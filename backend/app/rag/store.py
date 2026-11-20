"""Vector store: chunks + embeddings live in SQLite, search uses FAISS if available."""
import importlib.util
import numpy as np
from ..db import conn
from .chunker import chunk_text
from .embedder import embed, embedding_model_id

_faiss = importlib.util.find_spec("faiss") is not None


def search_backend_name() -> str:
    return "FAISS IndexFlatIP" if _faiss else "NumPy exact inner product"


def add_document(name: str, corpus: str, text: str) -> dict:
    chunks = chunk_text(text)
    if not chunks:
        raise ValueError("Document has no readable text")
    embs = embed(chunks).astype(np.float32)
    model_id = embedding_model_id()
    c = conn()
    try:
        cur = c.execute("INSERT INTO documents(name, corpus, n_chunks) VALUES(?,?,?)",
                        (name, corpus, len(chunks)))
        doc_id = cur.lastrowid
        c.executemany("INSERT INTO chunks(doc_id, idx, text, emb, embedding_model) VALUES(?,?,?,?,?)",
                      [(doc_id, i, t, embs[i].tobytes(), model_id) for i, t in enumerate(chunks)])
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()
    return {"id": doc_id, "name": name, "corpus": corpus, "n_chunks": len(chunks)}


def list_documents() -> list[dict]:
    c = conn()
    rows = c.execute("SELECT id, name, corpus, n_chunks, created_at FROM documents ORDER BY id DESC").fetchall()
    c.close()
    return [dict(r) for r in rows]


def delete_document(doc_id: int) -> bool:
    c = conn()
    cur = c.execute("DELETE FROM documents WHERE id=?", (doc_id,))
    c.commit()
    c.close()
    return cur.rowcount > 0


def get_chunks(doc_id: int) -> list[dict]:
    c = conn()
    rows = c.execute("SELECT id, idx, text FROM chunks WHERE doc_id=? ORDER BY idx", (doc_id,)).fetchall()
    c.close()
    return [dict(r) for r in rows]


def reindex_document(doc_id: int) -> bool:
    c = conn()
    rows = c.execute("SELECT id, text FROM chunks WHERE doc_id=? ORDER BY idx", (doc_id,)).fetchall()
    if not rows:
        c.close()
        return False
    embeddings = embed([row["text"] for row in rows]).astype(np.float32)
    model_id = embedding_model_id()
    try:
        c.executemany("UPDATE chunks SET emb=?, embedding_model=? WHERE id=?",
                      [(embeddings[i].tobytes(), model_id, row["id"]) for i, row in enumerate(rows)])
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()
    return True


def search(query: str, k: int = 3, corpus: str | None = None) -> list[dict]:
    q = embed([query]).astype(np.float32)
    model_id = embedding_model_id()
    c = conn()
    sql = ("SELECT ch.id, ch.doc_id, ch.idx, ch.text, ch.emb, ch.embedding_model, d.name AS doc_name "
           "FROM chunks ch JOIN documents d ON d.id = ch.doc_id")
    rows = c.execute(sql + (" WHERE d.corpus=?" if corpus else ""), (corpus,) if corpus else ()).fetchall()
    try:
        if not rows:
            return []
        stale = [i for i, row in enumerate(rows) if row["embedding_model"] != model_id]
        if stale:
            refreshed = embed([rows[i]["text"] for i in stale]).astype(np.float32)
            for vector_index, row_index in enumerate(stale):
                c.execute("UPDATE chunks SET emb=?, embedding_model=? WHERE id=?",
                          (refreshed[vector_index].tobytes(), model_id, rows[row_index]["id"]))
            c.commit()
            rows = c.execute(sql + (" WHERE d.corpus=?" if corpus else ""), (corpus,) if corpus else ()).fetchall()

        matrix = [np.frombuffer(row["emb"], dtype=np.float32) for row in rows]
        if any(vector.shape != q[0].shape for vector in matrix):
            raise ValueError("Stored embedding dimensions do not match the active embedding model.")
        mat = np.vstack(matrix)
        k = min(k, len(rows))
        if _faiss:
            import faiss
            index = faiss.IndexFlatIP(mat.shape[1])
            index.add(mat)
            distances, indices = index.search(q, k)
            pairs = [(int(i), float(score)) for i, score in zip(indices[0], distances[0]) if i >= 0]
        else:
            similarities = mat @ q[0]
            top = np.argsort(-similarities)[:k]
            pairs = [(int(i), float(similarities[i])) for i in top]
    finally:
        c.close()
    return [{"chunk_id": rows[i]["id"], "doc_id": rows[i]["doc_id"], "doc": rows[i]["doc_name"],
             "source": rows[i]["doc_name"],
             "chunk_index": rows[i]["idx"], "text": rows[i]["text"], "similarity": round(s, 4)}
            for i, s in pairs]
