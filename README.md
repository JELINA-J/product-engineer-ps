# Trustworthy Long-Term Memory

A small, production-minded memory engine for conversational agents. It stores facts extracted from conversation, tracks where each fact came from, handles corrections and ambiguous contradictions without silently rewriting history, and answers queries with a bounded, deterministic, fully explained retrieval algorithm.

Built for the Caygnus Product Engineering Challenge — Problem 4.

## Problem interpretation

The spec is explicit that this should **not** be a vector-database/LLM demo. The interesting part is memory **semantics**: provenance, lifecycle, supersession, deletion, deterministic retrieval, and honest handling of uncertainty. I took that literally:

* Retrieval is plain lexical/tag overlap over a fixed, documented formula — no embeddings, no LLM calls, nothing non-deterministic.
* The one place where real judgment is required — "does this new fact replace an old one, or just contradict it?" — is handled by a conservative, explicit policy rather than a heuristic guess.
* Every memory always carries provenance back to the message it came from.
* Lifecycle state is a small, centrally enforced state machine rather than a scattered set of boolean flags.

## Setup

### Prerequisites

* Node.js 22+
* npm

No external services, API keys, or network calls are required.

### Install dependencies

```bash
npm install
```

### Run tests

```bash
npm test
```

### Run the deterministic benchmark

```bash
npm run benchmark
```

### Start the REST API

```bash
npm run dev
```

The API starts at:

```text
http://localhost:3000
```

SQLite is used through `better-sqlite3`.

### Environment variables

* `PORT` — API port, default `3000`
* `MEMORY_DB_PATH` — SQLite database path, default `memory.db`

The test and benchmark suites use in-memory SQLite and do not modify the local `memory.db` file.

## Commands

| Command             | What it does                     |
| ------------------- | -------------------------------- |
| `npm install`       | Installs dependencies            |
| `npm test`          | Runs the full Vitest test suite  |
| `npm run benchmark` | Runs the deterministic benchmark |
| `npm run dev`       | Starts the REST API              |
| `npm start`         | Starts the REST API              |
| `npm run typecheck` | Runs TypeScript type checking    |

## Architecture

```text
src/
  domain/
    types.ts                       Memory, SourceMessage, MemoryConflict, RetrievalResult
    tokenize.ts                    Deterministic tokenizer + stopword list
    lifecycle.ts                   ACTIVE/SUPERSEDED/DELETED state machine
    retrieval.ts                   Scoring and ranking algorithm

  persistence/
    db.ts                          SQLite schema + connection
    memory-repository.ts           Repository interface
    sqlite-memory-repository.ts    SQLite implementation

  application/
    memory-service.ts              Business rules:
                                    creation, supersession, deletion,
                                    conflict detection, search orchestration
    errors.ts                      NotFoundError / ValidationError

  api/
    routes.ts                      Thin Express HTTP routes

  index.ts                         Process entrypoint

benchmark/
  fixture.json                     Version-controlled memory/query fixture
  runner.ts                        Deterministic benchmark runner

tests/
  Vitest unit and integration tests
```

### Why this split?

`domain/retrieval.ts` and `domain/lifecycle.ts` have zero dependency on SQLite or HTTP and can therefore be tested directly with plain objects.

`memory-service.ts` is the main application layer containing the business rules and coordinating persistence.

The API layer only translates HTTP requests into service calls and maps service errors to HTTP responses.

## Data model

### `source_messages`

The raw conversational input from which a memory was derived.

| Column       | Notes                   |
| ------------ | ----------------------- |
| `id`         | Stable identity         |
| `scope`      | User/conversation scope |
| `content`    | Raw message text        |
| `created_at` | ISO-8601 timestamp      |

### `memories`

A normalized fact plus lifecycle metadata.

| Column                    | Notes                                                   |
| ------------------------- | ------------------------------------------------------- |
| `id`                      | Stable identity, never reused                           |
| `scope`                   | User/conversation scope                                 |
| `content`                 | Normalized fact text                                    |
| `topic`                   | Free-text key used for conflict detection and retrieval |
| `source_message_id`       | Foreign key to `source_messages.id`                     |
| `created_at`              | Immutable creation timestamp                            |
| `updated_at`              | Updated on lifecycle transitions                        |
| `state`                   | `ACTIVE`, `SUPERSEDED`, or `DELETED`                    |
| `supersedes_memory_id`    | Nullable link to the previous memory                    |
| `superseded_by_memory_id` | Nullable link to the replacement memory                 |

Indexes are provided for:

* `(scope, state)`
* `(scope, topic, state)`

### `memory_conflicts`

Records unresolved ambiguous contradictions without changing either memory's lifecycle state.

| Column        | Notes                 |
| ------------- | --------------------- |
| `id`          | Stable identity       |
| `memory_id_a` | First memory          |
| `memory_id_b` | Conflicting memory    |
| `type`        | Currently `AMBIGUOUS` |
| `detected_at` | ISO-8601 timestamp    |

A memory is never overwritten in place. Its original content, topic, creation time, and provenance remain unchanged.

## Lifecycle / state machine

```text
ACTIVE ──supersede──▶ SUPERSEDED

ACTIVE ──delete──────▶ DELETED
```

The lifecycle rules are enforced centrally in `domain/lifecycle.ts`.

`SUPERSEDED` and `DELETED` have no outgoing transitions.

Therefore a memory cannot be:

* un-superseded
* un-deleted
* superseded twice

Illegal lifecycle transitions produce `InvalidTransitionError`, which the API maps to HTTP `409 Conflict`.

## Retrieval algorithm

Retrieval is implemented as a pure function in `domain/retrieval.ts`.

The algorithm is deterministic:

```text
queryTokens        = tokenize(query)
contentTokens(m)   = tokenize(m.content)
topicTokens(m)     = tokenize(m.topic with "_" replaced by " ")

matchedTerms(m)    = queryTokens ∩ (contentTokens(m) ∪ topicTokens(m))

topicMatch(m)      = true if any queryToken ∈ topicTokens(m)

coverage(m)        = |matchedTerms(m)| / |queryTokens|

score(m)           = min(1, coverage(m) + (topicMatch(m) ? 0.15 : 0))
```

The tokenizer:

* lowercases text
* splits on non-alphanumeric characters
* removes a fixed stopword list
* does not perform stemming

### Eligibility

A memory is only eligible when it has at least one matched term or a topic match.

Zero-overlap memories are never returned.

### Sort order

Results are sorted deterministically by:

1. Score descending
2. `updatedAt` descending
3. `memoryId` ascending

The final ID-based tie-break prevents results from depending on insertion order.

### Lifecycle filtering

Lifecycle filtering happens in `MemoryService.search()`.

Only `ACTIVE` memories are passed to the retrieval algorithm.

This keeps the retrieval scoring function independent from lifecycle semantics.

### Retrieval evidence

Each result contains observable evidence including:

* `matchedTerms`
* `topicMatch`
* `queryTermCoverage`
* relevance `score`
* conflict information

This makes it possible to understand why a memory was selected.

## Provenance design

`GET /memories/:id` works for memories in any lifecycle state.

The response includes:

* the memory and its current lifecycle state
* the originating source message
* the memory it supersedes, if applicable
* the memory that superseded it, if applicable
* conflicts involving the memory

This preserves the complete history of a fact.

For example:

```text
Source message
      ↓
Original memory: "Lives in Pune"
      ↓
SUPERSEDED
      ↓
New memory: "Lives in Mumbai"
```

The original Pune memory remains inspectable instead of being overwritten.

## Correction & supersession policy

### Explicit correction

Correction is performed through:

```text
POST /memories/:id/supersede
```

The caller explicitly identifies which memory is being replaced.

The system then:

1. Marks the old memory as `SUPERSEDED`.
2. Creates a new `ACTIVE` memory.
3. Links the old memory to the new memory.
4. Preserves the original memory content and provenance.

This avoids silently deciding which contradictory fact should replace another.

## Ambiguous contradiction policy

A normal:

```text
POST /memories
```

operation is **not** automatically treated as a correction.

If a new memory has the same `(scope, topic)` as an existing active memory but materially different content, the system conservatively:

1. Does not supersede either memory.
2. Keeps both memories `ACTIVE`.
3. Records a `memory_conflicts` relationship.
4. Returns the conflict information to the caller.
5. Flags the conflict during retrieval.

For example, if two memories say:

```text
Favorite color: blue
Favorite color: green
```

the system does not arbitrarily choose one.

Both remain active and are marked as disputed until an explicit supersession decision is made.

This makes uncertainty visible rather than silently rewriting history.

## Deletion semantics

Deletion is implemented as a **soft delete**.

```text
ACTIVE → DELETED
```

The database row remains available for inspection, but deleted memories are excluded from normal retrieval.

Deleting an already deleted memory produces `409 Conflict` rather than silently succeeding.

## API

| Method   | Path                                | Purpose                                |
| -------- | ----------------------------------- | -------------------------------------- |
| `POST`   | `/messages`                         | Record a source message                |
| `GET`    | `/messages/:id`                     | Inspect a source message               |
| `POST`   | `/memories`                         | Create a memory with provenance        |
| `GET`    | `/memories/:id`                     | Inspect full provenance and lifecycle  |
| `GET`    | `/memories/search?scope=&q=&limit=` | Bounded retrieval over active memories |
| `POST`   | `/memories/:id/supersede`           | Explicitly supersede a memory          |
| `DELETE` | `/memories/:id`                     | Soft-delete a memory                   |

HTTP errors:

* `400` — validation error
* `404` — unknown resource
* `409` — invalid lifecycle transition
* `500` — unexpected server error

## Demo sequence

The repository contains `api-test.http`, which can be executed using the VS Code REST Client extension.

The recording flow demonstrates:

1. Create a source message.
2. Create a memory with provenance.
3. Inspect its provenance.
4. Retrieve the memory.
5. Create a correction message.
6. Explicitly supersede the original memory.
7. Inspect the original memory and its supersession history.
8. Retrieve the corrected memory.
9. Verify the superseded memory is absent from current retrieval.
10. Delete the current memory.
11. Retrieve again and verify the deleted memory is absent.

The REST Client requests automatically reuse returned IDs, so UUIDs do not need to be manually copied between requests.

## Benchmark

`benchmark/fixture.json` contains a fixed, version-controlled evaluation fixture with:

* **31 memories**
* **23 topics**
* **5 explicit supersession chains**
* **2 ambiguous conflict pairs**
* **1 deleted memory**
* **25 fixed queries**
* explicit include/exclude expectations
* a retrieval-result bound for a bounded query

The benchmark is run using:

```bash
npm run benchmark
```

The runner loads the fixture into a fresh in-memory SQLite database and evaluates every query using the same retrieval logic used by the API.

It verifies:

* expected memories are included
* excluded memories are absent
* result limits are respected
* non-`ACTIVE` memories never appear in results

Observed result:

```text
=== Trustworthy Memory Benchmark ===
Queries: 25
Passed: 25
Failed: 0
Overall: PASS
```

## Testing

The project contains 27 automated Vitest tests across four test files.

### Lifecycle tests

`tests/lifecycle.test.ts`

Tests the lifecycle state machine independently.

### Retrieval tests

`tests/retrieval.test.ts`

Tests deterministic scoring, ranking, matching, and candidate filtering without a database.

### Memory service tests

`tests/memory-service.test.ts`

Tests:

* provenance
* relevant retrieval
* bounded retrieval
* explicit correction
* ambiguous contradiction
* deletion
* validation
* not-found behaviour
* invalid lifecycle transitions
* deterministic repeated queries

### Benchmark tests

`tests/benchmark.test.ts`

Tests that:

* the benchmark passes
* repeated benchmark runs produce identical results

All automated tests use in-memory SQLite.

The submission was verified with:

```bash
npm run typecheck
npm test
npm run benchmark
```

Observed results:

```text
npm run typecheck
Clean — no TypeScript errors.

npm test
Test Files: 4 passed
Tests: 27 passed

npm run benchmark
Queries: 25
Passed: 25
Failed: 0
Overall: PASS
```

A live REST API smoke test was also performed manually through the demonstration sequence.

## Technology choices

### TypeScript

Chosen for static typing and maintainability.

### Node.js + Express

Provides a small HTTP API with minimal infrastructure.

### SQLite + better-sqlite3

SQLite keeps the prototype persistent without requiring an external database.

`better-sqlite3` provides a simple synchronous interface suitable for this small prototype.

### Vitest

Used for fast deterministic automated testing.

### Why not embeddings or an LLM?

The challenge focuses on trustworthy memory semantics rather than building a semantic-search demo.

Lexical retrieval provides:

* deterministic behaviour
* no API dependencies
* easy debugging
* observable scoring
* reproducible benchmark results

A production system could add semantic retrieval if the product required stronger paraphrase matching.

## Important decisions

### 1. Preserve history

A correction never overwrites the original memory.

The original memory becomes `SUPERSEDED` and links to the replacement.

### 2. Separate explicit correction from uncertainty

A new contradictory statement is not automatically treated as a correction.

Explicit supersession requires the caller to identify the memory being replaced.

Ambiguous contradictions remain visible as conflicts.

### 3. Make retrieval explainable

Every retrieval result contains evidence describing why it matched.

This makes retrieval behaviour inspectable rather than opaque.

## Assumptions and limitations

* The prototype uses a logical `scope` supplied by the caller.
* Authentication and authorization are outside the challenge scope.
* Memory creation is explicit rather than automatically extracting every fact from arbitrary conversation.
* Retrieval is lexical rather than semantic.
* There is no stemming or synonym handling.
* `topic` is a free-text field supplied by the caller.
* Conflict detection is scoped to `(scope, topic)`.
* Conflicts are currently represented pairwise.
* Search supports a result limit but not cursor-based pagination.
* SQLite is suitable for this prototype but not for large-scale concurrent deployments.
* Production-grade encryption, retention policies, sensitive-memory handling, and access control would require additional design.

## What would change at larger scale?

For a production deployment, I would first move persistent storage from local SQLite to a production database such as PostgreSQL.

I would then consider:

* database indexing for scope, lifecycle, topic, and timestamps
* stronger concurrency handling
* authentication and authorization
* encrypted storage and transport
* configurable retention and deletion policies
* audit logging
* semantic/vector retrieval where justified
* pagination
* observability and metrics
* migration/versioning strategy
* stronger sensitive-memory controls

I would also consider a controlled topic taxonomy or synonym layer, deterministic stemming/lemmatization, an inverted index for retrieval, and conflict sets for handling multiple contradictory memories on the same topic.

The submitted implementation intentionally remains a small deterministic prototype rather than pretending to be a production-scale memory platform.

## AI usage disclosure

This implementation was built with AI assistance (Claude).

AI assistance was used for:

* development troubleshooting
* reasoning about implementation approaches
* reviewing API behaviour
* documentation preparation
* demonstration planning

I reviewed the generated suggestions and verified the implementation through automated tests, TypeScript typechecking, the deterministic benchmark, and manual HTTP API testing.

The final implementation was tested locally rather than treating AI-generated suggestions as automatically correct.
