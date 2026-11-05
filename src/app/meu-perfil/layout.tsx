import type { ReactNode } from "react";
import PersonalWorkspace from "@/components/personal-workspace";

export default function PersonalLayout({ children }: { children: ReactNode }) {
  return <PersonalWorkspace>{children}</PersonalWorkspace>;
}
