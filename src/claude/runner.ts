export interface ClaudeOptions {
  prompt: string;
  cwd: string;
  claudePath: string;
  timeout: number;
  allowedTools?: string[];
  maxOutputTokens?: number;
  model?: string;
  sessionId?: string;
  isResuming?: boolean;
  signal?: AbortSignal;
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "thinking"; thinking: string }
  | { type: "result"; text: string }
  | { type: "error"; error: string };

export interface ClaudeResult {
  success: boolean;
  output: string;
  error?: string;
}

const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
] as const;

const BASE_ENV: Record<string, string> = (() => {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
})();

function buildClaudeEnv(maxOutputTokens?: number): Record<string, string> {
  if (!maxOutputTokens) return BASE_ENV;
  return { ...BASE_ENV, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxOutputTokens) };
}

function buildClaudeCmd(options: ClaudeOptions, extraFlags: string[] = []): string[] {
  const { claudePath, prompt, model, allowedTools, sessionId, isResuming } = options;
  const cmd = [claudePath, "-p", prompt, "--output-format", "stream-json", "--verbose", ...extraFlags];
  if (model) cmd.push("--model", model);
  if (allowedTools?.length) cmd.push("--allowedTools", ...allowedTools);
  if (sessionId) {
    if (isResuming) {
      cmd.push("--resume", sessionId);
    } else {
      cmd.push("--session-id", sessionId);
    }
  }
  return cmd;
}

export function parseStreamJson(rawOutput: string): { text: string; thinking: string[] } {
  const lines = rawOutput.split("\n").filter((l) => l.trim());
  let text = "";
  const thinking: string[] = [];

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);

      // Final result message contains the text output
      if (msg.type === "result") {
        text = msg.result ?? "";
      }

      // Collect thinking blocks from assistant messages
      if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type === "thinking" && block.thinking) {
            thinking.push(block.thinking);
          }
        }
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return { text, thinking };
}

export async function* runClaudeStream(options: ClaudeOptions): AsyncGenerator<StreamEvent> {
  const { cwd, timeout, maxOutputTokens } = options;
  const cmd = buildClaudeCmd(options, ["--include-partial-messages"]);

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: buildClaudeEnv(maxOutputTokens),
  });

  // Handle pre-aborted signal
  if (options.signal?.aborted) {
    proc.kill();
    yield { type: "error", error: "cancelled" };
    return;
  }

  const abortPromise = new Promise<void>((resolve) => {
    options.signal?.addEventListener("abort", () => {
      proc.kill();
      resolve();
    }, { once: true });
  });

  const timeoutPromise = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
      resolve();
    }, timeout);
  });

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const pendingEvents: StreamEvent[] = [];

  function parseLine(line: string) {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);

      // Real-time token streaming via stream_event (--include-partial-messages)
      if (msg.type === "stream_event" && msg.event) {
        const evt = msg.event;
        if (evt.type === "content_block_delta" && evt.delta) {
          if (evt.delta.type === "text_delta" && evt.delta.text) {
            pendingEvents.push({ type: "text_delta", text: evt.delta.text });
          }
          if (evt.delta.type === "thinking_delta" && evt.delta.thinking) {
            pendingEvents.push({ type: "thinking_delta", thinking: evt.delta.thinking });
          }
        }
      }

      // Thinking blocks from completed assistant messages
      if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type === "thinking" && block.thinking) {
            pendingEvents.push({ type: "thinking", thinking: block.thinking });
          }
        }
      }

      // Final result
      if (msg.type === "result") {
        pendingEvents.push({ type: "result", text: msg.result ?? "" });
      }
    } catch {
      // skip non-JSON lines
    }
  }

  try {
    while (true) {
      const readPromise = reader.read();
      const { done, value } = await Promise.race([
        readPromise,
        timeoutPromise.then(() => ({ done: true as const, value: undefined })),
        abortPromise.then(() => ({ done: true as const, value: undefined })),
      ]);

      if (timedOut) {
        yield { type: "error", error: "timeout" };
        return;
      }

      if (options.signal?.aborted) {
        yield { type: "error", error: "cancelled" };
        return;
      }

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        parseLine(line);
      }

      for (const evt of pendingEvents) {
        yield evt;
      }
      pendingEvents.length = 0;
    }

    if (buffer.trim()) {
      parseLine(buffer);
      for (const evt of pendingEvents) {
        yield evt;
      }
      pendingEvents.length = 0;
    }

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      yield { type: "error", error: stderr || `Process exited with code ${exitCode}` };
    }
  } finally {
    clearTimeout(timer);
    try {
      reader.cancel();
    } catch {
      // ignore
    }
  }
}

export async function runClaude(options: ClaudeOptions): Promise<ClaudeResult> {
  const { cwd, timeout, maxOutputTokens } = options;

  try {
    const cmd = buildClaudeCmd(options);
    const proc = Bun.spawn(cmd, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: buildClaudeEnv(maxOutputTokens),
    });

    if (options.signal?.aborted) {
      proc.kill();
      return { success: false, output: "", error: "cancelled" };
    }

    const abortPromise = new Promise<never>((_, reject) => {
      options.signal?.addEventListener("abort", () => {
        proc.kill();
        reject(new Error("cancelled"));
      }, { once: true });
    });

    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        proc.kill();
        reject(new Error("timeout"));
      }, timeout);
    });

    const resultPromise = (async () => {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      const { text, thinking } = parseStreamJson(stdout);

      // Log thinking blocks
      if (thinking.length > 0) {
        for (const thought of thinking) {
          const preview = thought.length > 200 ? `${thought.slice(0, 200)}...` : thought;
          console.log(`[thinking] ${preview}`);
        }
      }

      if (exitCode !== 0) {
        return {
          success: false,
          output: text || stdout,
          error: stderr || `Process exited with code ${exitCode}`,
        };
      }

      return { success: true, output: text || stdout };
    })();

    try {
      return await Promise.race([resultPromise, timeoutPromise, abortPromise]);
    } finally {
      clearTimeout(timer!);
    }
  } catch (err: any) {
    return {
      success: false,
      output: "",
      error: err.message || String(err),
    };
  }
}
