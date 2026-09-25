export interface RenderResult {
  text: string;
  missing: string[];
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function extractVariables(body: string): string[] {
  const set = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER_RE)) {
    const key = match[1];
    if (key) set.add(key);
  }
  return Array.from(set);
}

export function renderTemplate(body: string, vars: Record<string, string>): RenderResult {
  const missing: string[] = [];
  const seenMissing = new Set<string>();
  const text = body.replace(PLACEHOLDER_RE, (raw, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return String(vars[key]);
    }
    if (!seenMissing.has(key)) {
      seenMissing.add(key);
      missing.push(key);
    }
    return raw;
  });
  return { text, missing };
}
