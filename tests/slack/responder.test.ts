import { describe, it, expect } from "bun:test";
import { formatMentionReply, splitMessage } from "../../src/slack/responder";
import type { ClaudeResult } from "../../src/claude/runner";

describe("formatMentionReply", () => {
  it("returns single message with markdown block for short result", () => {
    const result: ClaudeResult = {
      success: true,
      output: "Fixed the bug in auth.ts\nChanged 3 files",
    };
    const messages = formatMentionReply(result);
    expect(messages).toHaveLength(1);
    expect(messages[0].blocks).toHaveLength(1);
    expect(messages[0].blocks[0].type).toBe("markdown");
    expect(messages[0].blocks[0].text).toContain("Fixed the bug");
    // text is fallback for notifications
    expect(messages[0].text).toBeDefined();
  });

  it("splits output exceeding 12000 chars into multiple messages", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `Line ${i}: ${"x".repeat(50)}`);
    const result: ClaudeResult = {
      success: true,
      output: lines.join("\n"),
    };
    const messages = formatMentionReply(result);
    expect(messages.length).toBeGreaterThan(1);
    for (const msg of messages) {
      expect(msg.blocks).toHaveLength(1);
      expect(msg.blocks[0].type).toBe("markdown");
      expect(msg.blocks[0].text.length).toBeLessThanOrEqual(12000);
    }
  });

  it("formats error result with markdown block", () => {
    const result: ClaudeResult = {
      success: false,
      output: "",
      error: "Process timed out",
    };
    const messages = formatMentionReply(result);
    expect(messages).toHaveLength(1);
    expect(messages[0].blocks[0].text).toContain("Process timed out");
  });

  it("handles missing error field on failure", () => {
    const result: ClaudeResult = {
      success: false,
      output: "",
    };
    const messages = formatMentionReply(result);
    expect(messages[0].blocks[0].text).toContain("Unknown error");
  });

  it("truncates fallback text to 200 chars", () => {
    const result: ClaudeResult = {
      success: true,
      output: "x".repeat(300),
    };
    const messages = formatMentionReply(result);
    expect(messages[0].text.length).toBeLessThanOrEqual(204); // 200 + "..."
    expect(messages[0].blocks[0].text.length).toBe(300); // full content in block
  });
});

describe("splitMessage", () => {
  it("returns single chunk for short messages", () => {
    const chunks = splitMessage("hello", 4000);
    expect(chunks).toEqual(["hello"]);
  });

  it("splits long messages at line boundaries", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${"x".repeat(50)}`);
    const text = lines.join("\n");
    const chunks = splitMessage(text, 500);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
    }
    expect(chunks.join("\n")).toBe(text);
  });

  it("handles empty string", () => {
    const chunks = splitMessage("", 4000);
    expect(chunks).toEqual([""]);
  });

  it("handles single line longer than maxLength", () => {
    const longLine = "x".repeat(5000);
    const chunks = splitMessage(longLine, 4000);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(longLine);
  });
});
