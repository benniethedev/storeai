import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "StoreAI",
  description: "Self-hosted multi-tenant backend platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
