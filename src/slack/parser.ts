export interface ParsedMessage {
  repo: string | null;
  model: string | null;
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

  // Extract model: prefix
  const modelMatch = cleaned.match(/model:(\S+)/);
  let model: string | null = null;
  if (modelMatch) {
    model = modelMatch[1];
    cleaned = cleaned.replace(/model:\S+/, "").trim();
  }

  // Collapse whitespace
  const prompt = cleaned.replace(/\s+/g, " ").trim();

  return { repo, model, prompt };
}
