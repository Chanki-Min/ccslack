import { describe, it, expect } from "bun:test";
import { formatThreadReply, splitMessage } from "../../src/slack/responder";
import type { ClaudeResult } from "../../src/claude/runner";

describe("formatThreadReply", () => {
  it("formats a successful result", () => {
    const result: ClaudeResult = {
      success: true,
      output: "Fixed the bug in auth.ts\nChanged 3 files",
    };
    const reply = formatThreadReply(result);
    expect(reply).toContain("Fixed the bug");
  });

  it("formats a failed result", () => {
    const result: ClaudeResult = {
      success: false,
      output: "",
      error: "Process timed out",
    };
    const reply = formatThreadReply(result);
    expect(reply).toContain("Process timed out");
  });

  it("truncates long output to 500 chars", () => {
    const result: ClaudeResult = {
      success: true,
      output: "x".repeat(600),
    };
    const reply = formatThreadReply(result);
    expect(reply.length).toBeLessThanOrEqual(503); // 500 + "..."
    expect(reply).toEndWith("...");
  });

  it("handles missing error field on failure", () => {
    const result: ClaudeResult = {
      success: false,
      output: "",
    };
    const reply = formatThreadReply(result);
    expect(reply).toContain("Unknown error");
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
