"""
Indexer control routes.

POST /api/indexer/backfill  — run a historical back-fill
GET  /api/indexer/state     — list checkpoints for all tracked addresses
"""

from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pydefi.indexer.models import IndexerState
from sqlmodel import Session, select
from web3 import AsyncWeb3

from backend.deps import get_indexer, get_rpc_url

router = APIRouter()


class BackfillBody(BaseModel):
    from_block: int
    to_block: Optional[int] = None
    batch_size: int = 2000
    pool_address: Optional[str] = None


@router.post("/indexer/backfill")
def backfill(body: BackfillBody) -> dict:
    """Run a historical back-fill for registered pools / factories.

    Requires the ``RPC_URL`` environment variable to be set.  Creates a
    fresh :class:`~web3.AsyncWeb3` instance, assigns it to the indexer, then
    runs :meth:`~pydefi.indexer.PoolIndexer.backfill` synchronously via
    ``asyncio.run``.
    """
    rpc_url = get_rpc_url()
    if not rpc_url:
        raise HTTPException(
            status_code=400,
            detail="RPC_URL environment variable is not set.",
        )

    indexer = get_indexer()
    indexer.w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(rpc_url))

    events_stored: int = asyncio.run(
        indexer.backfill(
            from_block=body.from_block,
            to_block=body.to_block,
            batch_size=body.batch_size,
            pool_address=body.pool_address,
        )
    )

    return {"events_stored": events_stored}


@router.get("/indexer/state")
def get_indexer_state() -> list[dict]:
    """Return the last indexed block checkpoint for every tracked address."""
    indexer = get_indexer()

    with Session(indexer._engine) as session:
        states = session.exec(select(IndexerState)).all()

    return [{"address": s.address, "last_indexed_block": s.last_indexed_block} for s in states]
