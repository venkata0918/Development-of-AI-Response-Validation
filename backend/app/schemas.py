from pydantic import BaseModel, Field, field_validator


class EvaluateRequest(BaseModel):
    prompt: str = Field(min_length=1)
    response: str = Field(min_length=1)
    corpus: str | None = "demo"
    reference_answer: str | None = None
    strictness: float = Field(0.5, ge=0, le=1)
    top_k: int = Field(3, ge=1, le=10)

    @field_validator("prompt", "response")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Text must not be blank")
        return value.strip()


class TextDocument(BaseModel):
    name: str
    corpus: str = "demo"
    text: str = Field(min_length=1)

    @field_validator("name", "corpus", "text")
    @classmethod
    def reject_blank_document_fields(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Value must not be blank")
        return value.strip()


class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    corpus: str | None = None
    top_k: int = Field(5, ge=1, le=20)

    @field_validator("query")
    @classmethod
    def reject_blank_query(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Query must not be blank")
        return value.strip()
