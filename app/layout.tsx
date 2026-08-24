import type { Metadata } from "next";
import "./globals.css";
import AuthShell from "./auth-shell";

export const metadata: Metadata = {
  title: "CoGri Survey & Remedial Costing",
  description: "Secure multi-company survey, grinding, screeding and repairs costing platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><AuthShell>{children}</AuthShell></body>
    </html>
  );
}
