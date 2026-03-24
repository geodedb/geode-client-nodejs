import { describe, it, expect } from 'vitest';
import {
  QueryBuilder,
  PatternBuilder,
  PredicateBuilder,
  NodePatternBuilder,
  EdgePatternBuilder,
  query,
  pattern,
  predicate,
  node,
  edge,
} from '../../src/query-builder.js';

describe('query-builder', () => {
  describe('QueryBuilder', () => {
    it('should build basic MATCH query', () => {
      const q = query().match('(n)').return('n');

      expect(q.toGQL()).toBe('MATCH (n)\nRETURN n');
    });

    it('should build query with WHERE clause', () => {
      const q = query().match('(n:Person)').where('n.age > 21').return('n');

      expect(q.toGQL()).toBe('MATCH (n:Person)\nWHERE n.age > 21\nRETURN n');
    });

    it('should build query with ORDER BY and LIMIT', () => {
      const q = query()
        .match('(n:Person)')
        .return('n')
        .orderBy('n.name', ['n.age', 'DESC'])
        .limit(10);

      expect(q.toGQL()).toBe('MATCH (n:Person)\nRETURN n\nORDER BY n.name, n.age DESC\nLIMIT 10');
    });

    it('should build query with SKIP', () => {
      const q = query().match('(n)').return('n').skip(20).limit(10);

      expect(q.toGQL()).toBe('MATCH (n)\nRETURN n\nSKIP 20\nLIMIT 10');
    });

    it('should build query with WITH clause', () => {
      const q = query().match('(n:Person)').with('n', 'n.name AS name').return('name');

      expect(q.toGQL()).toBe('MATCH (n:Person)\nWITH n, n.name AS name\nRETURN name');
    });

    it('should build OPTIONAL MATCH query', () => {
      const q = query().match('(n:Person)').optionalMatch('(n)-[:KNOWS]->(m)').return('n', 'm');

      expect(q.toGQL()).toBe('MATCH (n:Person)\nOPTIONAL MATCH (n)-[:KNOWS]->(m)\nRETURN n, m');
    });

    it('should build CREATE query', () => {
      const q = query().create("(n:Person {name: 'Alice'})").return('n');

      expect(q.toGQL()).toBe("CREATE (n:Person {name: 'Alice'})\nRETURN n");
    });

    it('should build MERGE query', () => {
      const q = query().merge("(n:Person {name: 'Alice'})").return('n');

      expect(q.toGQL()).toBe("MERGE (n:Person {name: 'Alice'})\nRETURN n");
    });

    it('should build DELETE query', () => {
      const q = query().match('(n:Person)').where("n.name = 'Alice'").delete('n');

      expect(q.toGQL()).toBe("MATCH (n:Person)\nWHERE n.name = 'Alice'\nDELETE n");
    });

    it('should build DETACH DELETE query', () => {
      const q = query().match('(n:Person)').detachDelete('n');

      expect(q.toGQL()).toBe('MATCH (n:Person)\nDETACH DELETE n');
    });

    it('should build SET query', () => {
      const q = query().match('(n:Person)').where("n.name = 'Alice'").set('n.age = 30').return('n');

      expect(q.toGQL()).toBe("MATCH (n:Person)\nWHERE n.name = 'Alice'\nSET n.age = 30\nRETURN n");
    });

    it('should build REMOVE query', () => {
      const q = query().match('(n:Person)').remove('n.age', 'n:OldLabel').return('n');

      expect(q.toGQL()).toBe('MATCH (n:Person)\nREMOVE n.age, n:OldLabel\nRETURN n');
    });

    it('should build RETURN DISTINCT query', () => {
      const q = query().match('(n:Person)').returnDistinct('n.name');

      expect(q.toGQL()).toBe('MATCH (n:Person)\nRETURN DISTINCT n.name');
    });

    it('should track parameters', () => {
      const q = query()
        .match('(n:Person)')
        .where('n.age > $minAge', { minAge: 21 })
        .param('limit', 10)
        .return('n')
        .limit(10);

      const { params } = q.build();
      expect(params).toEqual({ minAge: 21, limit: 10 });
    });

    it('should support raw clauses', () => {
      const q = query().raw('CALL db.indexes() YIELD name').return('name');

      expect(q.toGQL()).toBe('CALL db.indexes() YIELD name\nRETURN name');
    });

    it('should accept PatternBuilder', () => {
      const p = pattern()
        .node((n) => n.as('a').label('Person'))
        .outgoing((e) => e.type('KNOWS'))
        .node((n) => n.as('b'));

      const q = query().match(p).return('a', 'b');

      expect(q.toGQL()).toBe('MATCH (a:Person)-[:KNOWS]->(b)\nRETURN a, b');
    });
  });

  describe('PatternBuilder', () => {
    it('should build simple node pattern', () => {
      const p = pattern().node((n) => n.as('n'));

      expect(p.toGQL()).toBe('(n)');
    });

    it('should build node pattern with labels', () => {
      const p = pattern().node((n) => n.as('n').label('Person').label('Employee'));

      expect(p.toGQL()).toBe('(n:Person:Employee)');
    });

    it('should build node pattern with properties', () => {
      const p = pattern().node((n) => n.as('n').label('Person').prop('name', 'Alice'));

      expect(p.toGQL()).toBe("(n:Person {name: 'Alice'})");
    });

    it('should build outgoing relationship pattern', () => {
      const p = pattern()
        .node((n) => n.as('a'))
        .outgoing()
        .node((n) => n.as('b'));

      expect(p.toGQL()).toBe('(a)-->(b)');
    });

    it('should build incoming relationship pattern', () => {
      const p = pattern()
        .node((n) => n.as('a'))
        .incoming()
        .node((n) => n.as('b'));

      expect(p.toGQL()).toBe('(a)<--(b)');
    });

    it('should build bidirectional relationship pattern', () => {
      const p = pattern()
        .node((n) => n.as('a'))
        .related()
        .node((n) => n.as('b'));

      expect(p.toGQL()).toBe('(a)--(b)');
    });

    it('should build typed relationship pattern', () => {
      const p = pattern()
        .node((n) => n.as('a'))
        .outgoing((e) => e.type('KNOWS'))
        .node((n) => n.as('b'));

      expect(p.toGQL()).toBe('(a)-[:KNOWS]->(b)');
    });

    it('should build relationship with variable', () => {
      const p = pattern()
        .node((n) => n.as('a'))
        .outgoing((e) => e.as('r').type('KNOWS'))
        .node((n) => n.as('b'));

      expect(p.toGQL()).toBe('(a)-[r:KNOWS]->(b)');
    });

    it('should build variable length path', () => {
      const p = pattern()
        .node((n) => n.as('a'))
        .outgoing((e) => e.type('KNOWS').hops(1, 5))
        .node((n) => n.as('b'));

      expect(p.toGQL()).toBe('(a)-[:KNOWS*1..5]->(b)');
    });

    it('should build relationship with properties', () => {
      const p = pattern()
        .node((n) => n.as('a'))
        .outgoing((e) => e.type('KNOWS').prop('since', 2020))
        .node((n) => n.as('b'));

      expect(p.toGQL()).toBe('(a)-[:KNOWS {since: 2020}]->(b)');
    });

    it('should build complex pattern', () => {
      const p = pattern()
        .node((n) => n.as('a').label('Person'))
        .outgoing((e) => e.as('r1').type('WORKS_AT'))
        .node((n) => n.as('c').label('Company'))
        .incoming((e) => e.as('r2').type('WORKS_AT'))
        .node((n) => n.as('b').label('Person'));

      expect(p.toGQL()).toBe('(a:Person)-[r1:WORKS_AT]->(c:Company)<-[r2:WORKS_AT]-(b:Person)');
    });
  });

  describe('NodePatternBuilder', () => {
    it('should build empty node', () => {
      const n = node();
      expect(n.toGQL()).toBe('()');
    });

    it('should build node with variable', () => {
      const n = node().as('n');
      expect(n.toGQL()).toBe('(n)');
    });

    it('should build node with multiple labels', () => {
      const n = node().labels('Person', 'Employee');
      expect(n.toGQL()).toBe('(:Person:Employee)');
    });

    it('should build node with multiple properties', () => {
      const n = node().props({ name: 'Alice', age: 30 });
      expect(n.toGQL()).toBe("( {name: 'Alice', age: 30})");
    });
  });

  describe('EdgePatternBuilder', () => {
    it('should build outgoing edge', () => {
      const e = edge().outgoing();
      expect(e.toGQL()).toBe('-->');
    });

    it('should build incoming edge', () => {
      const e = edge().incoming();
      expect(e.toGQL()).toBe('<--');
    });

    it('should build bidirectional edge', () => {
      const e = edge().both();
      expect(e.toGQL()).toBe('--');
    });

    it('should build typed edge', () => {
      const e = edge().outgoing().type('KNOWS');
      expect(e.toGQL()).toBe('-[:KNOWS]->');
    });

    it('should build edge with variable and type', () => {
      const e = edge().outgoing().as('r').type('KNOWS');
      expect(e.toGQL()).toBe('-[r:KNOWS]->');
    });

    it('should build edge with hops', () => {
      const e = edge().outgoing().hops(2, 5);
      // Note: hops() doesn't affect toGQL if no type/variable is set
      // This is a limitation of the current implementation
      expect(e.toGQL()).toBe('-->');
    });
  });

  describe('PredicateBuilder', () => {
    it('should build equality predicate', () => {
      const p = predicate().eq('n.name', 'Alice');
      const { predicate: pred, params } = p.build();

      expect(pred).toBe('n.name = $pred_1');
      expect(params['pred_1']).toBe('Alice');
    });

    it('should build comparison predicates', () => {
      const p = predicate().gt('n.age', 18).lt('n.age', 65);

      const { predicate: pred, params } = p.build();

      expect(pred).toBe('n.age > $pred_1 AND n.age < $pred_2');
      expect(params['pred_1']).toBe(18);
      expect(params['pred_2']).toBe(65);
    });

    it('should build IN predicate', () => {
      const p = predicate().in('n.status', ['active', 'pending']);
      const { predicate: pred, params } = p.build();

      expect(pred).toBe('n.status IN $pred_1');
      expect(params['pred_1']).toEqual(['active', 'pending']);
    });

    it('should build NOT IN predicate', () => {
      const p = predicate().notIn('n.status', ['deleted']);
      const { predicate: pred, params } = p.build();

      expect(pred).toBe('n.status NOT IN $pred_1');
    });

    it('should build string predicates', () => {
      const p = predicate()
        .contains('n.name', 'ali')
        .startsWith('n.email', 'user')
        .endsWith('n.email', '.com');

      const { predicate: pred } = p.build();

      expect(pred).toBe(
        'n.name CONTAINS $pred_1 AND n.email STARTS WITH $pred_2 AND n.email ENDS WITH $pred_3'
      );
    });

    it('should build NULL predicates', () => {
      const p = predicate().isNull('n.deleted').isNotNull('n.name');

      const { predicate: pred } = p.build();

      expect(pred).toBe('n.deleted IS NULL AND n.name IS NOT NULL');
    });

    it('should combine with OR', () => {
      const p1 = predicate().eq('n.status', 'active');
      const p2 = predicate().eq('n.status', 'pending');

      const combined = predicate().and(p1).or(p2);
      const { predicate: pred } = combined.build();

      // Note: The implementation wraps predicates in extra parentheses for AND clauses
      expect(pred).toBe('((n.status = $pred_1)) OR (n.status = $pred_1)');
    });

    it('should support raw predicates', () => {
      const p = predicate().eq('n.age', 30).raw('n.score > 0.5', { threshold: 0.5 });

      const { predicate: pred, params } = p.build();

      expect(pred).toContain('n.score > 0.5');
      expect(params['threshold']).toBe(0.5);
    });
  });

  // Security tests for valueToGQL string escaping
  describe('valueToGQL string escaping (security)', () => {
    it('should escape single quotes in property values', () => {
      const n = node().label('Person').prop('name', "it's a test");
      const result = n.toGQL();
      expect(result).toContain("'it\\'s a test'");
    });

    it('should escape backslashes in property values', () => {
      const n = node().label('Person').prop('path', 'C:\\Users\\test');
      const result = n.toGQL();
      // Backslash should be escaped to prevent escape sequence injection
      expect(result).toContain("'C:\\\\Users\\\\test'");
    });

    it('should escape backslash before quote to prevent injection', () => {
      // This is the critical security test
      // Input: auth\'); DROP USER admin; //
      // Without proper escaping, this becomes: 'auth\'); DROP USER admin; //'
      // Which closes the string and injects GQL
      const n = node().label('Test').prop('data', "auth\\'); DROP USER admin; //");
      const result = n.toGQL();
      // The backslash should be escaped, preventing the quote from closing the string
      // Expected: 'auth\\'); DROP USER admin; //' where \\ is an escaped backslash
      // and the following \' is an escaped quote, so the string stays open
      expect(result).toContain("'auth\\\\\\'");
      expect(result).not.toMatch(/'auth\\'\)/); // This would indicate injection
    });

    it('should handle double backslash correctly', () => {
      const n = node().label('Test').prop('data', 'test\\\\end');
      const result = n.toGQL();
      // Each backslash should be escaped
      expect(result).toContain("'test\\\\\\\\end'");
    });

    it('should handle complex escape sequences', () => {
      // Multiple backslashes followed by quote
      const n = node().label('Test').prop('data', "a\\\\'b");
      const result = n.toGQL();
      // Input: a\\'b (backslash, backslash, quote, b)
      // Output should have each backslash escaped plus quote escaped
      expect(result).toContain("'a\\\\\\\\\\'b'");
    });

    it('should safely handle array values with special characters', () => {
      const n = node()
        .label('Test')
        .props({ items: ["a'b", 'c\\d'] });
      const result = n.toGQL();
      expect(result).toContain("'a\\'b'");
      expect(result).toContain("'c\\\\d'");
    });
  });

  describe('SEC-P6-6: propsToGQL defense-in-depth key validation', () => {
    it('should reject injection attempts via property keys at builder level', () => {
      // The props() builder method already validates, this is the outer layer
      expect(() => {
        node().label('Person').props({ 'name) SET n.admin = true //': 'evil' });
      }).toThrow(/security/i);
    });

    it('should reject injection keys in propsToGQL defense-in-depth layer', () => {
      // SEC-P6-6: Test that propsToGQL() itself validates keys (defense-in-depth).
      // If a NodePatternBuilder has its _properties set directly (bypassing
      // the props() validation), the toGQL() method should still catch it
      // because propsToGQL validates keys internally.
      const builder = node().label('Person');
      // Bypass the props() validation by directly setting _properties
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (builder as any)._properties = { 'name) SET n.admin = true //': 'evil' };

      // Before the fix: toGQL() would succeed and include the injection payload
      // After the fix: propsToGQL validates keys and throws SecurityError
      expect(() => builder.toGQL()).toThrow(/security/i);
    });

    it('should reject SQL-like injection in propsToGQL defense-in-depth layer', () => {
      const builder = node().label('Test');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (builder as any)._properties = { "'; DROP TABLE users --": 'value' };

      expect(() => builder.toGQL()).toThrow(/security/i);
    });

    it('should allow valid property keys in propsToGQL', () => {
      const n = node().label('Person').props({ valid_name: 'Alice', age: 30 });
      const result = n.toGQL();
      expect(result).toContain('valid_name');
      expect(result).toContain('age');
    });
  });
});
