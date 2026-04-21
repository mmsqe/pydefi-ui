"""
Swap routing routes.

POST /api/swap/quote  — off-chain quote via pydefi Router + indexed pool state
POST /api/swap/build  — compile DeFiVM execute() calldata for a swap
"""

from __future__ import annotations

import os
from decimal import Decimal, InvalidOperation

from eth_contract import Contract
from fastapi import APIRouter, HTTPException
from pydefi.abi import DeFiVM
from pydefi.abi.amm import UNISWAP_V2_FACTORY, UNISWAP_V2_PAIR, UNISWAP_V3_FACTORY, UNISWAP_V3_POOL
from pydefi.aggregator.base import AggregatorQuote
from pydefi.deployments import get_address
from pydefi.exceptions import NoRouteFoundError
from pydefi.indexer import Pool, V2SyncEvent, V3SwapEvent
from pydefi.pathfinder.graph import PoolEdge, PoolGraph, V3PoolEdge
from pydefi.pathfinder.router import Router
from pydefi.types import ZERO_ADDRESS, Address, RouteDAG, RouteSplit, RouteSplitLeg, RouteSwap, Token, TokenAmount
from pydefi.vm import Program, build_execution_program_for_dag, build_quote_program_for_dag
from pydefi.vm.swap import build_swap_transaction
from sqlmodel import Session, select

from backend.deps import get_indexer, get_rpc_url

router = APIRouter()

# Chains not yet in pydefi/deployments.py — residual fallback only.
_V3_QUOTER_EXTRA: dict[int, str] = {
    8453: "0x3d4e44Eb1374240CE5F1B136041212047e93690c",  # Base
    42161: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",  # Arbitrum
    137: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",  # Polygon
}


def _get_v3_quoter(chain_id: int) -> str:
    """Return the Uniswap V3 QuoterV2 address for *chain_id*.

    Prefers the pydefi deployment registry (``get_address``); falls back to the
    residual table for chains not yet registered there.
    """
    try:
        return get_address("UNISWAP_V3_QUOTER", chain_id)
    except KeyError:
        return _V3_QUOTER_EXTRA.get(chain_id, "")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _token_from_body(data: dict) -> Token:
    """Build a pydefi :class:`~pydefi.types.Token` from a request token dict.

    Expected keys: ``address``, ``symbol``, ``decimals``, ``chain_id``.
    """
    try:
        return Token(
            chain_id=int(data["chain_id"]),
            address=Address(data["address"]),
            symbol=str(data["symbol"]),
            decimals=int(data["decimals"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid token object: {exc}")


def _build_graph(session: Session, pools: list[Pool]) -> PoolGraph:
    """Build a :class:`~pydefi.pathfinder.graph.PoolGraph` from indexed pool data."""
    graph = PoolGraph()

    for pool in pools:
        pool_addr = Address(pool.pool_address)
        addr = pool_addr.to_0x_hex().lower()  # lowercase string for DB queries
        protocol = (pool.protocol or "unknown").lower()
        fee_bps = pool.fee_bps or 30

        t0 = Token(
            chain_id=pool.chain_id,
            address=Address(pool.token0_address),
            symbol=pool.token0_symbol,
            decimals=pool.token0_decimals,
        )
        t1 = Token(
            chain_id=pool.chain_id,
            address=Address(pool.token1_address),
            symbol=pool.token1_symbol,
            decimals=pool.token1_decimals,
        )

        if protocol in ("v2", "sushiswap", "uniswapv2"):
            ev = session.exec(
                select(V2SyncEvent)
                .where(V2SyncEvent.pool_address == addr)
                .order_by(V2SyncEvent.block_number.desc(), V2SyncEvent.log_index.desc())
                .limit(1)
            ).first()
            if ev is None or ev.reserve0 == 0 or ev.reserve1 == 0:
                continue
            graph.add_pool(
                PoolEdge(
                    token_in=t0,
                    token_out=t1,
                    pool_address=pool_addr,
                    protocol=protocol,
                    reserve_in=ev.reserve0,
                    reserve_out=ev.reserve1,
                    fee_bps=fee_bps,
                    extra={"is_token0_in": True},
                )
            )
            graph.add_pool(
                PoolEdge(
                    token_in=t1,
                    token_out=t0,
                    pool_address=pool_addr,
                    protocol=protocol,
                    reserve_in=ev.reserve1,
                    reserve_out=ev.reserve0,
                    fee_bps=fee_bps,
                    extra={"is_token0_in": False},
                )
            )
        elif "v4" in protocol:
            continue
        else:
            ev3 = session.exec(
                select(V3SwapEvent)
                .where(V3SwapEvent.pool_address == addr)
                .order_by(V3SwapEvent.block_number.desc(), V3SwapEvent.log_index.desc())
                .limit(1)
            ).first()
            if ev3 is None or ev3.sqrt_price_x96 == 0 or ev3.liquidity == 0:
                continue
            graph.add_pool(
                V3PoolEdge(
                    token_in=t0,
                    token_out=t1,
                    pool_address=pool_addr,
                    protocol=protocol,
                    fee_bps=fee_bps,
                    sqrt_price_x96=ev3.sqrt_price_x96,
                    liquidity=ev3.liquidity,
                    is_token0_in=True,
                )
            )
            graph.add_pool(
                V3PoolEdge(
                    token_in=t1,
                    token_out=t0,
                    pool_address=pool_addr,
                    protocol=protocol,
                    fee_bps=fee_bps,
                    sqrt_price_x96=ev3.sqrt_price_x96,
                    liquidity=ev3.liquidity,
                    is_token0_in=False,
                )
            )

    return graph


# ---------------------------------------------------------------------------
# DAG serialization
# ---------------------------------------------------------------------------


def _serialize_dag(dag) -> dict:
    """Convert a RouteDAG to a JSON-serializable dict for the frontend."""
    from pydefi.types import RouteSplit, RouteSwap

    def _actions(actions) -> list:
        result = []
        for action in actions:
            if isinstance(action, RouteSwap):
                result.append(
                    {
                        "type": "swap",
                        "token_out": action.token_out.symbol,
                        "pool_address": action.pool.pool_address.to_0x_hex(),
                        "protocol": action.pool.protocol,
                        "fee_bps": action.pool.fee_bps,
                    }
                )
            elif isinstance(action, RouteSplit):
                result.append(
                    {
                        "type": "split",
                        "token_out": action.token_out.symbol,
                        "legs": [
                            {"fraction_bps": leg.fraction_bps, "actions": _actions(leg.actions)} for leg in action.legs
                        ],
                    }
                )
        return result

    payload = dag.to_dict()
    return {"token_in": payload["token_in"].symbol, "actions": _actions(payload["actions"])}


# ---------------------------------------------------------------------------
# On-demand pool discovery (used as fallback when no route is found)
# ---------------------------------------------------------------------------


async def _augment_graph_on_demand(
    graph: PoolGraph,
    tok_in: Token,
    tok_out: Token,
    rpc_url: str,
) -> PoolGraph:
    """Discover direct pools for (tok_in, tok_out) via factory eth_calls.

    Called only after NoRouteFoundError — bypasses the event index and reads
    current slot0/liquidity directly so newly deployed or never-traded pools
    work without a backfill.  Adds edges to *graph* in-place and returns it.
    """
    from web3 import AsyncWeb3

    w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(rpc_url))
    chain_id = tok_in.chain_id
    addr_a = tok_in.address
    addr_b = tok_out.address

    try:
        v3_factory_addr = get_address("UNISWAP_V3_FACTORY", chain_id)
    except KeyError:
        v3_factory_addr = ""
    try:
        v2_factory_addr = get_address("UNISWAP_V2_FACTORY", chain_id)
    except KeyError:
        v2_factory_addr = ""

    # -- V3 pools across fee tiers -----------------------------------------
    if v3_factory_addr:
        factory = UNISWAP_V3_FACTORY(to=v3_factory_addr)
        for fee_tier in (100, 500, 3000, 10000):
            try:
                pool_addr = await factory.fns.getPool(addr_a, addr_b, fee_tier).call(w3)
            except Exception:
                continue
            edge_addr = Address(pool_addr) if pool_addr else None
            if not edge_addr or edge_addr == ZERO_ADDRESS:
                continue
            pool_contract = UNISWAP_V3_POOL(to=pool_addr)
            try:
                token0_addr = await pool_contract.fns.token0().call(w3)
                slot0 = await pool_contract.fns.slot0().call(w3)
                liquidity = await pool_contract.fns.liquidity().call(w3)
            except Exception:
                continue
            sqrt_price_x96 = slot0[0]
            if sqrt_price_x96 == 0 or liquidity == 0:
                continue
            fee_bps = fee_tier // 100
            for t_in, t_out in ((tok_in, tok_out), (tok_out, tok_in)):
                graph.add_pool(
                    V3PoolEdge(
                        token_in=t_in,
                        token_out=t_out,
                        pool_address=edge_addr,
                        protocol="UniswapV3",
                        fee_bps=fee_bps,
                        sqrt_price_x96=sqrt_price_x96,
                        liquidity=liquidity,
                        is_token0_in=(Address(token0_addr) == t_in.address),
                    )
                )

    # -- V2 pair -----------------------------------------------------------
    if v2_factory_addr:
        factory_v2 = UNISWAP_V2_FACTORY(to=v2_factory_addr)
        try:
            pair_addr = await factory_v2.fns.getPair(addr_a, addr_b).call(w3)
        except Exception:
            pair_addr = None
        if pair_addr and Address(pair_addr) != ZERO_ADDRESS:
            pair = UNISWAP_V2_PAIR(to=pair_addr)
            try:
                token0_v2 = await pair.fns.token0().call(w3)
                reserves = await pair.fns.getReserves().call(w3)
                r0, r1 = int(reserves[0]), int(reserves[1])
            except Exception:
                r0 = r1 = 0
            if r0 > 0 and r1 > 0:
                token0_v2_addr = Address(token0_v2)
                tok0 = tok_in if token0_v2_addr == addr_a else tok_out
                tok1 = tok_out if token0_v2_addr == addr_a else tok_in
                pair_edge_addr = Address(pair_addr)
                for t_in, t_out, r_in, r_out in (
                    (tok0, tok1, r0, r1),
                    (tok1, tok0, r1, r0),
                ):
                    graph.add_pool(
                        PoolEdge(
                            token_in=t_in,
                            token_out=t_out,
                            pool_address=pair_edge_addr,
                            protocol="UniswapV2",
                            fee_bps=30,
                            reserve_in=r_in,
                            reserve_out=r_out,
                            extra={"is_token0_in": t_in.address == token0_v2_addr},
                        )
                    )

    return graph


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/swap/quote")
async def get_quote(body: dict) -> dict:
    """Compute an off-chain swap quote using the pydefi Router.

    Request body keys:
      - ``token_in``  / ``token_out``: ``{address, symbol, decimals, chain_id}``
      - ``amount_in``: human-readable string, e.g. ``"0.1"``
      - ``is_native_in`` / ``is_native_out``: bool (default ``false``)
    """
    tok_in = _token_from_body(body.get("token_in") or {})
    tok_out = _token_from_body(body.get("token_out") or {})
    amount_in_str = str(body.get("amount_in", ""))
    _path_raw = body.get("path")

    # Allow round-trips (same start/end token) only when intermediate hops are provided
    if tok_in.address == tok_out.address and not (isinstance(_path_raw, list) and len(_path_raw) > 2):
        raise HTTPException(status_code=422, detail="token_in and token_out must be different.")

    try:
        amount_in_raw = int(Decimal(amount_in_str) * Decimal(10**tok_in.decimals))
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=422, detail=f"Invalid amount_in: {amount_in_str!r}")
    if amount_in_raw <= 0:
        raise HTTPException(status_code=422, detail="amount_in must be positive.")

    indexer = get_indexer()
    with Session(indexer._engine) as session:
        pools = session.exec(select(Pool)).all()
        if not pools:
            raise HTTPException(status_code=422, detail="No indexed pools found. Run a backfill first.")
        graph = _build_graph(session, list(pools))

    # ── Custom path: explicit hop-by-hop route ───────────────────────────────
    if isinstance(_path_raw, list) and len(_path_raw) > 2:
        path_tokens = [_token_from_body(t) for t in _path_raw]
        # Optional manual split fractions: list of fraction_bps per leg, must sum to 10000.
        # e.g. [5000, 5000] for 50/50, [3000, 3000, 4000] for a 3-way split.
        _split_fracs_raw = body.get("split_fractions_bps")
        manual_fractions: list[int] | None = None
        if _split_fracs_raw is not None:
            try:
                manual_fractions = [int(x) for x in _split_fracs_raw]
                if len(manual_fractions) < 2:
                    raise ValueError("need at least 2 legs")
                if any(f <= 0 for f in manual_fractions):
                    raise ValueError("all fractions must be positive")
                if sum(manual_fractions) != 10000:
                    raise ValueError(f"fractions must sum to 10000, got {sum(manual_fractions)}")
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=422, detail=f"split_fractions_bps invalid: {exc}")

        # Use a max_hops=1 router per waypoint pair so each hop is confined to
        # direct pools only but can still be split across multiple pools when
        # find_best_split finds it beneficial (e.g. two UNI/USDC V3 pools).
        hop_router = Router(graph, max_hops=1)
        combined_actions: list = []
        cur_amount = amount_in_raw
        for i in range(len(path_tokens) - 1):
            t_in_h, t_out_h = path_tokens[i], path_tokens[i + 1]

            # When manual split fractions are requested, pick the top N direct pools
            # (N = number of requested legs) and build an N-leg RouteSplit.
            if manual_fractions is not None:
                n_req = len(manual_fractions)
                candidates = sorted(
                    [e for e in graph.edges_from(t_in_h) if e.token_out.address == t_out_h.address],
                    key=lambda e: e.amount_out(cur_amount // n_req),
                    reverse=True,
                )[:n_req]
                n = len(candidates)
                if n >= 2:
                    # Renormalize fractions to the pools actually available
                    raw_fracs = manual_fractions[:n]
                    total = sum(raw_fracs)
                    fracs = [f * 10000 // total for f in raw_fracs[:-1]]
                    fracs.append(10000 - sum(fracs))
                    amounts = [cur_amount * f // 10000 for f in fracs[:-1]]
                    amounts.append(cur_amount - sum(amounts))
                    combined_actions.append(
                        RouteSplit(
                            legs=tuple(
                                RouteSplitLeg(
                                    fraction_bps=fracs[j],
                                    actions=(RouteSwap(token_out=t_out_h, pool=candidates[j]),),
                                )
                                for j in range(n)
                            ),
                            token_out=t_out_h,
                        )
                    )
                    cur_amount = sum(candidates[j].amount_out(amounts[j]) for j in range(n))
                    continue

            try:
                hop_dag = hop_router.find_best_split(TokenAmount(t_in_h, cur_amount), t_out_h)
            except NoRouteFoundError:
                raise HTTPException(
                    status_code=422,
                    detail=f"No indexed pool for {t_in_h.symbol} → {t_out_h.symbol} on chain {t_in_h.chain_id}.",
                )
            cur_amount = hop_router.simulate(hop_dag, cur_amount)
            combined_actions.extend(hop_dag.actions)
        dag_path = RouteDAG().from_token(path_tokens[0])
        dag_path.actions.extend(combined_actions)
        amount_out_human = str(Decimal(cur_amount) / Decimal(10 ** path_tokens[-1].decimals))
        return {
            "amount_out": str(cur_amount),
            "amount_out_human": amount_out_human,
            "price_impact": "NaN",
            "token_in": path_tokens[0].symbol,
            "token_out": path_tokens[-1].symbol,
            "dag": _serialize_dag(dag_path),
        }

    router_obj = Router(graph)
    try:
        route = router_obj.find_best_route(TokenAmount(tok_in, amount_in_raw), tok_out)
        dag = router_obj.find_best_split(TokenAmount(tok_in, amount_in_raw), tok_out)
    except NoRouteFoundError:
        # No indexed pool for this pair — try on-demand factory discovery if
        # RPC_URL is configured, then retry routing once.
        rpc_url = get_rpc_url()
        if not rpc_url:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"No route found for {tok_in.symbol} → {tok_out.symbol}. "
                    "Set RPC_URL to enable on-demand pool discovery for un-indexed pairs."
                ),
            )
        graph = await _augment_graph_on_demand(graph, tok_in, tok_out, rpc_url)
        router_obj = Router(graph)
        try:
            route = router_obj.find_best_route(TokenAmount(tok_in, amount_in_raw), tok_out)
            dag = router_obj.find_best_split(TokenAmount(tok_in, amount_in_raw), tok_out)
        except NoRouteFoundError:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"No route found for {tok_in.symbol} → {tok_out.symbol}. "
                    f"No direct or indexed pool exists for this pair on chain {tok_in.chain_id}."
                ),
            )

    amount_out_raw = route.amount_out.amount
    quote = AggregatorQuote(
        token_in=tok_in,
        token_out=tok_out,
        amount_in=TokenAmount(tok_in, amount_in_raw),
        amount_out=route.amount_out,
        min_amount_out=TokenAmount(tok_out, 0),
        gas_estimate=0,
        price_impact=route.price_impact,
        protocol="pydefi-router",
        route_summary=f"{tok_in.symbol} → {tok_out.symbol}",
    )

    amount_out_human = str(Decimal(amount_out_raw) / Decimal(10**tok_out.decimals))
    price_impact_str = "NaN" if quote.price_impact.is_nan() else str(quote.price_impact.quantize(Decimal("0.000001")))

    return {
        "amount_out": str(amount_out_raw),
        "amount_out_human": amount_out_human,
        "price_impact": price_impact_str,
        "token_in": tok_in.symbol,
        "token_out": tok_out.symbol,
        "dag": _serialize_dag(dag),
    }


@router.post("/swap/build")
async def build_swap(body: dict) -> dict:
    """Compile DeFiVM execute() calldata for a swap.

    Request body keys (in addition to quote fields):
      - ``slippage_bps``: int, default ``50``
      - ``sender``: checksummed wallet address

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
                "DEFI_VM_ADDRESS environment variable is not set. Set it to your deployed DeFiVM contract address."
            ),
        )

    tok_in = _token_from_body(body.get("token_in") or {})
    tok_out = _token_from_body(body.get("token_out") or {})
    is_native_in = bool(body.get("is_native_in", False))
    slippage_bps = int(body.get("slippage_bps", 50))
    sender = str(body.get("sender", ""))
    amount_in_str = str(body.get("amount_in", ""))

    if not sender:
        raise HTTPException(status_code=422, detail="sender is required.")
    if tok_in.address == tok_out.address:
        raise HTTPException(status_code=422, detail="token_in and token_out must be different.")

    try:
        amount_in_raw = int(Decimal(amount_in_str) * Decimal(10**tok_in.decimals))
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=422, detail=f"Invalid amount_in: {amount_in_str!r}")
    if amount_in_raw <= 0:
        raise HTTPException(status_code=422, detail="amount_in must be positive.")

    # ── Build graph ──────────────────────────────────────────────────────────
    indexer = get_indexer()
    with Session(indexer._engine) as session:
        pools = session.exec(select(Pool)).all()
        if not pools:
            raise HTTPException(status_code=422, detail="No indexed pools found. Run a backfill first.")
        graph = _build_graph(session, list(pools))

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
    amount_out_for_slippage: int = route.amount_out.amount

    # ── On-chain quote via DeFiVM eth_call (V2 + V3 routes) ─────────────────────
    # build_quote_program_for_dag composes a view-only DeFiVM program that:
    #   V2 hops — pair.getReserves() + constant-product formula (live reserves)
    #   V3 hops — quoter.quoteExactInput per hop
    if rpc_url:
        quoter_address = os.environ.get("V3_QUOTER_ADDRESS", "").strip() or _get_v3_quoter(tok_in.chain_id)
        if quoter_address:
            try:
                from web3 import AsyncWeb3

                w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(rpc_url))
                quote_prog = build_quote_program_for_dag(dag, amount_in=amount_in_raw, quoter_address=quoter_address)
                returndata = await w3.eth.call({"to": vm_address, "data": bytes(quote_prog)})
                amount_out = int.from_bytes(returndata[:32], "big")
                if amount_out > 0:
                    amount_out_for_slippage = amount_out
                    on_chain_quote_used = True
            except Exception as exc:
                on_chain_quote_note = f"on-chain quote failed ({exc}); using indexed estimate"
        else:
            on_chain_quote_note = "no V3 quoter address for this chain; using indexed estimate"
    else:
        on_chain_quote_note = "RPC_URL not set; using indexed estimate (set RPC_URL for accurate slippage)"

    min_final_out = amount_out_for_slippage * (10_000 - slippage_bps) // 10_000

    # ── Compile to DeFiVM calldata ────────────────────────────────────────────
    try:
        if is_native_in:
            weth_address = tok_in.address
            weth = Contract.from_abi(["function deposit() external payable"], to=weth_address)
            deposit_calldata = weth.fns.deposit().data
            swap_prog = build_execution_program_for_dag(
                dag,
                amount_in=amount_in_raw,
                vm_address=vm_address,
                recipient=sender,
                min_final_out=min_final_out,
            )
            full_program = (
                Program().call_contract(weth_address, deposit_calldata, value=amount_in_raw).pop() + swap_prog
            ).build()
            defi_vm = DeFiVM(to=vm_address)
            tx_to = vm_address
            tx_data_bytes_val = bytes(defi_vm.fns.execute(full_program).data)
            tx_value = amount_in_raw
        else:
            tx = build_swap_transaction(dag, amount_in_raw, vm_address, sender, min_final_out=min_final_out)
            tx_to = tx.to
            tx_data_bytes_val = bytes(tx.data)
            tx_value = tx.value
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    quote = AggregatorQuote(
        token_in=tok_in,
        token_out=tok_out,
        amount_in=TokenAmount(tok_in, amount_in_raw),
        amount_out=TokenAmount(tok_out, amount_out_for_slippage),
        min_amount_out=TokenAmount(tok_out, min_final_out),
        gas_estimate=0,
        tx_data={
            "to": tx_to,
            "data": "0x" + tx_data_bytes_val.hex(),
            "value": str(tx_value),
        },
        protocol="pydefi-router",
        route_summary=f"{tok_in.symbol} → {tok_out.symbol}",
    )

    amount_out_human = str(Decimal(quote.amount_out.amount) / Decimal(10**tok_out.decimals))
    result: dict = {
        **quote.tx_data,
        "value_eth": str(Decimal(tx_value) / Decimal(10**18)) if tx_value else "0",
        "token_in": tok_in.symbol,
        "token_out": tok_out.symbol,
        "amount_in": amount_in_str,
        "amount_out": str(quote.amount_out.amount),
        "amount_out_human": amount_out_human,
        "amount_out_min": str(quote.min_amount_out.amount),
        "slippage_bps": slippage_bps,
        "on_chain_quote": on_chain_quote_used,
    }
    if on_chain_quote_note:
        result["on_chain_quote_note"] = on_chain_quote_note
    return result
