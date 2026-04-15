"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowLeftRight,
  Zap,
  RefreshCcw,
  Link2,
  Shield,
  Plus,
  Play,
  Trash2,
  GripVertical,
} from "lucide-react";

const BLOCK_PALETTE = [
  {
    id: "approve",
    label: "Approve",
    icon: Shield,
    color: "#00d4ff",
    desc: "ERC20 token approval",
  },
  {
    id: "swap",
    label: "Swap",
    icon: ArrowLeftRight,
    color: "#8b5cf6",
    desc: "Token swap via pool",
  },
  {
    id: "flashloan",
    label: "Flash Loan",
    icon: Zap,
    color: "#f59e0b",
    desc: "Borrow and repay in one tx",
  },
  {
    id: "loop",
    label: "Loop",
    icon: RefreshCcw,
    color: "#00ff87",
    desc: "Repeat operation N times",
  },
  {
    id: "transfer",
    label: "Transfer",
    icon: Link2,
    color: "#f43f5e",
    desc: "Move tokens to address",
  },
];

interface CanvasBlock {
  id: string;
  type: string;
  label: string;
  color: string;
  order: number;
}

export default function ProgramBuilderPage() {
  const [canvasBlocks, setCanvasBlocks] = useState<CanvasBlock[]>([
    { id: "b1", type: "approve", label: "Approve WETH", color: "#00d4ff", order: 0 },
    { id: "b2", type: "swap", label: "Swap WETH → USDC", color: "#8b5cf6", order: 1 },
  ]);

  const addBlock = (block: (typeof BLOCK_PALETTE)[0]) => {
    const newBlock: CanvasBlock = {
      id: `block-${Date.now()}`,
      type: block.id,
      label: block.label,
      color: block.color,
      order: canvasBlocks.length,
    };
    setCanvasBlocks((prev) => [...prev, newBlock]);
  };

  const removeBlock = (id: string) => {
    setCanvasBlocks((prev) =>
      prev.filter((b) => b.id !== id).map((b, i) => ({ ...b, order: i }))
    );
  };

  return (
    <div className="max-w-7xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#e8eaf0] mb-1">
            DeFi Program Builder
          </h2>
          <p className="text-sm text-muted">
            Compose DeFi operations visually with the pydefi VM
          </p>
        </div>
        <Badge variant="purple">Coming Soon</Badge>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4" style={{ minHeight: 520 }}>
        {/* Block Palette */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Block Palette</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-3">
            {BLOCK_PALETTE.map((block) => {
              const Icon = block.icon;
              return (
                <button
                  key={block.id}
                  onClick={() => addBlock(block)}
                  className="w-full flex items-start gap-3 p-3 rounded-xl border border-border-dim hover:border-opacity-50 transition-all text-left group"
                  style={{
                    "--hover-color": block.color,
                  } as React.CSSProperties}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{
                      backgroundColor: `${block.color}15`,
                      border: `1px solid ${block.color}30`,
                    }}
                  >
                    <Icon size={14} style={{ color: block.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#e8eaf0] group-hover:text-white transition-colors">
                      {block.label}
                    </p>
                    <p className="text-[10px] text-muted mt-0.5 leading-tight">
                      {block.desc}
                    </p>
                  </div>
                  <Plus size={12} className="text-muted group-hover:text-cyan transition-colors flex-shrink-0 mt-1" />
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Canvas */}
        <Card className="lg:col-span-3 flex flex-col">
          <CardHeader>
            <CardTitle>Canvas</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">{canvasBlocks.length} operations</span>
              <Button variant="ghost" size="sm" className="gap-1.5 text-green opacity-60" disabled>
                <Play size={12} />
                Run Sandbox
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 p-3">
            {canvasBlocks.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-2xl bg-border-dim/30 flex items-center justify-center mb-3">
                  <Plus size={24} className="text-muted" />
                </div>
                <p className="text-sm font-medium text-muted mb-1">Canvas is empty</p>
                <p className="text-xs text-muted/60">
                  Click blocks from the palette to add them
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Connection line header */}
                <div className="flex items-center gap-2 px-3 py-1.5">
                  <div className="text-xs text-muted font-mono">#</div>
                  <div className="text-xs text-muted uppercase tracking-wider">Operation</div>
                </div>

                {canvasBlocks.map((block, index) => (
                  <div key={block.id} className="relative">
                    {/* Connector line */}
                    {index < canvasBlocks.length - 1 && (
                      <div
                        className="absolute left-[22px] top-full w-0.5 h-2 z-10"
                        style={{ backgroundColor: `${block.color}40` }}
                      />
                    )}
                    <div
                      className="flex items-center gap-3 p-3 rounded-xl border transition-all group"
                      style={{
                        backgroundColor: `${block.color}06`,
                        borderColor: `${block.color}20`,
                      }}
                    >
                      {/* Drag handle (visual only) */}
                      <GripVertical size={12} className="text-muted/40 flex-shrink-0 cursor-grab" />

                      {/* Step number */}
                      <div
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold font-mono flex-shrink-0"
                        style={{
                          backgroundColor: `${block.color}20`,
                          color: block.color,
                          border: `1px solid ${block.color}30`,
                        }}
                      >
                        {index + 1}
                      </div>

                      {/* Block info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#e8eaf0]">{block.label}</p>
                        <p className="text-xs text-muted font-mono">{block.type}</p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => removeBlock(block.id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-400 text-muted transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Add more hint */}
                <div className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-border-dim text-muted hover:border-cyan/20 transition-colors">
                  <Plus size={14} className="ml-8" />
                  <span className="text-xs">Add operation from palette</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Coming soon notice */}
      <Card>
        <CardContent className="py-4 px-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-purple/10 border border-purple/20 flex items-center justify-center flex-shrink-0">
              <Zap size={14} className="text-purple" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#e8eaf0] mb-1">
                DeFi VM Integration Pending
              </p>
              <p className="text-xs text-muted leading-relaxed">
                The Program Builder will connect to the pydefi fluent VM to compose, simulate,
                and execute multi-step DeFi programs. Features include Monaco editor with
                auto-complete, live transaction preview, Permit2 signing, and sandbox simulation.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
