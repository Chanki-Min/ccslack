import type { CCSlackConfig } from "../config";
import { parseMessage } from "./parser";
import { runClaude } from "../claude/runner";
import { formatThreadReply, splitMessage } from "./responder";
import type { TaskQueue } from "../queue/taskQueue";

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

  // Absolute path -- use directly
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

async function fetchThreadContext(
  client: any,
  channel: string,
  threadTs: string | undefined,
  currentTs: string
): Promise<string> {
  // Not in a thread — no prior context
  if (!threadTs) return "";

  try {
    const result = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit: 50,
    });

    const messages = (result.messages || [])
      .filter((m: any) => m.ts !== currentTs) // exclude the current message
      .map((m: any) => {
        const isBot = !!m.bot_id;
        const role = isBot ? "assistant" : "user";
        // Strip bot mentions from user messages
        const text = (m.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
        return `[${role}]: ${text}`;
      });

    if (messages.length === 0) return "";

    console.log(`[thread] Loaded ${messages.length} prior message(s) from thread`);
    return (
      "Below is the prior conversation in this Slack thread for context:\n\n" +
      messages.join("\n") +
      "\n\n---\nNow respond to the latest request:\n"
    );
  } catch (err: any) {
    console.log(`[thread] Failed to fetch thread: ${err.message}`);
    return "";
  }
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
      console.log(`[auth] Ignored mention from unauthorized user: ${event.user}`);
      return;
    }

    const { repo, prompt } = parseMessage(event.text || "");
    console.log(`[task] New request from ${event.user} | repo: ${repo ?? "(default)"} | prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`);

    let repoPath: string;
    try {
      repoPath = resolveRepoPath(repo, config);
    } catch (err: any) {
      console.log(`[task] Repo resolution failed: ${err.message}`);
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: err.message,
      });
      return;
    }

    console.log(`[task] Resolved repo path: ${repoPath}`);

    // Fetch thread context if this message is in a thread
    const threadContext = await fetchThreadContext(
      client,
      event.channel,
      event.thread_ts,
      event.ts
    );
    const fullPrompt = threadContext + prompt;

    // Add "working" reaction
    await client.reactions.add({
      channel: event.channel,
      timestamp: event.ts,
      name: "hourglass_flowing_sand",
    });

    // Notify if queued
    if (queue.pendingCount > 0) {
      console.log(`[queue] Task queued (${queue.pendingCount} ahead, ${queue.runningCount} running)`);
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: `Queue: ${queue.pendingCount} task(s) ahead. Waiting...`,
      });
    }

    // Enqueue the task
    const startTime = Date.now();
    console.log(`[claude] Starting: claude -p "${prompt.slice(0, 50)}..." in ${repoPath}`);
    const result = await queue.enqueue(() =>
      runClaude({
        prompt: fullPrompt,
        cwd: repoPath,
        claudePath: config.claudePath,
        timeout: config.taskTimeout,
      })
    );
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[claude] Finished in ${elapsed}s | success: ${result.success} | output: ${result.output.length} chars`);
    if (!result.success) {
      console.log(`[claude] Error: ${result.error}`);
    }

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
    const dmChunks = splitMessage(
      result.output || result.error || "No output",
      4000
    );
    console.log(`[slack] Sending thread reply + ${dmChunks.length} DM chunk(s) to ${event.user}`);
    for (const chunk of dmChunks) {
      await client.chat.postMessage({
        channel: event.user,
        text: chunk,
      });
    }
  };
}
