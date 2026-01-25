/**
 * Query Builder Benchmarks
 *
 * Measures performance of query builder operations.
 */

import { describe, bench } from 'vitest';
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

describe('Query Builder Benchmarks', () => {
  describe('Factory Functions', () => {
    bench('create QueryBuilder', () => {
      query();
    });

    bench('create PatternBuilder', () => {
      pattern();
    });

    bench('create PredicateBuilder', () => {
      predicate();
    });

    bench('create NodePatternBuilder', () => {
      node();
    });

    bench('create EdgePatternBuilder', () => {
      edge();
    });
  });

  describe('Node Patterns', () => {
    bench('simple node', () => {
      node().as('n').toGQL();
    });

    bench('node with label', () => {
      node().as('n').label('Person').toGQL();
    });

    bench('node with multiple labels', () => {
      node().as('n').labels('Person', 'Employee', 'Manager').toGQL();
    });

    bench('node with properties', () => {
      node().as('n').label('Person').props({ name: 'Alice', age: 30 }).toGQL();
    });

    bench('node with many properties', () => {
      node()
        .as('n')
        .label('Person')
        .props({
          name: 'Alice',
          age: 30,
          email: 'alice@example.com',
          active: true,
          score: 95.5,
          department: 'Engineering',
        })
        .toGQL();
    });
  });

  describe('Edge Patterns', () => {
    bench('simple outgoing edge', () => {
      edge().outgoing().toGQL();
    });

    bench('typed edge', () => {
      edge().outgoing().type('KNOWS').toGQL();
    });

    bench('edge with variable', () => {
      edge().outgoing().as('r').type('KNOWS').toGQL();
    });

    bench('edge with hops', () => {
      edge().outgoing().type('KNOWS').hops(1, 5).toGQL();
    });

    bench('edge with properties', () => {
      edge().outgoing().as('r').type('KNOWS').props({ since: 2020 }).toGQL();
    });
  });

  describe('Pattern Composition', () => {
    bench('simple path (2 nodes, 1 edge)', () => {
      pattern()
        .node((n) => n.as('a'))
        .outgoing()
        .node((n) => n.as('b'))
        .toGQL();
    });

    bench('typed path', () => {
      pattern()
        .node((n) => n.as('a').label('Person'))
        .outgoing((e) => e.type('KNOWS'))
        .node((n) => n.as('b').label('Person'))
        .toGQL();
    });

    bench('long path (4 nodes, 3 edges)', () => {
      pattern()
        .node((n) => n.as('a').label('Person'))
        .outgoing((e) => e.type('KNOWS'))
        .node((n) => n.as('b').label('Person'))
        .outgoing((e) => e.type('WORKS_AT'))
        .node((n) => n.as('c').label('Company'))
        .incoming((e) => e.type('WORKS_AT'))
        .node((n) => n.as('d').label('Person'))
        .toGQL();
    });

    bench('complex path with properties', () => {
      pattern()
        .node((n) => n.as('a').label('Person').props({ name: 'Alice' }))
        .outgoing((e) => e.as('r1').type('KNOWS').props({ since: 2020 }))
        .node((n) => n.as('b').labels('Person', 'Developer'))
        .toGQL();
    });
  });

  describe('Predicate Building', () => {
    bench('single equality', () => {
      predicate().eq('n.name', 'Alice').build();
    });

    bench('multiple comparisons', () => {
      predicate().gt('n.age', 21).lt('n.age', 65).eq('n.active', true).build();
    });

    bench('string predicates', () => {
      predicate()
        .contains('n.name', 'ali')
        .startsWith('n.email', 'user')
        .endsWith('n.email', '.com')
        .build();
    });

    bench('IN predicate', () => {
      predicate().in('n.status', ['active', 'pending', 'review']).build();
    });

    bench('NULL predicates', () => {
      predicate().isNull('n.deleted').isNotNull('n.email').build();
    });

    bench('complex combined predicate', () => {
      const p1 = predicate().eq('n.type', 'person').gt('n.age', 21);
      const p2 = predicate().eq('n.type', 'company');
      predicate().and(p1).or(p2).build();
    });
  });

  describe('Query Building', () => {
    bench('simple MATCH/RETURN', () => {
      query().match('(n)').return('n').toGQL();
    });

    bench('MATCH with WHERE', () => {
      query().match('(n:Person)').where('n.age > 21').return('n').toGQL();
    });

    bench('MATCH with ORDER BY and LIMIT', () => {
      query()
        .match('(n:Person)')
        .return('n')
        .orderBy('n.name', ['n.age', 'DESC'])
        .limit(10)
        .toGQL();
    });

    bench('complex query', () => {
      query()
        .match('(a:Person)-[:KNOWS]->(b:Person)')
        .where('a.age > 21')
        .with('a', 'b', 'count(*) AS cnt')
        .orderBy(['cnt', 'DESC'])
        .limit(10)
        .return('a.name', 'collect(b.name) AS friends')
        .toGQL();
    });

    bench('query with PatternBuilder', () => {
      query()
        .match(
          pattern()
            .node((n) => n.as('a').label('Person'))
            .outgoing((e) => e.type('KNOWS'))
            .node((n) => n.as('b'))
        )
        .return('a', 'b')
        .toGQL();
    });

    bench('query with PredicateBuilder', () => {
      query()
        .match('(n:Person)')
        .where(predicate().gt('n.age', 21).isNotNull('n.email'))
        .return('n')
        .toGQL();
    });

    bench('full query build()', () => {
      query()
        .match('(n:Person)')
        .where('n.age > $minAge', { minAge: 21 })
        .param('limit', 10)
        .return('n')
        .limit(10)
        .build();
    });
  });

  describe('CREATE Queries', () => {
    bench('simple CREATE', () => {
      query().create("(n:Person {name: 'Alice'})").return('n').toGQL();
    });

    bench('CREATE with PatternBuilder', () => {
      query()
        .create(pattern().node((n) => n.label('Person').props({ name: 'Alice', age: 30 })))
        .return('n')
        .toGQL();
    });
  });

  describe('MERGE Queries', () => {
    bench('simple MERGE', () => {
      query().merge("(n:Person {name: 'Alice'})").return('n').toGQL();
    });
  });

  describe('DELETE Queries', () => {
    bench('DELETE', () => {
      query().match('(n:Person)').where("n.name = 'Alice'").delete('n').toGQL();
    });

    bench('DETACH DELETE', () => {
      query().match('(n:Person)').detachDelete('n').toGQL();
    });
  });

  describe('SET/REMOVE Queries', () => {
    bench('SET properties', () => {
      query().match('(n:Person)').set('n.age = 31', 'n.updated = timestamp()').return('n').toGQL();
    });

    bench('REMOVE properties', () => {
      query().match('(n:Person)').remove('n.temporary', 'n:OldLabel').return('n').toGQL();
    });
  });
});
