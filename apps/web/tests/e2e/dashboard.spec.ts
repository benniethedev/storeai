import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";

function unique(prefix = "u"): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

test("sign up, create API key, create project, create record", async ({ page, request }) => {
  const email = `${unique("e")}@test.local`;
  const password = "password1234";
  const tenantSlug = unique("w");

  // Sign up
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("E2E User");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Workspace name").fill("E2E Workspace");
  await page.getByLabel("Workspace slug").fill(tenantSlug);
  await page.getByRole("button", { name: /create account/i }).click();

  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  // Create API key
  await page.getByRole("link", { name: /api keys/i }).click();
  await page.waitForURL("**/dashboard/api-keys");
  await page.getByLabel("Key name").fill("my-service");
  await page.getByRole("button", { name: /create api key/i }).click();
  const keyBlock = page.locator("pre").first();
  await expect(keyBlock).toContainText("sk_");
  const plaintext = (await keyBlock.textContent())!.trim();

  // Use API key to create a project via the HTTP API
  const projCreate = await request.post("/api/projects", {
    headers: { Authorization: `Bearer ${plaintext}` },
    data: { name: "API Project", slug: unique("proj") },
  });
  expect(projCreate.ok()).toBeTruthy();
  const projBody = await projCreate.json();
  expect(projBody.ok).toBeTruthy();
  const projectId = projBody.data.id;

  // Use API key to create a record
  const recCreate = await request.post("/api/records", {
    headers: { Authorization: `Bearer ${plaintext}` },
    data: { projectId, key: "first", data: { hello: "e2e" } },
  });
  expect(recCreate.ok()).toBeTruthy();

  // Go to projects page in UI and see the project
  await page.getByRole("link", { name: /projects/i }).click();
  await page.waitForURL("**/dashboard/projects");
  await expect(page.getByText("API Project")).toBeVisible();

  // Audit logs page should contain the project.create action
  await page.getByRole("link", { name: /audit logs/i }).click();
  await page.waitForURL("**/dashboard/audit-logs");
  await expect(page.getByText("project.create").first()).toBeVisible();
});

test("cannot access dashboard without auth", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForURL("**/login");
  await expect(page.getByRole("heading", { name: /sign in to storeai/i })).toBeVisible();
});
