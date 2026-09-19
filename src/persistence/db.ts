import Database from 'better-sqlite3';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS source_messages (
  id         TEXT PRIMARY KEY,
  scope      TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_messages_scope ON source_messages(scope);

CREATE TABLE IF NOT EXISTS memories (
  id                     TEXT PRIMARY KEY,
  scope                  TEXT NOT NULL,
  content                TEXT NOT NULL,
  topic                  TEXT NOT NULL,
  source_message_id      TEXT NOT NULL REFERENCES source_messages(id),
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  state                  TEXT NOT NULL CHECK(state IN ('ACTIVE','SUPERSEDED','DELETED')),
  supersedes_memory_id   TEXT REFERENCES memories(id),
  superseded_by_memory_id TEXT REFERENCES memories(id)
);

CREATE INDEX IF NOT EXISTS idx_memories_scope_state ON memories(scope, state);
CREATE INDEX IF NOT EXISTS idx_memories_scope_topic_state ON memories(scope, topic, state);
CREATE INDEX IF NOT EXISTS idx_memories_source_message ON memories(source_message_id);

CREATE TABLE IF NOT EXISTS memory_conflicts (
  id            TEXT PRIMARY KEY,
  memory_id_a   TEXT NOT NULL REFERENCES memories(id),
  memory_id_b   TEXT NOT NULL REFERENCES memories(id),
  type          TEXT NOT NULL CHECK(type IN ('AMBIGUOUS')),
  detected_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conflicts_a ON memory_conflicts(memory_id_a);
CREATE INDEX IF NOT EXISTS idx_conflicts_b ON memory_conflicts(memory_id_b);
`;

export function createDb(path: string): Db {
  const db = new Database(path);
  // WAL is not supported (and not useful) for the in-memory DB used by tests/benchmark.
  if (path !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
