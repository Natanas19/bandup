import type { ReactNode } from "react";
import PersonalWorkspace from "@/components/personal-workspace";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <PersonalWorkspace>{children}</PersonalWorkspace>;
}
