// Small, fixed stopword list. Deliberately conservative — we'd rather keep a
// borderline word than risk dropping a term that matters for matching.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'i', 'me', 'my', 'you', 'your', 'do', 'does', 'did', 'doing',
  'in', 'on', 'at', 'to', 'of', 'for', 'with', 'and', 'or', 'it', 'its',
  'this', 'that', 'these', 'those', 'what', 'where', 'when', 'who', 'how',
  'which', 'about', 'am', 'as', 'by',
]);

/**
 * Deterministic tokenizer: lowercase, split on any non-alphanumeric run,
 * drop empty tokens and stopwords. No stemming — kept simple and explainable.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
    .filter((t) => !STOPWORDS.has(t));
}

export function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}
