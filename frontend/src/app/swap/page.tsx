"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { swrFetcher } from "@/lib/api";
import { pairLabel, formatNumber } from "@/lib/utils";
import type { Pool } from "@/lib/types";
import {
  ArrowDownUp,
  ChevronDown,
  Zap,
  AlertCircle,
  Info,
  Lock,
} from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface RouteHop {
  from: string;
  to: string;
  protocol: string;
  pool: string;
  pct: number;
}

const MOCK_ROUTES: RouteHop[][] = [
  [
    { from: "WETH", to: "USDC", protocol: "V3", pool: "0x88e6...a4b1", pct: 60 },
  ],
  [
    { from: "WETH", to: "WBTC", protocol: "V2", pool: "0x4f3c...9d22", pct: 30 },
    { from: "WBTC", to: "USDC", protocol: "V3", pool: "0x1a2b...3c4d", pct: 30 },
  ],
  [
    { from: "WETH", to: "USDC", protocol: "V2", pool: "0xdead...beef", pct: 10 },
  ],
];

const ROUTE_COLORS = ["#00d4ff", "#8b5cf6", "#00ff87"];

function RouteVisualizer() {
  return (
    <div className="space-y-3">
      {MOCK_ROUTES.map((route, ri) => (
        <div key={ri} className="flex items-center gap-2 group">
          {/* Percentage */}
          <div
            className="w-10 text-right text-xs font-mono font-bold flex-shrink-0"
            style={{ color: ROUTE_COLORS[ri] }}
          >
            {route[route.length - 1].pct}%
          </div>

          {/* Bar indicator */}
          <div className="relative h-1.5 rounded-full bg-border-dim flex-shrink-0 w-20">
            <div
              className="absolute left-0 top-0 h-full rounded-full"
              style={{
                width: `${route[route.length - 1].pct}%`,
                backgroundColor: ROUTE_COLORS[ri],
                boxShadow: `0 0 6px ${ROUTE_COLORS[ri]}80`,
              }}
            />
          </div>

          {/* Hops */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {route.map((hop, hi) => (
              <div key={hi} className="flex items-center gap-1.5">
                {hi === 0 && (
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-md border"
                    style={{
                      color: ROUTE_COLORS[ri],
                      borderColor: `${ROUTE_COLORS[ri]}30`,
                      backgroundColor: `${ROUTE_COLORS[ri]}10`,
                    }}
                  >
                    {hop.from}
                  </span>
                )}
                <span className="text-muted text-xs">→</span>
                <div
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs"
                  style={{
                    borderColor: `${ROUTE_COLORS[ri]}25`,
                    backgroundColor: `${ROUTE_COLORS[ri]}08`,
                  }}
                >
                  <span className="text-muted font-mono text-[10px]">
                    {hop.pool}
                  </span>
                  <Badge
                    variant={hop.protocol === "V3" ? "cyan" : "purple"}
                    className="text-[9px] px-1 py-0"
                  >
                    {hop.protocol}
                  </Badge>
                </div>
                <span className="text-muted text-xs">→</span>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-md border"
                  style={{
                    color: ROUTE_COLORS[ri],
                    borderColor: `${ROUTE_COLORS[ri]}30`,
                    backgroundColor: `${ROUTE_COLORS[ri]}10`,
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

export default function SwapPage() {
  const [tokenIn, setTokenIn] = useState("WETH");
  const [tokenOut, setTokenOut] = useState("USDC");
  const [amountIn, setAmountIn] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [quoteResult, setQuoteResult] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const { data: pools } = useSWR<Pool[]>(`${BASE}/api/pools`, swrFetcher);

  const tokenSymbols = useMemo(() => {
    const set = new Set<string>();
    pools?.forEach((p) => {
      if (p.token0_symbol) set.add(p.token0_symbol);
      if (p.token1_symbol) set.add(p.token1_symbol);
    });
    return Array.from(set).slice(0, 30);
  }, [pools]);

  const handleSwapTokens = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setQuoteResult(null);
    setQuoteError(null);
  };

  const handleGetQuote = async () => {
    if (!amountIn) return;
    setQuoteLoading(true);
    setQuoteError(null);
    setQuoteResult(null);
    try {
      const res = await fetch(`${BASE}/api/swap/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_in: tokenIn,
          token_out: tokenOut,
          amount_in: amountIn,
        }),
      });
      if (res.status === 404) {
        setQuoteError("routing not yet wired — quote endpoint not available");
      } else if (!res.ok) {
        setQuoteError(`Error ${res.status}: ${await res.text()}`);
      } else {
        const data = await res.json();
        setQuoteResult(String(data.amount_out ?? data.quote ?? JSON.stringify(data)));
      }
    } catch {
      setQuoteError("routing not yet wired — could not connect to API");
    } finally {
      setQuoteLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* Swap card */}
      <Card glow>
        <CardHeader>
          <CardTitle>Swap</CardTitle>
          <Badge variant="purple">Beta</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Token In */}
          <div className="bg-surface rounded-xl border border-border-dim p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted uppercase tracking-wider">You pay</span>
              <span className="text-xs text-muted">Balance: —</span>
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
                  onChange={(e) => setTokenIn(e.target.value)}
                  className="appearance-none bg-card border border-border-dim rounded-xl pl-3 pr-8 py-2 text-sm font-semibold text-[#e8eaf0] focus:outline-none focus:border-cyan/40 cursor-pointer"
                >
                  {tokenSymbols.length > 0
                    ? tokenSymbols.map((t) => <option key={t}>{t}</option>)
                    : ["WETH", "USDC", "WBTC", "DAI", "USDT"].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Swap direction button */}
          <div className="flex justify-center -my-1 z-10 relative">
            <button
              onClick={handleSwapTokens}
              className="bg-card border border-border-dim rounded-xl p-2 hover:border-cyan/30 hover:bg-cyan/5 transition-all group"
            >
              <ArrowDownUp size={16} className="text-muted group-hover:text-cyan transition-colors" />
            </button>
          </div>

          {/* Token Out */}
          <div className="bg-surface rounded-xl border border-border-dim p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted uppercase tracking-wider">You receive</span>
              <span className="text-xs text-muted">Balance: —</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 text-2xl font-mono font-semibold text-muted">
                {quoteResult ? (
                  <span className="text-[#e8eaf0]">{formatNumber(parseFloat(quoteResult), 6)}</span>
                ) : (
                  "0.0"
                )}
              </div>
              <div className="relative">
                <select
                  value={tokenOut}
                  onChange={(e) => setTokenOut(e.target.value)}
                  className="appearance-none bg-card border border-border-dim rounded-xl pl-3 pr-8 py-2 text-sm font-semibold text-[#e8eaf0] focus:outline-none focus:border-cyan/40 cursor-pointer"
                >
                  {tokenSymbols.length > 0
                    ? tokenSymbols.map((t) => <option key={t}>{t}</option>)
                    : ["USDC", "WETH", "WBTC", "DAI", "USDT"].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Quote error */}
          {quoteError && (
            <div className="flex items-start gap-2 bg-amber-500/8 border border-amber-500/20 rounded-xl p-3">
              <AlertCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-300">{quoteError}</p>
            </div>
          )}

          {/* Slippage & gas row */}
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
              <p className="text-xs text-muted mb-1 uppercase tracking-wider">Gas Estimate</p>
              <p className="text-xs font-mono text-muted">—</p>
            </div>
          </div>

          {/* Price impact */}
          <div className="flex items-center justify-between text-xs py-1 border-t border-border-dim/50">
            <span className="text-muted flex items-center gap-1">
              <Info size={11} /> Price impact
            </span>
            <span className="text-green font-mono">{"< 0.01%"}</span>
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button
              variant="outline"
              onClick={handleGetQuote}
              loading={quoteLoading}
              disabled={!amountIn}
            >
              <Zap size={14} />
              Get Quote
            </Button>
            <div className="relative group">
              <Button
                variant="primary"
                className="w-full opacity-50 cursor-not-allowed"
                disabled
              >
                <Lock size={14} />
                Build & Sign
              </Button>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-card border border-border-dim rounded-lg text-xs text-muted whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                Coming soon — DeFi VM integration pending
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Route visualizer */}
      <Card>
        <CardHeader>
          <CardTitle>Split Route</CardTitle>
          <Badge variant="muted">Mock</Badge>
        </CardHeader>
        <CardContent>
          <div className="mb-4 pb-3 border-b border-border-dim flex items-center justify-between text-xs">
            <span className="text-muted">
              {tokenIn} → {tokenOut}
            </span>
            <span className="text-muted">3 routes · 3 hops</span>
          </div>
          <RouteVisualizer />
          <p className="text-xs text-muted mt-4 italic flex items-center gap-1.5">
            <Info size={10} />
            Route visualization is mocked. Connect the routing engine to see live paths.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
