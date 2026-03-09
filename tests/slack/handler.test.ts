import { describe, expect, it, mock } from "bun:test";
import type { CCSlackConfig } from "../../src/config";
import {
  createReactionCancelHandler,
  extractSessionIdFromMessage,
  resolveRepoPath,
  resolveSessionId,
  SESSION_ID_RE,
} from "../../src/slack/handler";
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

describe("extractSessionIdFromMessage", () => {
  const testUuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

  it("extracts session ID from text field (Session: format)", () => {
    const msg = { text: `Session: ${testUuid}`, bot_id: "B123" };
    expect(extractSessionIdFromMessage(msg)).toBe(testUuid);
  });

  it("extracts session ID from text field (:link: format)", () => {
    const msg = { text: `:link: \`${testUuid}\``, bot_id: "B123" };
    expect(extractSessionIdFromMessage(msg)).toBe(testUuid);
  });

  it("extracts session ID from blocks when text is empty", () => {
    const msg = {
      text: "",
      bot_id: "B123",
      blocks: [{ type: "markdown", text: `---\n:link: \`${testUuid}\`\n\`\`\`\ncd /repo && claude --resume ${testUuid}\n\`\`\`` }],
    };
    expect(extractSessionIdFromMessage(msg)).toBe(testUuid);
  });

  it("extracts session ID from blocks when text has no session info", () => {
    const msg = {
      text: "Some other text without session info",
      bot_id: "B123",
      blocks: [
        { type: "markdown", text: "Here is my response..." },
        { type: "markdown", text: `---\n:link: \`${testUuid}\`` },
      ],
    };
    expect(extractSessionIdFromMessage(msg)).toBe(testUuid);
  });

  it("returns null when no session ID found anywhere", () => {
    const msg = { text: "Just a regular message", bot_id: "B123", blocks: [] };
    expect(extractSessionIdFromMessage(msg)).toBeNull();
  });

  it("returns null when message has no text and no blocks", () => {
    const msg = { bot_id: "B123" };
    expect(extractSessionIdFromMessage(msg)).toBeNull();
  });

  it("prefers text field over blocks", () => {
    const textUuid = "11111111-2222-3333-4444-555555555555";
    const blockUuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const msg = {
      text: `Session: ${textUuid}`,
      bot_id: "B123",
      blocks: [{ type: "markdown", text: `:link: \`${blockUuid}\`` }],
    };
    expect(extractSessionIdFromMessage(msg)).toBe(textUuid);
  });

  it("extracts session ID from rich_text blocks (Slack conversion of markdown blocks)", () => {
    const msg = {
      text: "",
      bot_id: "B123",
      blocks: [
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [
                { type: "emoji", name: "link" },
                { type: "text", text: ` \`${testUuid}\`` },
              ],
            },
          ],
        },
      ],
    };
    expect(extractSessionIdFromMessage(msg)).toBe(testUuid);
  });

  it("extracts session ID from rich_text with Session: prefix", () => {
    const msg = {
      text: "",
      bot_id: "B123",
      blocks: [
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [{ type: "text", text: `Session: ${testUuid}` }],
            },
          ],
        },
      ],
    };
    expect(extractSessionIdFromMessage(msg)).toBe(testUuid);
  });
});

describe("createReactionCancelHandler", () => {
  const config = mockConfig;

  it("cancels task and sends ephemeral message when x reaction by allowed user", async () => {
    const cancelMap = { cancel: mock(() => true) };
    const mockClient = {
      chat: { postEphemeral: mock(async () => {}) },
      reactions: { remove: mock(async () => {}) },
    };

    const handler = createReactionCancelHandler(config, cancelMap as any);
    await handler({
      event: {
        reaction: "x",
        user: config.allowedUsers[0],
        item: { type: "message", channel: "C123", ts: "1234567890.000001" },
      },
      client: mockClient,
    });

    expect(cancelMap.cancel).toHaveBeenCalledWith("1234567890.000001");
    expect(mockClient.chat.postEphemeral).toHaveBeenCalled();
    expect(mockClient.reactions.remove).toHaveBeenCalledWith({
      channel: "C123",
      timestamp: "1234567890.000001",
      name: "hourglass_flowing_sand",
    });
  });

  it("ignores reaction from non-allowed user", async () => {
    const cancelMap = { cancel: mock(() => true) };
    const mockClient = {
      chat: { postEphemeral: mock(async () => {}) },
      reactions: { remove: mock(async () => {}) },
    };

    const handler = createReactionCancelHandler(config, cancelMap as any);
    await handler({
      event: {
        reaction: "x",
        user: "U_UNKNOWN",
        item: { type: "message", channel: "C123", ts: "1234567890.000001" },
      },
      client: mockClient,
    });

    expect(cancelMap.cancel).not.toHaveBeenCalled();
  });

  it("ignores non-x reactions", async () => {
    const cancelMap = { cancel: mock(() => true) };
    const mockClient = {
      chat: { postEphemeral: mock(async () => {}) },
      reactions: { remove: mock(async () => {}) },
    };

    const handler = createReactionCancelHandler(config, cancelMap as any);
    await handler({
      event: {
        reaction: "thumbsup",
        user: config.allowedUsers[0],
        item: { type: "message", channel: "C123", ts: "1234567890.000001" },
      },
      client: mockClient,
    });

    expect(cancelMap.cancel).not.toHaveBeenCalled();
  });

  it("does nothing when no active task for that ts", async () => {
    const cancelMap = { cancel: mock(() => false) };
    const mockClient = {
      chat: { postEphemeral: mock(async () => {}) },
      reactions: { remove: mock(async () => {}) },
    };

    const handler = createReactionCancelHandler(config, cancelMap as any);
    await handler({
      event: {
        reaction: "x",
        user: config.allowedUsers[0],
        item: { type: "message", channel: "C123", ts: "no-such-ts" },
      },
      client: mockClient,
    });

    expect(mockClient.chat.postEphemeral).not.toHaveBeenCalled();
  });
});
