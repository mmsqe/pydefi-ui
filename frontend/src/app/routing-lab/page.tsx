"use client";

import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Loader, RefreshCw, ArrowRight, X } from "lucide-react";
import { fetchPools } from "@/lib/api";
import type { Pool } from "@/lib/types";

// ── Token colours ─────────────────────────────────────────────────────────────
function tokenColor(sym: string): string {
  let hash = 0;
  for (let i = 0; i < sym.length; i++) hash = (hash * 31 + sym.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 70%, 65%)`;
}

const PROTOCOL_COLOR: Record<string, string> = {
  v3: "#00d4ff", uniswapv3: "#00d4ff",
  v2: "#8b5cf6", uniswapv2: "#8b5cf6", sushiswap: "#8b5cf6",
};
function protocolColor(p: string) {
  return PROTOCOL_COLOR[p.toLowerCase()] ?? "#64748b";
}
function protocolShort(p: string): string {
  const l = p.toLowerCase();
  if (l === "uniswapv3" || l === "v3") return "V3";
  if (l === "uniswapv2" || l === "v2") return "V2";
  if (l === "sushiswap") return "SushiV2";
  return p;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TokenNode {
  symbol: string; address: string; decimals: number; chain_id: number;
}
interface GraphEdge {
  pool_address: string; from: string; to: string; protocol: string; fee_bps: number;
}
interface DAGSwap {
  type: "swap"; token_out: string; pool_address: string; protocol: string; fee_bps: number;
}
interface DAGSplit {
  type: "split"; token_out: string; legs: { fraction_bps: number; actions: DAGAction[] }[];
}
type DAGAction = DAGSwap | DAGSplit;
interface RouteDAGData { token_in: string; actions: DAGAction[]; }
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

// ── DAG diagram ───────────────────────────────────────────────────

interface VisualHop { token_in: string; token_out: string; protocol: string; fee_bps: number; }
interface VisualLane { fraction_bps: number; hops: VisualHop[]; }

function flattenDAG(actions: DAGAction[], tokenIn: string, fraction = 10000): VisualLane[] {
  let cur = tokenIn;
  const pre: VisualHop[] = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.type === "swap") {
      pre.push({ token_in: cur, token_out: a.token_out, protocol: a.protocol, fee_bps: a.fee_bps });
      cur = a.token_out;
    } else {
      const remaining = actions.slice(i + 1);
      const lanes: VisualLane[] = [];
      for (const leg of a.legs) {
        const legFrac = Math.round((fraction * leg.fraction_bps) / 10000);
        for (const sub of flattenDAG(leg.actions, cur, legFrac)) {
          const postHops = remaining.length > 0
            ? (flattenDAG(remaining, a.token_out, sub.fraction_bps)[0]?.hops ?? [])
            : [];
          lanes.push({ fraction_bps: sub.fraction_bps, hops: [...pre, ...sub.hops, ...postHops] });
        }
      }
      return lanes;
    }
  }
  return [{ fraction_bps: fraction, hops: pre }];
}

const D_W = 680;
const D_NODE_R = 22;
const D_INT_R = 16;
const D_LANE_H = 64;
const D_PAD_Y = 18;
const D_PAD_X = 58;

// ── Section-based DAG types ───────────────────────────────────────────────────

interface VisualSeqSection { type: "seq"; hops: VisualHop[]; }
interface VisualSplitSection {
  type: "split";
  token_in: string;
  legs: { fraction_bps: number; hops: VisualHop[] }[];
  token_out: string;
}
type VisualSection = VisualSeqSection | VisualSplitSection;

/** Convert DAGActions into visual sections — one section per action.
 *
 *  Each RouteSwap becomes its own single-hop "seq" section so that
 *  intermediate token circles appear as proper graph nodes between sections
 *  (e.g. WETH→UNI→USDC→WETH shows UNI and USDC circles, not just badges).
 *  Each RouteSplit becomes one "split" section.  Nested splits within legs
 *  are flattened one level. */
function buildSections(actions: DAGAction[], tokenIn: string): VisualSection[] {
  const sections: VisualSection[] = [];
  let cur = tokenIn;
  for (const a of actions) {
    if (a.type === "swap") {
      sections.push({ type: "seq", hops: [{ token_in: cur, token_out: a.token_out, protocol: a.protocol, fee_bps: a.fee_bps }] });
      cur = a.token_out;
    } else {
      sections.push({
        type: "split", token_in: cur,
        legs: a.legs.map((leg) => {
          let lc = cur; const hops: VisualHop[] = [];
          for (const la of leg.actions) {
            if (la.type === "swap") {
              hops.push({ token_in: lc, token_out: la.token_out, protocol: la.protocol, fee_bps: la.fee_bps });
              lc = la.token_out;
            }
          }
          return { fraction_bps: leg.fraction_bps, hops };
        }),
        token_out: a.token_out,
      });
      cur = a.token_out;
    }
  }
  return sections;
}

// ── DAG diagram ───────────────────────────────────────────────────────────────

function DAGDiagram({
  dag,
  selectedLaneIdx = null,
  onLaneClick = () => {},
}: {
  dag: RouteDAGData;
  selectedLaneIdx?: number | null;
  onLaneClick?: (legIdx: number) => void;
}) {
  const sections = buildSections(dag.actions, dag.token_in);
  if (sections.length === 0) {
    return <p className="text-xs text-muted py-4 text-center">No swaps in route.</p>;
  }

  // Vertical: height driven by the widest split block
  const maxLanes = sections.reduce((m, s) => s.type === "split" ? Math.max(m, s.legs.length) : m, 1);
  const H = D_PAD_Y * 2 + Math.max(maxLanes, 1) * D_LANE_H;
  const cy = H / 2;

  // Node list: [tokenIn, inter0, inter1, …, tokenOut]
  const nodeSyms: string[] = [dag.token_in];
  for (let i = 0; i < sections.length - 1; i++) {
    const s = sections[i];
    nodeSyms.push(s.type === "seq" ? s.hops.at(-1)!.token_out : s.token_out);
  }
  const last = sections.at(-1)!;
  nodeSyms.push(last.type === "seq" ? last.hops.at(-1)!.token_out : last.token_out);

  const nodeR = (i: number) => (i === 0 || i === nodeSyms.length - 1) ? D_NODE_R : D_INT_R;

  // Section weights: hop count + 0.5 bonus for split fan lines
  const weights = sections.map((s) =>
    s.type === "seq" ? s.hops.length : Math.max(...s.legs.map((l) => l.hops.length), 1) + 0.5,
  );
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const totalNodePx = nodeSyms.reduce((sum, _, i) => sum + 2 * nodeR(i), 0);
  const availPx = D_W - 2 * D_PAD_X - totalNodePx;

  // Left-to-right layout: alternate node → section → node → …
  let xCur = D_PAD_X;
  const nodeCx: number[] = [];
  const bounds: { x1: number; x2: number }[] = [];
  for (let i = 0; i < nodeSyms.length; i++) {
    nodeCx.push(xCur + nodeR(i));
    xCur += 2 * nodeR(i);
    if (i < sections.length) {
      const sw = (weights[i] / totalW) * availPx;
      bounds.push({ x1: xCur, x2: xCur + sw });
      xCur += sw;
    }
  }

  const laneY = (li: number, nLegs: number) =>
    cy - (nLegs * D_LANE_H) / 2 + D_LANE_H / 2 + li * D_LANE_H;

  const hopFee = (h: VisualHop) =>
    h.fee_bps % 100 === 0 ? `${h.fee_bps / 100}%` : `${(h.fee_bps / 100).toFixed(2)}%`;

  return (
    <svg viewBox={`0 0 ${D_W} ${H}`} width="100%" style={{ display: "block" }}>
      {/* ── Sections ── */}
      {sections.map((sec, si) => {
        const { x1, x2 } = bounds[si];

        if (sec.type === "seq") {
          // Sequential hops drawn on the center line
          const n = sec.hops.length;
          return (
            <g key={si}>
              {sec.hops.map((hop, j) => {
                const hx1 = x1 + (j / n) * (x2 - x1);
                const hx2 = x1 + ((j + 1) / n) * (x2 - x1);
                const xm = (hx1 + hx2) / 2;
                const pc = protocolColor(hop.protocol);
                const lbl = `${protocolShort(hop.protocol)} ${hopFee(hop)}`;
                const bw = lbl.length * 5.6 + 10;
                return (
                  <g key={j}>
                    <line x1={hx1} y1={cy} x2={xm - bw / 2 - 3} y2={cy} stroke={pc} strokeWidth="1.5" />
                    <rect x={xm - bw / 2} y={cy - 9} width={bw} height={18} rx={9}
                      fill="#0d1117" stroke={pc} strokeWidth="1" strokeOpacity="0.9" />
                    <text x={xm} y={cy + 4} textAnchor="middle" fontSize="8"
                      fontFamily="monospace" fill={pc} style={{ pointerEvents: "none" }}>{lbl}</text>
                    <line x1={xm + bw / 2 + 3} y1={cy} x2={hx2} y2={cy} stroke={pc} strokeWidth="1.5" />
                  </g>
                );
              })}
            </g>
          );
        }

        // Split block: fanout → parallel lanes → fanin
        const nLegs = sec.legs.length;
        const fanW = Math.min(30, (x2 - x1) * 0.18);
        const lx1 = x1 + fanW;
        const lx2 = x2 - fanW;
        return (
          <g key={si}>
            {sec.legs.map((leg, li) => {
              const y = laneY(li, nLegs);
              const nHops = Math.max(leg.hops.length, 1);
              const segW = (lx2 - lx1) / nHops;
              const isSelected = nLegs > 1 && li === selectedLaneIdx;
              const fc = isSelected ? "#00d4ff" : (nLegs > 1 ? "#3b4560" : (leg.hops[0] ? protocolColor(leg.hops[0].protocol) : "#3b4560"));
              const laneTop = y - D_LANE_H / 2 + 6;
              const laneH = D_LANE_H - 12;
              return (
                <g key={li}>
                  {/* Selection highlight (behind everything) */}
                  {isSelected && (
                    <rect x={lx1 - 4} y={laneTop} width={lx2 - lx1 + 8} height={laneH}
                      fill="#00d4ff0a" stroke="#00d4ff" strokeWidth="1" strokeOpacity="0.5" rx="4"
                      style={{ pointerEvents: "none" }} />
                  )}
                  {/* Fan-out / fan-in */}
                  <line x1={x1} y1={cy} x2={lx1} y2={y} stroke={fc}
                    strokeWidth={isSelected ? "2" : "1.5"} strokeOpacity={isSelected ? 0.8 : 0.45} />
                  <line x1={lx2} y1={y} x2={x2} y2={cy} stroke={fc}
                    strokeWidth={isSelected ? "2" : "1.5"} strokeOpacity={isSelected ? 0.8 : 0.45} />
                  {nLegs > 1 && (
                    <text x={lx1 + 6} y={y < cy ? y - 9 : y + 18}
                      fontSize="10" fontWeight="bold" fontFamily="monospace"
                      fill={isSelected ? "#00d4ff" : "#00d4ffaa"} textAnchor="start">
                      {(leg.fraction_bps / 100).toFixed(0)}%
                    </text>
                  )}
                  {/* Hops within this leg */}
                  {leg.hops.map((hop, j) => {
                    const hx1 = lx1 + j * segW + (j > 0 ? D_INT_R + 2 : 0);
                    const hx2 = lx1 + (j + 1) * segW;
                    const xm = (hx1 + hx2) / 2;
                    const pc = protocolColor(hop.protocol);
                    const lbl = `${protocolShort(hop.protocol)} ${hopFee(hop)}`;
                    const bw = lbl.length * 5.6 + 10;
                    return (
                      <g key={j}>
                        {j > 0 && (
                          <>
                            <circle cx={lx1 + j * segW} cy={y} r={D_INT_R}
                              fill={`${tokenColor(hop.token_in)}22`}
                              stroke={tokenColor(hop.token_in)} strokeWidth="1.5" />
                            <text x={lx1 + j * segW} y={y + 4} textAnchor="middle"
                              fontSize={hop.token_in.length > 4 ? 6 : 8} fontWeight="bold"
                              fontFamily="monospace" fill={tokenColor(hop.token_in)}
                              style={{ pointerEvents: "none" }}>{hop.token_in}</text>
                          </>
                        )}
                        <line x1={hx1} y1={y} x2={xm - bw / 2 - 3} y2={y} stroke={pc} strokeWidth="1.5" />
                        <rect x={xm - bw / 2} y={y - 9} width={bw} height={18} rx={9}
                          fill="#0d1117" stroke={pc} strokeWidth="1" strokeOpacity="0.9" />
                        <text x={xm} y={y + 4} textAnchor="middle" fontSize="8"
                          fontFamily="monospace" fill={pc} style={{ pointerEvents: "none" }}>{lbl}</text>
                        <line x1={xm + bw / 2 + 3} y1={y} x2={hx2} y2={y} stroke={pc} strokeWidth="1.5" />
                      </g>
                    );
                  })}
                  {/* Clickable overlay rendered last so it sits above all lane content */}
                  {nLegs > 1 && (
                    <rect x={x1} y={y - D_LANE_H / 2} width={x2 - x1} height={D_LANE_H}
                      fill="transparent" style={{ cursor: "pointer" }}
                      onClick={() => onLaneClick(li)} />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}

      {/* ── Token nodes ── */}
      {nodeSyms.map((sym, i) => {
        const cx = nodeCx[i];
        const r = nodeR(i);
        const color = tokenColor(sym);
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={r} fill={`${color}22`} stroke={color} strokeWidth="1.5" />
            <text x={cx} y={cy + 4} textAnchor="middle"
              fontSize={sym.length > 4 ? (r >= D_NODE_R ? 7 : 6) : (r >= D_NODE_R ? 9 : 8)}
              fontWeight="bold" fontFamily="monospace" fill={color}
              style={{ pointerEvents: "none" }}>{sym}</text>
          </g>
        );
      })}
    </svg>
  );
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

  const [waypoints, setWaypoints] = useState<string[]>([]);
  const selectedIn = waypoints[0] ?? "";
  const selectedOut = waypoints.at(-1) ?? "";
  const [amountIn, setAmountIn] = useState("1");
  // splitFractions: null = auto; array of percentages summing to 100 = manual N-way split
  const [splitFractions, setSplitFractions] = useState<number[] | null>(null);
  // selectedLegIdx: which split lane is currently highlighted (null = none)
  const [selectedLegIdx, setSelectedLegIdx] = useState<number | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoting, setQuoting] = useState(false);
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
      const body: Record<string, unknown> = { token_in: tokIn, token_out: tokOut, amount_in: amountIn };
      if (waypoints.length > 2) {
        body.path = waypoints.map((sym) => tokenNodes[sym]).filter(Boolean);
        if (splitFractions !== null) body.split_fractions_bps = splitFractions.map((p) => p * 100);
      }
      const res = await fetch("/api/swap/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  // Reset manual split and selection when the path changes
  useEffect(() => { setSplitFractions(null); setSelectedLegIdx(null); }, [waypoints]);

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

  // Clicking a lane in the diagram: highlight it and switch to manual mode
  const handleLaneClick = useCallback((legIdx: number) => {
    setSelectedLegIdx((prev) => prev === legIdx ? null : legIdx);
    setSplitFractions((prev) => prev ?? autoFracs);
  }, [autoFracs]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#e8eaf0] mb-2">Routing Lab</h2>
          <p className="text-sm text-muted">
            {loadingPools ? "Loading pool graph…" : poolError ? poolError
              : `${symbols.length} tokens · ${edges.length} pools — drag nodes · click to chain hops`}
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

      {/* Simulation controls + quote summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Controls */}
        <Card>
          <CardContent className="pt-5 space-y-4">
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
            <p className="text-xs text-muted leading-relaxed">
              Click nodes on the graph to chain hops, or use the path builder below.
            </p>

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
                  {/* Extend path */}
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

            <div>
              <label className="text-[10px] text-muted uppercase tracking-wider block mb-1.5">Amount In</label>
              <input
                type="number" min="0" step="any" value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
                className="w-full bg-[#0d1117] border border-border-dim rounded-lg px-3 py-1.5 text-xs text-[#e8eaf0] focus:outline-none focus:border-cyan/40"
                placeholder="1.0"
              />
            </div>
          </CardContent>
        </Card>

        {/* Quote summary */}
        <Card>
          <CardContent className="pt-5">
            <h3 className="text-sm font-semibold text-[#e8eaf0] mb-3">Quote</h3>

            {/* Spinner only when loading with no prior result */}
            {quoting && !quote && (
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
            {/* Keep previous result visible while re-fetching — just dim it */}
            {quote && (
              <div className="space-y-3" style={{ opacity: quoting ? 0.45 : 1, transition: "opacity 0.15s" }}>
                <div className="flex items-center gap-2 bg-[#0d1117] border border-border-dim rounded-lg px-3 py-2">
                  <span className="font-mono text-xs text-[#e8eaf0]">{amountIn} {quote.token_in}</span>
                  <ArrowRight size={12} className="text-muted flex-shrink-0" />
                  <span className="font-mono text-xs font-semibold ml-auto" style={{ color: "#00ff87" }}>
                    {parseFloat(quote.amount_out_human).toPrecision(6)} {quote.token_out}
                  </span>
                </div>
                {quote.price_impact !== "NaN" && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">Price impact</span>
                    <span className={
                      parseFloat(quote.price_impact) * 100 > 5 ? "text-red-400"
                        : parseFloat(quote.price_impact) * 100 > 1 ? "text-amber-400"
                        : "text-green-400"
                    }>
                      {(parseFloat(quote.price_impact) * 100).toFixed(3)}%
                    </span>
                  </div>
                )}
                {/* Per-lane route breakdown */}
                <div className="pt-1 border-t border-border-dim/50 space-y-2">
                  {quoteLanes.map((lane, i) => (
                    <div key={i} className="space-y-1">
                      {quoteLanes.length > 1 && (
                        <span className="text-[10px] font-mono font-bold text-cyan">
                          {(lane.fraction_bps / 100).toFixed(0)}%
                        </span>
                      )}
                      {lane.hops.map((hop, j) => (
                        <div key={j} className="flex items-center gap-1.5 pl-2 text-xs">
                          <span className="font-mono" style={{ color: tokenColor(hop.token_in) }}>{hop.token_in}</span>
                          <ArrowRight size={9} className="text-muted flex-shrink-0" />
                          <span className="font-mono" style={{ color: tokenColor(hop.token_out) }}>{hop.token_out}</span>
                          <span
                            className="ml-auto text-[10px] font-mono"
                            style={{ color: protocolColor(hop.protocol) }}
                          >
                            {protocolShort(hop.protocol)} {hop.fee_bps % 100 === 0 ? `${hop.fee_bps / 100}%` : `${(hop.fee_bps / 100).toFixed(2)}%`}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!quote && !quoting && !quoteError && (
              <p className="text-xs text-muted">
                {waypoints.length === 0
                  ? "Build a path above, or click nodes on the graph."
                  : waypoints.length === 1
                  ? "Click another token to add the next hop."
                  : ""}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* route diagram — stays mounted while re-fetching to avoid layout jump */}
      {quote && (
        <Card style={{ opacity: quoting ? 0.45 : 1, transition: "opacity 0.15s" }}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
              <p className="text-[10px] text-muted uppercase tracking-wider">Route</p>
              <div className="flex items-center gap-3 flex-wrap">
                {waypoints.length > 2 && (() => {
                  const fracs: number[] = splitFractions ?? autoFracs ?? [];
                  if (fracs.length < 2) return null;

                  const adjust = (i: number, delta: number) => {
                    const next = [...fracs];
                    const donor = i === fracs.length - 1 ? 0 : fracs.length - 1;
                    const nI = next[i] + delta;
                    const nD = next[donor] - delta;
                    if (nI < 5 || nI > 95 || nD < 5) return;
                    next[i] = nI; next[donor] = nD;
                    setSplitFractions(next);
                  };

                  const addLeg = () => {
                    // Split the selected lane (or the largest if none selected)
                    const targetIdx = (selectedLegIdx !== null && selectedLegIdx < fracs.length)
                      ? selectedLegIdx
                      : fracs.indexOf(Math.max(...fracs));
                    const give = Math.floor(fracs[targetIdx] / 2 / 5) * 5;
                    if (give < 5) return;
                    const next = [...fracs];
                    next[targetIdx] -= give;
                    // Insert the new lane right after the split target
                    next.splice(targetIdx + 1, 0, give);
                    setSplitFractions(next);
                    setSelectedLegIdx(targetIdx + 1);
                  };

                  const removeLeg = (i: number) => {
                    if (fracs.length <= 2) return;
                    const removed = fracs[i];
                    const next = fracs.filter((_, j) => j !== i);
                    next[next.length - 1] += removed;
                    setSplitFractions(next);
                    setSelectedLegIdx((prev) => {
                      if (prev === null) return null;
                      if (prev === i) return null;
                      return prev > i ? prev - 1 : prev;
                    });
                  };

                  return (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-muted">Split</span>
                      {fracs.map((pct, i) => {
                        const isSel = i === selectedLegIdx;
                        return (
                          <div key={i}
                            onClick={() => setSelectedLegIdx((prev) => prev === i ? null : i)}
                            className={`flex items-center gap-0.5 border rounded px-1 py-0.5 cursor-pointer transition-colors ${
                              isSel
                                ? "border-cyan bg-cyan/15 ring-1 ring-cyan/40"
                                : "border-cyan/30 bg-cyan/5 hover:border-cyan/60"
                            }`}>
                            <div className="flex flex-col" style={{ lineHeight: 1 }}>
                              <button onClick={(e) => { e.stopPropagation(); adjust(i, 5); }}
                                className="text-[7px] text-muted hover:text-cyan px-0.5">▲</button>
                              <button onClick={(e) => { e.stopPropagation(); adjust(i, -5); }}
                                className="text-[7px] text-muted hover:text-cyan px-0.5">▼</button>
                            </div>
                            <span className={`text-[10px] font-mono w-7 text-center ${isSel ? "text-cyan font-bold" : "text-cyan"}`}>{pct}%</span>
                            {fracs.length > 2 && (
                              <button onClick={(e) => { e.stopPropagation(); removeLeg(i); }}
                                className="text-[8px] text-muted hover:text-red-400 ml-0.5">×</button>
                            )}
                          </div>
                        );
                      })}
                      <button onClick={addLeg}
                        title={selectedLegIdx !== null ? `Split lane ${selectedLegIdx + 1}` : "Split largest lane"}
                        className="text-[10px] text-muted hover:text-cyan border border-dashed border-border-dim rounded px-1.5 py-0.5">
                        +
                      </button>
                      {splitFractions !== null && (
                        <button onClick={() => { setSplitFractions(null); setSelectedLegIdx(null); }}
                          className="text-[10px] text-muted hover:text-[#e8eaf0] transition-colors">
                          auto
                        </button>
                      )}
                    </div>
                  );
                })()}
                {quoteLanes.length > 1 && (
                  <span className="text-[10px] font-mono text-cyan px-2 py-0.5 rounded-full border border-cyan/30 bg-cyan/5">
                    split route
                  </span>
                )}
              </div>
            </div>
            <div className="bg-[#0a0b0e] rounded-xl px-2 py-3">
              <DAGDiagram dag={quote.dag} selectedLaneIdx={selectedLegIdx} onLaneClick={handleLaneClick} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
