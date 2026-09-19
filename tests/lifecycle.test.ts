import { describe, it, expect } from 'vitest';
import { assertTransition, canTransition, InvalidTransitionError } from '../src/domain/lifecycle.js';

describe('lifecycle state machine', () => {
  it('allows ACTIVE -> SUPERSEDED', () => {
    expect(canTransition('ACTIVE', 'SUPERSEDED')).toBe(true);
    expect(() => assertTransition('ACTIVE', 'SUPERSEDED')).not.toThrow();
  });

  it('allows ACTIVE -> DELETED', () => {
    expect(canTransition('ACTIVE', 'DELETED')).toBe(true);
  });

  it('forbids any transition out of SUPERSEDED', () => {
    expect(canTransition('SUPERSEDED', 'ACTIVE')).toBe(false);
    expect(canTransition('SUPERSEDED', 'DELETED')).toBe(false);
    expect(() => assertTransition('SUPERSEDED', 'DELETED')).toThrow(InvalidTransitionError);
  });

  it('forbids any transition out of DELETED', () => {
    expect(canTransition('DELETED', 'ACTIVE')).toBe(false);
    expect(canTransition('DELETED', 'SUPERSEDED')).toBe(false);
    expect(() => assertTransition('DELETED', 'ACTIVE')).toThrow(InvalidTransitionError);
  });

  it('forbids a no-op transition to the same state', () => {
    expect(canTransition('ACTIVE', 'ACTIVE')).toBe(false);
  });
});
