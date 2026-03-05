export interface ClaudeRunOptions {
  prompt: string;
  cwd: string;
  claudePath: string;
  timeout: number;
}

export interface ClaudeResult {
  success: boolean;
  output: string;
  error?: string;
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

export async function runClaude(options: ClaudeRunOptions): Promise<ClaudeResult> {
  const { prompt, cwd, claudePath, timeout } = options;

  try {
    const proc = Bun.spawn(
      [claudePath, "-p", prompt, "--output-format", "stream-json", "--verbose"],
      {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      }
    );

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
