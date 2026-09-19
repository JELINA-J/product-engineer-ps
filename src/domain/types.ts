// Core domain types. No I/O, no framework dependencies — kept pure and testable.

export type MemoryState = 'ACTIVE' | 'SUPERSEDED' | 'DELETED';

export interface SourceMessage {
  id: string;
  scope: string;
  content: string;
  createdAt: string; // ISO-8601
}

export interface Memory {
  id: string;
  scope: string;
  content: string;
  topic: string;
  sourceMessageId: string;
  createdAt: string; // ISO-8601, immutable once set
  updatedAt: string; // ISO-8601, bumped on any lifecycle transition
  state: MemoryState;
  /** The memory this one explicitly replaced (if any). */
  supersedesMemoryId: string | null;
  /** The memory that explicitly replaced this one (if any). */
  supersededByMemoryId: string | null;
}

export type ConflictType = 'AMBIGUOUS';

export interface MemoryConflict {
  id: string;
  memoryIdA: string;
  memoryIdB: string;
  type: ConflictType;
  detectedAt: string; // ISO-8601
}

export interface RetrievalEvidence {
  matchedTerms: string[];
  topicMatch: boolean;
  /** Fraction of query terms matched (0..1), rounded to 3 decimals. */
  queryTermCoverage: number;
  hasAmbiguousConflict: boolean;
  conflictingMemoryIds: string[];
}

export interface RetrievalResult {
  memoryId: string;
  content: string;
  topic: string;
  score: number;
  state: MemoryState;
  evidence: RetrievalEvidence;
}

/** Full provenance view returned by GET /memories/:id */
export interface MemoryProvenance {
  memory: Memory;
  sourceMessage: SourceMessage | null;
  supersedes: Memory | null;
  supersededBy: Memory | null;
  conflicts: MemoryConflict[];
}
