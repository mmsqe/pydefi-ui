import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { TopbarWrapper } from "@/components/layout/topbar-wrapper";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import { MainContent } from "@/components/layout/main-content";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "pydefi — DeFi Dashboard",
  description: "DeFi routing & pool analytics powered by pydefi",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>
          <SidebarProvider>
            <Sidebar />
            <MainContent>
              <TopbarWrapper />
              <main className="flex-1 pt-14 p-6">{children}</main>
            </MainContent>
          </SidebarProvider>
        </Providers>
      </body>
    </html>
  );
}
