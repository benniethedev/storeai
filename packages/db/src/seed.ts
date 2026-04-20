import { loadEnvFromRepoRoot } from "./loadEnv.js";
loadEnvFromRepoRoot();
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "./client.js";
import { users, tenants, memberships, projects } from "./schema.js";

const KNOWN_WEAK_PASSWORDS = new Set([
  "CHANGE_ME_BEFORE_SEEDING",
  "admin12345",
  "admin",
  "password",
  "changeme",
  "change-me",
]);

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@storeai.local").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  const tenantSlug = process.env.SEED_TENANT_SLUG ?? "workspace";
  const tenantName = process.env.SEED_TENANT_NAME ?? "My Workspace";

  if (!password || password.length < 8 || KNOWN_WEAK_PASSWORDS.has(password)) {
    console.error(
      [
        "",
        "  Refusing to seed: SEED_ADMIN_PASSWORD is missing, too short, or a known placeholder.",
        "  Set a real password in .env (8+ chars) and re-run `pnpm db:seed`.",
        "  Or just run `pnpm bootstrap` and the wizard will set one for you.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  const db = getDb();

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let userId: string;
  if (existing[0]) {
    userId = existing[0].id;
    await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
    console.log(`User ${email} already exists (${userId}) — password rotated to match .env.`);
  } else {
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name: "Platform Admin", isPlatformAdmin: true })
      .returning();
    if (!user) throw new Error("Failed to create user");
    userId = user.id;
    console.log(`Created user ${email} (${userId}).`);
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
