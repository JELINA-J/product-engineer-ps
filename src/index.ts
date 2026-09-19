import express from 'express';
import { createDb } from './persistence/db.js';
import { SqliteMemoryRepository } from './persistence/sqlite-memory-repository.js';
import { MemoryService } from './application/memory-service.js';
import { createRouter } from './api/routes.js';

const DB_PATH = process.env.MEMORY_DB_PATH ?? 'memory.db';
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const db = createDb(DB_PATH);
const repo = new SqliteMemoryRepository(db);
const service = new MemoryService(repo);

const app = express();
app.use(express.json());
app.use('/', createRouter(service));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Trustworthy memory API listening on http://localhost:${PORT} (db: ${DB_PATH})`);
});
