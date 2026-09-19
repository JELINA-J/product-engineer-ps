import type { Memory, RetrievalResult } from './types.js';
import { tokenize, tokenSet } from './tokenize.js';

export interface RetrievalOptions {
  limit?: number;
}

/**
 * Deterministic lexical retrieval over a set of ACTIVE memories.
 *
 * SCORING (documented precisely so behavior is explainable, not opaque):
 *
 *   queryTokens      = tokenize(query)                         (deduped)
 *   contentTokens(m)  = tokenize(m.content)
 *   topicTokens(m)    = tokenize(m.topic with "_" -> " ")
 *
 *   matchedTerms(m)  = queryTokens ∩ (contentTokens(m) ∪ topicTokens(m))
 *   topicMatch(m)    = true if any queryToken is in topicTokens(m)
 *   coverage(m)      = |matchedTerms(m)| / |queryTokens|   (0 if queryTokens empty)
 *   score(m)         = min(1, coverage(m) + (topicMatch(m) ? 0.15 : 0))
 *
 * ELIGIBILITY: a memory is only a candidate if matchedTerms(m) is non-empty
 * OR topicMatch(m) is true. Memories with zero lexical overlap are never
 * returned, regardless of limit.
 *
 * SORT ORDER (fully deterministic, no ties left to chance):
 *   1. score DESC
 *   2. updatedAt DESC   (prefer more recently confirmed/corrected facts)
 *   3. memoryId ASC     (stable final tiebreaker)
 *
 * Only memories the caller passes in are ever considered — callers are
 * expected to pass only ACTIVE memories for normal retrieval. This function
 * does not know about lifecycle at all, by design: keeping "what counts as
 * current" out of the scoring logic makes both independently testable.
 */
export function retrieve(
  candidateMemories: Memory[],
  query: string,
  conflictMap: Map<string, string[]>,
  options: RetrievalOptions = {}
): RetrievalResult[] {
  const limit = options.limit ?? 5;
  const queryTokens = Array.from(new Set(tokenize(query)));
  const queryTokenCount = queryTokens.length;

  const results: RetrievalResult[] = [];

  for (const mem of candidateMemories) {
    const contentTokens = tokenSet(mem.content);
    const topicTokens = tokenSet(mem.topic.replace(/_/g, ' '));

    const matchedTerms = queryTokens.filter(
      (t) => contentTokens.has(t) || topicTokens.has(t)
    );
    const topicMatch = queryTokens.some((t) => topicTokens.has(t));

    if (matchedTerms.length === 0 && !topicMatch) {
      continue;
    }

    const coverage = queryTokenCount > 0 ? matchedTerms.length / queryTokenCount : 0;
    const rawScore = coverage + (topicMatch ? 0.15 : 0);
    const score = Math.min(1, Math.round(rawScore * 1000) / 1000);

    const conflictingMemoryIds = conflictMap.get(mem.id) ?? [];

    results.push({
      memoryId: mem.id,
      content: mem.content,
      topic: mem.topic,
      score,
      state: mem.state,
      evidence: {
        matchedTerms,
        topicMatch,
        queryTermCoverage: Math.round(coverage * 1000) / 1000,
        hasAmbiguousConflict: conflictingMemoryIds.length > 0,
        conflictingMemoryIds,
      },
    });
  }

  const byId = new Map(candidateMemories.map((m) => [m.id, m]));

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ua = byId.get(a.memoryId)!.updatedAt;
    const ub = byId.get(b.memoryId)!.updatedAt;
    if (ua !== ub) return ua < ub ? 1 : -1;
    return a.memoryId < b.memoryId ? -1 : 1;
  });

  return results.slice(0, limit);
}
