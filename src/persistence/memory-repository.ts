import type { Memory, MemoryConflict, MemoryState, SourceMessage } from '../domain/types.js';

export interface CreateMessageInput {
  id: string;
  scope: string;
  content: string;
  createdAt: string;
}

export interface CreateMemoryInput {
  id: string;
  scope: string;
  content: string;
  topic: string;
  sourceMessageId: string;
  createdAt: string;
  updatedAt: string;
  state: MemoryState;
  supersedesMemoryId?: string | null;
  supersededByMemoryId?: string | null;
}

export interface MemoryRepository {
  insertMessage(input: CreateMessageInput): SourceMessage;
  getMessage(id: string): SourceMessage | null;

  insertMemory(input: CreateMemoryInput): Memory;
  getMemory(id: string): Memory | null;

  /** Persist a full replacement of the memory row's mutable fields. */
  saveMemory(memory: Memory): Memory;

  listActiveByScope(scope: string): Memory[];
  listActiveByScopeAndTopic(scope: string, topic: string): Memory[];
  listAllByScope(scope: string): Memory[];

  insertConflict(conflict: MemoryConflict): void;
  getConflictsForMemory(memoryId: string): MemoryConflict[];
  /** Map of memoryId -> list of memoryIds it is in an unresolved ambiguous conflict with. */
  getConflictMapForScope(scope: string): Map<string, string[]>;
}
