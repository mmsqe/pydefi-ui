"use client";

// ── Token / protocol colours ───────────────────────────────────────────────────

export function tokenColor(sym: string): string {
  let hash = 0;
  for (let i = 0; i < sym.length; i++) hash = (hash * 31 + sym.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 70%, 65%)`;
}

const PROTOCOL_COLOR: Record<string, string> = {
  v3: "#00d4ff", uniswapv3: "#00d4ff",
  v2: "#8b5cf6", uniswapv2: "#8b5cf6", sushiswap: "#8b5cf6",
};
export function protocolColor(p: string) {
  return PROTOCOL_COLOR[p.toLowerCase()] ?? "#64748b";
}
export function protocolShort(p: string): string {
  const l = p.toLowerCase();
  if (l === "uniswapv3" || l === "v3") return "V3";
  if (l === "uniswapv2" || l === "v2") return "V2";
  if (l === "sushiswap") return "SushiV2";
  return p;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DAGSwap {
  type: "swap"; token_out: string; pool_address: string; protocol: string; fee_bps: number;
}
export interface DAGSplit {
  type: "split"; token_out: string; legs: { fraction_bps: number; actions: DAGAction[] }[];
}
export type DAGAction = DAGSwap | DAGSplit;
export interface RouteDAGData { token_in: string; actions: DAGAction[]; }

export interface VisualHop {
  token_in: string; token_out: string; protocol: string; fee_bps: number; pool_address: string;
}
export interface VisualLane { fraction_bps: number; hops: VisualHop[]; }

interface VisualSeqSection { type: "seq"; hops: VisualHop[]; }
interface VisualSplitSection {
  type: "split"; token_in: string;
  legs: { fraction_bps: number; hops: VisualHop[] }[];
  token_out: string;
}
type VisualSection = VisualSeqSection | VisualSplitSection;

// ── DAG flattening ─────────────────────────────────────────────────────────────

export function flattenDAG(actions: DAGAction[], tokenIn: string, fraction = 10000): VisualLane[] {
  let cur = tokenIn;
  const pre: VisualHop[] = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.type === "swap") {
      pre.push({ token_in: cur, token_out: a.token_out, protocol: a.protocol, fee_bps: a.fee_bps, pool_address: a.pool_address });
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

function buildSections(actions: DAGAction[], tokenIn: string): VisualSection[] {
  const sections: VisualSection[] = [];
  let cur = tokenIn;
  for (const a of actions) {
    if (a.type === "swap") {
      sections.push({ type: "seq", hops: [{ token_in: cur, token_out: a.token_out, protocol: a.protocol, fee_bps: a.fee_bps, pool_address: a.pool_address }] });
      cur = a.token_out;
    } else {
      sections.push({
        type: "split", token_in: cur,
        legs: a.legs.map((leg) => {
          let lc = cur; const hops: VisualHop[] = [];
          for (const la of leg.actions) {
            if (la.type === "swap") {
              hops.push({ token_in: lc, token_out: la.token_out, protocol: la.protocol, fee_bps: la.fee_bps, pool_address: la.pool_address });
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

// ── RouteTree SVG ─────────────────────────────────────────────────────────────

const BASE = { W: 700, NODE_R: 26, INT_R: 19, LANE_H: 84, PAD_Y: 22, PAD_X: 44 };

export function RouteTree({
  dag,
  selectedLane = null,
  onLaneClick = () => {},
  dim = false,
  large = false,
}: {
  dag: RouteDAGData;
  selectedLane?: { si: number; li: number } | null;
  onLaneClick?: (si: number, li: number, sectionFracs: number[]) => void;
  dim?: boolean;
  large?: boolean;
}) {
  const sc = large ? 1.55 : 1;
  const RT_W    = BASE.W    * sc;
  const RT_NODE_R = BASE.NODE_R * sc;
  const RT_INT_R  = BASE.INT_R  * sc;
  const RT_LANE_H = BASE.LANE_H * sc;
  const RT_PAD_Y  = BASE.PAD_Y  * sc;
  const RT_PAD_X  = BASE.PAD_X  * sc;

  const sections = buildSections(dag.actions, dag.token_in);
  if (sections.length === 0) {
    return <p className="text-xs text-muted py-4 text-center">No swaps in route.</p>;
  }

  const maxLanes = sections.reduce((m, s) => s.type === "split" ? Math.max(m, s.legs.length) : m, 1);
  const H = RT_PAD_Y * 2 + Math.max(maxLanes, 1) * RT_LANE_H;
  const cy = H / 2;

  const nodeSyms: string[] = [dag.token_in];
  for (let i = 0; i < sections.length - 1; i++) {
    const s = sections[i];
    nodeSyms.push(s.type === "seq" ? s.hops.at(-1)!.token_out : s.token_out);
  }
  const last = sections.at(-1)!;
  nodeSyms.push(last.type === "seq" ? last.hops.at(-1)!.token_out : last.token_out);

  const nodeR = (i: number) => (i === 0 || i === nodeSyms.length - 1) ? RT_NODE_R : RT_INT_R;

  const weights = sections.map((s) =>
    s.type === "seq" ? s.hops.length : Math.max(...s.legs.map((l) => l.hops.length), 1) + 0.6,
  );
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const totalNodePx = nodeSyms.reduce((sum, _, i) => sum + 2 * nodeR(i), 0);
  const availPx = RT_W - 2 * RT_PAD_X - totalNodePx;

  let xCur = RT_PAD_X;
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
    cy - (nLegs * RT_LANE_H) / 2 + RT_LANE_H / 2 + li * RT_LANE_H;

  const feeStr = (h: VisualHop) =>
    h.fee_bps % 100 === 0 ? `${h.fee_bps / 100}%` : `${(h.fee_bps / 100).toFixed(2)}%`;

  const addrStr = (addr: string) =>
    addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";

  // Scaled helpers so badge geometry, fonts, and offsets grow with `large`
  const hopBadge = (topLbl: string, botLbl: string) => {
    const bw = Math.max(topLbl.length * 6.4 * sc + 14 * sc, botLbl.length * 5.4 * sc + 14 * sc);
    const bh = botLbl ? 34 * sc : 20 * sc;
    return { bw, bh };
  };

  return (
    <svg viewBox={`0 0 ${RT_W} ${H}`} width="100%" style={{ display: "block", opacity: dim ? 0.45 : 1 }}>
      {sections.map((sec, si) => {
        const { x1, x2 } = bounds[si];

        if (sec.type === "seq") {
          const n = sec.hops.length;
          const isSel = selectedLane?.si === si && selectedLane?.li === 0;
          return (
            <g key={si}>
              {isSel && (
                <rect x={x1} y={cy - RT_LANE_H / 2} width={x2 - x1} height={RT_LANE_H}
                  fill="#00d4ff05" stroke="#00d4ff" strokeWidth="1" strokeOpacity="0.3" rx="6"
                  style={{ pointerEvents: "none" }} />
              )}
              {sec.hops.map((hop, j) => {
                const hx1 = x1 + (j / n) * (x2 - x1);
                const hx2 = x1 + ((j + 1) / n) * (x2 - x1);
                const xm = (hx1 + hx2) / 2;
                const pc = protocolColor(hop.protocol);
                const topLbl = `${protocolShort(hop.protocol)} ${feeStr(hop)}`;
                const botLbl = addrStr(hop.pool_address);
                const { bw, bh } = hopBadge(topLbl, botLbl);
                return (
                  <g key={j}>
                    <line x1={hx1} y1={cy} x2={xm - bw / 2 - 3} y2={cy} stroke={pc} strokeWidth="1.5" strokeOpacity="0.75" />
                    <rect x={xm - bw / 2} y={cy - bh / 2} width={bw} height={bh} rx={bh / 2}
                      fill="#0d1117" stroke={pc} strokeWidth="1.2" strokeOpacity="0.85" />
                    <text x={xm} y={cy - (botLbl ? 4 * sc : -4 * sc)} textAnchor="middle" fontSize={9.5 * sc}
                      fontFamily="monospace" fontWeight="600" fill={pc} style={{ pointerEvents: "none" }}>{topLbl}</text>
                    {botLbl && (
                      <text x={xm} y={cy + 11 * sc} textAnchor="middle" fontSize={7.5 * sc}
                        fontFamily="monospace" fill={`${pc}80`} style={{ pointerEvents: "none" }}>{botLbl}</text>
                    )}
                    <line x1={xm + bw / 2 + 3} y1={cy} x2={hx2} y2={cy} stroke={pc} strokeWidth="1.5" strokeOpacity="0.75" />
                  </g>
                );
              })}
              <rect x={x1} y={cy - RT_LANE_H / 2} width={x2 - x1} height={RT_LANE_H}
                fill="transparent" style={{ cursor: "pointer" }}
                onClick={() => onLaneClick(si, 0, [100])} />
            </g>
          );
        }

        // Split section
        const nLegs = sec.legs.length;
        const fanW = Math.min(38 * sc, (x2 - x1) * 0.18);
        const lx1 = x1 + fanW;
        const lx2 = x2 - fanW;
        return (
          <g key={si}>
            {sec.legs.map((leg, li) => {
              const y = laneY(li, nLegs);
              const nHops = Math.max(leg.hops.length, 1);
              const segW = (lx2 - lx1) / nHops;
              const isSel = nLegs > 1 && si === selectedLane?.si && li === selectedLane?.li;
              const fc = isSel ? "#00d4ff" : (nLegs > 1 ? "#4b5570" : (leg.hops[0] ? protocolColor(leg.hops[0].protocol) : "#4b5570"));
              const laneTop = y - RT_LANE_H / 2 + 8 * sc;
              const laneHt = RT_LANE_H - 16 * sc;

              const pct = (leg.fraction_bps / 100).toFixed(0);
              const pillW = pct.length * 7 * sc + 16 * sc;
              const pillH = 18 * sc;
              const pillR = 9 * sc;

              return (
                <g key={li}>
                  {isSel && (
                    <rect x={lx1 - 6 * sc} y={laneTop} width={lx2 - lx1 + 12 * sc} height={laneHt}
                      fill="#00d4ff07" stroke="#00d4ff" strokeWidth="1" strokeOpacity="0.4" rx="6"
                      style={{ pointerEvents: "none" }} />
                  )}
                  <line x1={x1} y1={cy} x2={lx1} y2={y}
                    stroke={fc} strokeWidth={isSel ? "2" : "1.5"} strokeOpacity={isSel ? 0.9 : 0.5} />
                  <line x1={lx2} y1={y} x2={x2} y2={cy}
                    stroke={fc} strokeWidth={isSel ? "2" : "1.5"} strokeOpacity={isSel ? 0.9 : 0.5} />
                  {nLegs > 1 && (
                    <g>
                      <rect x={x1 + 2} y={y - pillH / 2} width={pillW} height={pillH} rx={pillR}
                        fill={isSel ? "#00d4ff18" : "#ffffff08"}
                        stroke={isSel ? "#00d4ff" : "#4b5570"} strokeWidth="1" strokeOpacity={isSel ? 0.9 : 0.6} />
                      <text x={x1 + 2 + pillW / 2} y={y + 4.5 * sc} textAnchor="middle"
                        fontSize={10.5 * sc} fontWeight="700" fontFamily="monospace"
                        fill={isSel ? "#00d4ff" : "#94a3b8"} style={{ pointerEvents: "none" }}>{pct}%</text>
                    </g>
                  )}
                  {leg.hops.map((hop, j) => {
                    const hx1 = lx1 + j * segW + (j > 0 ? RT_INT_R + 2 * sc : 0);
                    const hx2 = lx1 + (j + 1) * segW;
                    const xm = (hx1 + hx2) / 2;
                    const pc = protocolColor(hop.protocol);
                    const topLbl = `${protocolShort(hop.protocol)} ${feeStr(hop)}`;
                    const botLbl = addrStr(hop.pool_address);
                    const { bw, bh } = hopBadge(topLbl, botLbl);
                    return (
                      <g key={j}>
                        {j > 0 && (
                          <>
                            <circle cx={lx1 + j * segW} cy={y} r={RT_INT_R}
                              fill={`${tokenColor(hop.token_in)}20`}
                              stroke={tokenColor(hop.token_in)} strokeWidth="1.5" strokeOpacity="0.9" />
                            <text x={lx1 + j * segW} y={y + 4 * sc} textAnchor="middle"
                              fontSize={hop.token_in.length > 4 ? 7 * sc : 9 * sc} fontWeight="bold"
                              fontFamily="monospace" fill={tokenColor(hop.token_in)}
                              style={{ pointerEvents: "none" }}>{hop.token_in}</text>
                          </>
                        )}
                        <line x1={hx1} y1={y} x2={xm - bw / 2 - 3} y2={y}
                          stroke={pc} strokeWidth="1.5" strokeOpacity="0.75" />
                        <rect x={xm - bw / 2} y={y - bh / 2} width={bw} height={bh} rx={bh / 2}
                          fill="#0d1117" stroke={pc} strokeWidth="1.2" strokeOpacity="0.85" />
                        <text x={xm} y={y - (botLbl ? 4 * sc : -4 * sc)} textAnchor="middle" fontSize={9.5 * sc}
                          fontFamily="monospace" fontWeight="600" fill={pc}
                          style={{ pointerEvents: "none" }}>{topLbl}</text>
                        {botLbl && (
                          <text x={xm} y={y + 11 * sc} textAnchor="middle" fontSize={7.5 * sc}
                            fontFamily="monospace" fill={`${pc}80`}
                            style={{ pointerEvents: "none" }}>{botLbl}</text>
                        )}
                        <line x1={xm + bw / 2 + 3} y1={y} x2={hx2} y2={y}
                          stroke={pc} strokeWidth="1.5" strokeOpacity="0.75" />
                      </g>
                    );
                  })}
                  {nLegs > 1 && (
                    <rect x={x1} y={y - RT_LANE_H / 2} width={x2 - x1} height={RT_LANE_H}
                      fill="transparent" style={{ cursor: "pointer" }}
                      onClick={() => onLaneClick(si, li, sec.legs.map((l) => Math.round(l.fraction_bps / 100)))} />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Token nodes */}
      {nodeSyms.map((sym, i) => {
        const cx = nodeCx[i];
        const r = nodeR(i);
        const color = tokenColor(sym);
        const isTerminal = i === 0 || i === nodeSyms.length - 1;
        return (
          <g key={i}>
            {isTerminal && (
              <circle cx={cx} cy={cy} r={r + 6 * sc}
                fill={`${color}08`} stroke={color} strokeWidth="1" strokeOpacity="0.18" />
            )}
            <circle cx={cx} cy={cy} r={r}
              fill={`${color}22`} stroke={color} strokeWidth={isTerminal ? 2 : 1.5} strokeOpacity="0.95" />
            <text x={cx} y={cy + 4 * sc} textAnchor="middle"
              fontSize={sym.length > 4 ? (r >= BASE.NODE_R * sc ? 8 * sc : 7 * sc) : (r >= BASE.NODE_R * sc ? 10 * sc : 9 * sc)}
              fontWeight="bold" fontFamily="monospace" fill={color}
              style={{ pointerEvents: "none" }}>{sym}</text>
          </g>
        );
      })}
    </svg>
  );
}
