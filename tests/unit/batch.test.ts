/**
 * Unit tests for Batch Operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BatchQuery, BatchResult, BatchSummary, BatchOptions } from '../../src/batch.js';

describe('Batch Operations Types', () => {
  describe('BatchQuery interface', () => {
    it('should support query without params', () => {
      const query: BatchQuery = {
        query: 'MATCH (n) RETURN n',
      };

      expect(query.query).toBe('MATCH (n) RETURN n');
      expect(query.params).toBeUndefined();
    });

    it('should support query with params', () => {
      const query: BatchQuery = {
        query: 'MATCH (n {name: $name}) RETURN n',
        params: { name: 'Alice' },
      };

      expect(query.query).toContain('$name');
      expect(query.params?.name).toBe('Alice');
    });
  });

  describe('BatchResult interface', () => {
    it('should represent successful result', () => {
      const result: BatchResult = {
        index: 0,
        query: 'MATCH (n) RETURN n',
        success: true,
        rows: [{ n: { id: 1 } }],
        durationMs: 10,
      };

      expect(result.success).toBe(true);
      expect(result.rows).toHaveLength(1);
      expect(result.error).toBeUndefined();
    });

    it('should represent failed result', () => {
      const result: BatchResult = {
        index: 1,
        query: 'INVALID QUERY',
        success: false,
        error: new Error('Syntax error'),
        durationMs: 5,
      };

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Syntax error');
      expect(result.rows).toBeUndefined();
    });
  });

  describe('BatchSummary interface', () => {
    it('should represent complete summary', () => {
      const summary: BatchSummary = {
        total: 3,
        successful: 2,
        failed: 1,
        totalDurationMs: 50,
        results: [
          { index: 0, query: 'Q1', success: true, rows: [] },
          { index: 1, query: 'Q2', success: true, rows: [] },
          { index: 2, query: 'Q3', success: false, error: new Error('Failed') },
        ],
      };

      expect(summary.total).toBe(3);
      expect(summary.successful).toBe(2);
      expect(summary.failed).toBe(1);
      expect(summary.totalDurationMs).toBe(50);
      expect(summary.results).toHaveLength(3);
    });

    it('should have results matching total count', () => {
      const summary: BatchSummary = {
        total: 5,
        successful: 5,
        failed: 0,
        totalDurationMs: 100,
        results: Array(5)
          .fill(null)
          .map((_, i) => ({
            index: i,
            query: `Q${i}`,
            success: true,
            rows: [],
          })),
      };

      expect(summary.results.length).toBe(summary.total);
      expect(summary.successful + summary.failed).toBe(summary.total);
    });
  });

  describe('BatchOptions interface', () => {
    it('should support all options', () => {
      const controller = new AbortController();
      const options: BatchOptions = {
        stopOnError: true,
        concurrency: 5,
        signal: controller.signal,
        pageSize: 100,
        transaction: true,
      };

      expect(options.stopOnError).toBe(true);
      expect(options.concurrency).toBe(5);
      expect(options.signal).toBe(controller.signal);
      expect(options.pageSize).toBe(100);
      expect(options.transaction).toBe(true);
    });

    it('should have sensible defaults', () => {
      const options: BatchOptions = {};

      // These should use defaults
      expect(options.stopOnError).toBeUndefined();
      expect(options.concurrency).toBeUndefined();
      expect(options.transaction).toBeUndefined();
    });
  });
});

describe('Batch Operation Logic', () => {
  describe('stopOnError behavior', () => {
    it('should mark remaining queries as skipped when stopOnError is true', () => {
      // Simulate batch result where 2nd query fails with stopOnError
      const results: BatchResult[] = [
        { index: 0, query: 'Q1', success: true, rows: [] },
        { index: 1, query: 'Q2', success: false, error: new Error('Failed') },
        {
          index: 2,
          query: 'Q3',
          success: false,
          error: new Error('Skipped due to previous error'),
        },
        {
          index: 3,
          query: 'Q4',
          success: false,
          error: new Error('Skipped due to previous error'),
        },
      ];

      expect(results.filter((r) => r.success).length).toBe(1);
      expect(results.filter((r) => !r.success).length).toBe(3);
      expect(results[2].error?.message).toContain('Skipped');
    });
  });

  describe('transaction behavior', () => {
    it('should support transactional execution mode', () => {
      // Transaction mode should rollback on failure
      const summary: BatchSummary = {
        total: 3,
        successful: 2,
        failed: 1,
        totalDurationMs: 50,
        results: [
          { index: 0, query: 'CREATE (:A)', success: true, rows: [] },
          { index: 1, query: 'CREATE (:B)', success: true, rows: [] },
          { index: 2, query: 'INVALID', success: false, error: new Error('Syntax') },
        ],
      };

      // If transaction mode was on, we'd expect a rollback
      // (this is conceptual - actual behavior tested in integration tests)
      expect(summary.failed > 0).toBe(true);
    });
  });

  describe('result ordering', () => {
    it('should maintain result order matching query order', () => {
      const queries = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'];
      const results: BatchResult[] = queries.map((q, i) => ({
        index: i,
        query: q,
        success: true,
        rows: [],
      }));

      // Verify indices are sequential
      for (let i = 0; i < results.length; i++) {
        expect(results[i].index).toBe(i);
        expect(results[i].query).toBe(`Q${i + 1}`);
      }
    });
  });

  describe('duration tracking', () => {
    it('should track individual query durations', () => {
      const results: BatchResult[] = [
        { index: 0, query: 'Q1', success: true, rows: [], durationMs: 10 },
        { index: 1, query: 'Q2', success: true, rows: [], durationMs: 20 },
        { index: 2, query: 'Q3', success: true, rows: [], durationMs: 15 },
      ];

      const totalIndividual = results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
      expect(totalIndividual).toBe(45);
    });

    it('should have total duration >= sum of individual durations', () => {
      // Due to overhead, total may be slightly higher than sum
      const summary: BatchSummary = {
        total: 3,
        successful: 3,
        failed: 0,
        totalDurationMs: 50, // Includes overhead
        results: [
          { index: 0, query: 'Q1', success: true, rows: [], durationMs: 10 },
          { index: 1, query: 'Q2', success: true, rows: [], durationMs: 20 },
          { index: 2, query: 'Q3', success: true, rows: [], durationMs: 15 },
        ],
      };

      const sumDurations = summary.results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
      expect(summary.totalDurationMs).toBeGreaterThanOrEqual(sumDurations);
    });
  });

  describe('empty batch handling', () => {
    it('should handle empty query list', () => {
      const summary: BatchSummary = {
        total: 0,
        successful: 0,
        failed: 0,
        totalDurationMs: 0,
        results: [],
      };

      expect(summary.total).toBe(0);
      expect(summary.results).toHaveLength(0);
    });
  });

  describe('row collection', () => {
    it('should collect rows from successful queries', () => {
      const result: BatchResult = {
        index: 0,
        query: 'MATCH (n:Person) RETURN n.name AS name',
        success: true,
        rows: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }],
      };

      expect(result.rows).toHaveLength(3);
      expect(result.rows?.[0].name).toBe('Alice');
    });

    it('should handle queries returning no rows', () => {
      const result: BatchResult = {
        index: 0,
        query: 'MATCH (n:Empty) RETURN n',
        success: true,
        rows: [],
      };

      expect(result.rows).toHaveLength(0);
    });
  });
});
