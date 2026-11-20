import csv
import io
import logging
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from ..agents.pipeline import run_pipeline
from .evaluations import save_evaluation

router = APIRouter(prefix="/api/batch", tags=["batch"])
MAX_ROWS = 200
logger = logging.getLogger(__name__)


@router.post("/evaluate")
async def batch_evaluate(file: UploadFile = File(...), corpus: str = Form("demo")):
    """CSV with columns: prompt,response  (optional: corpus)."""
    raw = await file.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "CSV file size exceeds the 5 MiB limit.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(400, "CSV files must use UTF-8 encoding.") from exc
    try:
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        rows = list(reader)
    except csv.Error as exc:
        raise HTTPException(400, "CSV file is malformed.") from exc
    fieldnames = [c.strip().lower() if c else "" for c in (reader.fieldnames or [])]
    prompt_column = "prompt" if "prompt" in fieldnames else "question" if "question" in fieldnames else None
    response_column = "response" if "response" in fieldnames else None
    if not prompt_column or not response_column:
        raise HTTPException(400, "CSV must have 'prompt' (or 'question') and 'response' columns")
    if not rows:
        raise HTTPException(400, "CSV must contain at least one evaluation row.")
    results, errors = [], []
    for i, row in enumerate(rows, start=1):
        if i > MAX_ROWS:
            errors.append({"row": i, "error": f"Row limit of {MAX_ROWS} reached"})
            break
        row = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
        prompt = row.get(prompt_column, "")
        response = row.get(response_column, "")
        if not prompt or not response:
            errors.append({"row": i, "error": "Empty prompt or response"})
            continue
        try:
            res = run_pipeline(prompt, response, row.get("corpus") or corpus,
                               reference_answer=row.get("reference_answer") or None)
            save_evaluation(res)
            results.append({"row": i, "id": res["id"], "prompt": res["prompt"], "response": res["response"],
                            "verdict": res["verdict"], "composite": res["composite"], "scores": res["scores"],
                            "safety_veto": res["safety_veto"]})
        except Exception as exc:
            logger.exception("Batch evaluation failed for row %s", i)
            errors.append({"row": i, "error": f"Evaluation failed ({type(exc).__name__})."})
    n = len(results)
    return {"processed": n, "failed": len(errors),
            "average_score": round(sum(r["composite"] for r in results) / n, 1) if n else 0,
            "results": results, "errors": errors}
