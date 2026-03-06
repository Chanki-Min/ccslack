import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderTemplate, loadTemplate, buildPrompt } from "../../src/prompt/template";
import type { CCSlackConfig } from "../../src/config";

const TEST_DIR = join(import.meta.dir, ".test-templates");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("renderTemplate", () => {
  it("replaces all known variables", () => {
    const result = renderTemplate("Hello {{repo}}, {{prompt}}", {
      repo: "my-repo",
      prompt: "fix bug",
      thread: "",
      global: "",
    });
    expect(result).toBe("Hello my-repo, fix bug");
  });

  it("leaves unknown variables untouched", () => {
    const result = renderTemplate("{{unknown}} {{prompt}}", {
      repo: "",
      prompt: "test",
      thread: "",
      global: "",
    });
    expect(result).toBe("{{unknown}} test");
  });

  it("handles empty variables", () => {
    const result = renderTemplate("{{thread}}{{prompt}}", {
      repo: "",
      prompt: "hello",
      thread: "",
      global: "",
    });
    expect(result).toBe("hello");
  });
});

describe("loadTemplate", () => {
  it("loads a template file", () => {
    const filePath = join(TEST_DIR, "test.txt");
    writeFileSync(filePath, "Hello {{prompt}}");

    const result = loadTemplate(filePath);
    expect(result).toBe("Hello {{prompt}}");
  });

  it("throws for missing file", () => {
    expect(() => loadTemplate("/nonexistent/template.txt")).toThrow();
  });
});

describe("buildPrompt", () => {
  it("uses default template when no promptTemplate is configured", () => {
    const config: CCSlackConfig = {
      allowedUsers: ["U123"],
      maxConcurrency: 2,
      taskTimeout: 300000,
      claudePath: "claude",
      repos: { "my-repo": "/tmp/repo" },
    };

    const result = buildPrompt({
      config,
      repoName: "my-repo",
      prompt: "fix bug",
      threadContext: "",
    });
    expect(result).toBe("fix bug");
  });

  it("uses default template with thread context", () => {
    const config: CCSlackConfig = {
      allowedUsers: ["U123"],
      maxConcurrency: 2,
      taskTimeout: 300000,
      claudePath: "claude",
      repos: { "my-repo": "/tmp/repo" },
    };

    const result = buildPrompt({
      config,
      repoName: "my-repo",
      prompt: "fix bug",
      threadContext: "[user]: hello\n[assistant]: hi\n",
    });
    expect(result).toBe("[user]: hello\n[assistant]: hi\nfix bug");
  });

  it("uses global promptTemplate", () => {
    const tplPath = join(TEST_DIR, "global.txt");
    writeFileSync(tplPath, "You are an expert.\n\n{{thread}}\nRequest: {{prompt}}");

    const config: CCSlackConfig = {
      allowedUsers: ["U123"],
      maxConcurrency: 2,
      taskTimeout: 300000,
      claudePath: "claude",
      repos: { "my-repo": "/tmp/repo" },
      promptTemplate: tplPath,
    };

    const result = buildPrompt({
      config,
      repoName: "my-repo",
      prompt: "fix bug",
      threadContext: "",
    });
    expect(result).toBe("You are an expert.\n\n\nRequest: fix bug");
  });

  it("uses repo-level template with {{global}} insertion", () => {
    const globalPath = join(TEST_DIR, "global.txt");
    writeFileSync(globalPath, "Global context.\n{{thread}}\n{{prompt}}");

    const repoPath = join(TEST_DIR, "frontend.txt");
    writeFileSync(repoPath, "Frontend expert for {{repo}}.\n\n{{global}}");

    const config: CCSlackConfig = {
      allowedUsers: ["U123"],
      maxConcurrency: 2,
      taskTimeout: 300000,
      claudePath: "claude",
      repos: {
        frontend: { path: "/tmp/frontend", promptTemplate: repoPath },
      },
      promptTemplate: globalPath,
    };

    const result = buildPrompt({
      config,
      repoName: "frontend",
      prompt: "add tests",
      threadContext: "",
    });
    expect(result).toBe("Frontend expert for frontend.\n\nGlobal context.\n\nadd tests");
  });

  it("repo template without {{global}} fully overrides", () => {
    const globalPath = join(TEST_DIR, "global.txt");
    writeFileSync(globalPath, "Global stuff\n{{prompt}}");

    const repoPath = join(TEST_DIR, "custom.txt");
    writeFileSync(repoPath, "Custom only: {{prompt}} in {{repo}}");

    const config: CCSlackConfig = {
      allowedUsers: ["U123"],
      maxConcurrency: 2,
      taskTimeout: 300000,
      claudePath: "claude",
      repos: {
        backend: { path: "/tmp/backend", promptTemplate: repoPath },
      },
      promptTemplate: globalPath,
    };

    const result = buildPrompt({
      config,
      repoName: "backend",
      prompt: "deploy",
      threadContext: "",
    });
    expect(result).toBe("Custom only: deploy in backend");
  });

  it("repo template with {{global}} but no global config uses default", () => {
    const repoPath = join(TEST_DIR, "repo.txt");
    writeFileSync(repoPath, "Repo: {{repo}}\n{{global}}");

    const config: CCSlackConfig = {
      allowedUsers: ["U123"],
      maxConcurrency: 2,
      taskTimeout: 300000,
      claudePath: "claude",
      repos: {
        myrepo: { path: "/tmp/myrepo", promptTemplate: repoPath },
      },
    };

    const result = buildPrompt({
      config,
      repoName: "myrepo",
      prompt: "hello",
      threadContext: "ctx\n",
    });
    expect(result).toBe("Repo: myrepo\nctx\nhello");
  });
});
