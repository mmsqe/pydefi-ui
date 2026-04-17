"""
GET /api/stats — aggregate counts across all indexed tables.
"""

from __future__ import annotations

from typing import Optional

import sqlalchemy as sa
from fastapi import APIRouter
from pydefi.indexer import Factory, IndexerState, Pool, V2SyncEvent, V3SwapEvent
from sqlmodel import Session

from backend.deps import get_indexer

router = APIRouter()


@router.get("/stats")
def get_stats() -> dict:
    """Return aggregate counts and the latest indexed block across all pools."""
    indexer = get_indexer()
    engine = indexer._engine

    with Session(engine) as session:
        pools: int = session.execute(sa.select(sa.func.count()).select_from(Pool)).scalar_one()
        factories: int = session.execute(sa.select(sa.func.count()).select_from(Factory)).scalar_one()
        v2_events: int = session.execute(sa.select(sa.func.count()).select_from(V2SyncEvent)).scalar_one()
        v3_events: int = session.execute(sa.select(sa.func.count()).select_from(V3SwapEvent)).scalar_one()
        latest_block: Optional[int] = session.execute(
            sa.select(sa.func.max(IndexerState.last_indexed_block))
        ).scalar_one_or_none()

    return {
        "pools": pools,
        "factories": factories,
        "v2_events": v2_events,
        "v3_events": v3_events,
        "latest_block": latest_block,
    }
