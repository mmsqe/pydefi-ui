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
import { swrFetcher, fetchQuoteOnChain } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import type { Pool } from "@/lib/types";
import {
  ArrowDownUp,
  ChevronDown,
  AlertCircle,
  CheckCircle,
  ExternalLink,
  Loader,
  X,
} from "lucide-react";
import { RouteTree, type RouteDAGData as _RouteDAGData } from "@/components/ui/route-tree";
import { useUrlRestore, useUrlWrite } from "@/lib/use-url-state";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Local DAG types (re-used from shared component via import alias)
// ---------------------------------------------------------------------------

type RouteDAGData = _RouteDAGData;

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
  const [quoteDag, setQuoteDag] = useState<RouteDAGData | null>(null);
  const [priceImpact, setPriceImpact] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [onChainQuote, setOnChainQuote] = useState<string | null>(null);
  const [onChainNote, setOnChainNote] = useState<string | null>(null);

  const { address, chain } = useAccount();
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
        return { address: p.token0_address as `0x${string}`, decimals: p.token0_decimals, symbol: p.token0_symbol, chain_id: p.chain_id };
      if (p.token1_symbol === tokenIn)
        return { address: p.token1_address as `0x${string}`, decimals: p.token1_decimals, symbol: p.token1_symbol, chain_id: p.chain_id };
    }
  }, [pools, tokenIn, isNativeIn]);

  const tokenOutMeta = useMemo(() => {
    if (isNativeOut || !pools) return undefined;
    for (const p of pools) {
      if (p.token0_symbol === tokenOut)
        return { address: p.token0_address as `0x${string}`, decimals: p.token0_decimals, symbol: p.token0_symbol, chain_id: p.chain_id };
      if (p.token1_symbol === tokenOut)
        return { address: p.token1_address as `0x${string}`, decimals: p.token1_decimals, symbol: p.token1_symbol, chain_id: p.chain_id };
    }
  }, [pools, tokenOut, isNativeOut]);

  // WETH metadata — used as token_in when swapping native ETH.
  const wethMeta = useMemo(() => {
    if (!pools) return undefined;
    for (const p of pools) {
      if (p.token0_symbol === "WETH") return { address: p.token0_address, symbol: "WETH", decimals: p.token0_decimals, chain_id: p.chain_id };
      if (p.token1_symbol === "WETH") return { address: p.token1_address, symbol: "WETH", decimals: p.token1_decimals, chain_id: p.chain_id };
    }
  }, [pools]);

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
    async (amount: string, nativeIn: boolean, nativeOut: boolean) => {
      const tokenInRef = nativeIn ? wethMeta : tokenInMeta;
      const tokenOutRef = nativeOut ? wethMeta : tokenOutMeta;
      if (!tokenInRef || !tokenOutRef) return;

      setQuoteLoading(true);
      setQuoteError(null);
      setOnChainQuote(null);
      setOnChainNote(null);
      const body = {
        token_in: tokenInRef,
        token_out: tokenOutRef,
        amount_in: amount,
        is_native_in: nativeIn,
      };
      // Fire on-chain (slow, ~3s) in parallel; merge when it arrives.
      fetchQuoteOnChain(body).then((data) => {
        if (!data) return;
        if (data.on_chain_amount_out_human !== undefined) setOnChainQuote(data.on_chain_amount_out_human);
        if (data.on_chain_quote_note) setOnChainNote(data.on_chain_quote_note);
      });
      try {
        const res = await fetch(`${BASE}/api/swap/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const detail = await res.json().then((j) => j.detail ?? JSON.stringify(j)).catch(() => res.statusText);
          setQuoteError(String(detail));
          setQuoteResult(null);
          setQuoteDag(null);
          setPriceImpact(null);
        } else {
          const data = await res.json();
          setQuoteResult(data.amount_out_human ?? String(data.amount_out));
          setPriceImpact(data.price_impact ?? null);
          setQuoteDag(data.dag ?? null);
        }
      } catch {
        setQuoteError("Could not reach the API — is the backend running?");
        setQuoteResult(null);
        setQuoteDag(null);
        setPriceImpact(null);
      } finally {
        setQuoteLoading(false);
      }
    },
    [wethMeta, tokenInMeta, tokenOutMeta]
  );

  useEffect(() => {
    const amt = parseFloat(amountIn);
    if (!amountIn || isNaN(amt) || amt <= 0 || exceedsBalance) {
      setQuoteResult(null);
      setQuoteDag(null);
      setPriceImpact(null);
      setQuoteError(null);
      setOnChainQuote(null);
      setOnChainNote(null);
      return;
    }
    const timer = setTimeout(
      () => fetchQuote(amountIn, isNativeIn, isNativeOut),
      500
    );
    return () => clearTimeout(timer);
  }, [amountIn, tokenIn, tokenOut, exceedsBalance, fetchQuote, isNativeIn, isNativeOut]);

  // ── URL state sync ───────────────────────────────────────────────────────────

  useUrlRestore({ from: setTokenIn, to: setTokenOut, amount: setAmountIn, slippage: setSlippage });

  useUrlWrite(() => {
    const p = new URLSearchParams();
    p.set("from", tokenIn);
    p.set("to", tokenOut);
    if (amountIn) p.set("amount", amountIn);
    if (slippage !== "0.5") p.set("slippage", slippage);
    return p;
  }, [tokenIn, tokenOut, amountIn, slippage]);

  // ---------------------------------------------------------------------------
  // Transaction
  // ---------------------------------------------------------------------------
  const {
    mutateAsync: sendTx,
    isPending: txPending,
    data: txHash,
    error: txSendError,
    reset: txReset,
  } = useSendTransaction();
  const {
    isLoading: txConfirming,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash: txHash });
  const txSuccess = receipt?.status === "success";
  const txReverted = receipt?.status === "reverted";
  const [txBuildError, setTxBuildError] = useState<string | null>(null);

  const handleBuildAndSign = async () => {
    if (!address || !quoteResult || !amountIn || !tokenInRef || !tokenOutRef) return;
    setTxBuildError(null);
    txReset();
    try {
      const res = await fetch(`${BASE}/api/swap/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_in: tokenInRef,
          token_out: tokenOutRef,
          amount_in: amountIn,
          slippage_bps: Math.round(parseFloat(slippage) * 100),
          sender: address,
          is_native_in: isNativeIn,
        }),
      });
      if (!res.ok) throw new Error(await res.json().then((j) => j.detail).catch(() => res.statusText));
      const { to, data, value } = await res.json();
      await sendTx({ to, data, value: value ? BigInt(value) : isNativeIn ? parseEther(amountIn) : undefined });
    } catch (err) {
      // Wallet rejections come through wagmi's error — don't double-report them
      if (err instanceof Error && !err.message.includes("User rejected")) {
        setTxBuildError(err instanceof Error ? err.message : "Failed to build transaction");
      }
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
  const tokenInRef = isNativeIn ? wethMeta : tokenInMeta;
  const tokenOutRef = isNativeOut ? wethMeta : tokenOutMeta;
  const buildEnabled = !!address && !exceedsBalance && !!amountIn && !!quoteResult && !quoteLoading && !txPending && !txConfirming && !!tokenInRef && !!tokenOutRef;

  const explorerBase = chain?.blockExplorers?.default?.url ?? "https://etherscan.io";

  // Price impact display
  const impactNum = priceImpact && priceImpact !== "NaN" ? parseFloat(priceImpact) * 100 : null;
  const impactLabel = impactNum === null ? "—" : `${impactNum.toFixed(2)}%`;
  const impactColor = impactNum === null ? "text-muted" : impactNum > 5 ? "text-red-400" : impactNum > 1 ? "text-amber-400" : "text-green";

  const [showRouteModal, setShowRouteModal] = useState(false);

  return (
    <div className="max-w-lg mx-auto space-y-4 pt-6">
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
                  onChange={(e) => { setTokenIn(e.target.value); setQuoteResult(null); setQuoteDag(null); }}
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
              onClick={() => { setTokenIn(tokenOut); setTokenOut(tokenIn); setQuoteResult(null); setQuoteDag(null); setQuoteError(null); }}
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
                  onChange={(e) => { setTokenOut(e.target.value); setQuoteResult(null); setQuoteDag(null); }}
                  className="appearance-none bg-card border border-border-dim rounded-xl pl-3 pr-8 py-2 text-sm font-semibold text-[#e8eaf0] focus:outline-none focus:border-cyan/40 cursor-pointer"
                >
                  {tokenSymbols.filter((t) => t !== tokenIn).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
            </div>
            {/* On-chain cross-check (async; appears when /swap/quote/on-chain returns) */}
            {quoteResult && !quoteLoading && (() => {
              if (onChainQuote !== null) {
                const off = parseFloat(quoteResult);
                const on = parseFloat(onChainQuote);
                const diffPct = off > 0 ? ((on - off) / off) * 100 : 0;
                const abs = Math.abs(diffPct);
                const color = abs >= 3 ? "#f87171" : abs >= 0.5 ? "#fbbf24" : "#94a3b8";
                const sign = diffPct >= 0 ? "+" : "";
                const tip = onChainNote
                  || "On-chain eth_call via DeFiVM quote program (live pool state vs indexed reserves).";
                return (
                  <div className="text-[10px] font-mono leading-tight mt-1" style={{ color }} title={tip}>
                    on-chain: {on.toPrecision(6)} {tokenOut} ({sign}{diffPct.toFixed(2)}%)
                  </div>
                );
              }
              if (onChainNote) {
                return (
                  <div className="text-[10px] text-muted leading-tight mt-1" title={onChainNote}>
                    on-chain: unavailable
                  </div>
                );
              }
              return (
                <div className="text-[10px] text-muted leading-tight mt-1 flex items-center gap-1">
                  <Loader size={10} className="animate-spin" />
                  on-chain: …
                </div>
              );
            })()}
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
              <div className="flex items-center gap-1.5 flex-wrap">
                {["0.5", "1.0", "5.0", "50"].map((v) => (
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
                <input
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.1"
                  value={["0.5","1.0","5.0","50"].includes(slippage) ? "" : slippage}
                  onChange={(e) => e.target.value && setSlippage(e.target.value)}
                  placeholder="custom"
                  className="w-16 bg-transparent border border-border-dim rounded-lg px-2 py-1 text-xs text-[#e8eaf0] placeholder-muted focus:outline-none focus:border-cyan/40"
                />
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

          {/* Build / API error */}
          {txBuildError && (
            <div className="flex items-start gap-2 bg-red-500/8 border border-red-500/20 rounded-xl p-3">
              <AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-400 break-all">{txBuildError}</p>
            </div>
          )}

          {/* Wallet rejected */}
          {txSendError && !txBuildError && (
            <div className="flex items-start gap-2 bg-red-500/8 border border-red-500/20 rounded-xl p-3">
              <AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-400">
                {txSendError.message.includes("User rejected")
                  ? "Transaction rejected in wallet."
                  : txSendError.message}
              </p>
            </div>
          )}

          {/* Pending confirmation */}
          {txConfirming && txHash && (
            <div className="flex items-center justify-between bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <Loader size={13} className="animate-spin text-amber-400" />
                <span className="text-xs text-amber-300 font-semibold">Waiting for confirmation…</span>
              </div>
              <a
                href={`${explorerBase}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted hover:text-cyan transition-colors font-mono"
              >
                {txHash.slice(0, 10)}… <ExternalLink size={11} />
              </a>
            </div>
          )}

          {/* On-chain revert */}
          {txReverted && txHash && (
            <div className="flex items-start justify-between bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3 gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-red-400 font-semibold">Transaction reverted</p>
                  <p className="text-[10px] text-red-400/70 mt-0.5">
                    The swap was rejected on-chain. Try increasing slippage tolerance.
                  </p>
                </div>
              </div>
              <a
                href={`${explorerBase}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted hover:text-cyan transition-colors font-mono flex-shrink-0 mt-0.5"
              >
                {txHash.slice(0, 10)}… <ExternalLink size={11} />
              </a>
            </div>
          )}

          {/* Success */}
          {txSuccess && txHash && (
            <div className="flex items-center justify-between bg-green/8 border border-green/20 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <CheckCircle size={14} className="text-green" />
                <span className="text-xs text-green font-semibold">Transaction confirmed</span>
              </div>
              <a
                href={`${explorerBase}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted hover:text-cyan transition-colors font-mono"
              >
                {txHash.slice(0, 10)}… <ExternalLink size={11} />
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Route visualizer */}
      <Card
        onClick={quoteDag ? () => setShowRouteModal(true) : undefined}
        className={quoteDag ? "cursor-pointer hover:border-cyan/30 transition-colors" : ""}
      >
        <CardHeader>
          <CardTitle>Route</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={quoteDag ? "cyan" : "muted"}>{quoteDag ? "Live" : "—"}</Badge>
            {quoteDag && <span className="text-[10px] text-muted">click to expand</span>}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isNativeIn && quoteDag && (
            <div className="flex items-center gap-2 text-xs text-amber-400/80 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2">
              <span className="font-semibold">ETH</span>
              <span className="text-muted">→</span>
              <span className="font-mono bg-amber-500/15 border border-amber-500/25 rounded px-1.5 py-0.5">WRAP</span>
              <span className="text-muted">→</span>
              <span className="font-semibold">WETH</span>
              <span className="text-muted ml-1">auto-wrapped atomically</span>
            </div>
          )}
          {quoteDag ? (
            <div className="bg-[#0a0b0e] rounded-xl p-3 pointer-events-none">
              <RouteTree dag={quoteDag} />
            </div>
          ) : (
            <p className="text-xs text-muted italic">
              Enter an amount to see the live route.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Route expand modal */}
      {showRouteModal && quoteDag && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setShowRouteModal(false)}
        >
          <div
            className="bg-[#0d1117] border border-border-dim rounded-2xl w-full max-w-5xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-dim">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-[#e8eaf0]">Route</span>
                <Badge variant="cyan">Live</Badge>
                {isNativeIn && (
                  <span className="text-[10px] text-amber-400/80 bg-amber-500/8 border border-amber-500/20 rounded px-1.5 py-0.5">
                    ETH → WRAP → WETH
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowRouteModal(false)}
                className="text-muted hover:text-[#e8eaf0] transition-colors p-1 rounded-lg hover:bg-white/5"
              >
                <X size={16} />
              </button>
            </div>
            {/* Modal route tree */}
            <div className="p-5 bg-[#0a0b0e] rounded-b-2xl">
              <RouteTree dag={quoteDag} large />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
