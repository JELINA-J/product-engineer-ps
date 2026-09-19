import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDb } from '../src/persistence/db.js';
import { SqliteMemoryRepository } from '../src/persistence/sqlite-memory-repository.js';
import { retrieve } from '../src/domain/retrieval.js';
import type { Memory, MemoryConflict, SourceMessage } from '../src/domain/types.js';

interface FixtureQuery {
  query: string;
  include: string[];
  exclude: string[];
  maxResults?: number;
}

interface Fixture {
  scope: string;
  sourceMessages: Array<Omit<SourceMessage, 'scope'>>;
  memories: Array<Omit<Memory, 'scope'>>;
  conflicts: MemoryConflict[];
  queries: FixtureQuery[];
}

export interface QueryFailure {
  query: string;
  reason: string;
}

export interface BenchmarkReport {
  queryCount: number;
  passed: number;
  failed: number;
  failures: QueryFailure[];
  overall: 'PASS' | 'FAIL';
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE_PATH = path.join(__dirname, 'fixture.json');

export function loadFixture(fixturePath: string = DEFAULT_FIXTURE_PATH): Fixture {
  const raw = readFileSync(fixturePath, 'utf-8');
  return JSON.parse(raw) as Fixture;
}

/**
 * Loads the fixture directly through the repository (bypassing the service's
 * create/supersede API) so we can seed memories that are already in
 * SUPERSEDED/DELETED states with pre-established links — exactly the shape
 * a real system would reach after a sequence of corrections over time.
 */
export function seedFixture(fixture: Fixture) {
  const db = createDb(':memory:');
  const repo = new SqliteMemoryRepository(db);

  for (const msg of fixture.sourceMessages) {
    repo.insertMessage({ ...msg, scope: fixture.scope });
  }

  // Two-pass insert: supersession links can point forward (an older memory's
  // supersededByMemoryId references a memory inserted later in the file), so
  // insert all rows with links stripped first, then patch the links in.
  for (const mem of fixture.memories) {
    repo.insertMemory({
      ...mem,
      scope: fixture.scope,
      supersedesMemoryId: null,
      supersededByMemoryId: null,
    });
  }
  for (const mem of fixture.memories) {
    if (mem.supersedesMemoryId || mem.supersededByMemoryId) {
      repo.saveMemory({ ...mem, scope: fixture.scope });
    }
  }

  for (const conflict of fixture.conflicts) {
    repo.insertConflict(conflict);
  }

  return { db, repo };
}

export function runBenchmark(fixturePath?: string): BenchmarkReport {
  const fixture = loadFixture(fixturePath);
  const { repo } = seedFixture(fixture);

  const activeMemories = repo.listActiveByScope(fixture.scope);
  const conflictMap = repo.getConflictMapForScope(fixture.scope);

  const failures: QueryFailure[] = [];

  for (const q of fixture.queries) {
    const results = retrieve(activeMemories, q.query, conflictMap, {
      limit: q.maxResults ?? 5,
    });
    const resultIds = new Set(results.map((r) => r.memoryId));

    // Structural invariant: only ACTIVE memories may ever appear.
    const nonActive = results.filter((r) => r.state !== 'ACTIVE');
    if (nonActive.length > 0) {
      failures.push({
        query: q.query,
        reason: `non-ACTIVE memory returned: ${nonActive.map((r) => r.memoryId).join(', ')}`,
      });
      continue;
    }

    const missingIncludes = q.include.filter((id) => !resultIds.has(id));
    if (missingIncludes.length > 0) {
      failures.push({
        query: q.query,
        reason: `expected memory missing from results: ${missingIncludes.join(', ')}`,
      });
      continue;
    }

    const unexpectedExcludes = q.exclude.filter((id) => resultIds.has(id));
    if (unexpectedExcludes.length > 0) {
      failures.push({
        query: q.query,
        reason: `excluded memory present in results: ${unexpectedExcludes.join(', ')}`,
      });
      continue;
    }

    if (q.maxResults !== undefined && results.length > q.maxResults) {
      failures.push({
        query: q.query,
        reason: `result count ${results.length} exceeds maxResults ${q.maxResults}`,
      });
    }
  }

  const queryCount = fixture.queries.length;
  const failed = failures.length;
  const passed = queryCount - failed;

  return {
    queryCount,
    passed,
    failed,
    failures,
    overall: failed === 0 ? 'PASS' : 'FAIL',
  };
}

function printReport(report: BenchmarkReport): void {
  console.log('=== Trustworthy Memory Benchmark ===');
  console.log(`Queries:  ${report.queryCount}`);
  console.log(`Passed:   ${report.passed}`);
  console.log(`Failed:   ${report.failed}`);
  if (report.failures.length > 0) {
    console.log('\nFailure details:');
    for (const f of report.failures) {
      console.log(`  - [${f.query}] ${f.reason}`);
    }
  }
  console.log(`\nOverall: ${report.overall}`);
}

// Run directly when executed as a script (npm run benchmark), but stay
// import-safe so tests can call runBenchmark() without side effects.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const report = runBenchmark();
  printReport(report);
  process.exit(report.overall === 'PASS' ? 0 : 1);
}
