import type { ReactNode } from "react";

// Compatibility routes redirect into the single Meu Painel workspace.
export default function LegacyPersonalLayout({ children }: { children: ReactNode }) {
  return children;
}
