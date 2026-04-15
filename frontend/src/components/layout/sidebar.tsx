"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Waves,
  ArrowLeftRight,
  FlaskConical,
  Blocks,
  Activity,
  Factory,
  ChevronLeft,
  ChevronRight,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pools", label: "Pools", icon: Waves },
  { href: "/swap", label: "Swap", icon: ArrowLeftRight },
  { href: "/routing-lab", label: "Routing Lab", icon: FlaskConical },
  { href: "/program-builder", label: "Program Builder", icon: Blocks },
  { href: "/indexer", label: "Indexer", icon: Activity },
  { href: "/factories", label: "Factories", icon: Factory },
];

export function Sidebar() {
  const { collapsed, setCollapsed } = useSidebar();
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen z-40 flex flex-col bg-surface border-r border-border-dim transition-all duration-300 ease-in-out",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="flex items-center h-14 px-4 border-b border-border-dim flex-shrink-0">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-cyan/10 border border-cyan/20 flex items-center justify-center shadow-[0_0_10px_rgba(0,212,255,0.2)]">
            <Zap size={16} className="text-cyan" />
          </div>
          {!collapsed && (
            <span className="text-base font-bold tracking-tight neon-cyan whitespace-nowrap">
              pydefi
            </span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
        <ul className="space-y-1 px-2">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
            return (
              <li key={href}>
                <Link
                  href={href}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm font-medium transition-all duration-150 relative group",
                    isActive
                      ? "text-cyan bg-cyan/8 border border-cyan/15 shadow-[0_0_8px_rgba(0,212,255,0.06)]"
                      : "text-[#94a3b8] hover:text-[#e8eaf0] hover:bg-white/4"
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-cyan rounded-r-full shadow-[0_0_6px_rgba(0,212,255,0.8)]" />
                  )}
                  <Icon
                    size={17}
                    className={cn(
                      "flex-shrink-0 transition-colors",
                      isActive ? "text-cyan" : "text-muted group-hover:text-[#e8eaf0]"
                    )}
                  />
                  {!collapsed && (
                    <span className="whitespace-nowrap">{label}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Collapse toggle */}
      <div className="p-2 border-t border-border-dim flex-shrink-0">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 px-2.5 py-2 rounded-xl text-muted hover:text-[#e8eaf0] hover:bg-white/5 transition-all text-sm"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={16} /> : (
            <>
              <ChevronLeft size={16} />
              <span className="text-xs">Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
