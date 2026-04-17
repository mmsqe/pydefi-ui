"""
Pool-related API routes.

GET  /api/pools                       — list / search pools
GET  /api/pools/{address}             — single pool metadata
GET  /api/pools/{address}/history     — price + event history
POST /api/pools/v2                    — register a V2 pool
POST /api/pools/v3                    — register a V3 pool
DELETE /api/pools/{address}           — remove a pool
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Optional

import sqlalchemy as sa
from fastapi import APIRouter, HTTPException
from pydefi.indexer import Pool, V2SyncEvent, V3SwapEvent
from sqlmodel import Session, select

from backend.deps import get_indexer

router = APIRouter()

# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _pool_to_dict(pool: Pool) -> dict:
    return {
        "pool_address": pool.pool_address,
        "protocol": pool.protocol,
        "chain_id": pool.chain_id,
        "token0_address": pool.token0_address,
        "token0_symbol": pool.token0_symbol,
        "token0_decimals": pool.token0_decimals,
        "token1_address": pool.token1_address,
        "token1_symbol": pool.token1_symbol,
        "token1_decimals": pool.token1_decimals,
        "fee_bps": pool.fee_bps,
    }


def _compute_v2_price(
    reserve0: int,
    reserve1: int,
    dec0: int,
    dec1: int,
) -> Optional[float]:
    """Return token1-per-token0 price using Decimal arithmetic."""
    try:
        r0 = Decimal(reserve0) / Decimal(10**dec0)
        r1 = Decimal(reserve1) / Decimal(10**dec1)
        if r0 == 0:
            return None
        return float(r1 / r0)
    except (InvalidOperation, ZeroDivisionError):
        return None


def _compute_v3_price(
    sqrt_price_x96: int,
    dec0: int,
    dec1: int,
) -> Optional[float]:
    """Return token1-per-token0 price from sqrtPriceX96 using Decimal arithmetic."""
    try:
        two_96 = Decimal(2**96)
        sqrt_p = Decimal(sqrt_price_x96) / two_96
        raw_price = sqrt_p * sqrt_p  # (sqrtP / 2^96)^2
        # Adjust for decimal difference
        price = raw_price * Decimal(10 ** (dec0 - dec1))
        return float(price)
    except (InvalidOperation, ZeroDivisionError, OverflowError):
        return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/pools")
def list_pools(
    q: Optional[str] = None,
    protocol: Optional[str] = None,
    chain_id: Optional[int] = None,
) -> list[dict]:
    """List all registered pools with optional filtering."""
    indexer = get_indexer()

    with Session(indexer._engine) as session:
        stmt = select(Pool)

        if protocol is not None:
            stmt = stmt.where(Pool.protocol == protocol)
        if chain_id is not None:
            stmt = stmt.where(Pool.chain_id == chain_id)

        pools = session.exec(stmt).all()

    if q:
        q_lower = q.lower()
        pools = [
            p
            for p in pools
            if q_lower in p.pool_address.lower()
            or q_lower in p.token0_symbol.lower()
            or q_lower in p.token1_symbol.lower()
            or q_lower in p.token0_address.lower()
            or q_lower in p.token1_address.lower()
        ]

    return [_pool_to_dict(p) for p in pools]


@router.get("/pools/{address}")
def get_pool(address: str) -> dict:
    """Return metadata for a single pool plus its last indexed block."""
    indexer = get_indexer()
    addr = address.lower()

    with Session(indexer._engine) as session:
        pool = session.get(Pool, addr)
        if pool is None:
            raise HTTPException(status_code=404, detail=f"Pool {address!r} not found")
        last_block: Optional[int] = session.execute(
            sa.select(sa.func.max(V2SyncEvent.block_number)).where(V2SyncEvent.pool_address == addr)
        ).scalar_one_or_none()
        if last_block is None:
            last_block = session.execute(
                sa.select(sa.func.max(V3SwapEvent.block_number)).where(V3SwapEvent.pool_address == addr)
            ).scalar_one_or_none()

        result = _pool_to_dict(pool)
        result["last_indexed_block"] = last_block
        return result


@router.get("/pools/{address}/history")
def get_pool_history(address: str, limit: int = 500) -> list[dict]:
    """Return price + event history for a pool (V2 or V3 auto-detected)."""
    indexer = get_indexer()
    addr = address.lower()

    with Session(indexer._engine) as session:
        pool = session.get(Pool, addr)
        if pool is None:
            raise HTTPException(status_code=404, detail=f"Pool {address!r} not found")

        dec0: int = pool.token0_decimals
        dec1: int = pool.token1_decimals

        # Detect protocol: query V2SyncEvent first.
        v2_check = session.exec(select(V2SyncEvent).where(V2SyncEvent.pool_address == addr).limit(1)).first()

        rows: list[dict[str, Any]] = []

        if v2_check is not None:
            # V2 pool
            v2_events = session.exec(
                select(V2SyncEvent)
                .where(V2SyncEvent.pool_address == addr)
                .order_by(V2SyncEvent.block_number.asc(), V2SyncEvent.log_index.asc())
                .limit(limit)
            ).all()

            for ev in v2_events:
                price = _compute_v2_price(ev.reserve0, ev.reserve1, dec0, dec1)
                reserve0_human = float(Decimal(ev.reserve0) / Decimal(10**dec0)) if dec0 >= 0 else None
                reserve1_human = float(Decimal(ev.reserve1) / Decimal(10**dec1)) if dec1 >= 0 else None
                rows.append(
                    {
                        "block_number": ev.block_number,
                        "timestamp": ev.timestamp,
                        "price": price,
                        "reserve0_human": reserve0_human,
                        "reserve1_human": reserve1_human,
                        "sqrt_price_x96": None,
                        "liquidity": None,
                        "tick": None,
                        "amount0": None,
                        "amount1": None,
                        "tx_hash": ev.tx_hash,
                    }
                )
        else:
            # V3 pool
            v3_events = session.exec(
                select(V3SwapEvent)
                .where(V3SwapEvent.pool_address == addr)
                .order_by(V3SwapEvent.block_number.asc(), V3SwapEvent.log_index.asc())
                .limit(limit)
            ).all()

            for ev in v3_events:
                price = _compute_v3_price(ev.sqrt_price_x96, dec0, dec1)
                rows.append(
                    {
                        "block_number": ev.block_number,
                        "timestamp": ev.timestamp,
                        "price": price,
                        "reserve0_human": None,
                        "reserve1_human": None,
                        "sqrt_price_x96": str(ev.sqrt_price_x96),
                        "liquidity": str(ev.liquidity),
                        "tick": ev.tick,
                        "amount0": str(ev.amount0),
                        "amount1": str(ev.amount1),
                        "tx_hash": ev.tx_hash,
                    }
                )

    return rows


def _pool_fields_from_body(body: dict) -> dict:
    """Extract and validate pool registration fields from a request dict."""
    try:
        return {
            "pool_address": str(body["pool_address"]),
            "protocol": str(body["protocol"]),
            "token0_address": str(body["token0_address"]),
            "token0_symbol": str(body["token0_symbol"]),
            "token0_decimals": int(body["token0_decimals"]),
            "token1_address": str(body["token1_address"]),
            "token1_symbol": str(body["token1_symbol"]),
            "token1_decimals": int(body["token1_decimals"]),
            "chain_id": int(body["chain_id"]),
            "fee_bps": int(body.get("fee_bps", 30)),
        }
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid pool body: {exc}")


@router.post("/pools/v2", status_code=201)
def add_v2_pool(body: dict) -> dict:
    """Register a Uniswap V2-compatible pool."""
    fields = _pool_fields_from_body(body)
    indexer = get_indexer()
    indexer.add_v2_pool(**fields)
    return {"status": "ok", "pool_address": fields["pool_address"].lower()}


@router.post("/pools/v3", status_code=201)
def add_v3_pool(body: dict) -> dict:
    """Register a Uniswap V3-compatible pool."""
    fields = _pool_fields_from_body(body)
    indexer = get_indexer()
    indexer.add_v3_pool(**fields)
    return {"status": "ok", "pool_address": fields["pool_address"].lower()}


@router.delete("/pools/{address}", status_code=200)
def delete_pool(address: str) -> dict:
    """Remove a pool and its associated events from the database."""
    indexer = get_indexer()
    addr = address.lower()

    with Session(indexer._engine) as session:
        pool = session.get(Pool, addr)
        if pool is None:
            raise HTTPException(status_code=404, detail=f"Pool {address!r} not found")

        # Remove associated events first to avoid FK constraint issues.
        session.exec(sa.delete(V2SyncEvent).where(V2SyncEvent.pool_address == addr))
        session.exec(sa.delete(V3SwapEvent).where(V3SwapEvent.pool_address == addr))
        session.delete(pool)
        session.commit()

    # Drop from in-memory protocol cache.
    indexer._pool_protocol.pop(addr, None)

    return {"status": "ok", "pool_address": addr}
