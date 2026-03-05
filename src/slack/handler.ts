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
    const dmChunks = splitMessage(
      result.output || result.error || "No output",
      4000
    );
    for (const chunk of dmChunks) {
      await client.chat.postMessage({
        channel: event.user,
        text: chunk,
      });
    }
  };
}
