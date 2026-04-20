"use client";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

export function TenantSwitcher({
  tenants,
  activeTenantId,
}: {
  tenants: { id: string; slug: string; name: string; role: string }[];
  activeTenantId: string;
}) {
  const router = useRouter();
  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    if (id === "__new__") {
      router.push("/dashboard/workspaces/new");
      return;
    }
    const res = await apiFetch("/api/tenants/switch", {
      method: "POST",
      body: JSON.stringify({ tenantId: id }),
    });
    if (res.ok) {
      router.refresh();
    }
  }
  return (
    <select value={activeTenantId} onChange={onChange}>
      {tenants.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name} ({t.role})
        </option>
      ))}
      <option value="__new__">+ New workspace</option>
    </select>
  );
}
