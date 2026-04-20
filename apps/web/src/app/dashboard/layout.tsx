import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { getDb, memberships, tenants } from "@storeai/db";
import { getUserSession } from "@/lib/context";
import { TenantSwitcher } from "./_components/TenantSwitcher";
import { SidebarNav } from "./_components/SidebarNav";
import { LogoutButton } from "./_components/LogoutButton";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const s = await getUserSession();
  if (!s) redirect("/login");

  const db = getDb();
  const rows = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, s.user.id));

  if (rows.length === 0) redirect("/dashboard/workspaces/new");

  const activeTenantId = s.session.activeTenantId ?? rows[0]!.id;
  const activeTenant = rows.find((r) => r.id === activeTenantId) ?? rows[0]!;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>StoreAI</div>
          <TenantSwitcher tenants={rows} activeTenantId={activeTenant.id} />
        </div>
        <SidebarNav role={activeTenant.role as "owner" | "admin" | "member"} />
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
            {s.user.email}
          </div>
          <LogoutButton />
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
