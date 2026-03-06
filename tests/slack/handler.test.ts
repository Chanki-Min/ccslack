import { describe, expect, it } from "bun:test";
import type { CCSlackConfig } from "../../src/config";
import { resolveRepoPath } from "../../src/slack/handler";

const mockConfig: CCSlackConfig = {
  allowedUsers: ["U123"],
  maxConcurrency: 2,
  taskTimeout: 300000,
  claudePath: "claude",
  defaultRepo: "default-project",
  repos: {
    "my-project": "/Users/test/projects/my-project",
    "default-project": "/Users/test/projects/default",
  },
};

describe("resolveRepoPath", () => {
  it("resolves a known repo alias", () => {
    const { repoName, repoPath } = resolveRepoPath("my-project", mockConfig);
    expect(repoName).toBe("my-project");
    expect(repoPath).toBe("/Users/test/projects/my-project");
  });

  it("uses defaultRepo when repo is null", () => {
    const { repoName, repoPath } = resolveRepoPath(null, mockConfig);
    expect(repoName).toBe("default-project");
    expect(repoPath).toBe("/Users/test/projects/default");
  });

  it("rejects absolute paths", () => {
    expect(() => resolveRepoPath("/tmp/some-repo", mockConfig)).toThrow();
  });

  it("rejects home-relative paths", () => {
    expect(() => resolveRepoPath("~/some-repo", mockConfig)).toThrow();
  });

  it("throws for unknown repo with no default", () => {
    const configNoDefault = { ...mockConfig, defaultRepo: undefined };
    expect(() => resolveRepoPath(null, configNoDefault)).toThrow();
  });

  it("throws for unknown repo alias", () => {
    expect(() => resolveRepoPath("nonexistent", mockConfig)).toThrow();
  });

  it("resolves repo path from object config", () => {
    const config: CCSlackConfig = {
      ...mockConfig,
      repos: {
        frontend: { path: "/Users/test/projects/frontend" },
      },
    };
    const { repoName, repoPath } = resolveRepoPath("frontend", config);
    expect(repoName).toBe("frontend");
    expect(repoPath).toBe("/Users/test/projects/frontend");
  });
});
