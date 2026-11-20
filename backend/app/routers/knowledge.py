import io
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from ..rag import store
from ..schemas import SearchRequest, TextDocument

router = APIRouter(prefix="/api/knowledge", tags=["knowledge-base"])


def _read_upload(name: str, raw: bytes) -> str:
    if name.lower().endswith(".pdf"):
        try:
            from pypdf import PdfReader
        except ImportError:
            raise HTTPException(400, "PDF support needs: pip install pypdf")
        try:
            return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(raw)).pages)
        except Exception as exc:
            raise HTTPException(400, "The uploaded PDF could not be read.") from exc
    if not name.lower().endswith((".txt", ".md", ".json")):
        raise HTTPException(415, "Supported files are PDF, TXT, MD, and JSON.")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(400, "Text files must use UTF-8 encoding.") from exc


@router.get("/documents")
def documents():
    return store.list_documents()


@router.post("/documents")
async def upload(file: UploadFile = File(...), corpus: str = Form("demo")):
    raw = await file.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(413, "File size exceeds the 10 MiB limit.")
    text = _read_upload(file.filename or "upload.txt", raw)
    try:
        return store.add_document(file.filename or "upload", corpus, text)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/documents/text")
def add_text(doc: TextDocument):
    try:
        return store.add_document(doc.name, doc.corpus, doc.text)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/documents/{doc_id}")
def delete(doc_id: int):
    if not store.delete_document(doc_id):
        raise HTTPException(404, "Document not found")
    return {"deleted": doc_id}


@router.get("/documents/{doc_id}/chunks")
def chunks(doc_id: int):
    return store.get_chunks(doc_id)


@router.post("/documents/{doc_id}/reindex")
def reindex(doc_id: int):
    if not store.reindex_document(doc_id):
        raise HTTPException(404, "Document or chunks not found")
    return {"reindexed": doc_id}


@router.post("/search")
def search(req: SearchRequest):
    return {"query": req.query, "results": store.search(req.query, req.top_k, req.corpus)}
