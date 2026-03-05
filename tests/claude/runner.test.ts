import { describe, it, expect } from "bun:test";
import { runClaude, parseStreamJson, runClaudeStream, StreamEvent } from "../../src/claude/runner";
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

  it("includes --session-id flag when sessionId is provided", async () => {
    const result = await runClaude({
      prompt: "hello",
      cwd: "/tmp",
      claudePath: "echo",
      timeout: 5000,
      sessionId: "test-uuid-1234",
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("--session-id");
    expect(result.output).toContain("test-uuid-1234");
  });

  it("omits --session-id when sessionId is undefined", async () => {
    const result = await runClaude({
      prompt: "hello",
      cwd: "/tmp",
      claudePath: "echo",
      timeout: 5000,
    });
    expect(result.output).not.toContain("--session-id");
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

describe("runClaudeStream", () => {
  it("yields events from stream_event and assistant messages", async () => {
    const script = join(import.meta.dir, "_stream.sh");
    writeFileSync(
      script,
      `#!/bin/bash
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"let me consider"}}}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello "}}}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}}'
echo '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"let me think"},{"type":"text","text":"hello world"}]}}'
echo '{"type":"result","result":"final answer"}'
`,
      { mode: 0o755 }
    );

    try {
      const events: StreamEvent[] = [];
      for await (const evt of runClaudeStream({
        prompt: "ignored",
        cwd: "/tmp",
        claudePath: script,
        timeout: 5000,
      })) {
        events.push(evt);
      }

      // stream_event thinking_delta
      expect(events).toContainEqual({ type: "thinking_delta", thinking: "let me consider" });
      // stream_event text_delta tokens
      expect(events).toContainEqual({ type: "text_delta", text: "hello " });
      expect(events).toContainEqual({ type: "text_delta", text: "world" });
      // thinking from completed assistant message
      expect(events).toContainEqual({ type: "thinking", thinking: "let me think" });
      // final result
      expect(events).toContainEqual({ type: "result", text: "final answer" });
    } finally {
      unlinkSync(script);
    }
  });

  it("respects timeout", async () => {
    const script = join(import.meta.dir, "_sleep_stream.sh");
    writeFileSync(script, "#!/bin/bash\nsleep 60\n", { mode: 0o755 });

    try {
      const events: StreamEvent[] = [];
      for await (const evt of runClaudeStream({
        prompt: "ignored",
        cwd: "/tmp",
        claudePath: script,
        timeout: 100,
      })) {
        events.push(evt);
      }

      expect(events.some((e) => e.type === "error")).toBe(true);
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
