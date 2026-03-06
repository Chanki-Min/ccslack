import { describe, expect, it } from "bun:test";
import type { CCSlackConfig } from "../../src/config";
import { resolveRepoPath, resolveSessionId } from "../../src/slack/handler";

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
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("resolveSessionId", () => {
  it("returns undefined sessionId when enableSessionContinuity is false", () => {
    const config = { ...mockConfig, enableSessionContinuity: false };
    const { sessionId, isResuming } = resolveSessionId(null, null, config);
    expect(sessionId).toBeUndefined();
    expect(isResuming).toBe(false);
  });

  it("returns a new UUID when parsedSession is 'new'", () => {
    const { sessionId, isResuming } = resolveSessionId("new", null, mockConfig);
    expect(sessionId).toMatch(UUID_RE);
    expect(isResuming).toBe(false);
  });

  it("returns parsedSession as-is when it is a specific UUID", () => {
    const specificId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const { sessionId, isResuming } = resolveSessionId(specificId, null, mockConfig);
    expect(sessionId).toBe(specificId);
    expect(isResuming).toBe(false);
  });

  it("returns threadSessionId with isResuming true when parsedSession is null", () => {
    const threadId = "11111111-2222-3333-4444-555555555555";
    const { sessionId, isResuming } = resolveSessionId(null, threadId, mockConfig);
    expect(sessionId).toBe(threadId);
    expect(isResuming).toBe(true);
  });

  it("returns a new UUID when both parsedSession and threadSessionId are null", () => {
    const { sessionId, isResuming } = resolveSessionId(null, null, mockConfig);
    expect(sessionId).toMatch(UUID_RE);
    expect(isResuming).toBe(false);
  });
});
