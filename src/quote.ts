/**
 * GQL Quoting Helpers
 *
 * Ports geode-client-go quote.go: safe inlining of identifiers, string
 * literals, and graph names into GQL admin statements.
 */

import { ErrInvalidIdent, ErrInvalidString } from './errors.js';

/**
 * Return `name` stripped of any character that is not alphanumeric, underscore,
 * or hyphen, so it can be inlined safely into a USE GRAPH statement.
 */
export function sanitizeGraphName(name: string): string {
  let out = '';
  for (const ch of name) {
    if (
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '_' ||
      ch === '-'
    ) {
      out += ch;
    }
  }
  return out;
}

/**
 * Validate and return `name` in a form safe to inline into a GQL admin
 * statement that takes an identifier. Valid identifiers consist of letters,
 * digits, underscore, and hyphen, and must not start with a hyphen. Digits are
 * permitted at any position. Throws ErrInvalidIdent for empty or invalid input.
 */
export function quoteIdent(name: string): string {
  if (name === '') {
    throw ErrInvalidIdent();
  }
  let first = true;
  for (const ch of name) {
    if (
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      ch === '_' ||
      (ch >= '0' && ch <= '9')
    ) {
      // always allowed (digits anywhere)
    } else if (ch === '-') {
      if (first) {
        throw ErrInvalidIdent();
      }
    } else {
      throw ErrInvalidIdent();
    }
    first = false;
  }
  return name;
}

/**
 * Return `s` wrapped in GQL single quotes with backslashes and single quotes
 * escaped. ASCII control characters (< 0x20 or 0x7F) are rejected with
 * ErrInvalidString. Escape order: backslash first (\ -> \\), then single
 * quotes (' -> '').
 */
export function quoteString(s: string): string {
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) {
      throw ErrInvalidString();
    }
  }
  const escaped = s.replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${escaped}'`;
}
