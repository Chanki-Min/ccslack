# CCSlack Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Slack bot that bridges Slack mentions to local Claude Code CLI, running tasks as subprocesses with full MCP/connector support.

**Architecture:** Bun + @slack/bolt in Socket Mode receives app_mention events, validates the user, parses repo info, queues tasks with configurable concurrency, runs `claude -p` as subprocess in the target repo directory, and reports results back via Slack thread replies and DMs.

**Tech Stack:** Bun, TypeScript, @slack/bolt, @slack/socket-mode, Bun.spawn (subprocess)

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Initialize the project**

```bash
cd ~/ccslack
bun init -y
```

**Step 2: Install dependencies**

```bash
bun add @slack/bolt @slack/socket-mode
bun add -d @types/bun typescript
```

**Step 3: Configure tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts"]
}
```

**Step 4: Create .env.example**

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
```

**Step 5: Create .gitignore**

```
node_modules/
dist/
.env
```

**Step 6: Add scripts to package.json**

Add `"dev": "bun run src/index.ts"` and `"start": "bun run src/index.ts"` to scripts.

**Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold project with Bun, TypeScript, and Slack Bolt deps"
```

---

### Task 2: Config Module

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, type CCSlackConfig } from "../src/config";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const TEST_CONFIG_DIR = join(import.meta.dir, ".test-ccslack");
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, "config.json");

describe("loadConfig", () => {
  beforeEach(() => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  it("loads a valid config file", () => {
    const config = {
      allowedUsers: ["U123"],
      maxConcurrency: 3,
      taskTimeout: 600000,
      defaultRepo: "test-repo",
      claudePath: "/usr/local/bin/claude",
      repos: { "test-repo": "/tmp/test-repo" },
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.allowedUsers).toEqual(["U123"]);
    expect(result.maxConcurrency).toBe(3);
    expect(result.repos["test-repo"]).toBe("/tmp/test-repo");
  });

  it("applies defaults for optional fields", () => {
    const config = {
      allowedUsers: ["U123"],
      repos: { "my-repo": "/tmp/my-repo" },
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    const result = loadConfig(TEST_CONFIG_PATH);
    expect(result.maxConcurrency).toBe(2);
    expect(result.taskTimeout).toBe(300000);
    expect(result.claudePath).toBe("claude");
  });

  it("throws if config file is missing", () => {
    expect(() => loadConfig("/nonexistent/config.json")).toThrow();
  });

  it("throws if allowedUsers is empty", () => {
    const config = { allowedUsers: [], repos: {} };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));

    expect(() => loadConfig(TEST_CONFIG_PATH)).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/config.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/config.ts
import { readFileSync, existsSync } from "fs";

export interface CCSlackConfig {
  allowedUsers: string[];
  maxConcurrency: number;
  taskTimeout: number;
  defaultRepo?: string;
  claudePath: string;
  repos: Record<string, string>;
}

const DEFAULTS: Partial<CCSlackConfig> = {
  maxConcurrency: 2,
  taskTimeout: 300000,
  claudePath: "claude",
};

export function loadConfig(configPath: string): CCSlackConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = JSON.parse(readFileSync(configPath, "utf-8"));

  const config: CCSlackConfig = {
    ...DEFAULTS,
    ...raw,
  } as CCSlackConfig;

  if (!config.allowedUsers || config.allowedUsers.length === 0) {
    throw new Error("allowedUsers must contain at least one Slack User ID");
  }

  return config;
}

export const DEFAULT_CONFIG_PATH = `${process.env.HOME}/.ccslack/config.json`;
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/config.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config module with validation and defaults"
```

---

### Task 3: Message Parser

**Files:**
- Create: `src/slack/parser.ts`
- Create: `tests/slack/parser.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/slack/parser.test.ts
import { describe, it, expect } from "bun:test";
import { parseMessage, type ParsedMessage } from "../../src/slack/parser";

describe("parseMessage", () => {
  it("extracts repo and prompt from message", () => {
    const result = parseMessage("repo:my-project fix this bug");
    expect(result.repo).toBe("my-project");
    expect(result.prompt).toBe("fix this bug");
  });

  it("handles repo with path", () => {
    const result = parseMessage("repo:~/projects/app add tests");
    expect(result.repo).toBe("~/projects/app");
    expect(result.prompt).toBe("add tests");
  });

  it("returns null repo when not specified", () => {
    const result = parseMessage("fix the typo in README");
    expect(result.repo).toBeNull();
    expect(result.prompt).toBe("fix the typo in README");
  });

  it("strips bot mention from message", () => {
    const result = parseMessage("<@U12345> repo:my-project fix bug");
    expect(result.repo).toBe("my-project");
    expect(result.prompt).toBe("fix bug");
  });

  it("handles extra whitespace", () => {
    const result = parseMessage("  repo:test   do something  ");
    expect(result.repo).toBe("test");
    expect(result.prompt).toBe("do something");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/slack/parser.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/slack/parser.ts
export interface ParsedMessage {
  repo: string | null;
  prompt: string;
}

export function parseMessage(text: string): ParsedMessage {
  // Strip bot mentions like <@U12345>
  let cleaned = text.replace(/<@[A-Z0-9]+>/g, "").trim();

  // Extract repo: prefix
  const repoMatch = cleaned.match(/repo:(\S+)/);
  let repo: string | null = null;

  if (repoMatch) {
    repo = repoMatch[1];
    cleaned = cleaned.replace(/repo:\S+/, "").trim();
  }

  // Collapse whitespace
  const prompt = cleaned.replace(/\s+/g, " ").trim();

  return { repo, prompt };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/slack/parser.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add src/slack/parser.ts tests/slack/parser.test.ts
git commit -m "feat: add message parser for repo extraction and prompt cleanup"
```

---

### Task 4: Task Queue

**Files:**
- Create: `src/queue/taskQueue.ts`
- Create: `tests/queue/taskQueue.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/queue/taskQueue.test.ts
import { describe, it, expect } from "bun:test";
import { TaskQueue } from "../../src/queue/taskQueue";

describe("TaskQueue", () => {
  it("executes tasks up to concurrency limit", async () => {
    const queue = new TaskQueue(2);
    const order: number[] = [];

    const task = (id: number, ms: number) => async () => {
      order.push(id);
      await new Promise((r) => setTimeout(r, ms));
      return `done-${id}`;
    };

    const p1 = queue.enqueue(task(1, 50));
    const p2 = queue.enqueue(task(2, 50));
    const p3 = queue.enqueue(task(3, 10));

    // Tasks 1 and 2 start immediately, task 3 waits
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([1, 2]);

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("returns task result", async () => {
    const queue = new TaskQueue(1);
    const result = await queue.enqueue(async () => "hello");
    expect(result).toBe("hello");
  });

  it("propagates errors", async () => {
    const queue = new TaskQueue(1);
    expect(
      queue.enqueue(async () => {
        throw new Error("fail");
      })
    ).rejects.toThrow("fail");
  });

  it("reports pending count", () => {
    const queue = new TaskQueue(1);
    expect(queue.pendingCount).toBe(0);

    // Enqueue a long task to fill the slot
    queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    // This one should be pending
    queue.enqueue(async () => {});

    expect(queue.pendingCount).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/queue/taskQueue.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/queue/taskQueue.ts
type Task<T> = () => Promise<T>;

interface QueueItem {
  task: Task<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

export class TaskQueue {
  private readonly maxConcurrency: number;
  private running = 0;
  private queue: QueueItem[] = [];

  constructor(maxConcurrency: number) {
    this.maxConcurrency = maxConcurrency;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get runningCount(): number {
    return this.running;
  }

  enqueue<T>(task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processNext();
    });
  }

  private processNext(): void {
    if (this.running >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift()!;
    this.running++;

    item
      .task()
      .then(item.resolve)
      .catch(item.reject)
      .finally(() => {
        this.running--;
        this.processNext();
      });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/queue/taskQueue.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add src/queue/taskQueue.ts tests/queue/taskQueue.test.ts
git commit -m "feat: add task queue with configurable concurrency"
```

---

### Task 5: Claude CLI Runner

**Files:**
- Create: `src/claude/runner.ts`
- Create: `tests/claude/runner.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/claude/runner.test.ts
import { describe, it, expect } from "bun:test";
import { runClaude, type ClaudeResult } from "../../src/claude/runner";

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
    const result = await runClaude({
      prompt: "test",
      cwd: "/tmp",
      claudePath: "sleep",
      timeout: 100,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/claude/runner.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/claude/runner.ts
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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
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

    return await Promise.race([resultPromise, timeoutPromise]);
  } catch (err: any) {
    return {
      success: false,
      output: "",
      error: err.message || String(err),
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/claude/runner.test.ts`
Expected: PASS (all 3 tests)

**Step 5: Commit**

```bash
git add src/claude/runner.ts tests/claude/runner.test.ts
git commit -m "feat: add Claude CLI subprocess runner with timeout"
```

---

### Task 6: Slack Responder

**Files:**
- Create: `src/slack/responder.ts`
- Create: `tests/slack/responder.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/slack/responder.test.ts
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
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/slack/responder.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/slack/responder.ts
import type { ClaudeResult } from "../claude/runner";

export function formatThreadReply(result: ClaudeResult): string {
  if (result.success) {
    const summary =
      result.output.length > 500
        ? result.output.substring(0, 500) + "..."
        : result.output;
    return summary;
  }

  return `Error: ${result.error || "Unknown error"}`;
}

export function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    if (current.length + line.length + 1 > maxLength) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/slack/responder.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add src/slack/responder.ts tests/slack/responder.test.ts
git commit -m "feat: add Slack response formatter with message splitting"
```

---

### Task 7: Slack Event Handler

**Files:**
- Create: `src/slack/handler.ts`
- Create: `tests/slack/handler.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/slack/handler.test.ts
import { describe, it, expect } from "bun:test";
import { resolveRepoPath } from "../../src/slack/handler";
import type { CCSlackConfig } from "../../src/config";

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
    const path = resolveRepoPath("my-project", mockConfig);
    expect(path).toBe("/Users/test/projects/my-project");
  });

  it("uses defaultRepo when repo is null", () => {
    const path = resolveRepoPath(null, mockConfig);
    expect(path).toBe("/Users/test/projects/default");
  });

  it("returns absolute path as-is", () => {
    const path = resolveRepoPath("/tmp/some-repo", mockConfig);
    expect(path).toBe("/tmp/some-repo");
  });

  it("throws for unknown repo with no default", () => {
    const configNoDefault = { ...mockConfig, defaultRepo: undefined };
    expect(() => resolveRepoPath(null, configNoDefault)).toThrow();
  });

  it("throws for unknown repo alias", () => {
    expect(() => resolveRepoPath("nonexistent", mockConfig)).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/slack/handler.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/slack/handler.ts
import type { CCSlackConfig } from "../config";
import { parseMessage } from "./parser";
import { runClaude } from "../claude/runner";
import { formatThreadReply, splitMessage } from "./responder";
import { TaskQueue } from "../queue/taskQueue";

export function resolveRepoPath(
  repo: string | null,
  config: CCSlackConfig
): string {
  const repoName = repo ?? config.defaultRepo ?? null;

  if (!repoName) {
    const available = Object.keys(config.repos).join(", ");
    throw new Error(
      `No repo specified and no defaultRepo configured. Available: ${available}`
    );
  }

  // Absolute path — use directly
  if (repoName.startsWith("/")) {
    return repoName;
  }

  // Home-relative path
  if (repoName.startsWith("~/")) {
    return repoName.replace("~", process.env.HOME || "~");
  }

  // Alias lookup
  const resolved = config.repos[repoName];
  if (!resolved) {
    const available = Object.keys(config.repos).join(", ");
    throw new Error(`Unknown repo: "${repoName}". Available: ${available}`);
  }

  return resolved;
}

export function createHandler(config: CCSlackConfig, queue: TaskQueue) {
  return async ({
    event,
    client,
  }: {
    event: any;
    client: any;
  }) => {
    // Auth check
    if (!config.allowedUsers.includes(event.user)) {
      return;
    }

    const { repo, prompt } = parseMessage(event.text || "");

    let repoPath: string;
    try {
      repoPath = resolveRepoPath(repo, config);
    } catch (err: any) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: err.message,
      });
      return;
    }

    // Add "working" reaction
    await client.reactions.add({
      channel: event.channel,
      timestamp: event.ts,
      name: "hourglass_flowing_sand",
    });

    // Notify if queued
    if (queue.pendingCount > 0) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: `Queue: ${queue.pendingCount} task(s) ahead. Waiting...`,
      });
    }

    // Enqueue the task
    const result = await queue.enqueue(() =>
      runClaude({
        prompt,
        cwd: repoPath,
        claudePath: config.claudePath,
        timeout: config.taskTimeout,
      })
    );

    // Remove hourglass, add result reaction
    try {
      await client.reactions.remove({
        channel: event.channel,
        timestamp: event.ts,
        name: "hourglass_flowing_sand",
      });
    } catch {}

    await client.reactions.add({
      channel: event.channel,
      timestamp: event.ts,
      name: result.success ? "white_check_mark" : "x",
    });

    // Thread reply: summary
    const threadReply = formatThreadReply(result);
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: threadReply,
    });

    // DM: full output
    const dmChunks = splitMessage(result.output || result.error || "No output", 4000);
    for (const chunk of dmChunks) {
      await client.chat.postMessage({
        channel: event.user,
        text: chunk,
      });
    }
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/slack/handler.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add src/slack/handler.ts tests/slack/handler.test.ts
git commit -m "feat: add Slack event handler with repo resolution and queue integration"
```

---

### Task 8: Entry Point — Wire Everything Together

**Files:**
- Create: `src/index.ts`

**Step 1: Write the entry point**

```typescript
// src/index.ts
import { App } from "@slack/bolt";
import { loadConfig, DEFAULT_CONFIG_PATH } from "./config";
import { TaskQueue } from "./queue/taskQueue";
import { createHandler } from "./slack/handler";

const configPath = process.env.CCSLACK_CONFIG || DEFAULT_CONFIG_PATH;
const config = loadConfig(configPath);

console.log(`CCSlack starting...`);
console.log(`  Allowed users: ${config.allowedUsers.join(", ")}`);
console.log(`  Max concurrency: ${config.maxConcurrency}`);
console.log(`  Repos: ${Object.keys(config.repos).join(", ")}`);

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const queue = new TaskQueue(config.maxConcurrency);
const handler = createHandler(config, queue);

app.event("app_mention", async ({ event, client }) => {
  try {
    await handler({ event, client });
  } catch (err) {
    console.error("Unhandled error in mention handler:", err);
  }
});

(async () => {
  await app.start();
  console.log("CCSlack bot is running!");
})();
```

**Step 2: Verify it compiles**

Run: `bun build src/index.ts --outdir dist --target bun`
Expected: Successful build with no TypeScript errors

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add entry point wiring Bolt app, config, queue, and handler"
```

---

### Task 9: README & Setup Guide

**Files:**
- Create: `README.md`

**Step 1: Write the README**

```markdown
# CCSlack — Slack-to-Local-Claude Bridge

Run Claude Code from Slack. Messages to the bot are executed via `claude -p` on your local machine, with full access to your MCP servers and connectors.

## Setup

### 1. Create a Slack App

1. Go to https://api.slack.com/apps → Create New App → From Scratch
2. Enable **Socket Mode** (Settings → Socket Mode → Enable)
3. Create an **App-Level Token** with `connections:write` scope
4. Add **Bot Token Scopes** (OAuth & Permissions):
   - `app_mentions:read`
   - `chat:write`
   - `im:write`
   - `reactions:write`
5. Enable **Event Subscriptions** → Subscribe to `app_mention`
6. Install to workspace

### 2. Configure CCSlack

Create `~/.ccslack/config.json`:

```json
{
  "allowedUsers": ["YOUR_SLACK_USER_ID"],
  "maxConcurrency": 2,
  "taskTimeout": 300000,
  "claudePath": "/Users/you/.local/bin/claude",
  "defaultRepo": "my-project",
  "repos": {
    "my-project": "/Users/you/projects/my-project"
  }
}
```

Find your Slack User ID: Profile → ⋮ menu → Copy member ID

### 3. Set Environment Variables

```bash
cp .env.example .env
# Edit .env with your Slack tokens
```

### 4. Run

```bash
bun install
bun dev
```

## Usage

In any Slack channel where the bot is present:

```
@ccbot repo:my-project fix the login bug
@ccbot repo:frontend add dark mode toggle
@ccbot update the README  (uses defaultRepo)
```

## How It Works

1. Bot receives your mention via Socket Mode
2. Validates your Slack User ID against allowedUsers
3. Parses `repo:` and the prompt from your message
4. Queues the task (configurable concurrency limit)
5. Runs `claude -p "your prompt"` in the repo directory
6. Replies in thread (summary) and DM (full output)
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup guide and usage instructions"
```

---

### Task 10: End-to-End Manual Test

**Step 1: Create config directory and file**

```bash
mkdir -p ~/.ccslack
# Create config.json with your actual Slack User ID and repos
```

**Step 2: Create .env with tokens**

```bash
cp .env.example .env
# Fill in SLACK_BOT_TOKEN and SLACK_APP_TOKEN
```

**Step 3: Start the bot**

```bash
bun dev
```

Expected: Console shows "CCSlack bot is running!"

**Step 4: Test from Slack**

1. Invite the bot to a channel: `/invite @ccbot`
2. Send: `@ccbot repo:my-project explain this project`
3. Verify: ⏳ reaction appears → ✅ reaction on completion
4. Verify: Thread reply with summary
5. Verify: DM with full output

**Step 5: Test error cases**

1. Unknown repo: `@ccbot repo:nonexistent hello` → should reply with available repos
2. Different user mentions bot → should be silently ignored
