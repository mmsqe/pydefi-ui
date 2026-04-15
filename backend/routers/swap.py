"""
Swap routing routes.

POST /api/swap/quote  — off-chain quote via pydefi Router + indexed pool state
POST /api/swap/build  — placeholder (returns 501 until DeFi VM integration is wired)
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pydefi.exceptions import NoRouteFoundError
from pydefi.indexer.models import Pool, V2SyncEvent, V3SwapEvent
from pydefi.pathfinder.graph import PoolEdge, PoolGraph, V3PoolEdge
from pydefi.pathfinder.router import Router
from pydefi.types import Token, TokenAmount
from sqlmodel import Session, select

from backend.deps import get_indexer

router = APIRouter()

# Sentinel used by pydefi for native ETH
_NATIVE_ADDRESS = Token.NATIVE_ADDRESS


# ---------------------------------------------------------------------------
# Request / response bodies
# ---------------------------------------------------------------------------


class QuoteBody(BaseModel):
    token_in: str  # symbol or "ETH"
    token_out: str  # symbol or "ETH"
    amount_in: str  # human-readable, e.g. "0.1"
    is_native_in: bool = False
    is_native_out: bool = False
    chain_id: Optional[int] = None


class BuildBody(BaseModel):
    token_in: str
    token_out: str
    amount_in: str
    amount_out_min: str
    slippage_bps: int = 50
    sender: str
    is_native_in: bool = False
    is_native_out: bool = False


# ---------------------------------------------------------------------------
# Graph builder
# ---------------------------------------------------------------------------


def _build_graph(session: Session, pools: list[Pool]) -> tuple[PoolGraph, dict[str, Token]]:
    """Build a PoolGraph from indexed pool data with the latest reserve state.

    For each pool the most-recent event is fetched to get current reserves
    (V2 SyncEvent → reserve0/reserve1) or current price/liquidity
    (V3 SwapEvent → sqrtPriceX96/liquidity).  Pools with no indexed events
    are skipped — they carry no usable price information.

    Returns:
        graph: Populated PoolGraph (both directions added for each pool).
        token_by_symbol: symbol → Token mapping (case-sensitive, first seen wins).
    """
    graph = PoolGraph()
    token_registry: dict[str, Token] = {}  # lowercase address → Token
    token_by_symbol: dict[str, Token] = {}  # symbol → Token

    def _get_or_create(address: str, symbol: str, decimals: int, chain_id: int) -> Token:
        key = address.lower()
        if key not in token_registry:
            tok = Token(chain_id=chain_id, address=address, symbol=symbol, decimals=decimals)
            token_registry[key] = tok
            token_by_symbol.setdefault(symbol, tok)
        return token_registry[key]

    for pool in pools:
        addr = pool.pool_address.lower()
        protocol = (pool.protocol or "unknown").lower()
        fee_bps = pool.fee_bps or 30

        t0 = _get_or_create(pool.token0_address, pool.token0_symbol, pool.token0_decimals, pool.chain_id)
        t1 = _get_or_create(pool.token1_address, pool.token1_symbol, pool.token1_decimals, pool.chain_id)

        if protocol in ("v2", "sushiswap", "uniswapv2"):
            ev: Optional[V2SyncEvent] = session.exec(
                select(V2SyncEvent)
                .where(V2SyncEvent.pool_address == addr)
                .order_by(V2SyncEvent.block_number.desc(), V2SyncEvent.log_index.desc())
                .limit(1)
            ).first()
            if ev is None or ev.reserve0 == 0 or ev.reserve1 == 0:
                continue
            graph.add_pool(PoolEdge(
                token_in=t0, token_out=t1, pool_address=addr, protocol=protocol,
                reserve_in=ev.reserve0, reserve_out=ev.reserve1, fee_bps=fee_bps,
            ))
            graph.add_pool(PoolEdge(
                token_in=t1, token_out=t0, pool_address=addr, protocol=protocol,
                reserve_in=ev.reserve1, reserve_out=ev.reserve0, fee_bps=fee_bps,
            ))
        else:
            # V3, V4, and any other protocol that uses sqrtPriceX96/liquidity
            ev3: Optional[V3SwapEvent] = session.exec(
                select(V3SwapEvent)
                .where(V3SwapEvent.pool_address == addr)
                .order_by(V3SwapEvent.block_number.desc(), V3SwapEvent.log_index.desc())
                .limit(1)
            ).first()
            if ev3 is None or ev3.sqrt_price_x96 == 0 or ev3.liquidity == 0:
                continue
            # token0 → token1: is_token0_in=True
            graph.add_pool(V3PoolEdge(
                token_in=t0, token_out=t1, pool_address=addr, protocol=protocol,
                fee_bps=fee_bps, sqrt_price_x96=ev3.sqrt_price_x96,
                liquidity=ev3.liquidity, is_token0_in=True,
            ))
            # token1 → token0: is_token0_in=False
            graph.add_pool(V3PoolEdge(
                token_in=t1, token_out=t0, pool_address=addr, protocol=protocol,
                fee_bps=fee_bps, sqrt_price_x96=ev3.sqrt_price_x96,
                liquidity=ev3.liquidity, is_token0_in=False,
            ))

    return graph, token_by_symbol


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/swap/quote")
def get_quote(body: QuoteBody) -> dict:
    """Compute an off-chain swap quote using the pydefi Router.

    Builds a PoolGraph from the latest indexed reserve state, then runs
    hop-bounded DP to find the best output amount.  ETH is treated as WETH
    for routing purposes (pools pair with WETH; the actual wrap happens at
    execution time via the Universal Router).
    """
    indexer = get_indexer()

    with Session(indexer._engine) as session:
        pools = session.exec(select(Pool)).all()
        graph, token_by_symbol = _build_graph(session, list(pools))

    if not token_by_symbol:
        raise HTTPException(status_code=422, detail="No indexed pools with price data found. Run a backfill first.")

    # ETH routes via WETH internally
    sym_in = "WETH" if body.is_native_in else body.token_in
    sym_out = "WETH" if body.is_native_out else body.token_out

    tok_in = token_by_symbol.get(sym_in)
    tok_out = token_by_symbol.get(sym_out)

    if tok_in is None:
        raise HTTPException(status_code=422, detail=f"Token '{sym_in}' not found in any indexed pool.")
    if tok_out is None:
        raise HTTPException(status_code=422, detail=f"Token '{sym_out}' not found in any indexed pool.")
    if tok_in.address.lower() == tok_out.address.lower():
        raise HTTPException(status_code=422, detail="token_in and token_out must be different.")

    try:
        amount_in_raw = int(Decimal(body.amount_in) * Decimal(10 ** tok_in.decimals))
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=422, detail=f"Invalid amount_in: {body.amount_in!r}")

    if amount_in_raw <= 0:
        raise HTTPException(status_code=422, detail="amount_in must be positive.")

    try:
        route = Router(graph).find_best_route(TokenAmount(tok_in, amount_in_raw), tok_out)
    except NoRouteFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    amount_out_raw = route.amount_out.amount
    amount_out_human = str(Decimal(amount_out_raw) / Decimal(10 ** tok_out.decimals))

    price_impact = route.price_impact
    price_impact_str = "NaN" if price_impact.is_nan() else str(price_impact.quantize(Decimal("0.000001")))

    steps = []
    for leg in route.legs:
        for step in leg.route.steps:
            steps.append({
                "token_in": step.token_in.symbol,
                "token_out": step.token_out.symbol,
                "pool_address": step.pool_address,
                "protocol": step.protocol,
                "fee_bps": step.fee,
                "pct": leg.weight_bps // 100,
            })

    return {
        "amount_out": str(amount_out_raw),
        "amount_out_human": amount_out_human,
        "price_impact": price_impact_str,
        "token_in": body.token_in,
        "token_out": body.token_out,
        "route": steps,
    }


@router.post("/swap/build")
def build_swap(_body: BuildBody) -> dict:
    """Build transaction calldata for a swap.

    Not yet implemented — requires DeFi VM / Universal Router integration.
    """
    raise HTTPException(
        status_code=501,
        detail="swap/build is not yet implemented. DeFi VM integration pending.",
    )
