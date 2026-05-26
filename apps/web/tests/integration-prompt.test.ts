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
    expect(prompt).toContain("fileId");
    expect(prompt).toContain(project.name);
    expect(prompt).toContain(baseUrl);
  });

  it("includes a smart record helper that offloads large JSON to files", () => {
    const js = buildIntegrationJsSnippet({ baseUrl, project });
    expect(js).toContain("INLINE_LIMIT_BYTES");
    expect(js).toContain("uploadJsonFile");
    expect(js).toContain("multipartUploadBody");
    expect(js).toContain("Content-Length");
    expect(js).toContain('Connection: "close"');
    expect(js).toContain("createSmartRecord");
    expect(js).toContain('storage: "file"');
    expect(js).toContain("fileId");
  });
});
