import { describe, it, expect } from "bun:test";
import { resolveRepoPath } from "../../src/slack/handler";
import type { CCSlackConfig } from "../../src/config";

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
    const path = resolveRepoPath("my-project", mockConfig);
    expect(path).toBe("/Users/test/projects/my-project");
  });

  it("uses defaultRepo when repo is null", () => {
    const path = resolveRepoPath(null, mockConfig);
    expect(path).toBe("/Users/test/projects/default");
  });

  it("returns absolute path as-is", () => {
    const path = resolveRepoPath("/tmp/some-repo", mockConfig);
    expect(path).toBe("/tmp/some-repo");
  });

  it("throws for unknown repo with no default", () => {
    const configNoDefault = { ...mockConfig, defaultRepo: undefined };
    expect(() => resolveRepoPath(null, configNoDefault)).toThrow();
  });

  it("throws for unknown repo alias", () => {
    expect(() => resolveRepoPath("nonexistent", mockConfig)).toThrow();
  });
});
