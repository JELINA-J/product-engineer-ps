import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Db } from '../src/persistence/db.js';
import { SqliteMemoryRepository } from '../src/persistence/sqlite-memory-repository.js';
import { MemoryService } from '../src/application/memory-service.js';
import { NotFoundError, ValidationError } from '../src/application/errors.js';
import { InvalidTransitionError } from '../src/domain/lifecycle.js';

describe('MemoryService', () => {
  let db: Db;
  let service: MemoryService;

  beforeEach(() => {
    db = createDb(':memory:');
    const repo = new SqliteMemoryRepository(db);
    // Fixed clock + id counter so every test is fully deterministic.
    let tick = 0;
    let seq = 0;
    service = new MemoryService(
      repo,
      () => {
        tick += 1;
        return `2024-01-01T00:00:${String(tick).padStart(2, '0')}.000Z`;
      },
      () => {
        seq += 1;
        return `id-${seq}`;
      }
    );
  });

  // ---- AC1: Store with provenance ----------------------------------------
  it('AC1: stores a memory with stable identity and inspectable provenance', () => {
    const msg = service.createMessage({ scope: 'u1', content: 'I live in Pune.' });
    const { memory } = service.createMemory({
      scope: 'u1',
      content: 'Lives in Pune',
      topic: 'location',
      sourceMessageId: msg.id,
    });

    expect(memory.id).toBeTruthy();
    expect(memory.state).toBe('ACTIVE');

    const provenance = service.getProvenance(memory.id);
    expect(provenance.memory.id).toBe(memory.id);
    expect(provenance.sourceMessage?.content).toBe('I live in Pune.');
    expect(provenance.supersedes).toBeNull();
    expect(provenance.supersededBy).toBeNull();
  });

  it('AC1: rejects creating a memory with a non-existent source message', () => {
    expect(() =>
      service.createMemory({
        scope: 'u1',
        content: 'Lives in Pune',
        topic: 'location',
        sourceMessageId: 'does-not-exist',
      })
    ).toThrow(ValidationError);
  });

  // ---- AC2: Relevant, bounded retrieval ----------------------------------
  it('AC2: returns relevant current memories for a topic, bounded and with evidence', () => {
    const msg1 = service.createMessage({ scope: 'u1', content: 'msg1' });
    const msg2 = service.createMessage({ scope: 'u1', content: 'msg2' });
    const msg3 = service.createMessage({ scope: 'u1', content: 'msg3' });

    service.createMemory({ scope: 'u1', content: 'Lives in Mumbai', topic: 'location', sourceMessageId: msg1.id });
    service.createMemory({ scope: 'u1', content: 'Has a pet dog', topic: 'pet', sourceMessageId: msg2.id });
    service.createMemory({ scope: 'u1', content: 'Enjoys hiking', topic: 'hobby', sourceMessageId: msg3.id });

    const results = service.search('u1', 'Where do I currently live? Mumbai', 5);
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('Lives in Mumbai');
    expect(results[0].evidence.matchedTerms.length).toBeGreaterThan(0);
  });

  it('AC2: bounds results to the requested limit', () => {
    const msg = service.createMessage({ scope: 'u1', content: 'msg' });
    for (let i = 0; i < 8; i++) {
      service.createMemory({
        scope: 'u1',
        content: `Coffee fact number ${i}`,
        topic: 'coffee',
        sourceMessageId: msg.id,
      });
    }
    const results = service.search('u1', 'coffee', 3);
    expect(results.length).toBe(3);
  });

  // ---- AC3: Explicit correction -------------------------------------------
  it('AC3: an explicit supersede makes the new memory current and retires the old one', () => {
    const msg1 = service.createMessage({ scope: 'u1', content: 'I live in Pune.' });
    const { memory: pune } = service.createMemory({
      scope: 'u1',
      content: 'Lives in Pune',
      topic: 'location',
      sourceMessageId: msg1.id,
    });

    const msg2 = service.createMessage({ scope: 'u1', content: 'I moved to Mumbai.' });
    const { oldMemory, newMemory } = service.supersede(pune.id, {
      content: 'Lives in Mumbai',
      sourceMessageId: msg2.id,
    });

    expect(oldMemory.state).toBe('SUPERSEDED');
    expect(oldMemory.supersededByMemoryId).toBe(newMemory.id);
    expect(newMemory.state).toBe('ACTIVE');
    expect(newMemory.supersedesMemoryId).toBe(oldMemory.id);

    // History is preserved, not overwritten.
    expect(oldMemory.content).toBe('Lives in Pune');

    const results = service.search('u1', 'Where do I currently live? Mumbai', 5);
    const ids = results.map((r) => r.memoryId);
    expect(ids).toContain(newMemory.id);
    expect(ids).not.toContain(oldMemory.id);
  });

  it('AC3: cannot supersede a memory that is already superseded', () => {
    const msg1 = service.createMessage({ scope: 'u1', content: 'm1' });
    const { memory: pune } = service.createMemory({
      scope: 'u1',
      content: 'Lives in Pune',
      topic: 'location',
      sourceMessageId: msg1.id,
    });
    const msg2 = service.createMessage({ scope: 'u1', content: 'm2' });
    service.supersede(pune.id, { content: 'Lives in Mumbai', sourceMessageId: msg2.id });

    const msg3 = service.createMessage({ scope: 'u1', content: 'm3' });
    expect(() =>
      service.supersede(pune.id, { content: 'Lives in Delhi', sourceMessageId: msg3.id })
    ).toThrow(InvalidTransitionError);
  });

  // ---- AC4: Ambiguous contradiction ---------------------------------------
  it('AC4: an unlinked conflicting fact does not silently overwrite history', () => {
    const msg1 = service.createMessage({ scope: 'u1', content: 'My favorite color is blue.' });
    const { memory: blue } = service.createMemory({
      scope: 'u1',
      content: 'Favorite color is blue',
      topic: 'favorite_color',
      sourceMessageId: msg1.id,
    });

    const msg2 = service.createMessage({ scope: 'u1', content: 'My favorite color is green.' });
    const { memory: green, conflicts } = service.createMemory({
      scope: 'u1',
      content: 'Favorite color is green',
      topic: 'favorite_color',
      sourceMessageId: msg2.id,
    });

    // Both remain ACTIVE — no silent supersession.
    expect(service.getProvenance(blue.id).memory.state).toBe('ACTIVE');
    expect(service.getProvenance(green.id).memory.state).toBe('ACTIVE');

    // The ambiguity is recorded and inspectable.
    expect(conflicts.length).toBe(1);
    expect(service.getProvenance(green.id).conflicts.length).toBe(1);
    expect(service.getProvenance(blue.id).conflicts.length).toBe(1);

    // Retrieval does not falsely present one as sole current truth: both come
    // back, and each is flagged as ambiguous evidence for the caller.
    const results = service.search('u1', 'favorite color', 5);
    const ids = results.map((r) => r.memoryId);
    expect(ids).toContain(blue.id);
    expect(ids).toContain(green.id);
    for (const r of results) {
      expect(r.evidence.hasAmbiguousConflict).toBe(true);
      expect(r.evidence.conflictingMemoryIds.length).toBeGreaterThan(0);
    }
  });

  it('AC4: restating the same fact is not treated as a conflict', () => {
    const msg1 = service.createMessage({ scope: 'u1', content: 'My favorite color is blue.' });
    service.createMemory({
      scope: 'u1',
      content: 'Favorite color is blue',
      topic: 'favorite_color',
      sourceMessageId: msg1.id,
    });

    const msg2 = service.createMessage({ scope: 'u1', content: 'Yep, still blue.' });
    const { conflicts } = service.createMemory({
      scope: 'u1',
      content: 'favorite color is BLUE', // same fact, different casing/whitespace
      topic: 'favorite_color',
      sourceMessageId: msg2.id,
    });

    expect(conflicts.length).toBe(0);
  });

  // ---- AC5: Deletion --------------------------------------------------------
  it('AC5: deletion removes a memory from retrieval but preserves it for inspection', () => {
    const msg = service.createMessage({ scope: 'u1', content: 'Quick note: meeting cancelled.' });
    const { memory } = service.createMemory({
      scope: 'u1',
      content: 'Meeting is cancelled',
      topic: 'misc',
      sourceMessageId: msg.id,
    });

    const deleted = service.deleteMemory(memory.id);
    expect(deleted.state).toBe('DELETED');

    const results = service.search('u1', 'meeting cancelled', 5);
    expect(results.map((r) => r.memoryId)).not.toContain(memory.id);

    // Still inspectable by ID — deletion is soft, not destructive.
    const provenance = service.getProvenance(memory.id);
    expect(provenance.memory.state).toBe('DELETED');
  });

  it('AC5: cannot delete a memory that is already deleted', () => {
    const msg = service.createMessage({ scope: 'u1', content: 'note' });
    const { memory } = service.createMemory({
      scope: 'u1',
      content: 'Some fact',
      topic: 'misc',
      sourceMessageId: msg.id,
    });
    service.deleteMemory(memory.id);
    expect(() => service.deleteMemory(memory.id)).toThrow(InvalidTransitionError);
  });

  // ---- AC6: Deterministic evaluation ---------------------------------------
  it('AC6: identical queries against identical state return identical results', () => {
    const msg = service.createMessage({ scope: 'u1', content: 'note' });
    service.createMemory({ scope: 'u1', content: 'Favorite color is blue', topic: 'favorite_color', sourceMessageId: msg.id });
    service.createMemory({ scope: 'u1', content: 'Favorite color is green', topic: 'favorite_color', sourceMessageId: msg.id });

    const run1 = service.search('u1', 'favorite color', 5);
    const run2 = service.search('u1', 'favorite color', 5);
    const run3 = service.search('u1', 'favorite color', 5);
    expect(run1).toEqual(run2);
    expect(run2).toEqual(run3);
  });

  // ---- Not-found / validation plumbing -------------------------------------
  it('raises NotFoundError for unknown memory IDs', () => {
    expect(() => service.getProvenance('nope')).toThrow(NotFoundError);
    expect(() => service.deleteMemory('nope')).toThrow(NotFoundError);
    expect(() => service.supersede('nope', { content: 'x', sourceMessageId: 'y' })).toThrow(NotFoundError);
  });

  it('validates required fields on memory creation', () => {
    const msg = service.createMessage({ scope: 'u1', content: 'note' });
    expect(() =>
      service.createMemory({ scope: '', content: 'x', topic: 't', sourceMessageId: msg.id })
    ).toThrow(ValidationError);
    expect(() =>
      service.createMemory({ scope: 'u1', content: '', topic: 't', sourceMessageId: msg.id })
    ).toThrow(ValidationError);
    expect(() =>
      service.createMemory({ scope: 'u1', content: 'x', topic: '', sourceMessageId: msg.id })
    ).toThrow(ValidationError);
  });
});
