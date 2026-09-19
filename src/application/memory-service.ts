import { randomUUID } from 'node:crypto';
import type { MemoryRepository } from '../persistence/memory-repository.js';
import type {
  Memory,
  MemoryConflict,
  MemoryProvenance,
  RetrievalResult,
  SourceMessage,
} from '../domain/types.js';
import { assertTransition, InvalidTransitionError } from '../domain/lifecycle.js';
import { retrieve } from '../domain/retrieval.js';
import { NotFoundError, ValidationError } from './errors.js';

export { InvalidTransitionError };

export interface CreateMessageParams {
  scope: string;
  content: string;
}

export interface CreateMemoryParams {
  scope: string;
  content: string;
  topic: string;
  sourceMessageId: string;
}

export interface SupersedeParams {
  content: string;
  topic?: string;
  sourceMessageId: string;
}

export interface CreateMemoryOutcome {
  memory: Memory;
  /** Ambiguous conflicts newly recorded against pre-existing ACTIVE memories, if any. */
  conflicts: MemoryConflict[];
}

export interface SupersedeOutcome {
  oldMemory: Memory;
  newMemory: Memory;
}

/** Normalizes content for equality comparison only — never stored. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export class MemoryService {
  constructor(
    private readonly repo: MemoryRepository,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly idGen: () => string = randomUUID
  ) {}

  createMessage(params: CreateMessageParams): SourceMessage {
    if (!params.scope || !params.scope.trim()) {
      throw new ValidationError('scope is required');
    }
    if (!params.content || !params.content.trim()) {
      throw new ValidationError('content is required');
    }
    return this.repo.insertMessage({
      id: this.idGen(),
      scope: params.scope,
      content: params.content,
      createdAt: this.now(),
    });
  }

  getMessage(id: string): SourceMessage {
    const msg = this.repo.getMessage(id);
    if (!msg) throw new NotFoundError(`source message not found: ${id}`);
    return msg;
  }

  /**
   * Create a new memory. If an ACTIVE memory already exists in the same
   * (scope, topic) with materially different content, this is treated as
   * an AMBIGUOUS conflict (see docs/README "ambiguous contradiction
   * policy"): both memories remain ACTIVE, and a conflict record is
   * created linking them. We never silently supersede here — supersession
   * only ever happens through the explicit supersede() call below.
   */
  createMemory(params: CreateMemoryParams): CreateMemoryOutcome {
    this.validateMemoryInput(params);

    const sourceMessage = this.repo.getMessage(params.sourceMessageId);
    if (!sourceMessage) {
      throw new ValidationError(`sourceMessageId does not exist: ${params.sourceMessageId}`);
    }

    const timestamp = this.now();
    const memory = this.repo.insertMemory({
      id: this.idGen(),
      scope: params.scope,
      content: params.content,
      topic: params.topic,
      sourceMessageId: params.sourceMessageId,
      createdAt: timestamp,
      updatedAt: timestamp,
      state: 'ACTIVE',
    });

    const conflicts = this.detectAndRecordConflicts(memory);

    return { memory, conflicts };
  }

  /**
   * Explicit correction. The caller identifies exactly which memory is
   * being replaced, so there is no ambiguity: the old memory transitions
   * ACTIVE -> SUPERSEDED and a new ACTIVE memory is created, linked both
   * ways. The old memory's content/timestamps are never altered — only
   * its lifecycle fields change.
   */
  supersede(oldMemoryId: string, params: SupersedeParams): SupersedeOutcome {
    const oldMemory = this.repo.getMemory(oldMemoryId);
    if (!oldMemory) throw new NotFoundError(`memory not found: ${oldMemoryId}`);

    assertTransition(oldMemory.state, 'SUPERSEDED');

    if (!params.content || !params.content.trim()) {
      throw new ValidationError('content is required');
    }
    const sourceMessage = this.repo.getMessage(params.sourceMessageId);
    if (!sourceMessage) {
      throw new ValidationError(`sourceMessageId does not exist: ${params.sourceMessageId}`);
    }

    const topic = params.topic ?? oldMemory.topic;
    const timestamp = this.now();

    const newMemory = this.repo.insertMemory({
      id: this.idGen(),
      scope: oldMemory.scope,
      content: params.content,
      topic,
      sourceMessageId: params.sourceMessageId,
      createdAt: timestamp,
      updatedAt: timestamp,
      state: 'ACTIVE',
      supersedesMemoryId: oldMemory.id,
    });

    const updatedOld: Memory = {
      ...oldMemory,
      state: 'SUPERSEDED',
      supersededByMemoryId: newMemory.id,
      updatedAt: timestamp,
    };
    const savedOld = this.repo.saveMemory(updatedOld);

    return { oldMemory: savedOld, newMemory };
  }

  deleteMemory(id: string): Memory {
    const memory = this.repo.getMemory(id);
    if (!memory) throw new NotFoundError(`memory not found: ${id}`);

    assertTransition(memory.state, 'DELETED');

    const updated: Memory = { ...memory, state: 'DELETED', updatedAt: this.now() };
    return this.repo.saveMemory(updated);
  }

  /** Provenance inspection: works regardless of lifecycle state. */
  getProvenance(id: string): MemoryProvenance {
    const memory = this.repo.getMemory(id);
    if (!memory) throw new NotFoundError(`memory not found: ${id}`);

    const sourceMessage = this.repo.getMessage(memory.sourceMessageId);
    const supersedes = memory.supersedesMemoryId
      ? this.repo.getMemory(memory.supersedesMemoryId)
      : null;
    const supersededBy = memory.supersededByMemoryId
      ? this.repo.getMemory(memory.supersededByMemoryId)
      : null;
    const conflicts = this.repo.getConflictsForMemory(memory.id);

    return { memory, sourceMessage, supersedes, supersededBy, conflicts };
  }

  /**
   * Bounded, deterministic retrieval over ACTIVE memories only. See
   * domain/retrieval.ts for the exact scoring algorithm.
   */
  search(scope: string, query: string, limit = 5): RetrievalResult[] {
    if (!query || !query.trim()) {
      throw new ValidationError('q (query) is required');
    }
    const activeMemories = this.repo.listActiveByScope(scope);
    const conflictMap = this.repo.getConflictMapForScope(scope);
    return retrieve(activeMemories, query, conflictMap, { limit });
  }

  private validateMemoryInput(params: CreateMemoryParams): void {
    if (!params.scope || !params.scope.trim()) throw new ValidationError('scope is required');
    if (!params.content || !params.content.trim()) throw new ValidationError('content is required');
    if (!params.topic || !params.topic.trim()) throw new ValidationError('topic is required');
    if (!params.sourceMessageId || !params.sourceMessageId.trim()) {
      throw new ValidationError('sourceMessageId is required');
    }
  }

  private detectAndRecordConflicts(memory: Memory): MemoryConflict[] {
    const siblings = this.repo
      .listActiveByScopeAndTopic(memory.scope, memory.topic)
      .filter((m) => m.id !== memory.id);

    const conflicts: MemoryConflict[] = [];
    const normalizedNew = normalize(memory.content);

    for (const sibling of siblings) {
      if (normalize(sibling.content) === normalizedNew) {
        // Same fact restated — not a conflict, nothing to record.
        continue;
      }
      const conflict: MemoryConflict = {
        id: this.idGen(),
        memoryIdA: sibling.id,
        memoryIdB: memory.id,
        type: 'AMBIGUOUS',
        detectedAt: this.now(),
      };
      this.repo.insertConflict(conflict);
      conflicts.push(conflict);
    }

    return conflicts;
  }
}
