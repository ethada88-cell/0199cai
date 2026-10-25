import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { currentSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  return <AdminShell username={session.username}>{children}</AdminShell>;
}
