import { describe, expect, it } from 'vitest';
import { checkQuantumWorkerHealth, getQuantumWorkerPoolStats, runQuantumWorker } from './quantumProcess.js';

describe('quantum worker pool', () => {
  it('reports idle pool stats with the configured concurrency cap', () => {
    const stats = getQuantumWorkerPoolStats();
    expect(stats.active).toBe(0);
    expect(stats.queued).toBe(0);
    expect(stats.maxConcurrency).toBeGreaterThan(0);
  });

  it('resolves null when the interpreter cannot be spawned', async () => {
    const original = process.env.PYTHON_BIN;
    process.env.PYTHON_BIN = '/no/such/interpreter';
    try {
      const result = await runQuantumWorker({
        mode: 'scenario', scriptPath: '/tmp/does-not-matter.py', payload: {}, timeoutMs: 2000, label: 'Test',
      });
      expect(result).toBeNull();
    } finally {
      if (original === undefined) delete process.env.PYTHON_BIN;
      else process.env.PYTHON_BIN = original;
    }
  });

  it('releases the pool slot after a failed run so the pool stays usable', async () => {
    const original = process.env.PYTHON_BIN;
    process.env.PYTHON_BIN = '/no/such/interpreter';
    try {
      await runQuantumWorker({ mode: 'scenario', scriptPath: '/tmp/x.py', payload: {}, timeoutMs: 2000, label: 'Test' });
      expect(getQuantumWorkerPoolStats().active).toBe(0);
    } finally {
      if (original === undefined) delete process.env.PYTHON_BIN;
      else process.env.PYTHON_BIN = original;
    }
  });

  it('checkQuantumWorkerHealth reports not-ok when the interpreter cannot import qiskit or is missing', async () => {
    const original = process.env.PYTHON_BIN;
    process.env.PYTHON_BIN = '/no/such/interpreter';
    try {
      const result = await checkQuantumWorkerHealth(1000);
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      if (original === undefined) delete process.env.PYTHON_BIN;
      else process.env.PYTHON_BIN = original;
    }
  });
});
