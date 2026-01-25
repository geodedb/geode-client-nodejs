/**
 * Unit tests for Query Explain and Profile
 */

import { describe, it, expect } from 'vitest';
import {
  formatPlan,
  formatProfile,
  type QueryPlan,
  type QueryProfile,
  type PlanOperation,
  type OperationTiming,
} from '../../src/explain.js';

describe('Query Explain and Profile', () => {
  describe('formatPlan', () => {
    it('should format a simple plan', () => {
      const plan: QueryPlan = {
        root: {
          type: 'NodeScan',
          cost: 10.5,
          rows: 100,
        },
        totalCost: 10.5,
        totalRows: 100,
        raw: {},
      };

      const formatted = formatPlan(plan);

      expect(formatted).toContain('NodeScan');
      expect(formatted).toContain('cost=10.50');
      expect(formatted).toContain('rows=100');
      expect(formatted).toContain('Total Cost: 10.50');
      expect(formatted).toContain('Estimated Rows: 100');
    });

    it('should format a plan with nested operations', () => {
      const plan: QueryPlan = {
        root: {
          type: 'Projection',
          cost: 5,
          rows: 10,
          children: [
            {
              type: 'Filter',
              cost: 3,
              rows: 10,
              children: [
                {
                  type: 'NodeScan',
                  cost: 10,
                  rows: 100,
                },
              ],
            },
          ],
        },
        totalCost: 18,
        totalRows: 10,
        raw: {},
      };

      const formatted = formatPlan(plan);

      expect(formatted).toContain('Projection');
      expect(formatted).toContain('  Filter');
      expect(formatted).toContain('    NodeScan');
    });

    it('should format plan with operator name', () => {
      const plan: QueryPlan = {
        root: {
          type: 'Scan',
          operator: 'AllNodesScan',
          cost: 10,
        },
        raw: {},
      };

      const formatted = formatPlan(plan);

      expect(formatted).toContain('Scan (AllNodesScan)');
    });

    it('should format plan with details', () => {
      const plan: QueryPlan = {
        root: {
          type: 'NodeScan',
          details: {
            label: 'Person',
            index: 'idx_person_name',
          },
        },
        raw: {},
      };

      const formatted = formatPlan(plan);

      expect(formatted).toContain('label:');
      expect(formatted).toContain('Person');
      expect(formatted).toContain('index:');
    });

    it('should handle plan without cost/rows', () => {
      const plan: QueryPlan = {
        root: {
          type: 'Unknown',
        },
        raw: {},
      };

      const formatted = formatPlan(plan);

      expect(formatted).toContain('Unknown');
      expect(formatted).not.toContain('cost=');
      expect(formatted).not.toContain('rows=');
    });
  });

  describe('formatProfile', () => {
    it('should format a simple profile', () => {
      const profile: QueryProfile = {
        root: {
          type: 'NodeScan',
          wallTimeMs: 15.5,
          rows: 100,
        },
        totalTimeMs: 15.5,
        totalRows: 100,
        raw: {},
      };

      const formatted = formatProfile(profile);

      expect(formatted).toContain('NodeScan');
      expect(formatted).toContain('15.50ms');
      expect(formatted).toContain('100 rows');
      expect(formatted).toContain('Total Time: 15.50ms');
      expect(formatted).toContain('Rows: 100');
    });

    it('should format profile with nested operations', () => {
      const profile: QueryProfile = {
        root: {
          type: 'Projection',
          wallTimeMs: 2,
          rows: 10,
          children: [
            {
              type: 'Filter',
              wallTimeMs: 3,
              rows: 10,
              children: [
                {
                  type: 'NodeScan',
                  wallTimeMs: 10,
                  rows: 100,
                },
              ],
            },
          ],
        },
        totalTimeMs: 15,
        totalRows: 10,
        raw: {},
      };

      const formatted = formatProfile(profile);

      expect(formatted).toContain('Projection');
      expect(formatted).toContain('  Filter');
      expect(formatted).toContain('    NodeScan');
    });

    it('should format profile with page hits/faults', () => {
      const profile: QueryProfile = {
        root: {
          type: 'NodeScan',
          wallTimeMs: 10,
          pageHits: 50,
          pageFaults: 5,
        },
        totalTimeMs: 10,
        raw: {},
      };

      const formatted = formatProfile(profile);

      expect(formatted).toContain('hits=50');
      expect(formatted).toContain('faults=5');
    });

    it('should format profile with planning/execution times', () => {
      const profile: QueryProfile = {
        root: {
          type: 'NodeScan',
          wallTimeMs: 10,
        },
        totalTimeMs: 15,
        planningTimeMs: 5,
        executionTimeMs: 10,
        raw: {},
      };

      const formatted = formatProfile(profile);

      expect(formatted).toContain('Planning: 5.00ms');
      expect(formatted).toContain('Execution: 10.00ms');
    });

    it('should format profile with memory usage', () => {
      const profile: QueryProfile = {
        root: {
          type: 'NodeScan',
          wallTimeMs: 10,
        },
        totalTimeMs: 10,
        memoryBytes: 1024 * 1024, // 1 MB
        raw: {},
      };

      const formatted = formatProfile(profile);

      expect(formatted).toContain('Memory:');
      expect(formatted).toContain('MB');
    });

    it('should format memory in appropriate units', () => {
      // Test bytes
      let profile: QueryProfile = {
        root: { type: 'X', wallTimeMs: 0 },
        totalTimeMs: 0,
        memoryBytes: 512,
        raw: {},
      };
      expect(formatProfile(profile)).toContain('512.00 B');

      // Test KB
      profile = {
        root: { type: 'X', wallTimeMs: 0 },
        totalTimeMs: 0,
        memoryBytes: 1024 * 2,
        raw: {},
      };
      expect(formatProfile(profile)).toContain('2.00 KB');

      // Test MB
      profile = {
        root: { type: 'X', wallTimeMs: 0 },
        totalTimeMs: 0,
        memoryBytes: 1024 * 1024 * 5,
        raw: {},
      };
      expect(formatProfile(profile)).toContain('5.00 MB');

      // Test GB
      profile = {
        root: { type: 'X', wallTimeMs: 0 },
        totalTimeMs: 0,
        memoryBytes: 1024 * 1024 * 1024 * 2,
        raw: {},
      };
      expect(formatProfile(profile)).toContain('2.00 GB');
    });
  });

  describe('PlanOperation types', () => {
    it('should support all plan operation fields', () => {
      const op: PlanOperation = {
        type: 'NodeScan',
        operator: 'IndexSeek',
        cost: 10,
        rows: 100,
        details: { index: 'idx_name' },
        children: [{ type: 'Child', cost: 5 }],
      };

      expect(op.type).toBe('NodeScan');
      expect(op.operator).toBe('IndexSeek');
      expect(op.cost).toBe(10);
      expect(op.rows).toBe(100);
      expect(op.details?.index).toBe('idx_name');
      expect(op.children).toHaveLength(1);
    });
  });

  describe('OperationTiming types', () => {
    it('should support all timing fields', () => {
      const timing: OperationTiming = {
        type: 'NodeScan',
        wallTimeMs: 10.5,
        cpuTimeMs: 8.2,
        rows: 100,
        pageHits: 50,
        pageFaults: 5,
        children: [{ type: 'Child', wallTimeMs: 2 }],
      };

      expect(timing.type).toBe('NodeScan');
      expect(timing.wallTimeMs).toBe(10.5);
      expect(timing.cpuTimeMs).toBe(8.2);
      expect(timing.rows).toBe(100);
      expect(timing.pageHits).toBe(50);
      expect(timing.pageFaults).toBe(5);
      expect(timing.children).toHaveLength(1);
    });
  });

  describe('QueryPlan types', () => {
    it('should support all plan fields', () => {
      const plan: QueryPlan = {
        root: { type: 'Root' },
        totalCost: 100,
        totalRows: 1000,
        raw: { original: 'data' },
      };

      expect(plan.root.type).toBe('Root');
      expect(plan.totalCost).toBe(100);
      expect(plan.totalRows).toBe(1000);
      expect(plan.raw).toEqual({ original: 'data' });
    });
  });

  describe('QueryProfile types', () => {
    it('should support all profile fields', () => {
      const profile: QueryProfile = {
        root: { type: 'Root', wallTimeMs: 50 },
        totalTimeMs: 50,
        totalRows: 1000,
        planningTimeMs: 5,
        executionTimeMs: 45,
        memoryBytes: 1024 * 1024,
        raw: { original: 'data' },
      };

      expect(profile.root.type).toBe('Root');
      expect(profile.totalTimeMs).toBe(50);
      expect(profile.totalRows).toBe(1000);
      expect(profile.planningTimeMs).toBe(5);
      expect(profile.executionTimeMs).toBe(45);
      expect(profile.memoryBytes).toBe(1024 * 1024);
    });
  });
});
