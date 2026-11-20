# Backend: AI Response Validation System

FastAPI + SQLite-backed vector retrieval (FAISS when installed, otherwise NumPy) +
a sequential multi-agent evaluation pipeline (LangGraph when installed).
Works without an API key: relevance, claim verification, and completeness use
explicitly reported heuristic fallbacks; accuracy and hallucination scores are
deterministic aggregations of claim judgments. Add `ANTHROPIC_API_KEY` to `.env`
to enable LLM relevance, claim extraction/verification, and completeness judges.
Similarity and keyword overlap are retrieval/fallback signals, not factual proof.

## Run (Windows)
```
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```
Mac/Linux: use `source venv/bin/activate` and `cp .env.example .env`.

- Health check: http://localhost:8000/health  (frontend switches to Live API mode)
- Interactive docs: http://localhost:8000/docs
- Run tests: `python -m pytest -q`

If the embedding model is unavailable, the app uses a labeled hashing fallback.
Stored chunks are re-embedded when the active embedding model changes; development
documents are not deleted.

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | status, LLM, embedding, and vector-search mode |
| POST | `/api/evaluate` | run full evaluation `{prompt, response, corpus, reference_answer, strictness, top_k}` |
| GET | `/api/evaluations` | history (`q`, `verdict`, `limit`, `offset`) |
| GET/DELETE | `/api/evaluations/{id}` | detail / delete |
| GET | `/api/stats` | dashboard KPIs |
| GET/POST | `/api/knowledge/documents` | list / upload (.pdf .txt .md .json; 10 MiB max) |
| POST | `/api/knowledge/documents/text` | add raw text |
| DELETE | `/api/knowledge/documents/{id}` | remove document |
| POST | `/api/knowledge/documents/{id}/reindex` | re-embed a document using the active embedding model |
| GET | `/api/knowledge/documents/{id}/chunks` | inspect chunks |
| POST | `/api/knowledge/search` | semantic retrieval playground |
| POST | `/api/batch/evaluate` | CSV with `prompt` (or `question`), `response`, optional `reference_answer` |

Claim results include one of `supported`, `unsupported`, `contradicted`, or
`inconclusive`. Unsupported/inconclusive claims block a Pass; any contradiction
blocks a Pass, and contradicted medical/financial claims trigger Fail. Weights
remain 20/30/25/25, with Pass at 75 and Fail below 50.

## Structure
```
app/
  main.py            FastAPI app, CORS, /health
  config.py          env settings, score weights (20/30/25/25)
  db.py              SQLite schema
  schemas.py         request models
  rag/               chunker, embedder, FAISS store, demo seed data
  agents/            llm client, judges, aggregator (safety veto), pipeline (LangGraph)
  routers/           evaluations, knowledge, batch
tests/test_api.py
```

## Connect to the frontend
`src/services/apiClient.ts` must call the paths above. If the frontend expects
different paths or JSON field names, change them in the routers (or adapt apiClient.ts).
