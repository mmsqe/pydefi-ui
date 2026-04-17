"""
Swap routing routes.

POST /api/swap/quote  — off-chain quote via pydefi Router + indexed pool state
POST /api/swap/build  — compile DeFiVM execute() calldata for a swap
"""

from __future__ import annotations

import os
from decimal import Decimal, InvalidOperation
from typing import Optional

from eth_contract import Contract
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pydefi.exceptions import NoRouteFoundError
from pydefi.indexer.models import Pool, V2SyncEvent, V3SwapEvent
from pydefi.pathfinder.graph import PoolEdge, PoolGraph, V3PoolEdge
from pydefi.pathfinder.router import Router
from pydefi.types import Token, TokenAmount
from pydefi.utils import DEFI_VM_ABI, tx_data_bytes
from pydefi.vm import Program, build_execution_program_for_dag
from pydefi.vm.swap import build_swap_transaction, quote_swap_transaction
from sqlmodel import Session, select

from backend.deps import get_indexer, get_rpc_url

router = APIRouter()

# Sentinel used by pydefi for native ETH
_NATIVE_ADDRESS = Token.NATIVE_ADDRESS

# Known Uniswap V3 QuoterV2 addresses by chain ID (used for on-chain quote).
# quote_swap_transaction does a single eth_call against the QuoterV2 to get the
# actual amountOut from current on-chain pool state — much more accurate than
# the indexed (potentially stale) off-chain estimate.
_V3_QUOTER_BY_CHAIN: dict[int, str] = {
    1:        "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",  # Mainnet
    11155111: "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3",  # Sepolia
    8453:     "0x3d4e44Eb1374240CE5F1B136041212047e93690c",  # Base
    42161:    "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",  # Arbitrum
    137:      "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",  # Polygon
}


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


def _build_graph(
    session: Session,
    pools: list[Pool],
) -> tuple[PoolGraph, dict[str, Token]]:
    """Build a PoolGraph from indexed pool data with the latest reserve state."""
    graph = PoolGraph()
    token_registry: dict[str, Token] = {}
    token_by_symbol: dict[str, Token] = {}

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
                extra={"is_token0_in": True},
            ))
            graph.add_pool(PoolEdge(
                token_in=t1, token_out=t0, pool_address=addr, protocol=protocol,
                reserve_in=ev.reserve1, reserve_out=ev.reserve0, fee_bps=fee_bps,
                extra={"is_token0_in": False},
            ))
        elif "v4" in protocol:
            # V4 pools are not yet supported for DeFiVM execution; skip them.
            continue
        else:
            ev3: Optional[V3SwapEvent] = session.exec(
                select(V3SwapEvent)
                .where(V3SwapEvent.pool_address == addr)
                .order_by(V3SwapEvent.block_number.desc(), V3SwapEvent.log_index.desc())
                .limit(1)
            ).first()
            if ev3 is None or ev3.sqrt_price_x96 == 0 or ev3.liquidity == 0:
                continue
            graph.add_pool(V3PoolEdge(
                token_in=t0, token_out=t1, pool_address=addr, protocol=protocol,
                fee_bps=fee_bps, sqrt_price_x96=ev3.sqrt_price_x96,
                liquidity=ev3.liquidity, is_token0_in=True,
            ))
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
    """Compute an off-chain swap quote using the pydefi Router."""
    indexer = get_indexer()

    with Session(indexer._engine) as session:
        pools = session.exec(select(Pool)).all()
        graph, token_by_symbol = _build_graph(session, list(pools))

    if not token_by_symbol:
        raise HTTPException(status_code=422, detail="No indexed pools with price data found. Run a backfill first.")

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
    for step in route.steps:
        steps.append({
            "token_in": step.token_in.symbol,
            "token_out": step.token_out.symbol,
            "pool_address": step.pool_address,
            "protocol": step.protocol,
            "fee_bps": step.fee,
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
async def build_swap(body: BuildBody) -> dict:
    """Compile DeFiVM execute() calldata for a swap.

    Steps:
    1. Build PoolGraph from indexed state → find best route (off-chain).
    2. If RPC_URL is set, run ``quote_swap_transaction()`` — a single
       ``eth_call`` against the Uniswap QuoterV2 — to get the **actual** on-chain
       amountOut for V3 routes.  This is critical: indexed state can be stale,
       causing the off-chain estimate to diverge and the slippage check to revert.
    3. Compute ``min_final_out`` from the on-chain quote (fallback: off-chain).
    4. Compile the route to ``execute(bytes)`` calldata via
       ``build_swap_transaction`` from pydefi.

    Requires ``DEFI_VM_ADDRESS`` env var.  ``RPC_URL`` enables on-chain quoting.
    ``V3_QUOTER_ADDRESS`` overrides the built-in per-chain QuoterV2 default.
    """
    vm_address = os.environ.get("DEFI_VM_ADDRESS", "").strip()
    if not vm_address:
        raise HTTPException(
            status_code=503,
            detail=(
                "DEFI_VM_ADDRESS environment variable is not set. "
                "Set it to your deployed DeFiVM contract address."
            ),
        )

    # ── Build graph ──────────────────────────────────────────────────────────
    indexer = get_indexer()
    with Session(indexer._engine) as session:
        pools = session.exec(select(Pool)).all()
        graph, token_by_symbol = _build_graph(session, list(pools))

    if not token_by_symbol:
        raise HTTPException(status_code=422, detail="No indexed pools with price data found. Run a backfill first.")

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

    # ── Route (off-chain) ─────────────────────────────────────────────────────
    router_obj = Router(graph)
    try:
        route = router_obj.find_best_route(TokenAmount(tok_in, amount_in_raw), tok_out)
        dag = router_obj.find_best_route_dag(TokenAmount(tok_in, amount_in_raw), tok_out)
    except NoRouteFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    rpc_url = get_rpc_url()
    on_chain_quote_used = False
    on_chain_quote_note: str = ""
    # amount_out_for_slippage starts as the off-chain indexed estimate;
    # updated below if we obtain a better on-chain figure.
    amount_out_for_slippage: int = route.amount_out.amount

    # ── On-chain quote via QuoterV2 (V3-only routes) ──────────────────────────
    # quote_swap_transaction issues a single eth_call against the QuoterV2
    # to get the actual amountOut from current on-chain pool state.
    is_all_v3 = all("v3" in s.protocol.lower() for s in route.steps)
    if rpc_url and is_all_v3:
        quoter_address = (
            os.environ.get("V3_QUOTER_ADDRESS", "").strip()
            or _V3_QUOTER_BY_CHAIN.get(tok_in.chain_id, "")
        )
        if quoter_address:
            try:
                from web3 import AsyncWeb3
                w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(rpc_url))
                on_chain = await quote_swap_transaction(
                    route,
                    vm_address,
                    body.sender,
                    w3,
                    quoter_address,
                )
                if on_chain.amount > 0:
                    amount_out_for_slippage = on_chain.amount
                    on_chain_quote_used = True
            except Exception as exc:
                on_chain_quote_note = f"on-chain V3 quote failed ({exc}); using indexed estimate"
        else:
            on_chain_quote_note = "no V3 quoter address for this chain; using indexed estimate"
    elif not rpc_url:
        on_chain_quote_note = "RPC_URL not set; using indexed estimate (set RPC_URL for accurate slippage)"
    elif not is_all_v3:
        on_chain_quote_note = "route contains non-V3 hops; on-chain quote not supported, using indexed estimate"

    min_final_out = amount_out_for_slippage * (10_000 - body.slippage_bps) // 10_000
    amount_out_raw = amount_out_for_slippage
    amount_out_human = str(Decimal(amount_out_raw) / Decimal(10 ** tok_out.decimals))

    # ── Compile to DeFiVM calldata ────────────────────────────────────────────
    try:
        if body.is_native_in:
            # Prepend WETH.deposit() so the ETH wrap and swap execute atomically.
            weth_address = tok_in.address
            weth = Contract.from_abi(["function deposit() external payable"], to=weth_address)
            deposit_calldata = tx_data_bytes(weth.fns.deposit().data)
            swap_prog = build_execution_program_for_dag(
                dag,
                amount_in=amount_in_raw,
                vm_address=vm_address,
                recipient=body.sender,
                min_final_out=min_final_out,
            )
            full_program = (
                Program().call_contract(weth_address, deposit_calldata, value=amount_in_raw).pop()
                + swap_prog
            ).build()
            defi_vm = Contract.from_abi(DEFI_VM_ABI, to=vm_address)
            execute_data = tx_data_bytes(defi_vm.fns.execute(full_program).data)
            tx_to = vm_address
            tx_data_bytes_val = bytes(execute_data)
            tx_value = amount_in_raw
        else:
            tx = build_swap_transaction(dag, amount_in_raw, vm_address, body.sender, min_final_out=min_final_out)
            tx_to = tx.to
            tx_data_bytes_val = bytes(tx.data)
            tx_value = tx.value
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    result: dict = {
        "to": tx_to,
        "data": "0x" + tx_data_bytes_val.hex(),
        "value": str(tx_value),
        "value_eth": str(Decimal(tx_value) / Decimal(10**18)) if tx_value else "0",
        "token_in": body.token_in,
        "token_out": body.token_out,
        "amount_in": body.amount_in,
        "amount_out": str(amount_out_raw),
        "amount_out_human": amount_out_human,
        "amount_out_min": str(min_final_out),
        "slippage_bps": body.slippage_bps,
        "on_chain_quote": on_chain_quote_used,
    }
    if on_chain_quote_note:
        result["on_chain_quote_note"] = on_chain_quote_note
    return result
