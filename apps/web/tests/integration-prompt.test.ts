import { describe, expect, it } from "vitest";
import {
  buildIntegrationJsSnippet,
  buildIntegrationPrompt,
} from "@/lib/integrationPrompt";

const project = { id: "project-123", name: "Interview Zero", slug: "interview-zero" };
const baseUrl = "https://storeai.example";

describe("integration prompt helpers", () => {
  it("includes the large content strategy in the agent prompt", () => {
    const prompt = buildIntegrationPrompt({ baseUrl, project });
    expect(prompt).toContain("Large content strategy");
    expect(prompt).toContain("POST /api/files");
    expect(prompt).toContain("@storeai/sdk");
    expect(prompt).toContain("fileId");
    expect(prompt).toContain(project.name);
    expect(prompt).toContain(baseUrl);
    expect(prompt).toContain("/api/atomic/records");
    expect(prompt).toContain("immutable: true");
    expect(prompt).toContain("Never embed a StoreAI secret");
    expect(prompt).toContain("integer atomic units");
    expect(prompt).toContain("projectId=<uuid>");
  });

  it("includes a smart record helper that offloads large JSON to files", () => {
    const js = buildIntegrationJsSnippet({ baseUrl, project });
    expect(js).toContain('import { StoreAI } from "@storeai/sdk"');
    expect(js).toContain(project.id);
    expect(js).toContain(baseUrl);
    expect(js).toContain("uploadFile");
    expect(js).toContain("createSmartRecord");
    expect(js).toContain("atomicRecords");
    expect(js).toContain("fileId");
  });

  it("warns agents when the selected project uses legacy integrity", () => {
    const prompt = buildIntegrationPrompt({
      baseUrl,
      project: { ...project, integrityMode: "legacy" },
    });
    expect(prompt).toContain("Project integrity mode: legacy");
    expect(prompt).toContain("duplicate keys may exist");
    expect(prompt).toContain("atomic operations are disabled");
    expect(prompt).toContain("do not assume strict-only guarantees");
  });
});
