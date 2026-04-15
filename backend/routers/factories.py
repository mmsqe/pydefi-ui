"""
Factory-related API routes.

GET  /api/factories   — list all registered factories with last indexed block
POST /api/factories   — register a new factory
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel
from pydefi.indexer.models import Factory, IndexerState
from sqlmodel import Session, select

from backend.deps import get_indexer

router = APIRouter()


class AddFactoryBody(BaseModel):
    factory_address: str
    protocol: str
    chain_id: int


@router.get("/factories")
def list_factories() -> list[dict]:
    """Return all registered factories joined with their last indexed block."""
    indexer = get_indexer()

    with Session(indexer._engine) as session:
        factories = session.exec(select(Factory)).all()
        result: list[dict] = []
        for factory in factories:
            state = session.get(IndexerState, factory.factory_address.lower())
            last_block: Optional[int] = state.last_indexed_block if state else None
            result.append(
                {
                    "factory_address": factory.factory_address,
                    "protocol": factory.protocol,
                    "chain_id": factory.chain_id,
                    "last_indexed_block": last_block,
                }
            )
    return result


@router.post("/factories", status_code=201)
def add_factory(body: AddFactoryBody) -> dict:
    """Register a factory contract for automatic pool discovery."""
    indexer = get_indexer()
    indexer.add_factory(
        factory_address=body.factory_address,
        protocol=body.protocol,
        chain_id=body.chain_id,
    )
    return {"status": "ok", "factory_address": body.factory_address.lower()}
