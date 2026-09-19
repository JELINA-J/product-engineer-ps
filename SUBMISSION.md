# Product Engineering Challenge Submission

## Candidate

* **Name:** Jelina J
* **Email:** [jelinaj345@gmail.com](mailto:jelinaj345@gmail.com)
* **GitHub:** https://github.com/JELINA-J/product-engineer-ps
* **Selected problem:** Problem 4 — Trustworthy Long-Term Memory
* **Demo video:** https://drive.google.com/file/d/1xEtPRVq85fbESt4RT9jPeCxKCysKwnyv/view?usp=drive_link

## Run the project

### Prerequisites

* Node.js 22+
* npm
* VS Code REST Client extension (recommended for the API demo)

### Setup

```bash
npm install
```

### Start the API

```bash
npm run dev
```

The API starts at:

```text
http://localhost:3000
```

The application uses SQLite for persistence. By default, the database is created as:

```text
memory.db
```

Optional environment variables:

```text
PORT
MEMORY_DB_PATH
```

No secret environment variables are required for this prototype.

### Run the successful scenario

The API can be exercised using the `api-test.http` file in the repository with the VS Code REST Client extension.

The demonstrated flow is:

1. Create a source message.
2. Store a memory with its source message as provenance.
3. Inspect the memory's provenance.
4. Retrieve a relevant memory.
5. Create a correction message.
6. Explicitly supersede the old memory.
7. Inspect the old memory and its supersession history.
8. Retrieve the corrected fact and verify the superseded fact is not returned as current.
9. Delete the current memory.
10. Retrieve again and verify the deleted memory is no longer returned.

The REST Client requests automatically reuse returned IDs, so the reviewer does not need to manually copy UUIDs between requests.

## Run the tests

```bash
npm test
```

Additional verification:

```bash
npm run typecheck
npm run benchmark
```

Observed test result:

```text
Test Files: 4 passed
Tests: 27 passed
```

The TypeScript typecheck completed without errors.

The deterministic benchmark produced:

```text
=== Trustworthy Memory Benchmark ===
Queries: 25
Passed: 25
Failed: 0
Overall: PASS
```

## Acceptance scenarios and verification

### AC1 — Store with provenance

Implemented.

Each stored memory has a stable ID and retains provenance through its source message. The API provides an endpoint to inspect the source message and memory lifecycle information.

### AC2 — Relevant retrieval

Implemented.

The retrieval endpoint accepts a query and scope and returns a bounded set of active memories together with observable retrieval evidence such as:

* relevance score
* matched terms
* topic match
* query-term coverage
* conflict information

### AC3 — Explicit correction

Implemented.

For example:

```text
I live in Pune.
```

followed by:

```text
I moved to Mumbai.
```

The second statement is explicitly recorded as a correction/supersession. The Pune memory remains in history with `SUPERSEDED` state, while Mumbai becomes the active memory.

Normal current retrieval does not return the superseded Pune memory as a current fact.

### AC4 — Uncertain contradiction

Implemented conservatively.

A conflicting memory is not automatically treated as a correction when there is insufficient evidence that the new statement replaces the old one. The conflict is documented rather than silently rewriting history.

This prevents an uncertain contradiction from automatically destroying or superseding an existing memory.

### AC5 — Deletion

Implemented.

Deleting a memory changes its lifecycle state to `DELETED`, and deleted memories are excluded from normal retrieval.

### AC6 — Deterministic evaluation

Implemented.

The repository contains a fixed benchmark fixture and repeatable benchmark runner.

Verification command:

```bash
npm run benchmark
```

Observed result:

```text
Queries: 25
Passed: 25
Failed: 0
Overall: PASS
```

### Failure / recovery scenario demonstrated

The demo demonstrates recovery through explicit correction.

The original Pune memory is not physically erased when the user moves to Mumbai. Instead, it is marked `SUPERSEDED` and linked to the new Mumbai memory. This preserves the historical source and makes the current state unambiguous.

The demo also shows that deleting the current Mumbai memory removes it from normal retrieval.

The deterministic benchmark additionally verifies the conservative handling of ambiguous conflicts.

## Architecture and data flow

The implementation is separated into API, application, domain, and persistence layers.

### Main components

* **API layer** — Express routes and HTTP error handling.
* **Application layer** — `MemoryService` contains memory creation, retrieval, supersession, deletion, and provenance behaviour.
* **Domain layer** — lifecycle states and valid lifecycle transitions.
* **Persistence layer** — SQLite repository responsible for storing messages, memories, provenance, lifecycle state, and relationships.
* **Benchmark** — fixed fixture and repeatable verification runner.
* **Tests** — automated tests covering storage, lifecycle transitions, retrieval, deletion, and benchmark behaviour.

Simplified data flow:

```text
HTTP Request
     |
     v
Express API
     |
     v
MemoryService
     |
     +------> Domain lifecycle rules
     |
     v
SQLite Repository
     |
     v
Persistent memory state
```

For retrieval:

```text
User Query
    |
    v
MemoryService
    |
    +--> filter by scope
    +--> exclude deleted/superseded memories
    +--> calculate relevance
    +--> collect retrieval evidence
    |
    v
Bounded active memory results
```

## Technology choices

I chose:

* **TypeScript** for type safety and maintainability.
* **Node.js + Express** for a small HTTP API with minimal setup.
* **SQLite** for simple persistent local storage.
* **better-sqlite3** for direct SQLite access.
* **Vitest** for automated testing.
* **VS Code REST Client** for repeatable manual API demonstration.

For this prototype, I intentionally did not use a vector database or a live LLM.

A semantic/vector retrieval system could provide stronger natural-language matching, but lexical retrieval was a deliberate choice for this challenge because it is deterministic, easy to inspect, and does not require external model/API dependencies.

For a production system, I would consider PostgreSQL and potentially an embedding/vector retrieval layer depending on scale and retrieval requirements.

## Important decisions

### 1. Preserve history instead of overwriting memories

A correction does not modify the original memory in place. The old memory is marked `SUPERSEDED` and linked to the replacement.

This makes the memory history auditable.

### 2. Separate explicit correction from uncertain contradiction

The system does not automatically replace an existing fact merely because a new memory appears to conflict with it.

Explicit correction can create a supersession relationship. Uncertain contradictions are documented conservatively.

### 3. Make retrieval explainable

Retrieval results contain evidence showing why a memory was selected, including matched terms, score, topic matching, and query coverage.

This makes retrieval behaviour observable instead of treating it as an unexplained ranking.

## Assumptions and limitations

* The prototype is designed for a single logical scope at a time.
* Retrieval uses deterministic lexical matching rather than embeddings.
* Memory extraction is performed through explicit API operations rather than automatically extracting every fact from arbitrary conversation.
* The prototype uses SQLite rather than a production database cluster.
* Authentication and multi-user authorization are outside the challenge scope.
* There is no polished frontend or complete chat application.
* The system does not attempt to infer every possible contradiction automatically.
* Production-grade sensitive-memory handling, encryption, retention policies, and access controls would require additional design.

## Production and scale

For a production deployment, I would first move persistent storage from local SQLite to a production database such as PostgreSQL.

I would then consider:

* database indexing for scope, lifecycle, topic, and timestamps
* stronger concurrency handling
* authentication and authorization
* encrypted storage and transport
* configurable retention/deletion policies
* audit logging
* embedding/vector retrieval if semantic search becomes necessary
* pagination and stricter retrieval limits
* observability and metrics
* migration/versioning strategy
* stronger handling of sensitive or high-risk memories

The submitted implementation intentionally remains a small deterministic prototype rather than pretending to be a production-scale memory platform.

## AI usage

I used ChatGPT as a development assistant during the implementation.

It contributed to:

* troubleshooting the Node.js/npm environment
* reasoning through implementation and API behaviour
* reviewing implementation decisions
* helping prepare documentation and the demonstration flow

I reviewed the suggestions and verified the implementation through automated tests, typechecking, the deterministic benchmark, and manual API scenarios.

The final implementation was tested locally rather than treating generated suggestions as automatically correct.

## Credibility note

One project I previously built and deployed is **Jeli Dress Shop**, a MERN-based women's fashion e-commerce application.

The project provides product browsing, authentication, cart, wishlist, and order-management functionality.

My contribution included building the application using React, Node.js, Express, and MongoDB, including:

* product catalogue
* JWT-based authentication
* cart functionality
* wishlist functionality
* order management
* REST APIs
* MongoDB persistence
* FAQ chatbot
* deployment and debugging

The application contains a 48-product catalogue and was deployed using Render and MongoDB Atlas.

Public repository:

https://github.com/JELINA-J/JeliDressShop

Deployed application:

https://jelidressshop-2.onrender.com
