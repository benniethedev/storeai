import { loadEnvFromRepoRoot } from "./loadEnv.js";
loadEnvFromRepoRoot();
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "./client.js";
import { users, tenants, memberships, projects } from "./schema.js";

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@storeai.local").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "admin12345";
  const tenantSlug = process.env.SEED_TENANT_SLUG ?? "demo";
  const tenantName = process.env.SEED_TENANT_NAME ?? "Demo Workspace";
  const db = getDb();

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let userId: string;
  if (existing[0]) {
    userId = existing[0].id;
    console.log(`User ${email} already exists (${userId}).`);
  } else {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name: "Platform Admin", isPlatformAdmin: true })
      .returning();
    if (!user) throw new Error("Failed to create user");
    userId = user.id;
    console.log(`Created user ${email} / ${password} (${userId}).`);
  }

  const existingTenant = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, tenantSlug))
    .limit(1);
  let tenantId: string;
  if (existingTenant[0]) {
    tenantId = existingTenant[0].id;
    console.log(`Tenant ${tenantSlug} already exists (${tenantId}).`);
  } else {
    const [t] = await db
      .insert(tenants)
      .values({ slug: tenantSlug, name: tenantName })
      .returning();
    if (!t) throw new Error("Failed to create tenant");
    tenantId = t.id;
    console.log(`Created tenant ${tenantSlug} (${tenantId}).`);

    await db
      .insert(memberships)
      .values({ userId, tenantId, role: "owner" })
      .onConflictDoNothing();
    console.log(`Added user as owner.`);

    await db
      .insert(projects)
      .values({
        tenantId,
        name: "Demo Project",
        slug: "demo-project",
        description: "A seeded starter project.",
        createdByUserId: userId,
      })
      .onConflictDoNothing();
    console.log(`Seeded demo project.`);
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
