export const TENANT_ROLES = ["owner", "admin", "member"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

const roleRank: Record<TenantRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

export function hasAtLeastRole(actual: TenantRole, required: TenantRole): boolean {
  return roleRank[actual] >= roleRank[required];
}

export const Permissions = {
  canRead: (r: TenantRole) => hasAtLeastRole(r, "member"),
  canWrite: (r: TenantRole) => hasAtLeastRole(r, "member"),
  canManageApiKeys: (r: TenantRole) => hasAtLeastRole(r, "admin"),
  canManageMembers: (r: TenantRole) => hasAtLeastRole(r, "admin"),
  canManageTenant: (r: TenantRole) => hasAtLeastRole(r, "owner"),
} as const;
