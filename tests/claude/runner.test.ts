import { describe, it, expect } from "bun:test";
import { runClaude } from "../../src/claude/runner";

describe("runClaude", () => {
  it("runs a simple echo command via claude and returns output", async () => {
    // Use 'echo' as a stand-in to test subprocess mechanics
    const result = await runClaude({
      prompt: "hello",
      cwd: "/tmp",
      claudePath: "echo",
      timeout: 5000,
    });
    expect(result.success).toBe(true);
    expect(result.output.trim()).toContain("hello");
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
    // node -p evaluates and prints, but we give it a long-running expression
    const result = await runClaude({
      prompt: "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000)",
      cwd: "/tmp",
      claudePath: "node",
      timeout: 100,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");
  });
});
