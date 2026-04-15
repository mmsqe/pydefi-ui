"use client";

import { useSidebar } from "./sidebar-context";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

export function MainContent({ children }: { children: ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <div
      className={cn(
        "flex flex-col min-h-screen transition-all duration-300",
        collapsed ? "ml-16" : "ml-60"
      )}
    >
      {children}
    </div>
  );
}
