"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const MOCK_NODES = [
  { id: "WETH", x: 120, y: 160, color: "#627EEA" },
  { id: "USDC", x: 480, y: 80, color: "#2775CA" },
  { id: "WBTC", x: 480, y: 240, color: "#F7931A" },
  { id: "DAI", x: 300, y: 320, color: "#F5AC37" },
  { id: "USDT", x: 660, y: 160, color: "#26A17B" },
];

const MOCK_EDGES = [
  { from: 0, to: 1, protocol: "V3", label: "0.05%" },
  { from: 0, to: 2, protocol: "V2", label: "0.3%" },
  { from: 0, to: 3, protocol: "V2", label: "0.3%" },
  { from: 1, to: 4, protocol: "V3", label: "0.01%" },
  { from: 2, to: 1, protocol: "V3", label: "0.05%" },
  { from: 3, to: 1, protocol: "V3", label: "0.01%" },
];

const PROTOCOL_COLORS: Record<string, string> = {
  V3: "#00d4ff",
  V2: "#8b5cf6",
};

export default function RoutingLabPage() {
  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#e8eaf0] mb-2">
            Advanced Routing Lab
          </h2>
          <p className="text-sm text-muted">
            Visual pool graph and drag-and-drop path builder
          </p>
        </div>
        <Badge variant="purple">Coming Soon</Badge>
      </div>

      {/* Graph placeholder */}
      <Card>
        <CardContent className="p-6">
          <div className="relative w-full overflow-hidden rounded-xl bg-[#0a0b0e] border border-border-dim"
               style={{ height: 400 }}>
            {/* Grid lines */}
            <svg
              width="100%"
              height="100%"
              className="absolute inset-0"
              viewBox="0 0 800 400"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Grid */}
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path
                    d="M 40 0 L 0 0 0 40"
                    fill="none"
                    stroke="#1e2132"
                    strokeWidth="0.5"
                  />
                </pattern>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />

              {/* Edges */}
              {MOCK_EDGES.map((edge, i) => {
                const from = MOCK_NODES[edge.from];
                const to = MOCK_NODES[edge.to];
                const mx = (from.x + to.x) / 2;
                const my = (from.y + to.y) / 2;
                const color = PROTOCOL_COLORS[edge.protocol] ?? "#64748b";
                return (
                  <g key={i}>
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={color}
                      strokeWidth="1.5"
                      strokeOpacity="0.4"
                      strokeDasharray="4 3"
                    />
                    <rect
                      x={mx - 14}
                      y={my - 9}
                      width="28"
                      height="18"
                      rx="5"
                      fill="#13161e"
                      stroke={color}
                      strokeOpacity="0.3"
                      strokeWidth="1"
                    />
                    <text
                      x={mx}
                      y={my + 4}
                      textAnchor="middle"
                      fontSize="8"
                      fill={color}
                      fontFamily="monospace"
                    >
                      {edge.label}
                    </text>
                  </g>
                );
              })}

              {/* Nodes */}
              {MOCK_NODES.map((node, i) => (
                <g key={i} style={{ cursor: "pointer" }}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r="26"
                    fill={`${node.color}15`}
                    stroke={node.color}
                    strokeWidth="1.5"
                    filter="url(#glow)"
                  />
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r="18"
                    fill={`${node.color}20`}
                    stroke={node.color}
                    strokeWidth="1"
                    strokeOpacity="0.5"
                  />
                  <text
                    x={node.x}
                    y={node.y + 4}
                    textAnchor="middle"
                    fontSize="9"
                    fill={node.color}
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {node.id}
                  </text>
                </g>
              ))}

              {/* Legend */}
              <g>
                {Object.entries(PROTOCOL_COLORS).map(([proto, color], i) => (
                  <g key={proto} transform={`translate(${20 + i * 70}, 375)`}>
                    <line x1="0" y1="5" x2="16" y2="5" stroke={color} strokeWidth="1.5" strokeDasharray="4 2" />
                    <text x="20" y="9" fontSize="9" fill={color} fontFamily="monospace">
                      {proto}
                    </text>
                  </g>
                ))}
              </g>
            </svg>

            {/* Overlay badge */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-card/80 backdrop-blur-sm border border-border-dim rounded-2xl px-6 py-4 text-center">
                <p className="text-sm font-semibold text-[#e8eaf0] mb-1">Interactive Graph</p>
                <p className="text-xs text-muted">
                  Drag nodes · Build paths · Simulate routes
                </p>
                <Badge variant="purple" className="mt-2">Coming Soon</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Feature previews */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            title: "Visual Pool Graph",
            desc: "Explore the full pool graph from SQLite cache. See connections between tokens across protocols.",
            color: "#00d4ff",
          },
          {
            title: "Path Builder",
            desc: "Drag and drop token nodes to construct swap paths manually or let the optimizer suggest.",
            color: "#8b5cf6",
          },
          {
            title: "Live Simulation",
            desc: "Simulate price impact and gas costs before signing. Compare multiple routes side-by-side.",
            color: "#00ff87",
          },
        ].map(({ title, desc, color }) => (
          <Card key={title}>
            <CardContent className="pt-5">
              <div
                className="w-8 h-8 rounded-xl mb-3 flex items-center justify-center text-sm font-bold"
                style={{ backgroundColor: `${color}15`, color }}
              >
                ⬡
              </div>
              <h3 className="text-sm font-semibold text-[#e8eaf0] mb-1">{title}</h3>
              <p className="text-xs text-muted leading-relaxed">{desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
