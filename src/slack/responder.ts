import type { ClaudeResult } from "../claude/runner";

const MARKDOWN_BLOCK_LIMIT = 12000;

export interface SlackMessage {
  text: string;
  blocks: Array<{ type: "markdown"; text: string }>;
}

export function formatMentionReply(result: ClaudeResult): SlackMessage[] {
  const content = result.success ? result.output : `Error: ${result.error || "Unknown error"}`;

  const chunks = splitMessage(content, MARKDOWN_BLOCK_LIMIT);
  return chunks.map((chunk) => ({
    text: chunk.length > 200 ? `${chunk.slice(0, 200)}...` : chunk,
    blocks: [{ type: "markdown" as const, text: chunk }],
  }));
}

export function formatSessionInfo(sessionId: string, repoPath: string, claudePath: string = "claude"): SlackMessage {
  const resumeCmd = `cd ${repoPath} && ${claudePath} --resume ${sessionId}`;
  return {
    text: `Session: ${sessionId}`,
    blocks: [
      {
        type: "markdown" as const,
        text: `---\n:link: \`${sessionId}\`\n\`\`\`\n${resumeCmd}\n\`\`\``,
      },
    ],
  };
}

export function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";
  for (const line of lines) {
    if (current.length + line.length + 1 > maxLength) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
