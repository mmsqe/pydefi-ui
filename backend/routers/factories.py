"""
Factory-related API routes.

GET  /api/factories   — list all registered factories with last indexed block
POST /api/factories   — register a new factory
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydefi.indexer.models import Factory, IndexerState
from sqlmodel import Session, select

from backend.deps import get_indexer

router = APIRouter()


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
def add_factory(body: dict) -> dict:
    """Register a factory contract for automatic pool discovery.

    Request body keys (mirror :class:`~pydefi.indexer.models.Factory`):
      ``factory_address``, ``protocol``, ``chain_id``.
    """
    try:
        factory_address = str(body["factory_address"])
        protocol = str(body["protocol"])
        chain_id = int(body["chain_id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid factory body: {exc}")

    indexer = get_indexer()
    indexer.add_factory(factory_address=factory_address, protocol=protocol, chain_id=chain_id)
    return {"status": "ok", "factory_address": factory_address.lower()}
