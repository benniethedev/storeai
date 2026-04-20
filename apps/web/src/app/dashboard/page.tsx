import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { getDb, projects, records, files, apiKeys, memberships } from "@storeai/db";
import { getUserSession, requireTenantContextForPage } from "@/lib/context";

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  const s = await getUserSession();
  if (!s) redirect("/login");
  const ctx = await requireTenantContextForPage();
  const db = getDb();

  const [p] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.tenantId, ctx.tenantId));
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(records)
    .where(eq(records.tenantId, ctx.tenantId));
  const [f] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(files)
    .where(eq(files.tenantId, ctx.tenantId));
  const [k] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(apiKeys)
    .where(and(eq(apiKeys.tenantId, ctx.tenantId), sql`revoked_at is null`));
  const [m] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(memberships)
    .where(eq(memberships.tenantId, ctx.tenantId));

  const stats = [
    { label: "Projects", value: p?.c ?? 0 },
    { label: "Records", value: r?.c ?? 0 },
    { label: "Files", value: f?.c ?? 0 },
    { label: "Active API keys", value: k?.c ?? 0 },
    { label: "Members", value: m?.c ?? 0 },
  ];

  return (
    <div>
      <div className="topbar">
        <h1>Overview</h1>
        <span className="pill">Role: {ctx.role}</span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        {stats.map((s) => (
          <div className="card" key={s.label}>
            <div className="muted" style={{ fontSize: 12 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 600, marginTop: 6 }}>{s.value}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Quick start</h2>
        <ol className="muted" style={{ paddingLeft: 20 }}>
          <li>Create an API key in <code>API keys</code></li>
          <li>Create a project</li>
          <li>Use the API key to create records via <code>POST /api/records</code></li>
        </ol>
      </div>
    </div>
  );
}
