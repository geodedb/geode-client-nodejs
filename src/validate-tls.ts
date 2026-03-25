/**
 * TLS Certificate Path Validation
 *
 * Security-focused validation for TLS certificate file paths.
 * Extracted from validate.ts for file size management.
 */

import * as fs from 'node:fs';
import { SecurityError } from './errors.js';

/**
 * List of sensitive paths that should never be accessed as TLS certificates.
 * GAP #21: Expanded to include cloud credential paths and user home directories.
 */
const SENSITIVE_PATHS = [
  // System files
  '/etc/passwd',
  '/etc/shadow',
  '/etc/hosts',
  '/proc/',
  '/sys/',
  '/dev/',
  // Root home directory
  '/root/',
  // SSH keys
  '/.ssh/',
  // Kubernetes secrets
  '/var/run/secrets/',
  '/run/secrets/',
  // AWS credentials
  '/.aws/',
  '/credentials',
  // GCP credentials
  '/.config/gcloud/',
  '/gcloud/',
  // Azure credentials
  '/.azure/',
  // Environment files
  '/.env',
  '/env',
];

/**
 * Validate a path string against the sensitive paths blocklist.
 *
 * @param normalizedPath - The normalized path to check
 * @param fieldName - The field name for error messages
 * @throws SecurityError if the path matches a sensitive path
 */
export function checkAgainstBlocklist(normalizedPath: string, fieldName: string): void {
  const lowerPath = normalizedPath.toLowerCase();
  for (const sensitive of SENSITIVE_PATHS) {
    if (lowerPath.includes(sensitive)) {
      throw new SecurityError({
        type: 'input',
        message: `${fieldName} path refers to a restricted system file`,
      });
    }
  }
}

/**
 * Validate a file path for TLS certificate loading (synchronous string checks only).
 *
 * Performs all synchronous validations: empty check, null bytes, path traversal,
 * encoded traversal, and blocklist checks. Does NOT perform filesystem I/O.
 *
 * @param path - The file path to validate
 * @param fieldName - The field name for error messages (e.g., 'tlsCA', 'tlsCert')
 * @throws SecurityError if the path is invalid or contains traversal sequences
 */
export function validateTLSCertPathSync(path: string, fieldName: string): void {
  if (!path) {
    throw new SecurityError({
      type: 'input',
      message: `${fieldName} path cannot be empty`,
    });
  }

  // Check for null bytes
  if (path.includes('\0')) {
    throw new SecurityError({
      type: 'input',
      message: `${fieldName} path contains null bytes`,
    });
  }

  // Normalize the path to detect traversal attempts
  const normalizedPath = path
    .replace(/\\/g, '/') // Normalize Windows paths
    .replace(/\/+/g, '/'); // Remove duplicate slashes

  // Check for directory traversal sequences
  if (normalizedPath.includes('/../') || normalizedPath.endsWith('/..')) {
    throw new SecurityError({
      type: 'input',
      message: `${fieldName} path contains directory traversal sequence`,
    });
  }

  // Check for traversal at start (../something)
  if (normalizedPath.startsWith('../') || normalizedPath === '..') {
    throw new SecurityError({
      type: 'input',
      message: `${fieldName} path contains directory traversal sequence`,
    });
  }

  // Check for encoded traversal attempts
  if (/%2e%2e/i.test(path) || /%252e/i.test(path)) {
    throw new SecurityError({
      type: 'input',
      message: `${fieldName} path contains encoded traversal sequence`,
    });
  }

  // GAP #21: Check original path against expanded blocklist
  checkAgainstBlocklist(normalizedPath, fieldName);
}

/**
 * Validate a file path for TLS certificate loading.
 *
 * Prevents path traversal attacks by ensuring paths are absolute and don't
 * contain directory traversal sequences. Also resolves symlinks to prevent
 * TOCTOU attacks where a symlink points to a restricted file.
 *
 * Uses async filesystem operations to avoid blocking the event loop (PERF-11).
 *
 * @param path - The file path to validate
 * @param fieldName - The field name for error messages (e.g., 'tlsCA', 'tlsCert')
 * @throws SecurityError if the path is invalid or contains traversal sequences
 */
export async function validateTLSCertPath(path: string, fieldName: string): Promise<void> {
  // Run all synchronous string-based validations first
  validateTLSCertPathSync(path, fieldName);

  // GAP #20: Resolve symlinks to prevent TOCTOU attacks
  // If the file exists, check if it's a symlink and validate the resolved path
  // Uses async fs operations to avoid blocking the event loop (PERF-11)
  try {
    await fs.promises.access(path);
    const stats = await fs.promises.lstat(path);
    if (stats.isSymbolicLink()) {
      // Resolve the symlink and validate the target path
      const resolvedPath = await fs.promises.realpath(path);
      const normalizedResolved = resolvedPath.replace(/\\/g, '/').replace(/\/+/g, '/');

      // Check resolved path against blocklist
      checkAgainstBlocklist(normalizedResolved, fieldName);

      // Check resolved path for traversal (shouldn't happen after realpath, but defense-in-depth)
      if (normalizedResolved.includes('/../') || normalizedResolved.endsWith('/..')) {
        throw new SecurityError({
          type: 'input',
          message: `${fieldName} symlink resolves to a path with directory traversal`,
        });
      }
    }
  } catch (e) {
    // If it's already a SecurityError, rethrow it
    if (e instanceof SecurityError) {
      throw e;
    }
    // For other errors (e.g., permission denied, file not found), we continue
    // with just the string validation. The actual file read will fail later
    // with a more specific error.
  }
}
