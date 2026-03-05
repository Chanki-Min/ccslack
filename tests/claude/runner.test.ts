import { describe, it, expect } from "bun:test";
import { runClaude, parseStreamJson } from "../../src/claude/runner";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";

describe("runClaude", () => {
  it("runs a command and returns output", async () => {
    // echo outputs all args including -p, prompt, --output-format, etc.
    // parseStreamJson will fail to parse and fallback to raw stdout
    const result = await runClaude({
      prompt: "hello",
      cwd: "/tmp",
      claudePath: "echo",
      timeout: 5000,
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("hello");
  });

  it("returns failure for nonexistent command", async () => {
    const result = await runClaude({
      prompt: "test",
      cwd: "/tmp",
      claudePath: "/nonexistent/binary",
      timeout: 5000,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("respects timeout", async () => {
    // Create a script that sleeps forever, ignoring all args
    const script = join(import.meta.dir, "_sleep.sh");
    writeFileSync(script, "#!/bin/bash\nsleep 60\n", { mode: 0o755 });

    try {
      const result = await runClaude({
        prompt: "ignored",
        cwd: "/tmp",
        claudePath: script,
        timeout: 100,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("timeout");
    } finally {
      unlinkSync(script);
    }
  });
});

describe("parseStreamJson", () => {
  it("extracts text from result message", () => {
    const input = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}',
      '{"type":"result","result":"final answer"}',
    ].join("\n");

    const { text, thinking } = parseStreamJson(input);
    expect(text).toBe("final answer");
    expect(thinking).toEqual([]);
  });

  it("extracts thinking blocks", () => {
    const input = [
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"let me think..."},{"type":"text","text":"answer"}]}}',
      '{"type":"result","result":"answer"}',
    ].join("\n");

    const { text, thinking } = parseStreamJson(input);
    expect(text).toBe("answer");
    expect(thinking).toEqual(["let me think..."]);
  });

  it("handles non-JSON lines gracefully", () => {
    const input = "not json\nalso not json\n";
    const { text, thinking } = parseStreamJson(input);
    expect(text).toBe("");
    expect(thinking).toEqual([]);
  });
});
