import type { Metadata } from "next";
import "./globals.css";
import AuthShell from "./auth-shell";

export const metadata: Metadata = {
  title: "FACE GmbH Contracting Costing",
  description: "Grinding, screeding and repairs costing app"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><AuthShell>{children}</AuthShell></body>
    </html>
  );
}
