import type { Db } from './db.js';
import type {
  CreateMemoryInput,
  CreateMessageInput,
  MemoryRepository,
} from './memory-repository.js';
import type { Memory, MemoryConflict, SourceMessage } from '../domain/types.js';

interface MemoryRow {
  id: string;
  scope: string;
  content: string;
  topic: string;
  source_message_id: string;
  created_at: string;
  updated_at: string;
  state: string;
  supersedes_memory_id: string | null;
  superseded_by_memory_id: string | null;
}

interface MessageRow {
  id: string;
  scope: string;
  content: string;
  created_at: string;
}

interface ConflictRow {
  id: string;
  memory_id_a: string;
  memory_id_b: string;
  type: string;
  detected_at: string;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    scope: row.scope,
    content: row.content,
    topic: row.topic,
    sourceMessageId: row.source_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    state: row.state as Memory['state'],
    supersedesMemoryId: row.supersedes_memory_id,
    supersededByMemoryId: row.superseded_by_memory_id,
  };
}

function rowToMessage(row: MessageRow): SourceMessage {
  return {
    id: row.id,
    scope: row.scope,
    content: row.content,
    createdAt: row.created_at,
  };
}

function rowToConflict(row: ConflictRow): MemoryConflict {
  return {
    id: row.id,
    memoryIdA: row.memory_id_a,
    memoryIdB: row.memory_id_b,
    type: row.type as MemoryConflict['type'],
    detectedAt: row.detected_at,
  };
}

export class SqliteMemoryRepository implements MemoryRepository {
  constructor(private readonly db: Db) {}

  insertMessage(input: CreateMessageInput): SourceMessage {
    this.db
      .prepare(
        `INSERT INTO source_messages (id, scope, content, created_at) VALUES (?, ?, ?, ?)`
      )
      .run(input.id, input.scope, input.content, input.createdAt);
    return { id: input.id, scope: input.scope, content: input.content, createdAt: input.createdAt };
  }

  getMessage(id: string): SourceMessage | null {
    const row = this.db
      .prepare(`SELECT * FROM source_messages WHERE id = ?`)
      .get(id) as MessageRow | undefined;
    return row ? rowToMessage(row) : null;
  }

  insertMemory(input: CreateMemoryInput): Memory {
    this.db
      .prepare(
        `INSERT INTO memories
          (id, scope, content, topic, source_message_id, created_at, updated_at, state, supersedes_memory_id, superseded_by_memory_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.scope,
        input.content,
        input.topic,
        input.sourceMessageId,
        input.createdAt,
        input.updatedAt,
        input.state,
        input.supersedesMemoryId ?? null,
        input.supersededByMemoryId ?? null
      );
    return this.getMemory(input.id)!;
  }

  getMemory(id: string): Memory | null {
    const row = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as
      | MemoryRow
      | undefined;
    return row ? rowToMemory(row) : null;
  }

  saveMemory(memory: Memory): Memory {
    this.db
      .prepare(
        `UPDATE memories SET
          content = ?, topic = ?, state = ?, updated_at = ?,
          supersedes_memory_id = ?, superseded_by_memory_id = ?
         WHERE id = ?`
      )
      .run(
        memory.content,
        memory.topic,
        memory.state,
        memory.updatedAt,
        memory.supersedesMemoryId,
        memory.supersededByMemoryId,
        memory.id
      );
    return this.getMemory(memory.id)!;
  }

  listActiveByScope(scope: string): Memory[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE scope = ? AND state = 'ACTIVE'`)
      .all(scope) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  listActiveByScopeAndTopic(scope: string, topic: string): Memory[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE scope = ? AND topic = ? AND state = 'ACTIVE'`)
      .all(scope, topic) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  listAllByScope(scope: string): Memory[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE scope = ?`)
      .all(scope) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  insertConflict(conflict: MemoryConflict): void {
    this.db
      .prepare(
        `INSERT INTO memory_conflicts (id, memory_id_a, memory_id_b, type, detected_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(conflict.id, conflict.memoryIdA, conflict.memoryIdB, conflict.type, conflict.detectedAt);
  }

  getConflictsForMemory(memoryId: string): MemoryConflict[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memory_conflicts WHERE memory_id_a = ? OR memory_id_b = ?`
      )
      .all(memoryId, memoryId) as ConflictRow[];
    return rows.map(rowToConflict);
  }

  getConflictMapForScope(scope: string): Map<string, string[]> {
    const rows = this.db
      .prepare(
        `SELECT c.* FROM memory_conflicts c
         JOIN memories m ON m.id = c.memory_id_a
         WHERE m.scope = ?`
      )
      .all(scope) as ConflictRow[];

    const map = new Map<string, string[]>();
    for (const row of rows) {
      const a = row.memory_id_a;
      const b = row.memory_id_b;
      if (!map.has(a)) map.set(a, []);
      if (!map.has(b)) map.set(b, []);
      map.get(a)!.push(b);
      map.get(b)!.push(a);
    }
    return map;
  }
}
