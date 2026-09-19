import { describe, it, expect } from 'vitest';
import { retrieve } from '../src/domain/retrieval.js';
import type { Memory } from '../src/domain/types.js';

function mem(overrides: Partial<Memory>): Memory {
  return {
    id: 'mem-1',
    scope: 'scope-1',
    content: 'default content',
    topic: 'topic',
    sourceMessageId: 'msg-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    state: 'ACTIVE',
    supersedesMemoryId: null,
    supersededByMemoryId: null,
    ...overrides,
  };
}

describe('retrieve()', () => {
  it('returns memories with lexical overlap, ranked by score', () => {
    const memories = [
      mem({ id: 'a', content: 'Lives in Mumbai', topic: 'location' }),
      mem({ id: 'b', content: 'Enjoys cricket on weekends', topic: 'hobby' }),
    ];
    const results = retrieve(memories, 'Where do I currently live, Mumbai?', new Map());
    expect(results.length).toBe(1);
    expect(results[0].memoryId).toBe('a');
    expect(results[0].evidence.matchedTerms).toContain('mumbai');
  });

  it('excludes memories with zero lexical overlap and no topic match', () => {
    const memories = [mem({ id: 'a', content: 'Enjoys hiking', topic: 'hobby' })];
    const results = retrieve(memories, 'favorite programming language', new Map());
    expect(results).toEqual([]);
  });

  it('gives a topic-match bonus even without content overlap', () => {
    const memories = [mem({ id: 'a', content: 'Works as Software Engineer II', topic: 'job_title' })];
    const results = retrieve(memories, 'What is my job title?', new Map());
    expect(results.length).toBe(1);
    expect(results[0].evidence.topicMatch).toBe(true);
  });

  it('respects the limit parameter', () => {
    const memories = Array.from({ length: 10 }, (_, i) =>
      mem({ id: `m${i}`, content: 'coffee coffee coffee', topic: 'coffee' })
    );
    const results = retrieve(memories, 'coffee', new Map(), { limit: 3 });
    expect(results.length).toBe(3);
  });

  it('is deterministic: identical input produces identical output across repeated calls', () => {
    const memories = [
      mem({ id: 'a', content: 'Favorite color is blue', topic: 'favorite_color', updatedAt: '2024-01-01T00:00:00.000Z' }),
      mem({ id: 'b', content: 'Favorite color is green', topic: 'favorite_color', updatedAt: '2024-01-02T00:00:00.000Z' }),
    ];
    const run1 = retrieve(memories, 'favorite color', new Map());
    const run2 = retrieve(memories, 'favorite color', new Map());
    expect(run1).toEqual(run2);
    // More recently updated memory (b) should sort first on equal score.
    expect(run1[0].memoryId).toBe('b');
  });

  it('surfaces ambiguous conflicts via evidence without hiding either memory', () => {
    const memories = [
      mem({ id: 'a', content: 'Favorite food is biryani', topic: 'favorite_food' }),
      mem({ id: 'b', content: 'Favorite food is pizza', topic: 'favorite_food' }),
    ];
    const conflictMap = new Map([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    const results = retrieve(memories, 'favorite food', conflictMap);
    expect(results.length).toBe(2);
    for (const r of results) {
      expect(r.evidence.hasAmbiguousConflict).toBe(true);
    }
  });

  it('never returns a memory not present in the candidate list (caller controls eligibility)', () => {
    // retrieve() has no lifecycle awareness by design — it trusts the caller
    // to pass only ACTIVE memories. This test documents that contract.
    const supersededOnly = [mem({ id: 'a', content: 'Lives in Pune', topic: 'location', state: 'SUPERSEDED' })];
    const results = retrieve(supersededOnly, 'location', new Map());
    // Still "matches" lexically since retrieve() doesn't filter by state itself —
    // lifecycle filtering is the service's responsibility (see memory-service.test.ts).
    expect(results.length).toBe(1);
    expect(results[0].state).toBe('SUPERSEDED');
  });
});
