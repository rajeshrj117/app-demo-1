import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Northstar Procure · Intelligent sourcing workspace",
  description: "Run supplier RFQs, reverse auctions, negotiations, and comparative statements in one intelligent procurement workspace.",
  applicationName: "Northstar Procure",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
