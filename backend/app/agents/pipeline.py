"""Evaluation pipeline. Runs as a LangGraph graph when langgraph is installed,
otherwise as a plain sequential loop (same nodes, same result)."""
import time
import uuid
from datetime import datetime, timezone
from typing import TypedDict
from ..rag.store import search
from . import judges
from .aggregator import aggregate


class State(TypedDict, total=False):
    prompt: str
    response: str
    corpus: str | None
    reference_answer: str | None
    strictness: float
    top_k: int
    retrieved: list
    claims: list
    scores: dict
    reasons: dict
    modes: dict
    trace: list
    result: dict
    missing: list[str]


def _trace(s: State, agent: str, summary: str, t0: float, mode: str = "heuristic"):
    s["trace"].append({"agent": agent, "summary": summary, "mode": mode,
                       "ms": round((time.time() - t0) * 1000)})


def n_retrieve(s: State):
    t0 = time.time()
    s["retrieved"] = search(s["prompt"] + " " + s["response"], k=s["top_k"], corpus=s["corpus"])
    if s.get("reference_answer"):
        s["retrieved"].insert(0, {"text": s["reference_answer"], "doc": "Provided reference answer",
                                  "source": "Provided reference answer"})
    _trace(s, "Retriever", f"Retrieved {len(s['retrieved'])} passage(s).", t0)


def n_claims(s: State):
    t0 = time.time()
    cl = judges.extract_claims(s["response"])
    s["claims"] = judges.verify_claims(cl, s["corpus"], s["top_k"], s["strictness"],
                                       s.get("reference_answer"), s["prompt"])
    modes = {claim["mode"] for claim in s["claims"]}
    mode = next(iter(modes)) if len(modes) == 1 else "mixed" if modes else "heuristic"
    _trace(s, "Claim Verifier", f"{len(cl)} claim(s) checked against available evidence.", t0, mode)


def n_relevance(s: State):
    t0 = time.time()
    r = judges.relevance_judge(s["prompt"], s["response"])
    s["scores"]["relevance"], s["reasons"]["relevance"] = r["score"], r["reason"]
    s["modes"]["relevance"] = r["mode"]
    _trace(s, "Relevance Judge", r["reason"], t0, r["mode"])


def n_accuracy(s: State):
    t0 = time.time()
    r = judges.accuracy_judge(s["claims"])
    s["scores"]["accuracy"], s["reasons"]["accuracy"] = r["score"], r["reason"]
    s["modes"]["accuracy"] = r["mode"]
    _trace(s, "Accuracy Judge", r["reason"], t0, r["mode"])


def n_hallucination(s: State):
    t0 = time.time()
    r = judges.hallucination_judge(s["claims"])
    s["scores"]["hallucination"], s["reasons"]["hallucination"] = r["score"], r["reason"]
    s["modes"]["hallucination"] = r["mode"]
    _trace(s, "Hallucination Sentinel", r["reason"], t0, r["mode"])


def n_completeness(s: State):
    t0 = time.time()
    r = judges.completeness_judge(s["prompt"], s["response"], s["retrieved"])
    s["scores"]["completeness"], s["reasons"]["completeness"] = r["score"], r["reason"]
    s["modes"]["completeness"] = r["mode"]
    s["missing"] = r.get("missing", [])
    _trace(s, "Completeness Judge", r["reason"], t0, r["mode"])


def n_aggregate(s: State):
    t0 = time.time()
    agg = aggregate(s["prompt"], s["response"], s["scores"], s["claims"])
    s["result"] = {
        "id": "EV-" + uuid.uuid4().hex[:8].upper(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "prompt": s["prompt"], "response": s["response"], "corpus": s["corpus"],
        "scores": s["scores"], "reasons": s["reasons"], "modes": s["modes"],
        "missing": s.get("missing", []), **agg,
        "claims": s["claims"], "retrieved": s["retrieved"], "trace": s["trace"],
    }
    _trace(s, "Verdict Aggregator", f"{agg['verdict_reason']} Composite: {agg['composite']}.", t0, "derived")


NODES = [("retrieve", n_retrieve), ("claims", n_claims), ("relevance", n_relevance),
         ("accuracy", n_accuracy), ("hallucination", n_hallucination),
         ("completeness", n_completeness), ("aggregate", n_aggregate)]

_graph = None
try:
    from langgraph.graph import StateGraph, START, END

    def _wrap(fn):
        def node(state):
            fn(state)
            return state
        return node

    _g = StateGraph(State)
    for name, fn in NODES:
        _g.add_node(name, _wrap(fn))
    _g.add_edge(START, NODES[0][0])
    for (a, _), (b, _) in zip(NODES, NODES[1:]):
        _g.add_edge(a, b)
    _g.add_edge(NODES[-1][0], END)
    _graph = _g.compile()
except ImportError:
    _graph = None


def run_pipeline(prompt: str, response: str, corpus: str | None = None,
                 strictness: float = 0.5, top_k: int = 3,
                 reference_answer: str | None = None) -> dict:
    state: State = {"prompt": prompt, "response": response, "corpus": corpus or None,
                    "reference_answer": reference_answer,
                    "strictness": strictness, "top_k": top_k, "scores": {}, "reasons": {},
                    "modes": {}, "trace": []}
    if _graph is not None:
        state = _graph.invoke(state)
    else:
        for _, fn in NODES:
            fn(state)
    return state["result"]
