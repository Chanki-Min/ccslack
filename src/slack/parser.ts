export interface ParsedMessage {
  repo: string | null;
  model: string | null;
  session: string | null;
  prompt: string;
}

function extractPrefix(text: string, prefix: string): { value: string | null; remaining: string } {
  const re = new RegExp(`${prefix}:(\\S+)`);
  const match = text.match(re);
  if (!match) return { value: null, remaining: text };
  return { value: match[1] ?? null, remaining: text.replace(re, "").trim() };
}

export function parseMessage(text: string): ParsedMessage {
  // Strip bot mentions like <@U12345>
  const cleaned = text.replace(/<@[A-Z0-9]+>/g, "").trim();

  const { value: repo, remaining: r1 } = extractPrefix(cleaned, "repo");
  const { value: model, remaining: r2 } = extractPrefix(r1, "model");
  const { value: session, remaining: r3 } = extractPrefix(r2, "session");

  const prompt = r3.replace(/\s+/g, " ").trim();

  return { repo, model, session, prompt };
}
