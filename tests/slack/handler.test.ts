import { describe, expect, it } from "bun:test";
import type { CCSlackConfig } from "../../src/config";
import { resolveRepoPath, resolveSessionId, SESSION_ID_RE } from "../../src/slack/handler";
import { formatSessionInfo } from "../../src/slack/responder";

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

describe("SESSION_ID_RE", () => {
  const testUuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

  it("matches formatSessionInfo text field (Session: <uuid>)", () => {
    const msg = formatSessionInfo(testUuid, "/tmp/repo");
    const match = msg.text.match(SESSION_ID_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(testUuid);
  });

  it("matches formatSessionInfo block field (:link: `<uuid>`)", () => {
    const msg = formatSessionInfo(testUuid, "/tmp/repo");
    const blockText = msg.blocks[0]!.text;
    const match = blockText.match(SESSION_ID_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(testUuid);
  });

  it("extracts last session ID when multiple bot messages exist", () => {
    const messages = [
      `Session: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`,
      `Some other bot message`,
      `Session: ${testUuid}`,
    ];
    let lastId: string | null = null;
    for (const text of messages) {
      const match = text.match(SESSION_ID_RE);
      if (match) lastId = match[1] ?? null;
    }
    expect(lastId).toBe(testUuid);
  });

  it("does not match non-UUID strings", () => {
    expect("Session: not-a-uuid".match(SESSION_ID_RE)).toBeNull();
    expect("random text".match(SESSION_ID_RE)).toBeNull();
  });
});
