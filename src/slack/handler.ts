import { Assistant } from "@slack/bolt";
import { runClaude, runClaudeStream } from "../claude/runner";
import type { CCSlackConfig } from "../config";
import { buildPrompt } from "../prompt/template";
import type { TaskQueue } from "../queue/taskQueue";
import type { CancelMap } from "./cancelMap";
import { parseMessage } from "./parser";
import type { SlackMessage } from "./responder";
import { formatMentionReply, formatSessionInfo } from "./responder";

async function postReplyOrEphemeral(
  client: any,
  {
    channel,
    threadTs,
    user,
    noreply,
  }: { channel: string; threadTs: string | undefined; user: string; noreply: boolean },
  payload: SlackMessage | { text: string },
): Promise<void> {
  if (noreply) {
    await client.chat.postEphemeral({ channel, user, ...(threadTs && { thread_ts: threadTs }), ...payload });
  } else {
    await client.chat.postMessage({ channel, thread_ts: threadTs, ...payload });
  }
}

export interface ResolvedRepo {
  repoName: string;
  repoPath: string;
}

export function resolveRepoPath(repo: string | null, config: CCSlackConfig): ResolvedRepo {
  const repoName = repo ?? config.defaultRepo ?? null;
  const available = Object.keys(config.repos).join(", ");

  if (!repoName) {
    throw new Error(`No repo specified and no defaultRepo configured. Available: ${available}`);
  }

  // Only allow configured repo aliases — no arbitrary paths
  const entry = config.repos[repoName];
  if (!entry) {
    throw new Error(`Unknown repo: "${repoName}". Available: ${available}`);
  }

  const repoPath = typeof entry === "string" ? entry : entry.path;
  return { repoName, repoPath };
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

export const SESSION_ID_RE = /(?::link:\s*`|Session:\s*)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;

export function extractSessionIdFromMessage(m: any): string | null {
  // 1. Try text field first
  const text = (m.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
  const textMatch = text.match(SESSION_ID_RE);
  if (textMatch) return textMatch[1] ?? null;

  // 2. Try blocks (markdown blocks from Assistant API may not populate text)
  if (Array.isArray(m.blocks)) {
    for (const block of m.blocks) {
      // Direct text/content fields (markdown blocks)
      const blockText = block.text ?? block.content ?? "";
      const blockMatch = blockText.match(SESSION_ID_RE);
      if (blockMatch) return blockMatch[1] ?? null;

      // rich_text blocks: Slack may convert markdown blocks to rich_text in conversations.replies
      if (block.type === "rich_text" && Array.isArray(block.elements)) {
        for (const section of block.elements) {
          if (!Array.isArray(section.elements)) continue;
          const sectionText = section.elements
            .map((elem: any) => (elem.type === "emoji" ? `:${elem.name}:` : elem.text ?? ""))
            .join("");
          const sectionMatch = sectionText.match(SESSION_ID_RE);
          if (sectionMatch) return sectionMatch[1] ?? null;
        }
      }
    }
  }

  return null;
}

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

        // Extract session ID from bot messages (check text + blocks)
        if (isBot) {
          const sessionId = extractSessionIdFromMessage(m);
          if (sessionId) {
            lastSessionId = sessionId;
          }
        }

        return `[${role}]: ${text}`;
      });

    if (messages.length === 0) return { context: "", lastSessionId };

    console.log(`[thread] Loaded ${messages.length} prior message(s) from thread, lastSessionId: ${lastSessionId}`);
    const context = `Below is the prior conversation in this Slack thread for context:\n\n${messages.join("\n")}\n\n---\n`;
    return { context, lastSessionId };
  } catch (err: any) {
    console.log(`[thread] Failed to fetch thread: ${err.message}`);
    return { context: "", lastSessionId: null };
  }
}

export function createMentionHandler(config: CCSlackConfig, queue: TaskQueue, cancelMap: CancelMap) {
  return async ({ event, client }: { event: any; client: any }) => {
    // Auth check
    if (!config.allowedUsers.includes(event.user)) {
      console.log(`[auth] Ignored mention from unauthorized user: ${event.user}`);
      return;
    }

    const { repo, model, session: parsedSession, noreply, prompt } = parseMessage(event.text || "");
    const resolvedModel = model ?? config.defaultModel;
    console.log(
      `[mention] New request from ${event.user} | repo: ${repo ?? "(default)"} | model: ${resolvedModel ?? "(default)"} | noreply: ${noreply} | prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`,
    );

    let resolved: ResolvedRepo;
    try {
      resolved = resolveRepoPath(repo, config);
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
    const fullPrompt = buildPrompt({
      config,
      repoName: resolved.repoName,
      prompt,
      threadContext: isResuming ? "" : threadContext,
    });

    const signal = cancelMap.register(event.ts);

    const startTime = Date.now();
    console.log(
      `[claude] Starting batch: claude -p "${prompt.slice(0, 50)}..." in ${resolved.repoPath}${sessionId ? ` [session: ${sessionId}]` : ""}`,
    );

    try {
      const result = await queue.enqueue(() =>
        runClaude({
          prompt: fullPrompt,
          cwd: resolved.repoPath,
          claudePath: config.claudePath,
          timeout: config.taskTimeout,
          allowedTools: config.allowedTools,
          maxOutputTokens: config.maxOutputTokens,
          model: resolvedModel,
          sessionId,
          isResuming,
          signal,
        }),
      );
      cancelMap.unregister(event.ts);

      const isCancelled = !result.success && result.error === "cancelled";

      // Swap reaction, then send reply chunks sequentially for ordering
      await Promise.all([
        client.reactions
          .remove({ channel: event.channel, timestamp: event.ts, name: "hourglass_flowing_sand" })
          .catch(() => {}),
        client.reactions
          .add({ channel: event.channel, timestamp: event.ts, name: result.success ? "white_check_mark" : "x" })
          .catch(() => {}),
      ]);

      // Cancelled: send cancellation notice as ephemeral, session info as persistent
      if (isCancelled) {
        const parts: Promise<void>[] = [
          client.chat.postEphemeral({
            channel: event.channel,
            user: event.user,
            thread_ts: event.ts,
            text: "작업이 취소되었습니다.",
          }),
        ];
        if (sessionId) {
          const sessionMsg = formatSessionInfo(sessionId, resolved.repoPath, config.claudePath);
          parts.push(
            client.chat.postMessage({
              channel: event.channel,
              thread_ts: event.ts,
              ...sessionMsg,
            }),
          );
        }
        await Promise.all(parts);
      } else {
        // noreply: skip thread reply, send session info only to requester via ephemeral
        if (!noreply) {
          const messages = formatMentionReply(result);
          for (const msg of messages) {
            await client.chat.postMessage({ channel: event.channel, thread_ts: event.ts, ...msg });
          }
        }

        // Post session info (always persistent for session continuity)
        if (sessionId) {
          const sessionMsg = formatSessionInfo(sessionId, resolved.repoPath, config.claudePath);
          await client.chat.postMessage({
            channel: event.channel,
            thread_ts: event.thread_ts ?? event.ts,
            ...sessionMsg,
          });
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[claude] Mention response finished in ${elapsed}s (${result.output.length} chars)`);
    } catch (err: any) {
      cancelMap.unregister(event.ts);
      console.log(`[claude] Mention handler error: ${err.message}`);
      await Promise.all([
        client.reactions
          .remove({ channel: event.channel, timestamp: event.ts, name: "hourglass_flowing_sand" })
          .catch(() => {}),
        client.reactions.add({ channel: event.channel, timestamp: event.ts, name: "x" }).catch(() => {}),
        postReplyOrEphemeral(
          client,
          { channel: event.channel, threadTs: noreply ? event.thread_ts : event.ts, user: event.user, noreply },
          { text: "오류가 발생했습니다. 서버 로그를 확인해주세요." },
        ),
      ]);
    }
  };
}

export function createReactionCancelHandler(config: CCSlackConfig, cancelMap: Pick<CancelMap, "cancel">) {
  return async ({ event, client }: { event: any; client: any }) => {
    if (event.reaction !== "x") return;
    if (!config.allowedUsers.includes(event.user)) return;
    if (event.item?.type !== "message") return;

    const { channel, ts } = event.item;
    const cancelled = cancelMap.cancel(ts);
    if (!cancelled) return;

    await Promise.all([
      client.reactions.remove({ channel, timestamp: ts, name: "hourglass_flowing_sand" }).catch(() => {}),
      client.chat.postEphemeral({
        channel,
        user: event.user,
        thread_ts: ts,
        text: "작업이 취소되었습니다.",
      }),
    ]);
  };
}

export function createAssistant(config: CCSlackConfig, queue: TaskQueue, cancelMap: CancelMap): Assistant {
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

      let resolved: ResolvedRepo;
      try {
        resolved = resolveRepoPath(repo, config);
      } catch (err: any) {
        console.log(`[task] Repo resolution failed: ${err.message}`);
        await say({ text: "알 수 없는 레포입니다. 설정을 확인해주세요." });
        return;
      }

      console.log(`[task] Resolved repo path: ${resolved.repoPath}`);

      // Title, status, and thread context are independent — run in parallel
      const [, , { context: threadContext, lastSessionId: threadSessionId }] = await Promise.all([
        setTitle(prompt.slice(0, 50)),
        setStatus("Thinking..."),
        fetchThreadContext(client, ev.channel, ev.thread_ts, ev.ts),
      ]);

      const { sessionId, isResuming } = resolveSessionId(parsedSession, threadSessionId, config);
      if (isResuming) console.log(`[session] Resuming session ${sessionId}`);
      const fullPrompt = buildPrompt({
        config,
        repoName: resolved.repoName,
        prompt,
        threadContext: isResuming ? "" : threadContext,
      });

      // Queue + Stream
      const signal = cancelMap.register(ev.ts);
      const startTime = Date.now();
      console.log(`[claude] Starting stream: claude -p "${prompt.slice(0, 50)}..." in ${resolved.repoPath}`);

      let cancelled = false;
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
              cwd: resolved.repoPath,
              claudePath: config.claudePath,
              timeout: config.taskTimeout,
              allowedTools: config.allowedTools,
              maxOutputTokens: config.maxOutputTokens,
              model: resolvedModel,
              sessionId,
              isResuming,
              signal,
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
                if (evt.error === "cancelled") {
                  cancelled = true;
                } else {
                  await streamer.append({ markdown_text: `\n\nError: ${evt.error}` });
                }
              } else if (evt.type === "result") {
                console.log(`[claude] Result received: ${evt.text.length} chars`);
              }
            }
          } finally {
            cancelMap.unregister(ev.ts);
            await streamer.stop();
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[claude] Stream finished in ${elapsed}s`);
          }
        });

        // Post session info (always persistent for session continuity)
        if (sessionId) {
          const sessionMsg = formatSessionInfo(sessionId, resolved.repoPath, config.claudePath);
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
