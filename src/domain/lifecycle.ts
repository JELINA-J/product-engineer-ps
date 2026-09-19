import type { MemoryState } from './types.js';

/**
 * The only legal state transitions. Both terminal states (SUPERSEDED,
 * DELETED) have no outgoing transitions — history is never overwritten,
 * revived, or re-superseded once written.
 */
const ALLOWED_TRANSITIONS: Record<MemoryState, MemoryState[]> = {
  ACTIVE: ['SUPERSEDED', 'DELETED'],
  SUPERSEDED: [],
  DELETED: [],
};

export class InvalidTransitionError extends Error {
  readonly from: MemoryState;
  readonly to: MemoryState;

  constructor(from: MemoryState, to: MemoryState) {
    super(`Invalid lifecycle transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: MemoryState, to: MemoryState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: MemoryState, to: MemoryState): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
