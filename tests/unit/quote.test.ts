import { describe, it, expect } from 'vitest';
import { quoteIdent, quoteString, sanitizeGraphName } from '../../src/quote.js';
import { ERR_INVALID_IDENT_MESSAGE, ERR_INVALID_STRING_MESSAGE } from '../../src/errors.js';

describe('sanitizeGraphName', () => {
  const cases: [string, string][] = [
    ['myGraph', 'myGraph'],
    ['my-graph_01', 'my-graph_01'],
    ['bad name!', 'badname'],
    ['', ''],
    ['有害', ''],
    ['   ', ''],
  ];
  it.each(cases)('sanitizeGraphName(%j) === %j', (input, expected) => {
    expect(sanitizeGraphName(input)).toBe(expected);
  });
});

describe('quoteIdent', () => {
  const valid = ['abc', 'ABC', '_foo', 'foo_bar', 'foo-bar', 'foo9', '9starts', '005_add_index'];
  it.each(valid)('accepts %j unchanged', (name) => {
    expect(quoteIdent(name)).toBe(name);
  });

  const invalid = ['', '-starts', 'has space', 'has;semi', 'has\x00null'];
  it.each(invalid)('rejects %j', (name) => {
    expect(() => quoteIdent(name)).toThrow(ERR_INVALID_IDENT_MESSAGE);
  });
});

describe('quoteString', () => {
  const cases: [string, string][] = [
    ['hello', "'hello'"],
    ["it's", "'it''s'"],
    ['back\\slash', "'back\\\\slash'"],
    ["back\\'quote", "'back\\\\''quote'"],
  ];
  it.each(cases)('quoteString(%j) === %j', (input, expected) => {
    expect(quoteString(input)).toBe(expected);
  });

  const controls = ['\n', '\r', '\t', '\x00', '\x1f', '\x7f'];
  it.each(controls)('rejects control char %j', (s) => {
    expect(() => quoteString(s)).toThrow(ERR_INVALID_STRING_MESSAGE);
  });

  it('escapes backslash before single quote (order matters)', () => {
    // input: \'  ->  backslash becomes \\, then ' becomes ''  -> '\\'''
    expect(quoteString("\\'")).toBe("'\\\\'''");
  });
});
