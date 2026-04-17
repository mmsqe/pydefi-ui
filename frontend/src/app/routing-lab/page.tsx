"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Loader, RefreshCw, ArrowRight } from "lucide-react";
import { fetchPools } from "@/lib/api";
import type { Pool } from "@/lib/types";

// ── Token colours ────────────────────────────────────────────────────────────
// Derives a consistent HSL colour from the token symbol — no hardcoded list.

function tokenColor(sym: string): string {
  let hash = 0;
  for (let i = 0; i < sym.length; i++) {
    hash = (hash * 31 + sym.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  // Fixed saturation + lightness keeps every colour readable on a dark background.
  return `hsl(${hue}, 70%, 65%)`;
}

const PROTOCOL_COLOR: Record<string, string> = {
  v3: "#00d4ff", uniswapv3: "#00d4ff",
  v2: "#8b5cf6", uniswapv2: "#8b5cf6", sushiswap: "#8b5cf6",
};

function protocolColor(p: string) {
  return PROTOCOL_COLOR[p.toLowerCase()] ?? "#64748b";
}

// ── Types ────────────────────────────────────────────────────────────────────

interface TokenNode {
  symbol: string;
  address: string;
  decimals: number;
  chain_id: number;
}

interface GraphEdge {
  pool_address: string;
  from: string;
  to: string;
  protocol: string;
  fee_bps: number;
}

interface DAGSwap {
  type: "swap";
  token_out: string;
  pool_address: string;
  protocol: string;
  fee_bps: number;
}

interface DAGSplit {
  type: "split";
  token_out: string;
  legs: { fraction_bps: number; actions: DAGAction[] }[];
}

type DAGAction = DAGSwap | DAGSplit;

interface RouteDAGData {
  token_in: string;
  actions: DAGAction[];
}

interface QuoteResult {
  amount_out: string;
  amount_out_human: string;
  price_impact: string;
  token_in: string;
  token_out: string;
  dag: RouteDAGData;
}

/** Collect all pool_address values from a DAG recursively. */
function dagPoolAddresses(actions: DAGAction[]): string[] {
  const out: string[] = [];
  for (const a of actions) {
    if (a.type === "swap") out.push(a.pool_address);
    else if (a.type === "split") a.legs.forEach((l) => out.push(...dagPoolAddresses(l.actions)));
  }
  return out;
}

// ── Layout helpers ───────────────────────────────────────────────────────────

const SVG_W = 800;
const SVG_H = 420;

function radialPositions(
  symbols: string[],
  cx: number,
  cy: number,
  r: number,
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  symbols.forEach((sym, i) => {
    const angle = (2 * Math.PI * i) / symbols.length - Math.PI / 2;
    out[sym] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  return out;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RoutingLabPage() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [loadingPools, setLoadingPools] = useState(true);
  const [poolError, setPoolError] = useState<string | null>(null);

  // SVG node positions keyed by token symbol
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});

  // Pointer drag tracking (outside React state to avoid render lag)
  const dragging = useRef<string | null>(null);
  const dragStart = useRef({ px: 0, py: 0, nx: 0, ny: 0 });
  const didDrag = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Route simulation
  const [selectedIn, setSelectedIn] = useState("");
  const [selectedOut, setSelectedOut] = useState("");
  const [amountIn, setAmountIn] = useState("1");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // ── Load pools ─────────────────────────────────────────────────────────────

  const loadPools = useCallback(() => {
    setLoadingPools(true);
    setPoolError(null);
    fetchPools()
      .then((data) => setPools(data))
      .catch((e: unknown) => setPoolError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingPools(false));
  }, []);

  useEffect(() => { loadPools(); }, [loadPools]);

  // ── Build graph from pools ─────────────────────────────────────────────────

  const { tokenNodes, edges } = useMemo<{
    tokenNodes: Record<string, TokenNode>;
    edges: GraphEdge[];
  }>(() => {
    const tokenNodes: Record<string, TokenNode> = {};
    const edges: GraphEdge[] = [];

    for (const p of pools) {
      tokenNodes[p.token0_symbol] ??= {
        symbol: p.token0_symbol,
        address: p.token0_address,
        decimals: p.token0_decimals,
        chain_id: p.chain_id,
      };
      tokenNodes[p.token1_symbol] ??= {
        symbol: p.token1_symbol,
        address: p.token1_address,
        decimals: p.token1_decimals,
        chain_id: p.chain_id,
      };
      edges.push({
        pool_address: p.pool_address,
        from: p.token0_symbol,
        to: p.token1_symbol,
        protocol: p.protocol,
        fee_bps: p.fee_bps,
      });
    }
    return { tokenNodes, edges };
  }, [pools]);

  const symbols = useMemo(() => Object.keys(tokenNodes), [tokenNodes]);

  // ── Initialize positions on first load ────────────────────────────────────

  useEffect(() => {
    if (symbols.length === 0) return;
    setPositions((prev) => {
      const radius = Math.min(SVG_W, SVG_H) * 0.36;
      const initial = radialPositions(symbols, SVG_W / 2, SVG_H / 2, radius);
      const next: typeof prev = {};
      for (const sym of symbols) {
        next[sym] = prev[sym] ?? initial[sym];
      }
      return next;
    });
  }, [symbols]);

  // ── Drag helpers ───────────────────────────────────────────────────────────

  const svgPoint = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * SVG_W,
      y: ((clientY - rect.top) / rect.height) * SVG_H,
    };
  }, []);

  const onNodePointerDown = useCallback(
    (e: React.PointerEvent<SVGGElement>, sym: string) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const pt = svgPoint(e.clientX, e.clientY);
      const pos = positions[sym] ?? pt;
      dragging.current = sym;
      didDrag.current = false;
      dragStart.current = { px: pt.x, py: pt.y, nx: pos.x, ny: pos.y };
    },
    [positions, svgPoint],
  );

  const onSvgPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragging.current) return;
      const pt = svgPoint(e.clientX, e.clientY);
      const dx = pt.x - dragStart.current.px;
      const dy = pt.y - dragStart.current.py;
      if (Math.hypot(dx, dy) > 4) didDrag.current = true;
      const sym = dragging.current;
      setPositions((prev) => ({
        ...prev,
        [sym]: {
          x: Math.max(32, Math.min(SVG_W - 32, dragStart.current.nx + dx)),
          y: Math.max(32, Math.min(SVG_H - 32, dragStart.current.ny + dy)),
        },
      }));
    },
    [svgPoint],
  );

  const onNodePointerUp = useCallback(
    (e: React.PointerEvent<SVGGElement>, sym: string) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      const wasDrag = didDrag.current;
      dragging.current = null;
      didDrag.current = false;
      if (wasDrag) return;

      // Click: cycle selectedIn → selectedOut
      if (!selectedIn || (selectedIn && selectedOut)) {
        setSelectedIn(sym);
        setSelectedOut("");
        setQuote(null);
        setQuoteError(null);
      } else if (sym !== selectedIn) {
        setSelectedOut(sym);
      }
    },
    [selectedIn, selectedOut],
  );

  // ── Quote fetching ─────────────────────────────────────────────────────────

  const fetchQuote = useCallback(async () => {
    if (!selectedIn || !selectedOut) return;
    const amt = parseFloat(amountIn);
    if (!amountIn || isNaN(amt) || amt <= 0) return;
    const tokIn = tokenNodes[selectedIn];
    const tokOut = tokenNodes[selectedOut];
    if (!tokIn || !tokOut) return;

    setQuoting(true);
    setQuoteError(null);
    try {
      const res = await fetch("/api/swap/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_in: tokIn,
          token_out: tokOut,
          amount_in: amountIn,
        }),
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
  }, [selectedIn, selectedOut, amountIn, tokenNodes]);

  useEffect(() => {
    if (!selectedIn || !selectedOut) return;
    const t = setTimeout(fetchQuote, 400);
    return () => clearTimeout(t);
  }, [selectedIn, selectedOut, amountIn, fetchQuote]);

  // ── Highlight active route edges ───────────────────────────────────────────

  const routePoolSet = useMemo<Set<string>>(
    () => new Set(quote ? dagPoolAddresses(quote.dag.actions) : []),
    [quote],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#e8eaf0] mb-2">Routing Lab</h2>
          <p className="text-sm text-muted">
            {loadingPools
              ? "Loading pool graph…"
              : poolError
              ? poolError
              : `${symbols.length} tokens · ${edges.length} pools — drag nodes, click two to simulate a route`}
          </p>
        </div>
        <button
          onClick={loadPools}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-[#e8eaf0] transition-colors mt-1"
        >
          <RefreshCw size={12} className={loadingPools ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Pool graph */}
      <Card>
        <CardContent className="p-0">
          <div
            className="relative bg-[#0a0b0e] border border-border-dim rounded-xl overflow-hidden"
            style={{ height: SVG_H }}
          >
            {loadingPools && (
              <div className="absolute inset-0 flex items-center justify-center z-10 bg-[#0a0b0e]/80">
                <Loader size={22} className="animate-spin text-cyan" />
              </div>
            )}

            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              preserveAspectRatio="xMidYMid meet"
              onPointerMove={onSvgPointerMove}
              style={{ display: "block", userSelect: "none" }}
            >
              <defs>
                <pattern id="lab-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e2132" strokeWidth="0.5" />
                </pattern>
                <filter id="lab-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <rect width="100%" height="100%" fill="url(#lab-grid)" />

              {/* Edges */}
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
                    <line
                      x1={from.x} y1={from.y}
                      x2={to.x} y2={to.y}
                      stroke={color}
                      strokeWidth={active ? 2.5 : 1}
                      strokeOpacity={active ? 1 : 0.2}
                      strokeDasharray={active ? undefined : "4 3"}
                    />
                    <rect
                      x={mx - 16} y={my - 9} width="32" height="17" rx="5"
                      fill="#13161e"
                      stroke={color}
                      strokeOpacity={active ? 0.9 : 0.2}
                      strokeWidth="1"
                    />
                    <text
                      x={mx} y={my + 4}
                      textAnchor="middle" fontSize="8"
                      fill={active ? color : `${color}60`}
                      fontFamily="monospace"
                    >
                      {edge.fee_bps / 100}%
                    </text>
                  </g>
                );
              })}

              {/* Token nodes */}
              {symbols.map((sym) => {
                const pos = positions[sym];
                if (!pos) return null;
                const color = tokenColor(sym);
                const isIn = sym === selectedIn;
                const isOut = sym === selectedOut;
                const hl = isIn || isOut;
                const r = hl ? 28 : 24;
                return (
                  <g
                    key={sym}
                    onPointerDown={(e) => onNodePointerDown(e, sym)}
                    onPointerUp={(e) => onNodePointerUp(e, sym)}
                    style={{ cursor: "grab" }}
                  >
                    {/* Outer glow ring */}
                    <circle
                      cx={pos.x} cy={pos.y} r={r + 4}
                      fill={`${color}${hl ? "20" : "0a"}`}
                      stroke={isIn ? "#00ff87" : isOut ? "#00d4ff" : color}
                      strokeWidth={hl ? 2 : 1.5}
                      strokeOpacity={hl ? 1 : 0.35}
                      filter={hl ? "url(#lab-glow)" : undefined}
                    />
                    {/* Inner fill */}
                    <circle
                      cx={pos.x} cy={pos.y} r={r - 4}
                      fill={`${color}22`}
                      stroke={isIn ? "#00ff87" : isOut ? "#00d4ff" : color}
                      strokeWidth="1"
                      strokeOpacity={hl ? 0.8 : 0.4}
                    />
                    {/* Symbol */}
                    <text
                      x={pos.x} y={pos.y + 4}
                      textAnchor="middle"
                      fontSize={sym.length > 4 ? "7" : "9"}
                      fontWeight="bold"
                      fontFamily="monospace"
                      fill={isIn ? "#00ff87" : isOut ? "#00d4ff" : color}
                      style={{ pointerEvents: "none" }}
                    >
                      {sym}
                    </text>
                    {/* FROM / TO label */}
                    {hl && (
                      <text
                        x={pos.x} y={pos.y - r - 10}
                        textAnchor="middle" fontSize="8"
                        fontFamily="monospace"
                        fill={isIn ? "#00ff87" : "#00d4ff"}
                        style={{ pointerEvents: "none" }}
                      >
                        {isIn ? "FROM" : "TO"}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Legend */}
              {[["V3", "#00d4ff"], ["V2", "#8b5cf6"]].map(([label, color], i) => (
                <g key={label} transform={`translate(${14 + i * 58}, ${SVG_H - 14})`}>
                  <line x1="0" y1="5" x2="16" y2="5" stroke={color} strokeWidth="1.5" strokeDasharray="4 2" />
                  <text x="20" y="9" fontSize="9" fill={color} fontFamily="monospace">{label}</text>
                </g>
              ))}
              <text
                x={SVG_W - 8} y={SVG_H - 8}
                textAnchor="end" fontSize="8"
                fill="#374151" fontFamily="monospace"
              >
                drag nodes · click to select route endpoints
              </text>
            </svg>
          </div>
        </CardContent>
      </Card>

      {/* Simulation controls + quote */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Inputs */}
        <Card>
          <CardContent className="pt-5 space-y-4">
            <h3 className="text-sm font-semibold text-[#e8eaf0]">Route Simulation</h3>
            <p className="text-xs text-muted leading-relaxed">
              Click two nodes on the graph, or pick tokens below. Quote updates automatically.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1.5">
                  From
                </label>
                <select
                  value={selectedIn}
                  onChange={(e) => { setSelectedIn(e.target.value); setSelectedOut(""); setQuote(null); setQuoteError(null); }}
                  className="w-full bg-[#0d1117] border border-border-dim rounded-lg px-2.5 py-1.5 text-xs text-[#e8eaf0] focus:outline-none focus:border-cyan/40 appearance-none"
                >
                  <option value="">Select token</option>
                  {symbols.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1.5">
                  To
                </label>
                <select
                  value={selectedOut}
                  onChange={(e) => { setSelectedOut(e.target.value); setQuote(null); setQuoteError(null); }}
                  className="w-full bg-[#0d1117] border border-border-dim rounded-lg px-2.5 py-1.5 text-xs text-[#e8eaf0] focus:outline-none focus:border-cyan/40 appearance-none"
                >
                  <option value="">Select token</option>
                  {symbols.filter((t) => t !== selectedIn).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] text-muted uppercase tracking-wider block mb-1.5">
                Amount In
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
                className="w-full bg-[#0d1117] border border-border-dim rounded-lg px-3 py-1.5 text-xs text-[#e8eaf0] focus:outline-none focus:border-cyan/40"
                placeholder="1.0"
              />
            </div>
          </CardContent>
        </Card>

        {/* Quote result */}
        <Card>
          <CardContent className="pt-5">
            <h3 className="text-sm font-semibold text-[#e8eaf0] mb-3">Quote Result</h3>

            {quoting && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Loader size={12} className="animate-spin" />
                Fetching best route…
              </div>
            )}

            {quoteError && !quoting && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                <p className="text-xs text-red-400">{quoteError}</p>
              </div>
            )}

            {quote && !quoting && (
              <div className="space-y-3">
                {/* Amount in → out */}
                <div className="flex items-center gap-2 bg-[#0d1117] border border-border-dim rounded-lg px-3 py-2">
                  <span className="font-mono text-xs text-[#e8eaf0]">
                    {amountIn} {quote.token_in}
                  </span>
                  <ArrowRight size={12} className="text-muted flex-shrink-0" />
                  <span
                    className="font-mono text-xs font-semibold ml-auto"
                    style={{ color: "#00ff87" }}
                  >
                    {parseFloat(quote.amount_out_human).toPrecision(6)} {quote.token_out}
                  </span>
                </div>

                {/* Price impact */}
                {quote.price_impact !== "NaN" && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">Price impact</span>
                    <span
                      className={
                        parseFloat(quote.price_impact) * 100 > 5
                          ? "text-red-400"
                          : parseFloat(quote.price_impact) * 100 > 1
                          ? "text-amber-400"
                          : "text-green-400"
                      }
                    >
                      {(parseFloat(quote.price_impact) * 100).toFixed(3)}%
                    </span>
                  </div>
                )}

                {/* Route steps from DAG */}
                <div className="pt-2 border-t border-border-dim/60 space-y-2">
                  <p className="text-[10px] text-muted uppercase tracking-wider">Route</p>
                  {dagPoolAddresses(quote.dag.actions).length === 0 && (
                    <p className="text-xs text-muted">No swaps in route.</p>
                  )}
                  {(function renderActions(actions: DAGAction[], tokenIn: string): React.ReactNode[] {
                    const nodes: React.ReactNode[] = [];
                    let currentToken = tokenIn;
                    actions.forEach((action, i) => {
                      if (action.type === "swap") {
                        nodes.push(
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="font-mono" style={{ color: tokenColor(currentToken) }}>{currentToken}</span>
                            <ArrowRight size={10} className="text-muted flex-shrink-0" />
                            <span className="font-mono" style={{ color: tokenColor(action.token_out) }}>{action.token_out}</span>
                            <span
                              className="text-[10px] font-mono ml-auto px-1.5 py-0.5 rounded"
                              style={{ color: protocolColor(action.protocol), backgroundColor: `${protocolColor(action.protocol)}15` }}
                            >
                              {action.protocol} {action.fee_bps / 100}%
                            </span>
                          </div>
                        );
                        currentToken = action.token_out;
                      } else {
                        // split — each leg starts from the same currentToken
                        action.legs.forEach((leg, j) => {
                          nodes.push(
                            <div key={`${i}-${j}`} className="pl-3 border-l border-border-dim/40 space-y-1">
                              <span className="text-[10px] text-cyan font-mono">{leg.fraction_bps / 100}%</span>
                              {renderActions(leg.actions, currentToken)}
                            </div>
                          );
                        });
                        currentToken = action.token_out;
                      }
                    });
                    return nodes;
                  })(quote.dag.actions, quote.dag.token_in)}
                </div>
              </div>
            )}

            {!quote && !quoting && !quoteError && (
              <p className="text-xs text-muted">
                {selectedIn && !selectedOut
                  ? `Now click a destination token on the graph, or pick one from the dropdown.`
                  : "Select a source and destination token to compute a quote."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
