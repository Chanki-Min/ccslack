import type { ClaudeResult } from "../claude/runner";

export function formatThreadReply(result: ClaudeResult): string {
  if (result.success) {
    return result.output.length > 500
      ? result.output.substring(0, 500) + "..."
      : result.output;
  }
  return `Error: ${result.error || "Unknown error"}`;
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
      current = current ? current + "\n" + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
