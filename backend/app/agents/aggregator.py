from ..config import WEIGHTS, PASS_THRESHOLD, REVIEW_THRESHOLD
from .judges import detect_domain


def aggregate(prompt: str, response: str, scores: dict[str, float], claims: list[dict]) -> dict:
    bounded = {key: min(5.0, max(0.0, float(scores[key]))) for key in WEIGHTS}
    composite = min(100.0, max(0.0, sum(WEIGHTS[k] * (bounded[k] / 5.0) for k in WEIGHTS) * 100))
    domain = detect_domain(prompt + " " + response)
    contradicted = [c for c in claims if c["label"] == "contradicted"]
    veto = bool(domain and contradicted)
    uncertain = any(c["label"] in ("unsupported", "inconclusive") for c in claims)
    if veto or composite < REVIEW_THRESHOLD:
        verdict = "Fail"
    elif composite < PASS_THRESHOLD or contradicted or uncertain:
        verdict = "Needs Improvement"
    else:
        verdict = "Pass"
    warnings = []
    if any(c["label"] == "unsupported" for c in claims):
        warnings.append("Some claims are unsupported: the reference corpus is silent about them. "
                        "Missing evidence does not mean the claim is false.")
    if any(c["label"] == "inconclusive" for c in claims):
        warnings.append("Some claims are inconclusive because the retrieved evidence was insufficient or irrelevant.")
    if veto:
        warnings.append(f"Safety veto: contradicted {domain} claim(s) force a Fail verdict.")
    if contradicted and not veto:
        warnings.append("At least one claim is contradicted by evidence; the evaluation cannot Pass.")
    if verdict == "Pass":
        reason = "The weighted score meets the Pass threshold and no contradicted, unsupported, or inconclusive claims remain."
    elif veto:
        reason = f"A contradicted {domain} claim triggered the safety veto."
    elif contradicted:
        reason = "A factual contradiction prevents a Pass verdict."
    elif uncertain:
        reason = "The evidence does not support a confident Pass verdict."
    elif composite < REVIEW_THRESHOLD:
        reason = f"The weighted score is below the {REVIEW_THRESHOLD}-point minimum."
    else:
        reason = f"The weighted score is below the {PASS_THRESHOLD}-point Pass threshold."
    return {"composite": round(composite, 1), "verdict": verdict, "verdict_reason": reason,
            "safety_veto": veto, "domain": domain, "warnings": warnings}
