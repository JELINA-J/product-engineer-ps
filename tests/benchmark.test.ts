import { describe, it, expect } from 'vitest';
import { runBenchmark } from '../benchmark/runner.js';

describe('benchmark fixture', () => {
  it('passes all fixed queries deterministically', () => {
    const report = runBenchmark();
    if (report.failed > 0) {
      // Surface failure details in the test output for easy debugging.
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(report.failures, null, 2));
    }
    expect(report.overall).toBe('PASS');
    expect(report.failed).toBe(0);
    expect(report.queryCount).toBeGreaterThanOrEqual(20);
  });

  it('is stable across repeated runs (no hidden randomness/time dependence)', () => {
    const r1 = runBenchmark();
    const r2 = runBenchmark();
    expect(r1).toEqual(r2);
  });
});
