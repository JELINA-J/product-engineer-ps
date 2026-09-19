import { Router, type Request, type Response, type NextFunction } from 'express';
import { MemoryService } from '../application/memory-service.js';
import { NotFoundError, ValidationError } from '../application/errors.js';
import { InvalidTransitionError } from '../domain/lifecycle.js';

export function createRouter(service: MemoryService): Router {
  const router = Router();

  const wrap =
    (fn: (req: Request, res: Response) => void) =>
    (req: Request, res: Response, next: NextFunction) => {
      try {
        fn(req, res);
      } catch (err) {
        next(err);
      }
    };

  router.post(
    '/messages',
    wrap((req, res) => {
      const { scope, content } = req.body ?? {};
      const message = service.createMessage({ scope, content });
      res.status(201).json(message);
    })
  );

  router.get(
    '/messages/:id',
    wrap((req, res) => {
      const message = service.getMessage(req.params.id);
      res.json(message);
    })
  );

  router.post(
    '/memories',
    wrap((req, res) => {
      const { scope, content, topic, sourceMessageId } = req.body ?? {};
      const outcome = service.createMemory({ scope, content, topic, sourceMessageId });
      res.status(201).json(outcome);
    })
  );

  router.get(
    '/memories/search',
    wrap((req, res) => {
      const scope = String(req.query.scope ?? '');
      const q = String(req.query.q ?? '');
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      if (!scope) throw new ValidationError('scope query parameter is required');
      const results = service.search(scope, q, limit);
      res.json({ query: q, scope, results });
    })
  );

  router.get(
    '/memories/:id',
    wrap((req, res) => {
      const provenance = service.getProvenance(req.params.id);
      res.json(provenance);
    })
  );

  router.post(
    '/memories/:id/supersede',
    wrap((req, res) => {
      const { content, topic, sourceMessageId } = req.body ?? {};
      const outcome = service.supersede(req.params.id, { content, topic, sourceMessageId });
      res.status(201).json(outcome);
    })
  );

  router.delete(
    '/memories/:id',
    wrap((req, res) => {
      const deleted = service.deleteMemory(req.params.id);
      res.json(deleted);
    })
  );

  // Centralized error mapping — keeps status-code decisions out of every handler.
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.name, message: err.message });
    } else if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.name, message: err.message });
    } else if (err instanceof InvalidTransitionError) {
      res.status(409).json({ error: err.name, message: err.message, from: err.from, to: err.to });
    } else {
      // eslint-disable-next-line no-console
      console.error(err);
      res.status(500).json({ error: 'InternalError', message: 'Unexpected error' });
    }
  });

  return router;
}
