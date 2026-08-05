"""Shared API schemas."""

from typing import List

from pydantic import BaseModel


class MediaUploadResponse(BaseModel):
    url: str


class ModelsResponse(BaseModel):
    llm_models: List[str]
    rag_models: List[str]
