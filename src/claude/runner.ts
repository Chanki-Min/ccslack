export interface ClaudeOptions {
  prompt: string;
  cwd: string;
  claudePath: string;
  timeout: number;
  allowedTools?: string[];
  maxOutputTokens?: number;
  model?: string;
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
  "PATH", "HOME", "USER", "SHELL", "LANG", "LC_ALL", "TERM",
  "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
  "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
] as const;

function buildClaudeEnv(maxOutputTokens?: number): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  if (maxOutputTokens) {
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(maxOutputTokens);
  }
  return env;
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
  const { prompt, cwd, claudePath, timeout, allowedTools, maxOutputTokens, model } = options;

  const cmd: string[] = [claudePath, "-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  if (model) {
    cmd.push("--model", model);
  }
  if (allowedTools && allowedTools.length > 0) {
    cmd.push("--allowedTools", ...allowedTools);
  }

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: buildClaudeEnv(maxOutputTokens),
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
      ]);

      if (timedOut) {
        yield { type: "error", error: "timeout" };
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

    clearTimeout(timer);

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
  const { prompt, cwd, claudePath, timeout, allowedTools, maxOutputTokens, model } = options;

  try {
    const cmd: string[] = [claudePath, "-p", prompt, "--output-format", "stream-json", "--verbose"];
    if (model) {
      cmd.push("--model", model);
    }
    if (allowedTools && allowedTools.length > 0) {
      cmd.push("--allowedTools", ...allowedTools);
    }
    const proc = Bun.spawn(cmd, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: buildClaudeEnv(maxOutputTokens),
    });

    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        proc.kill();
        reject(new Error("timeout"));
      }, timeout);
    });

    const resultPromise = (async () => {
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      const { text, thinking } = parseStreamJson(stdout);

      // Log thinking blocks
      if (thinking.length > 0) {
        for (const thought of thinking) {
          const preview = thought.length > 200 ? thought.slice(0, 200) + "..." : thought;
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
      return await Promise.race([resultPromise, timeoutPromise]);
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
