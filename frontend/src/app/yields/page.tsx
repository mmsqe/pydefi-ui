"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ExternalLink,
  Loader,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildYieldRoute,
  fetchBestRebalance,
  fetchYieldMarkets,
  fetchYieldPositions,
} from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import type {
  YieldMarket,
  YieldPosition,
  YieldRoute,
  YieldStep,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_SYMBOLS = ["USDC", "USDT", "WETH", "DAI", "LINK"] as const;
const DEFAULT_AMOUNT_HUMAN = "100";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _aprPct(decimalString: string): string {
  const v = parseFloat(decimalString);
  if (!isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function _humanAmount(raw: string, decimals: number, digits = 4): string {
  try {
    const v = Number(BigInt(raw)) / 10 ** decimals;
    return formatNumber(v, digits);
  } catch {
    return raw;
  }
}

function _stepBadgeColor(kind: YieldStep["kind"]): "cyan" | "purple" | "muted" {
  if (kind === "supply") return "cyan";
  if (kind === "withdraw") return "purple";
  return "muted";
}

/** Human label for a step — synthesized from kind + route context, since
 *  YieldStep itself carries only kind / chain_id / tx. */
function _stepLabel(step: YieldStep, route: YieldRoute): string {
  switch (step.kind) {
    case "approve":
      return "Approve token allowance";
    case "supply":
      return `Supply into ${route.target_market?.market_id ?? "target market"}`;
    case "withdraw":
      return "Withdraw from source position";
    case "bridge":
      return `Bridge to chain ${route.target_chain ?? "destination"}`;
  }
}

// ---------------------------------------------------------------------------
// Route executor — broadcasts steps sequentially via wagmi
// ---------------------------------------------------------------------------

interface RouteExecutorProps {
  route: YieldRoute;
  onClose: () => void;
  onCompleted?: () => void;
}

function RouteExecutor({ route, onClose, onCompleted }: RouteExecutorProps) {
  const { chain } = useAccount();
  const [stepIdx, setStepIdx] = useState(0);
  const [hashes, setHashes] = useState<(string | null)[]>(() =>
    route.steps.map(() => null),
  );
  const [error, setError] = useState<string | null>(null);

  const explorerBase = chain?.blockExplorers?.default?.url ?? "https://etherscan.io";

  const {
    mutateAsync: sendTx,
    isPending: txPending,
    data: txHash,
    reset: txReset,
  } = useSendTransaction();
  const { isLoading: txConfirming, data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Persist the hash for the active step when it appears.
  useEffect(() => {
    if (!txHash) return;
    setHashes((prev) => {
      const next = [...prev];
      next[stepIdx] = txHash;
      return next;
    });
  }, [txHash, stepIdx]);

  // Advance once the receipt confirms (or stop on revert).
  useEffect(() => {
    if (!receipt) return;
    if (receipt.status === "success") {
      const nextIdx = stepIdx + 1;
      if (nextIdx >= route.steps.length) {
        onCompleted?.();
        return;
      }
      txReset();
      setStepIdx(nextIdx);
    } else if (receipt.status === "reverted") {
      setError(`Step ${stepIdx + 1} reverted on-chain.`);
    }
  }, [receipt, stepIdx, route.steps.length, txReset, onCompleted]);

  const broadcastCurrent = useCallback(async () => {
    const step = route.steps[stepIdx];
    if (!step) return;
    setError(null);
    try {
      await sendTx({
        to: step.tx.to as `0x${string}`,
        data: step.tx.data as `0x${string}`,
        value: step.tx.value && step.tx.value !== "0" ? BigInt(step.tx.value) : undefined,
        gas: step.tx.gas ? BigInt(step.tx.gas) : undefined,
      });
    } catch (err) {
      if (err instanceof Error && !err.message.includes("User rejected")) {
        setError(err.message);
      }
    }
  }, [route.steps, stepIdx, sendTx]);

  const allDone = stepIdx >= route.steps.length - 1 && receipt?.status === "success";
  const inFlight = txPending || txConfirming;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#0d1117] border border-border-dim rounded-2xl w-full max-w-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-dim">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-[#e8eaf0]">{route.strategy}</span>
            <Badge variant="cyan">{route.steps.length}-step</Badge>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-[#e8eaf0] transition-colors p-1 rounded-lg hover:bg-white/5"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {route.steps.map((step, i) => {
            const active = i === stepIdx && !allDone;
            const done = hashes[i] !== null && (i < stepIdx || allDone);
            const stepHash = hashes[i];
            return (
              <div
                key={i}
                className={
                  "rounded-xl border p-3 " +
                  (active
                    ? "border-cyan/40 bg-cyan/5"
                    : done
                      ? "border-green/30 bg-green/5"
                      : "border-border-dim bg-surface")
                }
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted font-mono">{i + 1}.</span>
                    <Badge variant={_stepBadgeColor(step.kind)}>{step.kind}</Badge>
                  </div>
                  {done && <CheckCircle size={14} className="text-green" />}
                  {active && inFlight && <Loader size={14} className="animate-spin text-cyan" />}
                </div>
                <p className="text-xs text-[#cbd5e1]">{_stepLabel(step, route)}</p>
                {stepHash && (
                  <a
                    href={`${explorerBase}/tx/${stepHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted hover:text-cyan transition-colors font-mono"
                  >
                    {stepHash.slice(0, 10)}… <ExternalLink size={10} />
                  </a>
                )}
              </div>
            );
          })}

          {error && (
            <div className="flex items-start gap-2 bg-red-500/8 border border-red-500/20 rounded-xl p-3">
              <AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-400 break-all">{error}</p>
            </div>
          )}

          {allDone ? (
            <div className="flex items-center gap-2 bg-green/8 border border-green/20 rounded-xl px-4 py-3">
              <CheckCircle size={14} className="text-green" />
              <span className="text-xs text-green font-semibold">Route complete</span>
            </div>
          ) : (
            <Button
              variant="primary"
              className="w-full"
              onClick={broadcastCurrent}
              loading={inFlight}
              disabled={inFlight}
            >
              {inFlight
                ? txConfirming
                  ? `Confirming step ${stepIdx + 1}…`
                  : `Sign step ${stepIdx + 1}…`
                : `Broadcast step ${stepIdx + 1} of ${route.steps.length}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function YieldsPage() {
  const { address } = useAccount();
  const [tokenSymbol, setTokenSymbol] = useState<string>("USDC");
  const [supplyAmount, setSupplyAmount] = useState<string>(DEFAULT_AMOUNT_HUMAN);
  const [activeRoute, setActiveRoute] = useState<YieldRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routePending, setRoutePending] = useState(false);

  const marketsKey = `markets:${tokenSymbol}`;
  const { data: markets, isLoading: marketsLoading } = useSWR<YieldMarket[]>(
    marketsKey,
    () => fetchYieldMarkets({ token_symbol: tokenSymbol }),
    { revalidateOnFocus: false },
  );

  const positionsKey = address ? `positions:${address}:${tokenSymbol}` : null;
  const { data: positions, mutate: mutatePositions } = useSWR<YieldPosition[]>(
    positionsKey,
    () => fetchYieldPositions({ user: address!, token_symbol: tokenSymbol }),
    { revalidateOnFocus: false },
  );

  const bestKey = address ? `rebalance:${address}:${tokenSymbol}` : null;
  const { data: bestRebalance, mutate: mutateBest } = useSWR(
    bestKey,
    () => fetchBestRebalance({ user: address!, token_symbol: tokenSymbol }),
    { revalidateOnFocus: false },
  );

  const onCompleted = useCallback(() => {
    mutatePositions();
    mutateBest();
  }, [mutatePositions, mutateBest]);

  const handleSupply = useCallback(
    async (market: YieldMarket) => {
      if (!address) {
        setRouteError("Connect a wallet first.");
        return;
      }
      const amt = parseFloat(supplyAmount);
      if (!isFinite(amt) || amt <= 0) {
        setRouteError("Enter a positive amount.");
        return;
      }
      const rawAmount = BigInt(Math.floor(amt * 10 ** market.token.decimals)).toString();
      setRouteError(null);
      setRoutePending(true);
      try {
        const route = await buildYieldRoute({
          strategy: "supply_then_bridge",
          user: address,
          amount_in: { token: market.token, amount: rawAmount },
          target_market: market,
          target_chain: market.chain_id,
        });
        setActiveRoute(route);
      } catch (err) {
        setRouteError(err instanceof Error ? err.message : "Failed to build route.");
      } finally {
        setRoutePending(false);
      }
    },
    [address, supplyAmount],
  );

  const handleRebalance = useCallback(
    (route: YieldRoute) => {
      setRouteError(null);
      setActiveRoute(route);
    },
    [],
  );

  const totalSupplied = useMemo(() => {
    if (!positions?.length) return null;
    let sum = 0;
    for (const p of positions) {
      sum += parseFloat(p.balance_human);
    }
    return sum;
  }, [positions]);

  return (
    <div className="max-w-4xl mx-auto space-y-4 pt-6">
      {/* Token selector + amount */}
      <Card>
        <CardHeader>
          <CardTitle>Yields</CardTitle>
          <Badge variant="purple">YaaS</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted mb-1 uppercase tracking-wider">Token</p>
              <div className="relative">
                <select
                  value={tokenSymbol}
                  onChange={(e) => setTokenSymbol(e.target.value)}
                  className="w-full appearance-none bg-card border border-border-dim rounded-xl pl-3 pr-8 py-2 text-sm font-semibold text-[#e8eaf0] focus:outline-none focus:border-cyan/40 cursor-pointer"
                >
                  {TOKEN_SYMBOLS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted mb-1 uppercase tracking-wider">Supply amount</p>
              <input
                type="number"
                value={supplyAmount}
                onChange={(e) => setSupplyAmount(e.target.value)}
                placeholder="100"
                className="w-full bg-card border border-border-dim rounded-xl px-3 py-2 text-sm font-mono text-[#e8eaf0] placeholder-muted focus:outline-none focus:border-cyan/40"
              />
            </div>
          </div>
          {routeError && (
            <div className="flex items-start gap-2 bg-red-500/8 border border-red-500/20 rounded-xl p-3">
              <AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-400 break-all">{routeError}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Best rebalance */}
      {address && bestRebalance && bestRebalance.route && (
        <Card glow>
          <CardHeader>
            <CardTitle>Suggested rebalance</CardTitle>
            <Badge variant="cyan">{bestRebalance.route.strategy}</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted">
              Move{" "}
              {bestRebalance.route.target_market &&
                bestRebalance.route.target_market.token.symbol}
              {" "}into{" "}
              <span className="font-mono text-[#e8eaf0]">
                {bestRebalance.route.target_market?.market_id ?? "—"}
              </span>{" "}
              ({bestRebalance.route.steps.length}-step plan).
            </p>
            <Button variant="primary" onClick={() => handleRebalance(bestRebalance.route!)}>
              Execute rebalance
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Positions */}
      {address && (
        <Card>
          <CardHeader>
            <CardTitle>Your positions</CardTitle>
            {totalSupplied !== null && (
              <span className="text-xs text-muted font-mono">
                {formatNumber(totalSupplied, 4)} {tokenSymbol}
              </span>
            )}
          </CardHeader>
          <CardContent>
            {!positions ? (
              <p className="text-xs text-muted italic">Loading…</p>
            ) : positions.length === 0 ? (
              <p className="text-xs text-muted italic">
                No {tokenSymbol} positions on configured chains.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-muted uppercase tracking-wider">
                  <tr className="border-b border-border-dim">
                    <th className="text-left font-medium py-2">Market</th>
                    <th className="text-right font-medium py-2">APY</th>
                    <th className="text-right font-medium py-2">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.market.market_id} className="border-b border-border-dim/40">
                      <td className="py-2 font-mono">{p.market.market_id}</td>
                      <td className="py-2 text-right font-mono text-green">
                        {_aprPct(p.market.supply_apy)}
                      </td>
                      <td className="py-2 text-right font-mono text-[#e8eaf0]">
                        {_humanAmount(p.balance, p.market.token.decimals)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Markets */}
      <Card>
        <CardHeader>
          <CardTitle>Markets</CardTitle>
          {markets && <Badge variant="muted">{markets.length}</Badge>}
        </CardHeader>
        <CardContent>
          {marketsLoading ? (
            <p className="text-xs text-muted italic flex items-center gap-2">
              <Loader size={12} className="animate-spin" /> Loading markets…
            </p>
          ) : !markets || markets.length === 0 ? (
            <p className="text-xs text-muted italic">
              No active markets for {tokenSymbol} on configured chains. Set RPC_URLS on the backend.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-muted uppercase tracking-wider">
                <tr className="border-b border-border-dim">
                  <th className="text-left font-medium py-2">Protocol</th>
                  <th className="text-left font-medium py-2">Chain</th>
                  <th className="text-right font-medium py-2">APY</th>
                  <th className="text-right font-medium py-2">Utilization</th>
                  <th className="text-right font-medium py-2">Liquidity</th>
                  <th className="text-right font-medium py-2"></th>
                </tr>
              </thead>
              <tbody>
                {markets.map((m) => (
                  <tr key={m.market_id} className="border-b border-border-dim/40">
                    <td className="py-2">{m.protocol}</td>
                    <td className="py-2 font-mono">{m.chain_id}</td>
                    <td className="py-2 text-right font-mono text-green">
                      {_aprPct(m.supply_apy)}
                    </td>
                    <td className="py-2 text-right font-mono text-muted">
                      {_aprPct(m.utilization)}
                    </td>
                    <td className="py-2 text-right font-mono text-muted">
                      {formatNumber(parseFloat(m.available_liquidity_human), 2)}
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        variant="primary"
                        onClick={() => handleSupply(m)}
                        disabled={!address || routePending}
                      >
                        Supply
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {activeRoute && (
        <RouteExecutor
          route={activeRoute}
          onClose={() => setActiveRoute(null)}
          onCompleted={onCompleted}
        />
      )}
    </div>
  );
}
