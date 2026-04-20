"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Home", minRole: "member" as const },
  { href: "/dashboard/projects", label: "Projects", minRole: "member" as const },
  { href: "/dashboard/files", label: "Files", minRole: "member" as const },
  { href: "/dashboard/api-keys", label: "API keys", minRole: "admin" as const },
  { href: "/dashboard/members", label: "Members", minRole: "admin" as const },
  { href: "/dashboard/audit-logs", label: "Audit logs", minRole: "admin" as const },
  { href: "/dashboard/usage-logs", label: "Usage logs", minRole: "admin" as const },
];

const rank = { owner: 3, admin: 2, member: 1 } as const;

export function SidebarNav({ role }: { role: "owner" | "admin" | "member" }) {
  const pathname = usePathname();
  return (
    <nav>
      {LINKS.filter((l) => rank[role] >= rank[l.minRole]).map((l) => {
        const active = pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link key={l.href} href={l.href} className={active ? "active" : ""}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
