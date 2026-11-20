"""Judge agents. Each one tries the LLM first, then falls back to a heuristic."""
import re
from ..rag.store import search
from ..rag.embedder import embed
from .llm import call_json
from .text_utils import overlap, numbers, content_words

JUDGE_SYS = ("You are a strict evaluator of AI answers. Reply with ONLY a JSON object, no prose.")

MEDICAL = ["dose", "mg", "gram", "medicine", "drug", "tablet", "symptom", "disease", "diabetes",
           "treatment", "patient", "doctor", "paracetamol", "overdose", "infection"]
FINANCIAL = ["invest", "loan", "interest", "tax", "stock", "mutual fund", "sip", "return",
             "insurance", "credit", "emi", "portfolio"]


def detect_domain(text: str) -> str | None:
    t = text.lower()
    if any(w in t for w in MEDICAL):
        return "medical"
    if any(w in t for w in FINANCIAL):
        return "financial"
    return None


# ---------- Relevance ----------
def relevance_judge(prompt: str, response: str) -> dict:
    data = call_json(JUDGE_SYS, f'Rate 0-5 how well the RESPONSE addresses the PROMPT. '
                     f'JSON: {{"score": number, "reason": string}}\nPROMPT: {prompt}\nRESPONSE: {response}')
    score = _valid_score(data)
    if score is not None:
        return {"score": score, "reason": str(data.get("reason", "")), "mode": "llm"}
    ov = overlap(prompt, response)
    score = 5 * ov
    return {"score": round(score, 1), "reason": f"Prompt content-word coverage {ov:.0%}; heuristic fallback cannot establish semantic intent.",
            "mode": "heuristic"}


def _valid_score(data: dict | None) -> float | None:
    if not data or "score" not in data:
        return None
    try:
        score = float(data["score"])
    except (TypeError, ValueError):
        return None
    if not 0 <= score <= 5 or not re.fullmatch(r"(?:\d+(?:\.\d*)?|\.\d+)", str(data["score"]).strip()):
        return None
    return score


# ---------- Claims ----------
def extract_claims(response: str) -> list[str]:
    data = call_json(JUDGE_SYS, 'Split the RESPONSE into atomic factual claims. '
                     f'JSON: {{"claims": [string]}}\nRESPONSE: {response}')
    if data and isinstance(data.get("claims"), list):
        claims = [str(c).strip() for c in data["claims"] if isinstance(c, str) and c.strip()][:15]
        if claims:
            return claims
    sents = re.split(r"(?<=[.!?])\s+", response.strip())
    claims = [s.strip() for s in sents if len(s.split()) >= 3][:15]
    return claims or ([response.strip()] if response.strip() else [])


def _best_context(claim: str, text: str) -> tuple[str, str, float, int]:
    """Return the best sentence, its neighboring context, coverage, and shared terms."""
    sents = [x.strip() for x in re.split(r"(?<=[.!?])\s+|\n+", text) if x.strip()] or [text]
    claim_words = content_words(claim)
    candidates = []
    for i, sentence in enumerate(sents):
        shared = len(claim_words & content_words(sentence))
        coverage = shared / len(claim_words) if claim_words else 0.0
        candidates.append((coverage, shared, i, sentence))
    coverage, shared, best_index, best_sentence = max(candidates, default=(0.0, 0, 0, text))
    start, end = max(0, best_index - 1), min(len(sents), best_index + 2)
    return best_sentence, " ".join(sents[start:end]), coverage, shared


def _is_negated(s: str) -> bool:
    return bool(re.search(r"\b(?:not|never|no|cannot|can't|doesn't|don't|isn't|aren't|wasn't|weren't|without)\b", s.lower()))


_DENIAL = re.compile(
    r"\b(?:false|incorrect|untrue|myth|misconception|not true|does not happen|do not happen|"
    r"cannot happen|never happens|isn't true)\b",
    re.IGNORECASE,
)


def _heuristic_label(claim: str, evidence: list[dict], strictness: float) -> str:
    """Conservative offline fallback; vector similarity is retrieval, not proof."""
    if not evidence:
        return "inconclusive"
    candidates = [_best_context(claim, item["text"]) + (item,) for item in evidence]
    sentence, context, coverage, shared_count, best = max(candidates, key=lambda item: (item[2], item[3], item[4]["similarity"]))
    claim_words = content_words(claim)
    sentence_words = content_words(sentence)
    shared = (claim_words & sentence_words) - numbers(claim) - numbers(sentence)
    relevant = shared_count >= 2 and coverage >= 0.3
    if not relevant:
        return "inconclusive"

    # A nearby correction such as "Incorrect misconception: ... This is false"
    # negates the matching proposition even though the proposition itself is affirmative.
    if _DENIAL.search(context) and coverage >= 0.3:
        return "contradicted"

    claim_numbers, evidence_numbers = numbers(claim), numbers(sentence)
    if shared and claim_numbers and evidence_numbers and not (claim_numbers & evidence_numbers):
        return "contradicted"

    if _is_negated(claim) != _is_negated(sentence):
        return "contradicted"

    support_threshold = 0.65 + 0.2 * (strictness - 0.5)
    if coverage >= support_threshold:
        return "supported"
    # Relevant context that does not establish a claim is unsupported, not false.
    return "unsupported"


def verify_claims(claims: list[str], corpus: str | None, top_k: int, strictness: float,
                  reference_answer: str | None = None, prompt: str = "") -> list[dict]:
    results = []
    for i, c in enumerate(claims):
        ev = search(f"{prompt} {c}".strip(), k=top_k, corpus=corpus)
        if reference_answer:
            vectors = embed([c, reference_answer])
            ev.insert(0, {"text": reference_answer, "doc": "Provided reference answer",
                          "source": "Provided reference answer", "similarity": round(float(vectors[0] @ vectors[1]), 4)})
        label = _heuristic_label(f"{prompt} {c}".strip(), ev, strictness)
        reasons = {
            "supported": "The retrieved passage closely matches this claim and no direct contradiction was detected.",
            "unsupported": "Relevant evidence was retrieved, but it does not establish the claim.",
            "contradicted": "The retrieved passage directly conflicts with the claim or explicitly identifies it as false.",
            "inconclusive": "The available evidence is insufficient or irrelevant to decide this claim.",
        }
        results.append({"id": f"c{i + 1}", "text": c, "evidence": ev, "label": label,
                        "reason": reasons[label], "mode": "heuristic"})
    # Optional LLM verification of all claims in one call
    payload = [{"id": r["id"], "claim": r["text"], "evidence": [e["text"] for e in r["evidence"]]} for r in results]
    data = call_json(JUDGE_SYS, 'Classify each claim using its full evidence passages and surrounding context. '
                     'Use "supported" only when evidence entails the claim, "unsupported" when relevant evidence '
                     'does not establish it, "contradicted" only when evidence directly conflicts or explicitly '
                     'calls the matching proposition false, and "inconclusive" when evidence is insufficient or '
                     'irrelevant. Similarity and keyword overlap are retrieval clues, not proof. Missing evidence '
                     'is not contradiction. Return a short reason for each classification. '
                     f'JSON: {{"labels": [{{"id": string, "label": string, "reason": string}}]}}\n{payload}')
    if data and isinstance(data.get("labels"), list):
        labels = [item for item in data["labels"] if isinstance(item, dict)]
        by_id = {item.get("id"): item.get("label") for item in labels}
        for r in results:
            label = by_id.get(r["id"])
            if r["label"] != "contradicted" and label in ("supported", "unsupported", "contradicted", "inconclusive"):
                llm_item = next(item for item in labels if item.get("id") == r["id"])
                r["label"], r["mode"] = label, "llm"
                if isinstance(llm_item.get("reason"), str) and llm_item["reason"].strip():
                    r["reason"] = llm_item["reason"].strip()
    for r in results:
        r["similarity"] = r["evidence"][0]["similarity"] if r["evidence"] else 0.0
    return results


# ---------- Accuracy & Hallucination (derived from claim labels) ----------
def accuracy_judge(claims: list[dict]) -> dict:
    if not claims:
        return {"score": 0.0, "reason": "No claims found.", "mode": "heuristic"}
    pts = {"supported": 1.0, "inconclusive": 0.5, "unsupported": 0.4, "contradicted": 0.0}
    score = 5 * sum(pts[c["label"]] for c in claims) / len(claims)
    n_ok = sum(c["label"] == "supported" for c in claims)
    return {"score": round(score, 1),
            "reason": f"Deterministic aggregation: {n_ok}/{len(claims)} claims supported by evidence.",
            "mode": "derived"}


def hallucination_judge(claims: list[dict]) -> dict:
    """5 = no hallucination, 0 = severe."""
    if not claims:
        return {"score": 0.0, "reason": "No claims found.", "mode": "heuristic"}
    pen = sum(1.0 if c["label"] == "contradicted" else 0.4 if c["label"] == "unsupported" else 0
              for c in claims) / len(claims)
    nc = sum(c["label"] == "contradicted" for c in claims)
    nu = sum(c["label"] == "unsupported" for c in claims)
    return {"score": round(max(0.0, 5 * (1 - pen)), 1),
            "reason": f"Deterministic penalty aggregation: {nc} contradicted, {nu} unsupported claim(s).",
            "mode": "derived"}


# ---------- Completeness ----------
def completeness_judge(prompt: str, response: str, retrieved: list[dict]) -> dict:
    ctx = "\n".join(r["text"] for r in retrieved[:3])
    data = call_json(JUDGE_SYS, 'Rate 0-5 how completely the RESPONSE covers what the PROMPT needs, using the '
                     'REFERENCE. JSON: {"score": number, "reason": string, "missing": [string]}\n'
                     f'PROMPT: {prompt}\nRESPONSE: {response}\nREFERENCE: {ctx}')
    score = _valid_score(data)
    if score is not None:
        return {"score": score, "reason": str(data.get("reason", "")),
                "missing": data.get("missing", []) if isinstance(data.get("missing", []), list) else [],
                "mode": "llm"}
    cover = overlap(prompt, response)
    ref_cover = overlap(retrieved[0]["text"], response) if retrieved else 0.0
    length = min(1.0, len(response.split()) / 25)
    score = 5 * (0.35 * cover + 0.35 * min(1.0, ref_cover * 2) + 0.3 * length)
    missing_terms = sorted(content_words(prompt) - content_words(response))
    missing = [f"Prompt terms not reflected in the response: {', '.join(missing_terms[:8])}"] if missing_terms else []
    return {"score": round(score, 1), "missing": missing,
            "reason": f"Heuristic prompt-term coverage {cover:.0%}, reference coverage {ref_cover:.0%}; "
                      "term coverage is not semantic completeness.", "mode": "heuristic"}
