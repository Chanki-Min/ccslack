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

export async function runClaude(options: ClaudeRunOptions): Promise<ClaudeResult> {
  const { prompt, cwd, claudePath, timeout } = options;

  try {
    const proc = Bun.spawn([claudePath, "-p", prompt], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
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

      if (exitCode !== 0) {
        return {
          success: false,
          output: stdout,
          error: stderr || `Process exited with code ${exitCode}`,
        };
      }

      return { success: true, output: stdout };
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
