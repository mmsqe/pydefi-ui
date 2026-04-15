"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import useSWR from "swr";
import {
  useAccount,
  useBalance,
  useReadContracts,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from "wagmi";
import { erc20Abi, formatUnits, parseEther } from "viem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { swrFetcher } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import type { Pool } from "@/lib/types";
import {
  ArrowDownUp,
  ChevronDown,
  AlertCircle,
  Info,
  CheckCircle,
  ExternalLink,
  Loader,
} from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Route visualizer
// ---------------------------------------------------------------------------

interface RouteHop {
  from: string;
  to: string;
  protocol: string;
  pool: string;
  pct: number;
}

type RouteStep = {
  token_in: string;
  token_out: string;
  pool_address: string;
  protocol: string;
  fee_bps: number;
  pct: number;
};

const ROUTE_COLORS = ["#00d4ff", "#8b5cf6", "#00ff87"];

function RouteVisualizer({
  tokenIn,
  tokenOut,
  liveRoute,
}: {
  tokenIn: string;
  tokenOut: string;
  liveRoute?: RouteStep[] | null;
}) {
  const isNativeIn = tokenIn === "ETH";

  const routes: RouteHop[][] = useMemo(() => {
    if (liveRoute && liveRoute.length > 0) {
      return [
        liveRoute.map((s) => ({
          from: s.token_in,
          to: s.token_out,
          protocol: s.protocol.toUpperCase(),
          pool: `${s.pool_address.slice(0, 6)}…${s.pool_address.slice(-4)}`,
          pct: s.pct || 100,
        })),
      ];
    }
    // Placeholder shown before a quote is fetched
    const eff = isNativeIn ? "WETH" : tokenIn;
    return [
      [{ from: eff, to: tokenOut, protocol: "V3", pool: "0x????…????", pct: 100 }],
    ];
  }, [liveRoute, tokenIn, tokenOut, isNativeIn]);

  return (
    <div className="space-y-3">
      {isNativeIn && (
        <div className="flex items-center gap-2 text-xs text-amber-400/80 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2">
          <span className="font-semibold">ETH</span>
          <span className="text-muted">→</span>
          <span className="font-mono bg-amber-500/15 border border-amber-500/25 rounded px-1.5 py-0.5">WRAP</span>
          <span className="text-muted">→</span>
          <span className="font-semibold">WETH</span>
          <span className="text-muted ml-1">auto-wrapped via Universal Router</span>
        </div>
      )}

      {routes.map((route, ri) => (
        <div key={ri} className="flex items-center gap-2">
          <div
            className="w-10 text-right text-xs font-mono font-bold flex-shrink-0"
            style={{ color: ROUTE_COLORS[ri % ROUTE_COLORS.length] }}
          >
            {route[route.length - 1].pct}%
          </div>
          <div className="relative h-1.5 rounded-full bg-border-dim flex-shrink-0 w-20">
            <div
              className="absolute left-0 top-0 h-full rounded-full"
              style={{
                width: `${route[route.length - 1].pct}%`,
                backgroundColor: ROUTE_COLORS[ri % ROUTE_COLORS.length],
                boxShadow: `0 0 6px ${ROUTE_COLORS[ri % ROUTE_COLORS.length]}80`,
              }}
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {route.map((hop, hi) => (
              <div key={hi} className="flex items-center gap-1.5">
                {hi === 0 && (
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-md border"
                    style={{
                      color: ROUTE_COLORS[ri % ROUTE_COLORS.length],
                      borderColor: `${ROUTE_COLORS[ri % ROUTE_COLORS.length]}30`,
                      backgroundColor: `${ROUTE_COLORS[ri % ROUTE_COLORS.length]}10`,
                    }}
                  >
                    {hop.from}
                  </span>
                )}
                <span className="text-muted text-xs">→</span>
                <div
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs"
                  style={{
                    borderColor: `${ROUTE_COLORS[ri % ROUTE_COLORS.length]}25`,
                    backgroundColor: `${ROUTE_COLORS[ri % ROUTE_COLORS.length]}08`,
                  }}
                >
                  <span className="text-muted font-mono text-[10px]">{hop.pool}</span>
                  <Badge
                    variant={hop.protocol.includes("3") || hop.protocol.includes("4") ? "cyan" : "purple"}
                    className="text-[9px] px-1 py-0"
                  >
                    {hop.protocol}
                  </Badge>
                </div>
                <span className="text-muted text-xs">→</span>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-md border"
                  style={{
                    color: ROUTE_COLORS[ri % ROUTE_COLORS.length],
                    borderColor: `${ROUTE_COLORS[ri % ROUTE_COLORS.length]}30`,
                    backgroundColor: `${ROUTE_COLORS[ri % ROUTE_COLORS.length]}10`,
                  }}
                >
                  {hop.to}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const ETH_GAS_RESERVE = parseEther("0.005");

export default function SwapPage() {
  const [tokenIn, setTokenIn] = useState("ETH");
  const [tokenOut, setTokenOut] = useState("USDC");
  const [amountIn, setAmountIn] = useState("");
  const [slippage, setSlippage] = useState("0.5");

  const [quoteResult, setQuoteResult] = useState<string | null>(null);
  const [quoteRoute, setQuoteRoute] = useState<RouteStep[] | null>(null);
  const [priceImpact, setPriceImpact] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const { address } = useAccount();
  const { data: pools } = useSWR<Pool[]>(`${BASE}/api/pools`, swrFetcher);

  const isNativeIn = tokenIn === "ETH";
  const isNativeOut = tokenOut === "ETH";

  // Token symbol list — ETH always first, then whatever is in the indexed pools.
  const tokenSymbols = useMemo(() => {
    const set = new Set<string>();
    pools?.forEach((p) => {
      if (p.token0_symbol) set.add(p.token0_symbol);
      if (p.token1_symbol) set.add(p.token1_symbol);
    });
    return ["ETH", ...Array.from(set)].slice(0, 31);
  }, [pools]);

  // ERC-20 metadata for the selected tokens (undefined when ETH).
  const tokenInMeta = useMemo(() => {
    if (isNativeIn || !pools) return undefined;
    for (const p of pools) {
      if (p.token0_symbol === tokenIn)
        return { address: p.token0_address as `0x${string}`, decimals: p.token0_decimals, symbol: p.token0_symbol };
      if (p.token1_symbol === tokenIn)
        return { address: p.token1_address as `0x${string}`, decimals: p.token1_decimals, symbol: p.token1_symbol };
    }
  }, [pools, tokenIn, isNativeIn]);

  const tokenOutMeta = useMemo(() => {
    if (isNativeOut || !pools) return undefined;
    for (const p of pools) {
      if (p.token0_symbol === tokenOut)
        return { address: p.token0_address as `0x${string}`, decimals: p.token0_decimals, symbol: p.token0_symbol };
      if (p.token1_symbol === tokenOut)
        return { address: p.token1_address as `0x${string}`, decimals: p.token1_decimals, symbol: p.token1_symbol };
    }
  }, [pools, tokenOut, isNativeOut]);

  // Balances
  const { data: ethBalance, isLoading: ethBalanceLoading } = useBalance({
    address,
    query: { enabled: !!address && (isNativeIn || isNativeOut) },
  });

  const { data: erc20Balances, isLoading: erc20Loading } = useReadContracts({
    contracts: [
      { address: tokenInMeta?.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined },
      { address: tokenOutMeta?.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined },
    ],
    query: { enabled: !!address && (!!tokenInMeta || !!tokenOutMeta) },
  });

  const balanceInRaw = erc20Balances?.[0]?.result as bigint | undefined;
  const balanceOutRaw = erc20Balances?.[1]?.result as bigint | undefined;
  const balancesLoading = isNativeIn ? ethBalanceLoading : erc20Loading;

  const fmtBal = (raw: bigint | undefined, decimals: number, symbol: string) =>
    raw !== undefined ? `${formatNumber(parseFloat(formatUnits(raw, decimals)), 4)} ${symbol}` : "0";

  const balanceInFormatted = !address ? "—"
    : balancesLoading ? "…"
    : isNativeIn
    ? ethBalance ? `${formatNumber(parseFloat(formatUnits(ethBalance.value, 18)), 4)} ETH` : "0"
    : tokenInMeta ? fmtBal(balanceInRaw, tokenInMeta.decimals, tokenInMeta.symbol) : "0";

  const balanceInMax = isNativeIn
    ? ethBalance && ethBalance.value > ETH_GAS_RESERVE
      ? formatUnits(ethBalance.value - ETH_GAS_RESERVE, 18)
      : undefined
    : balanceInRaw !== undefined && tokenInMeta
    ? formatUnits(balanceInRaw, tokenInMeta.decimals)
    : undefined;

  // Validate amount against balance.
  const exceedsBalance = useMemo(() => {
    if (!amountIn || !address) return false;
    const amt = parseFloat(amountIn);
    if (isNaN(amt) || amt <= 0) return false;
    try {
      if (isNativeIn && ethBalance) return parseEther(amountIn) > ethBalance.value;
      if (balanceInRaw !== undefined && tokenInMeta)
        return BigInt(Math.floor(amt * 10 ** tokenInMeta.decimals)) > balanceInRaw;
    } catch { /* ignore parse errors */ }
    return false;
  }, [amountIn, address, isNativeIn, ethBalance, balanceInRaw, tokenInMeta]);

  // ---------------------------------------------------------------------------
  // Auto-quote: fires 500 ms after the user stops typing, or on token change.
  // ---------------------------------------------------------------------------
  const fetchQuote = useCallback(
    async (amount: string, tIn: string, tOut: string, nativeIn: boolean, nativeOut: boolean) => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const res = await fetch(`${BASE}/api/swap/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token_in: tIn,
            token_out: tOut,
            amount_in: amount,
            is_native_in: nativeIn,
            is_native_out: nativeOut,
          }),
        });
        if (!res.ok) {
          const detail = await res.json().then((j) => j.detail ?? JSON.stringify(j)).catch(() => res.statusText);
          setQuoteError(String(detail));
          setQuoteResult(null);
          setQuoteRoute(null);
          setPriceImpact(null);
        } else {
          const data = await res.json();
          setQuoteResult(data.amount_out_human ?? String(data.amount_out));
          setPriceImpact(data.price_impact ?? null);
          if (Array.isArray(data.route) && data.route.length > 0) setQuoteRoute(data.route);
          else setQuoteRoute(null);
        }
      } catch {
        setQuoteError("Could not reach the API — is the backend running?");
        setQuoteResult(null);
        setQuoteRoute(null);
        setPriceImpact(null);
      } finally {
        setQuoteLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const amt = parseFloat(amountIn);
    if (!amountIn || isNaN(amt) || amt <= 0 || exceedsBalance) {
      setQuoteResult(null);
      setQuoteRoute(null);
      setPriceImpact(null);
      setQuoteError(null);
      return;
    }
    const timer = setTimeout(
      () => fetchQuote(amountIn, tokenIn, tokenOut, isNativeIn, isNativeOut),
      500
    );
    return () => clearTimeout(timer);
  }, [amountIn, tokenIn, tokenOut, exceedsBalance, fetchQuote, isNativeIn, isNativeOut]);

  // ---------------------------------------------------------------------------
  // Transaction
  // ---------------------------------------------------------------------------
  const { mutateAsync: sendTx, isPending: txPending, data: txHash } = useSendTransaction();
  const { isLoading: txConfirming, isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });
  const [txBuildError, setTxBuildError] = useState<string | null>(null);

  const handleBuildAndSign = async () => {
    if (!address || !quoteResult || !amountIn) return;
    setTxBuildError(null);
    try {
      const res = await fetch(`${BASE}/api/swap/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_in: tokenIn,
          token_out: tokenOut,
          amount_in: amountIn,
          amount_out_min: quoteResult,
          slippage_bps: Math.round(parseFloat(slippage) * 100),
          sender: address,
          is_native_in: isNativeIn,
          is_native_out: isNativeOut,
        }),
      });
      if (!res.ok) throw new Error(await res.json().then((j) => j.detail).catch(() => res.statusText));
      const { to, data, value } = await res.json();
      await sendTx({ to, data, value: value ? BigInt(value) : isNativeIn ? parseEther(amountIn) : undefined });
    } catch (err) {
      setTxBuildError(err instanceof Error ? err.message : "Failed to build transaction");
    }
  };

  const buildLabel = !address ? "Connect wallet first"
    : exceedsBalance ? "Insufficient balance"
    : !amountIn ? "Enter an amount"
    : quoteLoading ? "Fetching quote…"
    : !quoteResult ? "Waiting for quote"
    : txConfirming ? "Confirming…"
    : txPending ? "Check wallet…"
    : "Build & Sign";
  const buildEnabled = !!address && !exceedsBalance && !!amountIn && !!quoteResult && !quoteLoading && !txPending && !txConfirming;

  // Price impact display
  const impactNum = priceImpact && priceImpact !== "NaN" ? parseFloat(priceImpact) * 100 : null;
  const impactLabel = impactNum === null ? "—" : `${impactNum.toFixed(2)}%`;
  const impactColor = impactNum === null ? "text-muted" : impactNum > 5 ? "text-red-400" : impactNum > 1 ? "text-amber-400" : "text-green";

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <Card glow>
        <CardHeader>
          <CardTitle>Swap</CardTitle>
          <Badge variant="purple">Beta</Badge>
        </CardHeader>
        <CardContent className="space-y-3">

          {/* Token In */}
          <div className={`bg-surface rounded-xl border p-4 space-y-2 transition-colors ${exceedsBalance ? "border-red-500/40" : "border-border-dim"}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted uppercase tracking-wider">You pay</span>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${exceedsBalance ? "text-red-400" : "text-muted"}`}>
                  Balance: {balanceInFormatted}
                </span>
                {balanceInMax && parseFloat(balanceInMax) > 0 && (
                  <button
                    onClick={() => setAmountIn(balanceInMax)}
                    className="text-[10px] font-semibold text-cyan hover:text-cyan/80 transition-colors px-1.5 py-0.5 rounded-md bg-cyan/10 border border-cyan/20"
                  >
                    MAX
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                placeholder="0.0"
                value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
                className="flex-1 bg-transparent text-2xl font-mono font-semibold text-[#e8eaf0] placeholder-border-dim focus:outline-none"
              />
              <div className="relative">
                <select
                  value={tokenIn}
                  onChange={(e) => { setTokenIn(e.target.value); setQuoteResult(null); setQuoteRoute(null); }}
                  className="appearance-none bg-card border border-border-dim rounded-xl pl-3 pr-8 py-2 text-sm font-semibold text-[#e8eaf0] focus:outline-none focus:border-cyan/40 cursor-pointer"
                >
                  {tokenSymbols.filter((t) => t !== tokenOut).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
            </div>
            {exceedsBalance && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle size={11} /> Amount exceeds balance
              </p>
            )}
          </div>

          {/* Swap direction */}
          <div className="flex justify-center -my-1 z-10 relative">
            <button
              onClick={() => { setTokenIn(tokenOut); setTokenOut(tokenIn); setQuoteResult(null); setQuoteRoute(null); setQuoteError(null); }}
              className="bg-card border border-border-dim rounded-xl p-2 hover:border-cyan/30 hover:bg-cyan/5 transition-all group"
            >
              <ArrowDownUp size={16} className="text-muted group-hover:text-cyan transition-colors" />
            </button>
          </div>

          {/* Token Out */}
          <div className="bg-surface rounded-xl border border-border-dim p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted uppercase tracking-wider">You receive</span>
              <span className="text-xs text-muted">
                Balance:{" "}
                {!address ? "—" : tokenOutMeta ? fmtBal(balanceOutRaw, tokenOutMeta.decimals, tokenOutMeta.symbol) : "0"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 text-2xl font-mono font-semibold text-muted">
                {quoteLoading ? (
                  <Loader size={18} className="animate-spin text-muted" />
                ) : quoteResult ? (
                  <span className="text-[#e8eaf0]">{formatNumber(parseFloat(quoteResult), 6)}</span>
                ) : (
                  "0.0"
                )}
              </div>
              <div className="relative">
                <select
                  value={tokenOut}
                  onChange={(e) => { setTokenOut(e.target.value); setQuoteResult(null); setQuoteRoute(null); }}
                  className="appearance-none bg-card border border-border-dim rounded-xl pl-3 pr-8 py-2 text-sm font-semibold text-[#e8eaf0] focus:outline-none focus:border-cyan/40 cursor-pointer"
                >
                  {tokenSymbols.filter((t) => t !== tokenIn).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Quote / balance error */}
          {quoteError && !exceedsBalance && (
            <div className="flex items-start gap-2 bg-amber-500/8 border border-amber-500/20 rounded-xl p-3">
              <AlertCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-300">{quoteError}</p>
            </div>
          )}

          {/* Slippage + price impact */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted mb-1 uppercase tracking-wider">Slippage</p>
              <div className="flex items-center gap-1.5">
                {["0.1", "0.5", "1.0"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setSlippage(v)}
                    className={`px-2 py-1 text-xs rounded-lg border transition-all ${
                      slippage === v
                        ? "border-cyan/40 text-cyan bg-cyan/8"
                        : "border-border-dim text-muted hover:border-cyan/20 hover:text-[#e8eaf0]"
                    }`}
                  >
                    {v}%
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted mb-1 uppercase tracking-wider">Price Impact</p>
              <p className={`text-xs font-mono ${impactColor}`}>{impactLabel}</p>
            </div>
          </div>

          {/* Build & Sign */}
          <Button
            variant="primary"
            className="w-full"
            onClick={handleBuildAndSign}
            loading={txPending || txConfirming}
            disabled={!buildEnabled}
            title={buildEnabled ? undefined : buildLabel}
          >
            {buildLabel}
          </Button>

          {txBuildError && (
            <div className="flex items-start gap-2 bg-red-500/8 border border-red-500/20 rounded-xl p-3">
              <AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-400">{txBuildError}</p>
            </div>
          )}

          {txConfirmed && txHash && (
            <div className="flex items-center justify-between bg-green/8 border border-green/20 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <CheckCircle size={14} className="text-green" />
                <span className="text-xs text-green font-semibold">Transaction confirmed</span>
              </div>
              <a
                href={`https://etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted hover:text-cyan transition-colors"
              >
                {txHash.slice(0, 10)}… <ExternalLink size={11} />
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Route visualizer */}
      <Card>
        <CardHeader>
          <CardTitle>Split Route</CardTitle>
          <Badge variant={quoteRoute ? "cyan" : "muted"}>{quoteRoute ? "Live" : "—"}</Badge>
        </CardHeader>
        <CardContent>
          <div className="mb-4 pb-3 border-b border-border-dim flex items-center justify-between text-xs">
            <span className="text-muted">{tokenIn} → {tokenOut}</span>
            <span className="text-muted">
              {quoteRoute ? `${quoteRoute.length} hop${quoteRoute.length !== 1 ? "s" : ""}` : "awaiting quote"}
            </span>
          </div>
          <RouteVisualizer tokenIn={tokenIn} tokenOut={tokenOut} liveRoute={quoteRoute} />
          {!quoteRoute && (
            <p className="text-xs text-muted mt-4 italic flex items-center gap-1.5">
              <Info size={10} />
              Enter an amount to see the live route.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
