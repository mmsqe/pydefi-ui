"use client";

import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { useUrlRestoreOnce, useUrlWrite } from "@/lib/use-url-state";
import { Card, CardContent } from "@/components/ui/card";
import { Loader, RefreshCw, ArrowRight, X } from "lucide-react";
import { fetchPools } from "@/lib/api";
import type { Pool } from "@/lib/types";
import {
  RouteTree, flattenDAG, tokenColor, protocolColor,
  type DAGAction, type RouteDAGData,
} from "@/components/ui/route-tree";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TokenNode {
  symbol: string; address: string; decimals: number; chain_id: number;
}
interface GraphEdge {
  pool_address: string; from: string; to: string; protocol: string; fee_bps: number;
}
interface QuoteResult {
  amount_out: string; amount_out_human: string; price_impact: string;
  token_in: string; token_out: string; dag: RouteDAGData;
}

/** Returns true if picking `token` at position `changeIdx` (−1 = append) would
 *  produce an invalid route.  Two cases are rejected by the backend:
 *  1. start === end with no intermediate hops (only 2 waypoints total)
 *  2. any consecutive pair is the same token (e.g. WETH→WETH) — the router
 *     raises ValueError for same-token hops regardless of path length. */
function wouldConflict(waypoints: string[], changeIdx: number, token: string): boolean {
  const next = changeIdx === -1
    ? [...waypoints, token]
    : waypoints.map((w, j) => (j === changeIdx ? token : w));
  if (next.length <= 2 && next[0] === next.at(-1)) return true;
  for (let i = 0; i < next.length - 1; i++) {
    if (next[i] === next[i + 1]) return true;
  }
  return false;
}

function dagPoolAddresses(actions: DAGAction[]): string[] {
  const out: string[] = [];
  for (const a of actions) {
    if (a.type === "swap") out.push(a.pool_address);
    else a.legs.forEach((l) => out.push(...dagPoolAddresses(l.actions)));
  }
  return out;
}

// ── Pool graph layout ─────────────────────────────────────────────────────────

const SVG_W = 800;
const SVG_H = 420;

function radialPositions(
  symbols: string[], cx: number, cy: number, r: number,
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  symbols.forEach((sym, i) => {
    const angle = (2 * Math.PI * i) / symbols.length - Math.PI / 2;
    out[sym] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  return out;
}

interface PoolGraphProps {
  symbols: string[];
  edges: GraphEdge[];
  positions: Record<string, { x: number; y: number }>;
  routePoolSet: Set<string>;
  selectedIn: string;
  selectedOut: string;
  svgRef: React.RefObject<SVGSVGElement>;
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onNodePointerDown: (e: React.PointerEvent<SVGGElement>, sym: string) => void;
  onNodePointerUp: (e: React.PointerEvent<SVGGElement>, sym: string) => void;
}

const PoolGraphSVG = memo(function PoolGraphSVG({
  symbols, edges, positions, routePoolSet, selectedIn, selectedOut,
  svgRef, onPointerMove, onNodePointerDown, onNodePointerUp,
}: PoolGraphProps) {
  return (
    <svg
      ref={svgRef}
      width="100%" height="100%"
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={onPointerMove}
      style={{ display: "block", userSelect: "none" }}
    >
      <defs>
        <pattern id="lab-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e2132" strokeWidth="0.5" />
        </pattern>
        <filter id="lab-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect width="100%" height="100%" fill="url(#lab-grid)" />

      {edges.map((edge) => {
        const from = positions[edge.from];
        const to = positions[edge.to];
        if (!from || !to) return null;
        const color = protocolColor(edge.protocol);
        const active = routePoolSet.has(edge.pool_address);
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        return (
          <g key={edge.pool_address}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke={color} strokeWidth={active ? 2.5 : 1}
              strokeOpacity={active ? 1 : 0.2}
              strokeDasharray={active ? undefined : "4 3"}
            />
            <rect x={mx - 16} y={my - 9} width="32" height="17" rx="5"
              fill="#13161e" stroke={color}
              strokeOpacity={active ? 0.9 : 0.2} strokeWidth="1"
            />
            <text x={mx} y={my + 4} textAnchor="middle" fontSize="8"
              fill={active ? color : `${color}60`} fontFamily="monospace">
              {edge.fee_bps / 100}%
            </text>
          </g>
        );
      })}

      {symbols.map((sym) => {
        const pos = positions[sym];
        if (!pos) return null;
        const color = tokenColor(sym);
        const isIn = sym === selectedIn;
        const isOut = sym === selectedOut;
        const hl = isIn || isOut;
        const r = hl ? 28 : 24;
        return (
          <g key={sym}
            onPointerDown={(e) => onNodePointerDown(e, sym)}
            onPointerUp={(e) => onNodePointerUp(e, sym)}
            style={{ cursor: "grab" }}
          >
            <circle cx={pos.x} cy={pos.y} r={r + 4}
              fill={`${color}${hl ? "20" : "0a"}`}
              stroke={isIn ? "#00ff87" : isOut ? "#00d4ff" : color}
              strokeWidth={hl ? 2 : 1.5} strokeOpacity={hl ? 1 : 0.35}
              filter={hl ? "url(#lab-glow)" : undefined}
            />
            <circle cx={pos.x} cy={pos.y} r={r - 4}
              fill={`${color}22`}
              stroke={isIn ? "#00ff87" : isOut ? "#00d4ff" : color}
              strokeWidth="1" strokeOpacity={hl ? 0.8 : 0.4}
            />
            <text x={pos.x} y={pos.y + 4} textAnchor="middle"
              fontSize={sym.length > 4 ? "7" : "9"} fontWeight="bold"
              fontFamily="monospace"
              fill={isIn ? "#00ff87" : isOut ? "#00d4ff" : color}
              style={{ pointerEvents: "none" }}
            >
              {sym}
            </text>
            {hl && (
              <text x={pos.x} y={pos.y - r - 10} textAnchor="middle"
                fontSize="8" fontFamily="monospace"
                fill={isIn ? "#00ff87" : "#00d4ff"}
                style={{ pointerEvents: "none" }}
              >
                {isIn ? "FROM" : "TO"}
              </text>
            )}
          </g>
        );
      })}

      {[["V3", "#00d4ff"], ["V2", "#8b5cf6"]].map(([label, color], i) => (
        <g key={label} transform={`translate(${14 + i * 58}, ${SVG_H - 14})`}>
          <line x1="0" y1="5" x2="16" y2="5" stroke={color} strokeWidth="1.5" strokeDasharray="4 2" />
          <text x="20" y="9" fontSize="9" fill={color} fontFamily="monospace">{label}</text>
        </g>
      ))}
      <text x={SVG_W - 8} y={SVG_H - 8} textAnchor="end" fontSize="8" fill="#374151" fontFamily="monospace">
        drag nodes · click to chain hops
      </text>
    </svg>
  );
});

// ── Main component ────────────────────────────────────────────────────────────

export default function RoutingLabPage() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [loadingPools, setLoadingPools] = useState(true);
  const [poolError, setPoolError] = useState<string | null>(null);

  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});

  const dragging = useRef<string | null>(null);
  const dragStart = useRef({ px: 0, py: 0, nx: 0, ny: 0 });
  const didDrag = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null) as React.RefObject<SVGSVGElement>;
  // Prevents the waypoints-change effect from clearing restored split fractions
  const isRestoringFromUrl = useRef(false);

  const [waypoints, setWaypoints] = useState<string[]>([]);
  const selectedIn = waypoints[0] ?? "";
  const selectedOut = waypoints.at(-1) ?? "";
  const [amountIn, setAmountIn] = useState("1");
  // splitFractions: null = auto; array of percentages summing to 100 = manual N-way split
  const [splitFractions, setSplitFractions] = useState<number[] | null>(null);
  // selectedLane: which split lane is highlighted — tracks both section and leg index
  const [selectedLane, setSelectedLane] = useState<{ si: number; li: number } | null>(null);
  // fracs of the clicked section (may differ from the global autoFracs)
  const [selectedSectionFracs, setSelectedSectionFracs] = useState<number[] | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [showGraph, setShowGraph] = useState(true);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // ── Load pools ──────────────────────────────────────────────────────────────

  const loadPools = useCallback(() => {
    setLoadingPools(true);
    setPoolError(null);
    fetchPools()
      .then((data) => setPools(data))
      .catch((e: unknown) => setPoolError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingPools(false));
  }, []);

  useEffect(() => { loadPools(); }, [loadPools]);

  // ── Build graph from pools ──────────────────────────────────────────────────

  const { tokenNodes, edges } = useMemo<{ tokenNodes: Record<string, TokenNode>; edges: GraphEdge[] }>(() => {
    const tokenNodes: Record<string, TokenNode> = {};
    const edges: GraphEdge[] = [];
    for (const p of pools) {
      tokenNodes[p.token0_symbol] ??= { symbol: p.token0_symbol, address: p.token0_address, decimals: p.token0_decimals, chain_id: p.chain_id };
      tokenNodes[p.token1_symbol] ??= { symbol: p.token1_symbol, address: p.token1_address, decimals: p.token1_decimals, chain_id: p.chain_id };
      edges.push({ pool_address: p.pool_address, from: p.token0_symbol, to: p.token1_symbol, protocol: p.protocol, fee_bps: p.fee_bps });
    }
    return { tokenNodes, edges };
  }, [pools]);

  const symbols = useMemo(() => Object.keys(tokenNodes), [tokenNodes]);

  useEffect(() => {
    if (symbols.length === 0) return;
    setPositions((prev) => {
      const radius = Math.min(SVG_W, SVG_H) * 0.36;
      const initial = radialPositions(symbols, SVG_W / 2, SVG_H / 2, radius);
      const next: typeof prev = {};
      for (const sym of symbols) next[sym] = prev[sym] ?? initial[sym];
      return next;
    });
  }, [symbols]);

  // ── Drag ────────────────────────────────────────────────────────────────────

  const svgPoint = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: ((clientX - rect.left) / rect.width) * SVG_W, y: ((clientY - rect.top) / rect.height) * SVG_H };
  }, []);

  const onNodePointerDown = useCallback((e: React.PointerEvent<SVGGElement>, sym: string) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = svgPoint(e.clientX, e.clientY);
    const pos = positions[sym] ?? pt;
    dragging.current = sym; didDrag.current = false;
    dragStart.current = { px: pt.x, py: pt.y, nx: pos.x, ny: pos.y };
  }, [positions, svgPoint]);

  const onSvgPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    const pt = svgPoint(e.clientX, e.clientY);
    const dx = pt.x - dragStart.current.px;
    const dy = pt.y - dragStart.current.py;
    if (Math.hypot(dx, dy) > 4) didDrag.current = true;
    const sym = dragging.current;
    setPositions((prev) => ({
      ...prev,
      [sym]: { x: Math.max(32, Math.min(SVG_W - 32, dragStart.current.nx + dx)), y: Math.max(32, Math.min(SVG_H - 32, dragStart.current.ny + dy)) },
    }));
  }, [svgPoint]);

  const onNodePointerUp = useCallback((e: React.PointerEvent<SVGGElement>, sym: string) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    const wasDrag = didDrag.current;
    dragging.current = null; didDrag.current = false;
    if (wasDrag) return;
    setWaypoints((prev) => {
      if (prev.length === 0) return [sym];
      if (prev.at(-1) === sym) return prev; // already last hop — no-op
      return [...prev, sym];
    });
    setQuote(null);
    setQuoteError(null);
  }, []);

  // ── Quote ───────────────────────────────────────────────────────────────────

  const fetchQuote = useCallback(async () => {
    if (waypoints.length < 2) return;
    const amt = parseFloat(amountIn);
    if (!amountIn || isNaN(amt) || amt <= 0) return;
    const tokIn = tokenNodes[waypoints[0]];
    const tokOut = tokenNodes[waypoints.at(-1)!];
    if (!tokIn || !tokOut) return;
    setQuoting(true); setQuoteError(null);
    try {
      const baseBody: Record<string, unknown> = { token_in: tokIn, token_out: tokOut, amount_in: amountIn };
      if (waypoints.length > 2) {
        baseBody.path = waypoints.map((sym) => tokenNodes[sym]).filter(Boolean);
        if (splitFractions !== null) baseBody.split_fractions_bps = splitFractions.map((p) => p * 100);
      }
      const res = await fetch("/api/swap/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        let detail = text;
        try { detail = JSON.parse(text).detail ?? text; } catch { /* ignore */ }
        throw new Error(detail);
      }
      setQuote(await res.json());
    } catch (e: unknown) {
      setQuote(null);
      setQuoteError(e instanceof Error ? e.message : String(e));
    } finally {
      setQuoting(false);
    }
  }, [waypoints, amountIn, splitFractions, tokenNodes]);

  // ── URL state sync ───────────────────────────────────────────────────────────

  useUrlRestoreOnce((p) => {
    const t = p.get("t");
    const a = p.get("a");
    const s = p.get("s");
    const tokens = t ? t.split(",").filter(Boolean) : [];
    if (tokens.length < 2 && !a) return;
    isRestoringFromUrl.current = true;
    if (tokens.length >= 2) setWaypoints(tokens);
    if (a) setAmountIn(a);
    if (s) {
      const parts = s.split(",").map(Number);
      if (parts.length >= 2 && parts.every((n) => !isNaN(n) && n > 0)) setSplitFractions(parts);
    }
  });

  useUrlWrite(() => {
    const p = new URLSearchParams();
    if (waypoints.length > 0) p.set("t", waypoints.join(","));
    if (amountIn && amountIn !== "1") p.set("a", amountIn);
    if (splitFractions) p.set("s", splitFractions.join(","));
    return p;
  }, [waypoints, amountIn, splitFractions]);

  // Reset manual split and selection when the path changes (skip during URL restore)
  useEffect(() => {
    if (isRestoringFromUrl.current) { isRestoringFromUrl.current = false; return; }
    setSplitFractions(null);
    setSelectedLane(null);
    setSelectedSectionFracs(null);
  }, [waypoints]);

  useEffect(() => {
    if (waypoints.length < 2) return;
    const t = setTimeout(fetchQuote, 400);
    return () => clearTimeout(t);
  }, [waypoints, amountIn, splitFractions, fetchQuote]);

  // ── Active route highlight + lane breakdown ───────────────────────────────

  const routePoolSet = useMemo<Set<string>>(
    () => new Set(quote ? dagPoolAddresses(quote.dag.actions) : []),
    [quote],
  );

  const quoteLanes = useMemo(
    () => quote ? flattenDAG(quote.dag.actions, quote.dag.token_in) : [],
    [quote],
  );

  const autoFracs = useMemo(
    () => quoteLanes.length > 1 ? quoteLanes.map((l) => Math.round(l.fraction_bps / 100)) : null,
    [quoteLanes],
  );

  // Clicking a lane in the diagram: visually select it (no quote re-trigger)
  const handleLaneClick = useCallback((si: number, li: number, sectionFracs: number[]) => {
    setSelectedLane((prev) => {
      if (prev?.si === si && prev?.li === li) { setSelectedSectionFracs(null); return null; }
      // seq sections pass [] — keep showing the global fracs in the controls
      setSelectedSectionFracs(sectionFracs.length > 0 ? sectionFracs : null);
      return { si, li };
    });
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[#e8eaf0] mb-1">Routing Lab</h2>
          <p className="text-sm text-muted">
            {loadingPools ? "Loading pool graph…" : poolError ? poolError
              : `${symbols.length} tokens · ${edges.length} pools`}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-1 flex-shrink-0">
          <button
            onClick={() => setShowGraph((v) => !v)}
            className="text-[10px] text-muted hover:text-[#e8eaf0] border border-border-dim rounded px-2 py-1 transition-colors"
          >
            {showGraph ? "Hide Graph" : "Pool Graph"}
          </button>
          <button
            onClick={loadPools}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-[#e8eaf0] transition-colors"
          >
            <RefreshCw size={12} className={loadingPools ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Pool graph — collapsible */}
      {showGraph && (
        <Card>
          <CardContent className="p-0">
            <div className="relative bg-[#0a0b0e] border border-border-dim rounded-xl overflow-hidden" style={{ height: SVG_H }}>
              {loadingPools && (
                <div className="absolute inset-0 flex items-center justify-center z-10 bg-[#0a0b0e]/80">
                  <Loader size={22} className="animate-spin text-cyan" />
                </div>
              )}
              <PoolGraphSVG
                symbols={symbols}
                edges={edges}
                positions={positions}
                routePoolSet={routePoolSet}
                selectedIn={selectedIn}
                selectedOut={selectedOut}
                svgRef={svgRef}
                onPointerMove={onSvgPointerMove}
                onNodePointerDown={onNodePointerDown}
                onNodePointerUp={onNodePointerUp}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main panel: path + amount + quote + route tree */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          {/* Row: title + reset */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#e8eaf0]">Route Simulation</h3>
            {waypoints.length > 0 && (
              <button
                onClick={() => { setWaypoints([]); setQuote(null); setQuoteError(null); }}
                className="text-[10px] text-muted hover:text-red-400 transition-colors"
              >
                Reset
              </button>
            )}
          </div>

          {/* Path chain builder */}
          <div className="flex items-center gap-1.5 flex-wrap min-h-[28px]">
            {waypoints.length === 0 ? (
              <select
                value=""
                onChange={(e) => { if (e.target.value) setWaypoints([e.target.value]); }}
                className="text-xs bg-[#0d1117] border border-border-dim rounded-md px-2 py-1 text-muted focus:outline-none focus:border-cyan/40"
              >
                <option value="">Select start token…</option>
                {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <>
                {waypoints.map((sym, i) => (
                  <div key={i} className="flex items-center gap-1">
                    {i > 0 && <ArrowRight size={9} className="text-muted flex-shrink-0" />}
                    <div className="flex items-center gap-0.5 rounded-md border border-border-dim bg-[#0d1117] px-1.5 py-0.5">
                      <select
                        value={sym}
                        onChange={(e) => {
                          const next = [...waypoints]; next[i] = e.target.value;
                          setWaypoints(next); setQuote(null); setQuoteError(null);
                        }}
                        className="text-xs bg-transparent text-[#e8eaf0] focus:outline-none"
                      >
                        {symbols.map((s) => <option key={s} value={s} disabled={wouldConflict(waypoints, i, s)}>{s}</option>)}
                      </select>
                      <button
                        onClick={() => { setWaypoints(waypoints.filter((_, j) => j !== i)); setQuote(null); setQuoteError(null); }}
                        className="text-muted hover:text-red-400 ml-0.5 flex-shrink-0"
                      >
                        <X size={9} />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-1">
                  <ArrowRight size={9} className="text-muted flex-shrink-0" />
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) { setWaypoints([...waypoints, e.target.value]); setQuote(null); setQuoteError(null); }
                    }}
                    className="text-xs bg-[#0d1117] border border-border-dim rounded-md px-1.5 py-0.5 text-muted focus:outline-none focus:border-cyan/40"
                  >
                    <option value="">+ hop</option>
                    {symbols.map((s) => <option key={s} value={s} disabled={wouldConflict(waypoints, -1, s)}>{s}</option>)}
                  </select>
                </div>
              </>
            )}
          </div>

          {/* Amount in */}
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider block mb-1.5">Amount In</label>
            <input
              type="number" min="0" step="any" value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              className="w-full bg-[#0d1117] border border-border-dim rounded-lg px-3 py-1.5 text-xs text-[#e8eaf0] focus:outline-none focus:border-cyan/40"
              placeholder="1.0"
            />
          </div>

          {/* Quote status */}
          {quoting && !quote && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader size={12} className="animate-spin" /> Fetching best route…
            </div>
          )}
          {quoteError && !quoting && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
              <p className="text-xs text-red-400">{quoteError}</p>
            </div>
          )}
          {!quote && !quoting && !quoteError && (
            <p className="text-xs text-muted">
              {waypoints.length === 0
                ? "Build a path above, or click nodes on the graph."
                : waypoints.length === 1 ? "Add the next hop." : ""}
            </p>
          )}

          {/* Quote result + route tree */}
          {quote && (
            <div style={{ opacity: quoting ? 0.45 : 1, transition: "opacity 0.15s" }} className="space-y-3">
              {/* Amount row */}
              <div className="flex items-center gap-2 bg-[#0d1117] border border-border-dim rounded-lg px-3 py-2">
                <span className="font-mono text-xs text-[#e8eaf0]">{amountIn} {quote.token_in}</span>
                <ArrowRight size={12} className="text-muted flex-shrink-0" />
                <span className="font-mono text-xs font-semibold ml-auto" style={{ color: "#00ff87" }}>
                  {parseFloat(quote.amount_out_human).toPrecision(6)} {quote.token_out}
                </span>
                {quote.price_impact !== "NaN" && (
                  <span className={`text-[10px] font-mono ${
                    parseFloat(quote.price_impact) * 100 > 5 ? "text-red-400"
                      : parseFloat(quote.price_impact) * 100 > 1 ? "text-amber-400"
                      : "text-green-400"
                  }`}>
                    ({(parseFloat(quote.price_impact) * 100).toFixed(3)}% impact)
                  </span>
                )}
              </div>

              {/* Route tree */}
              <div className="bg-[#0a0b0e] rounded-xl p-3">
                <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted uppercase tracking-wider">Route</span>
                    {quoteLanes.length > 1 && (
                      <span className="text-[10px] font-mono text-cyan px-2 py-0.5 rounded-full border border-cyan/30 bg-cyan/5">
                        split
                      </span>
                    )}
                  </div>
                  {/* Split fraction controls */}
                  {waypoints.length > 2 && (() => {
                    const fracs: number[] = splitFractions ?? selectedSectionFracs ?? autoFracs ?? [];
                    if (fracs.length < 1) return null;
                    const selLi = selectedLane?.li ?? null;
                    const adjust = (i: number, delta: number) => {
                      const next = [...fracs];
                      const donor = i === fracs.length - 1 ? 0 : fracs.length - 1;
                      const nI = next[i] + delta; const nD = next[donor] - delta;
                      if (nI < 5 || nI > 95 || nD < 5) return;
                      next[i] = nI; next[donor] = nD; setSplitFractions(next);
                    };
                    const addLeg = () => {
                      const targetIdx = (selLi !== null && selLi < fracs.length)
                        ? selLi : fracs.indexOf(Math.max(...fracs));
                      const give = Math.floor(fracs[targetIdx] / 2 / 5) * 5;
                      if (give < 5) return;
                      const next = [...fracs]; next[targetIdx] -= give;
                      next.splice(targetIdx + 1, 0, give); setSplitFractions(next);
                      setSelectedLane((prev) => ({ si: prev?.si ?? -1, li: targetIdx + 1 }));
                    };
                    const removeLeg = (i: number) => {
                      if (fracs.length <= 2) return;
                      const removed = fracs[i];
                      const next = fracs.filter((_, j) => j !== i);
                      next[next.length - 1] += removed; setSplitFractions(next);
                      setSelectedLane((prev) => {
                        if (prev === null || prev.li === i) return null;
                        return prev.li > i ? { ...prev, li: prev.li - 1 } : prev;
                      });
                    };
                    return (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-muted">Split</span>
                        {fracs.map((pct, i) => {
                          const isSel = i === selLi; const isReadOnly = fracs.length === 1;
                          return (
                            <div key={i}
                              onClick={() => !isReadOnly && setSelectedLane((prev) => (prev?.li === i) ? null : { si: prev?.si ?? -1, li: i })}
                              className={`flex items-center gap-0.5 border rounded px-1 py-0.5 transition-colors ${
                                isReadOnly ? "border-cyan/20 bg-cyan/5 cursor-default"
                                  : isSel ? "border-cyan bg-cyan/15 ring-1 ring-cyan/40 cursor-pointer"
                                  : "border-cyan/30 bg-cyan/5 hover:border-cyan/60 cursor-pointer"}`}>
                              {!isReadOnly && (
                                <div className="flex flex-col" style={{ lineHeight: 1 }}>
                                  <button onClick={(e) => { e.stopPropagation(); adjust(i, 5); }} className="text-[7px] text-muted hover:text-cyan px-0.5">▲</button>
                                  <button onClick={(e) => { e.stopPropagation(); adjust(i, -5); }} className="text-[7px] text-muted hover:text-cyan px-0.5">▼</button>
                                </div>
                              )}
                              <span className={`text-[10px] font-mono w-7 text-center ${isSel && !isReadOnly ? "text-cyan font-bold" : "text-cyan/60"}`}>{pct}%</span>
                              {fracs.length > 2 && (
                                <button onClick={(e) => { e.stopPropagation(); removeLeg(i); }} className="text-[8px] text-muted hover:text-red-400 ml-0.5">×</button>
                              )}
                            </div>
                          );
                        })}
                        {fracs.length > 1 && (
                          <button onClick={addLeg}
                            title={selectedLane && selectedSectionFracs === null ? "Add a parallel pool across all hops" : selLi !== null ? `Split lane ${selLi + 1}` : "Split largest lane"}
                            className="text-[10px] text-muted hover:text-cyan border border-dashed border-border-dim rounded px-1.5 py-0.5">+</button>
                        )}
                        {splitFractions !== null && (
                          <button onClick={() => { setSplitFractions(null); setSelectedLane(null); setSelectedSectionFracs(null); }}
                            className="text-[10px] text-muted hover:text-[#e8eaf0] transition-colors">auto</button>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <RouteTree dag={quote.dag} selectedLane={selectedLane} onLaneClick={handleLaneClick} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
