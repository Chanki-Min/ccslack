import { Assistant } from "@slack/bolt";
import { runClaude, runClaudeStream } from "../claude/runner";
import type { CCSlackConfig } from "../config";
import type { TaskQueue } from "../queue/taskQueue";
import { parseMessage } from "./parser";
import { formatMentionReply, formatSessionInfo } from "./responder";

export function resolveRepoPath(repo: string | null, config: CCSlackConfig): string {
  const repoName = repo ?? config.defaultRepo ?? null;
  const available = Object.keys(config.repos).join(", ");

  if (!repoName) {
    throw new Error(`No repo specified and no defaultRepo configured. Available: ${available}`);
  }

  // Only allow configured repo aliases — no arbitrary paths
  const resolved = config.repos[repoName];
  if (!resolved) {
    throw new Error(`Unknown repo: "${repoName}". Available: ${available}`);
  }

  return resolved;
}

export interface SessionResolution {
  sessionId: string | undefined;
  isResuming: boolean;
}

export function resolveSessionId(
  parsedSession: string | null,
  threadSessionId: string | null,
  config: CCSlackConfig,
): SessionResolution {
  if (config.enableSessionContinuity === false) return { sessionId: undefined, isResuming: false };
  if (parsedSession === "new") return { sessionId: crypto.randomUUID(), isResuming: false };
  if (parsedSession) return { sessionId: parsedSession, isResuming: false };
  if (threadSessionId) return { sessionId: threadSessionId, isResuming: true };
  return { sessionId: crypto.randomUUID(), isResuming: false };
}

const SESSION_ID_RE = /(?::link:\s*`|Session:\s*)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;

async function fetchThreadContext(
  client: any,
  channel: string,
  threadTs: string | undefined,
  currentTs: string,
): Promise<{ context: string; lastSessionId: string | null }> {
  // Not in a thread — no prior context
  if (!threadTs) return { context: "", lastSessionId: null };

  try {
    const result = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit: 50,
    });

    let lastSessionId: string | null = null;

    const messages = (result.messages || [])
      .filter((m: any) => m.ts !== currentTs) // exclude the current message
      .map((m: any) => {
        const isBot = !!m.bot_id;
        const role = isBot ? "assistant" : "user";
        const text = (m.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();

        // Extract session ID from bot messages
        if (isBot) {
          const sessionMatch = text.match(SESSION_ID_RE);
          if (sessionMatch) {
            lastSessionId = sessionMatch[1];
          }
        }

        return `[${role}]: ${text}`;
      });

    if (messages.length === 0) return { context: "", lastSessionId };

    console.log(`[thread] Loaded ${messages.length} prior message(s) from thread`);
    const context =
      "Below is the prior conversation in this Slack thread for context:\n\n" +
      messages.join("\n") +
      "\n\n---\nNow respond to the latest request:\n";
    return { context, lastSessionId };
  } catch (err: any) {
    console.log(`[thread] Failed to fetch thread: ${err.message}`);
    return { context: "", lastSessionId: null };
  }
}

export function createMentionHandler(config: CCSlackConfig, queue: TaskQueue) {
  return async ({ event, client }: { event: any; client: any }) => {
    // Auth check
    if (!config.allowedUsers.includes(event.user)) {
      console.log(`[auth] Ignored mention from unauthorized user: ${event.user}`);
      return;
    }

    const { repo, model, session: parsedSession, prompt } = parseMessage(event.text || "");
    const resolvedModel = model ?? config.defaultModel;
    console.log(
      `[mention] New request from ${event.user} | repo: ${repo ?? "(default)"} | model: ${resolvedModel ?? "(default)"} | prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`,
    );

    let repoPath: string;
    try {
      repoPath = resolveRepoPath(repo, config);
    } catch (err: any) {
      console.log(`[mention] Repo resolution failed: ${err.message}`);
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: "알 수 없는 레포입니다. 설정을 확인해주세요.",
      });
      return;
    }

    // Hourglass reaction + thread context in parallel
    const [, { context: threadContext, lastSessionId: threadSessionId }] = await Promise.all([
      client.reactions
        .add({ channel: event.channel, timestamp: event.ts, name: "hourglass_flowing_sand" })
        .catch(() => {}),
      fetchThreadContext(client, event.channel, event.thread_ts, event.ts),
    ]);

    const { sessionId, isResuming } = resolveSessionId(parsedSession, threadSessionId, config);
    if (isResuming) console.log(`[session] Resuming session ${sessionId}`);
    const fullPrompt = (isResuming ? "" : threadContext) + prompt;

    const startTime = Date.now();
    console.log(
      `[claude] Starting batch: claude -p "${prompt.slice(0, 50)}..." in ${repoPath}${sessionId ? ` [session: ${sessionId}]` : ""}`,
    );

    try {
      const result = await queue.enqueue(() =>
        runClaude({
          prompt: fullPrompt,
          cwd: repoPath,
          claudePath: config.claudePath,
          timeout: config.taskTimeout,
          allowedTools: config.allowedTools,
          maxOutputTokens: config.maxOutputTokens,
          model: resolvedModel,
          sessionId,
        }),
      );

      // Swap reaction, then send reply chunks sequentially for ordering
      await Promise.all([
        client.reactions
          .remove({ channel: event.channel, timestamp: event.ts, name: "hourglass_flowing_sand" })
          .catch(() => {}),
        client.reactions
          .add({ channel: event.channel, timestamp: event.ts, name: result.success ? "white_check_mark" : "x" })
          .catch(() => {}),
      ]);
      const messages = formatMentionReply(result);
      for (const msg of messages) {
        await client.chat.postMessage({ channel: event.channel, thread_ts: event.ts, ...msg });
      }

      // Post session info for local resume
      if (sessionId) {
        const sessionMsg = formatSessionInfo(sessionId, repoPath, config.claudePath);
        await client.chat.postMessage({ channel: event.channel, thread_ts: event.ts, ...sessionMsg });
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[claude] Mention response finished in ${elapsed}s (${result.output.length} chars)`);
    } catch (err: any) {
      console.log(`[claude] Mention handler error: ${err.message}`);
      await Promise.all([
        client.reactions
          .remove({ channel: event.channel, timestamp: event.ts, name: "hourglass_flowing_sand" })
          .catch(() => {}),
        client.reactions.add({ channel: event.channel, timestamp: event.ts, name: "x" }).catch(() => {}),
        client.chat.postMessage({
          channel: event.channel,
          thread_ts: event.ts,
          text: "오류가 발생했습니다. 서버 로그를 확인해주세요.",
        }),
      ]);
    }
  };
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

      // Narrow event to a normal message (guaranteed by guard above)
      const ev = event as { user: string; text: string; channel: string; ts: string; thread_ts?: string };

      // Auth check
      if (!config.allowedUsers.includes(ev.user)) {
        console.log(`[auth] Ignored message from unauthorized user: ${ev.user}`);
        await say({ text: "권한이 없습니다." });
        return;
      }

      const { repo, model, session: parsedSession, prompt } = parseMessage(ev.text || "");
      const resolvedModel = model ?? config.defaultModel;
      console.log(
        `[task] New request from ${ev.user} | repo: ${repo ?? "(default)"} | model: ${resolvedModel ?? "(default)"} | prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`,
      );

      let repoPath: string;
      try {
        repoPath = resolveRepoPath(repo, config);
      } catch (err: any) {
        console.log(`[task] Repo resolution failed: ${err.message}`);
        await say({ text: "알 수 없는 레포입니다. 설정을 확인해주세요." });
        return;
      }

      console.log(`[task] Resolved repo path: ${repoPath}`);

      // Title, status, and thread context are independent — run in parallel
      const [, , { context: threadContext, lastSessionId: threadSessionId }] = await Promise.all([
        setTitle(prompt.slice(0, 50)),
        setStatus("Thinking..."),
        fetchThreadContext(client, ev.channel, ev.thread_ts, ev.ts),
      ]);

      const { sessionId, isResuming } = resolveSessionId(parsedSession, threadSessionId, config);
      if (isResuming) console.log(`[session] Resuming session ${sessionId}`);
      const fullPrompt = (isResuming ? "" : threadContext) + prompt;

      // Queue + Stream
      const startTime = Date.now();
      console.log(`[claude] Starting stream: claude -p "${prompt.slice(0, 50)}..." in ${repoPath}`);

      try {
        await queue.enqueue(async () => {
          const streamer = client.chatStream({
            channel: ev.channel,
            thread_ts: ev.thread_ts || ev.ts,
            recipient_user_id: ev.user,
          });

          try {
            let hasThinking = false;
            let lastStatusUpdate = 0;

            for await (const evt of runClaudeStream({
              prompt: fullPrompt,
              cwd: repoPath,
              claudePath: config.claudePath,
              timeout: config.taskTimeout,
              allowedTools: config.allowedTools,
              maxOutputTokens: config.maxOutputTokens,
              model: resolvedModel,
              sessionId,
            })) {
              if (evt.type === "text_delta") {
                if (hasThinking) {
                  await setStatus("Responding...");
                  hasThinking = false;
                }
                await streamer.append({ markdown_text: evt.text });
              } else if (evt.type === "thinking_delta") {
                hasThinking = true;
                const now = Date.now();
                if (now - lastStatusUpdate >= 2000) {
                  const elapsed = Math.round((now - startTime) / 1000);
                  await setStatus(`Thinking... (${elapsed}s)`);
                  lastStatusUpdate = now;
                }
              } else if (evt.type === "thinking") {
                const preview = evt.thinking.length > 200 ? `${evt.thinking.slice(0, 200)}...` : evt.thinking;
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

        // Post session info for local resume
        if (sessionId) {
          const sessionMsg = formatSessionInfo(sessionId, repoPath, config.claudePath);
          await say(sessionMsg);
        }
      } catch (err: any) {
        console.log(`[claude] Unhandled error: ${err.message}`);
        await setStatus("");
        await say({ text: "오류가 발생했습니다. 서버 로그를 확인해주세요." });
      }
    },
  });
}
