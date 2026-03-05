import { Assistant } from "@slack/bolt";
import type { CCSlackConfig } from "../config";
import { parseMessage } from "./parser";
import { runClaudeStream } from "../claude/runner";
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

export function createAssistant(config: CCSlackConfig, queue: TaskQueue): Assistant {
  return new Assistant({
    threadStarted: async ({ say, setSuggestedPrompts, setTitle, saveThreadContext }) => {
      await setTitle("CCSlack Assistant");
      await saveThreadContext();
      const repos = Object.keys(config.repos).join(", ");
      await say({ text: `안녕하세요! 사용 가능한 레포: ${repos}\n\n레포 지정: \`repo:이름\` 프리픽스 사용` });
      if (config.suggestedPrompts?.length) {
        await setSuggestedPrompts({ prompts: config.suggestedPrompts });
      }
    },
    userMessage: async ({ message, event, client, say, setStatus, setTitle }) => {
      // Guard: ensure message has required fields
      if (!("text" in message) || !("thread_ts" in message) || !message.text) {
        return;
      }

      // Auth check
      if (!config.allowedUsers.includes(event.user)) {
        console.log(`[auth] Ignored message from unauthorized user: ${event.user}`);
        await say({ text: "권한이 없습니다." });
        return;
      }

      const { repo, prompt } = parseMessage(event.text || "");
      console.log(`[task] New request from ${event.user} | repo: ${repo ?? "(default)"} | prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`);

      let repoPath: string;
      try {
        repoPath = resolveRepoPath(repo, config);
      } catch (err: any) {
        console.log(`[task] Repo resolution failed: ${err.message}`);
        await say({ text: err.message });
        return;
      }

      console.log(`[task] Resolved repo path: ${repoPath}`);
      await setTitle(prompt.slice(0, 50));
      await setStatus("Thinking...");

      // Thread context
      const threadContext = await fetchThreadContext(
        client,
        event.channel,
        event.thread_ts,
        event.ts
      );
      const fullPrompt = threadContext + prompt;

      // Queue + Stream
      const startTime = Date.now();
      console.log(`[claude] Starting stream: claude -p "${prompt.slice(0, 50)}..." in ${repoPath}`);

      try {
        await queue.enqueue(async () => {
          const streamer = client.chatStream({
            channel: event.channel,
            thread_ts: event.thread_ts || event.ts,
            recipient_user_id: event.user,
          });

          try {
            for await (const evt of runClaudeStream({
              prompt: fullPrompt,
              cwd: repoPath,
              claudePath: config.claudePath,
              timeout: config.taskTimeout,
              allowedTools: config.allowedTools,
            })) {
              if (evt.type === "text_delta") {
                await streamer.append({ markdown_text: evt.text });
              } else if (evt.type === "thinking") {
                const preview = evt.thinking.length > 200 ? evt.thinking.slice(0, 200) + "..." : evt.thinking;
                console.log(`[thinking] ${preview}`);
              } else if (evt.type === "error") {
                console.log(`[claude] Error: ${evt.error}`);
                await streamer.append({ markdown_text: `\n\nError: ${evt.error}` });
              } else if (evt.type === "result") {
                console.log(`[claude] Result received: ${evt.text.length} chars`);
              }
            }
          } finally {
            await streamer.stop();
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[claude] Stream finished in ${elapsed}s`);
          }
        });
      } catch (err: any) {
        console.log(`[claude] Unhandled error: ${err.message}`);
        await setStatus("");
        await say({ text: `오류가 발생했습니다: ${err.message}` });
      }
    },
  });
}
