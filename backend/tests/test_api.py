import pytest
from fastapi.testclient import TestClient

from app import db
from app.agents import judges
from app.agents.aggregator import aggregate
from app.main import app
from app.rag import embedder, store


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(embedder, "_use_st", False)
    monkeypatch.setattr(store, "embed", embedder._hash_embed)
    monkeypatch.setattr(judges, "embed", embedder._hash_embed)
    monkeypatch.setattr(judges, "call_json", lambda *args, **kwargs: None)
    with TestClient(app) as test_client:
        yield test_client


def test_health_evaluation_and_persistence(client):
    assert client.get("/health").json()["status"] == "ok"

    bad = client.post("/api/evaluate", json={
        "prompt": "What is the maximum daily dose of paracetamol for adults?",
        "response": "The maximum daily dose is 8 grams. It is used for pain and fever."
    }).json()
    assert bad["verdict"] == "Fail"
    assert bad["safety_veto"] is True
    assert bad["verdict_reason"]

    good = client.post("/api/evaluate", json={
        "prompt": "What is the capital of France?",
        "response": "Paris is the capital of France."
    }).json()
    assert good["verdict"] == "Pass"
    assert good["claims"][0]["label"] == "supported"
    assert all(0 <= score <= 5 for score in good["scores"].values())
    assert 0 <= good["composite"] <= 100

    assert client.get(f"/api/evaluations/{good['id']}").json()["id"] == good["id"]
    listed = client.get("/api/evaluations").json()
    assert listed["total"] == 2
    assert listed["items"][0]["data"]["id"] == good["id"]
    assert client.get("/api/stats").json()["total"] == 2


def test_negated_misconception_cannot_pass(client):
    result = client.post("/api/evaluate", json={
        "prompt": "Do watermelon seeds grow in your stomach?",
        "response": "If you swallow watermelon seeds, they grow into watermelon plants inside your stomach.",
        "reference_answer": "Incorrect misconception: You grow watermelons in your stomach. This is false."
    }).json()

    assert result["claims"][0]["label"] == "contradicted"
    assert any("misconception" in item["text"].lower() for item in result["claims"][0]["evidence"])
    assert result["verdict"] != "Pass"
    assert "contradiction" in result["verdict_reason"].lower()


@pytest.mark.parametrize(
    ("claim", "evidence", "expected"),
    [
        ("Water boils at 100 degrees Celsius.", [], "inconclusive"),
        ("Adult maximum daily dose is 8 grams.", [
            {"text": "Adults should not take more than 4 grams of paracetamol in 24 hours.", "similarity": 0.9}
        ], "contradicted"),
        ("The capital of France is Paris.", [
            {"text": "Paris is the capital and largest city of France.", "similarity": 0.9}
        ], "supported"),
        ("The capital of France is Tokyo.", [
            {"text": "France is a country in Western Europe.", "similarity": 0.2}
        ], "inconclusive"),
    ],
)
def test_claim_evidence_labels_are_conservative(claim, evidence, expected):
    assert judges._heuristic_label(claim, evidence, 0.5) == expected


def test_unsupported_claim_is_not_a_contradiction():
    label = judges._heuristic_label(
        "France's population is 67 million residents.",
        [{"text": "France publishes annual population estimates.", "similarity": 0.7}],
        0.5,
    )
    assert label == "unsupported"


def test_aggregator_never_passes_a_contradicted_claim():
    result = aggregate(
        "What is true?", "False answer.", {
            "relevance": 5, "accuracy": 5, "hallucination": 5, "completeness": 5,
        }, [{"label": "contradicted"}],
    )
    assert result["verdict"] == "Needs Improvement"


def test_empty_and_invalid_api_inputs_are_rejected(client):
    assert client.post("/api/evaluate", json={"prompt": " ", "response": "x"}).status_code == 422
    assert client.post("/api/knowledge/search", json={"query": " "}).status_code == 422
    assert client.get("/api/evaluations?limit=0").status_code == 422
    assert client.get("/api/evaluations?offset=-1").status_code == 422


def test_knowledge_upload_search_chunks_and_delete(client):
    added = client.post("/api/knowledge/documents/text", json={
        "name": "Custom facts", "corpus": "test", "text": "The moon orbits Earth every 27 days."
    }).json()
    assert added["n_chunks"] == 1
    docs = client.get("/api/knowledge/documents").json()
    assert any(doc["id"] == added["id"] for doc in docs)
    assert client.get(f"/api/knowledge/documents/{added['id']}/chunks").json()[0]["text"]
    results = client.post("/api/knowledge/search", json={
        "query": "How long is the moon's orbit?", "corpus": "test"
    }).json()["results"]
    assert results and results[0]["source"] == "Custom facts"
    assert client.delete(f"/api/knowledge/documents/{added['id']}").status_code == 200
    assert client.get(f"/api/knowledge/documents/{added['id']}/chunks").json() == []


def test_batch_uses_same_pipeline_and_reports_invalid_rows(client):
    data = (
        "prompt,response,reference_answer\n"
        '"What is a capital?","Paris is the capital of France.","Paris is the capital of France."\n'
        '"Is the Earth flat?","","No; Earth is approximately spherical."\n'
    ).encode()
    response = client.post("/api/batch/evaluate", files={"file": ("sample.csv", data, "text/csv")})
    assert response.status_code == 200
    result = response.json()
    assert result["processed"] == 1
    assert result["failed"] == 1
    assert result["results"][0]["id"]
    assert result["errors"][0]["row"] == 2


def test_batch_requires_data_rows(client):
    response = client.post("/api/batch/evaluate", files={
        "file": ("empty.csv", b"prompt,response\n", "text/csv")
    })
    assert response.status_code == 400


def test_delete_evaluation(client):
    result = client.post("/api/evaluate", json={
        "prompt": "Question", "response": "A concise response."
    }).json()
    assert client.delete(f"/api/evaluations/{result['id']}").status_code == 200
    assert client.get(f"/api/evaluations/{result['id']}").status_code == 404


def test_similarity_is_not_used_as_fact_support():
    assert judges._heuristic_label(
        "The moon is made of cheese.",
        [{"text": "The Moon orbits Earth.", "similarity": 0.99}],
        0.5,
    ) == "inconclusive"
