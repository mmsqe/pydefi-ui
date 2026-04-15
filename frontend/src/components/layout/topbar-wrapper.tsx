"use client";

import { usePathname } from "next/navigation";
import { Topbar } from "./topbar";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/pools": "Pool Browser",
  "/swap": "Swap",
  "/routing-lab": "Advanced Routing Lab",
  "/program-builder": "Program Builder",
  "/indexer": "Indexer Control",
  "/factories": "Factories",
};

export function TopbarWrapper() {
  const pathname = usePathname();

  let title = "pydefi";
  for (const [path, label] of Object.entries(PAGE_TITLES)) {
    if (pathname === path || (path !== "/" && pathname.startsWith(path))) {
      title = label;
      break;
    }
  }

  return <Topbar title={title} />;
}
