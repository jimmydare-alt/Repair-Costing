import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export function StatusChip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`ds-chip ds-chip-${tone}`}>{children}</span>;
}

