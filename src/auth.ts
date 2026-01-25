/**
 * Authentication and Authorization Client
 *
 * Support for user management, role-based access control, and row-level security.
 */

import type { Connection } from './connection.js';
import { SecurityError } from './errors.js';
import { validateQuery } from './validate.js';

/**
 * User information.
 */
export interface User {
  /** Username */
  username: string;
  /** User roles */
  roles: string[];
  /** Whether the user is active */
  active: boolean;
  /** Creation timestamp */
  createdAt?: Date;
  /** Last login timestamp */
  lastLoginAt?: Date;
  /** User metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Role information.
 */
export interface Role {
  /** Role name */
  name: string;
  /** Role description */
  description?: string;
  /** Permissions granted to this role */
  permissions: Permission[];
  /** Whether the role is a system role */
  system?: boolean;
}

/**
 * Permission definition.
 */
export interface Permission {
  /** Resource type (e.g., 'NODE', 'EDGE', 'GRAPH') */
  resource: string;
  /** Action allowed (e.g., 'READ', 'WRITE', 'DELETE') */
  action: string;
  /** Optional label filter */
  label?: string;
  /** Optional property filters */
  properties?: string[];
}

/**
 * Row-Level Security (RLS) policy.
 */
export interface RLSPolicy {
  /** Policy name */
  name: string;
  /** Target label */
  label: string;
  /** Policy action ('READ', 'WRITE', 'ALL') */
  action: 'READ' | 'WRITE' | 'ALL';
  /** GQL predicate expression */
  predicate: string;
  /** Roles this policy applies to */
  roles?: string[];
  /** Whether the policy is enabled */
  enabled: boolean;
}

/**
 * Options for creating a user.
 */
export interface CreateUserOptions {
  /** Initial password */
  password: string;
  /** Roles to assign */
  roles?: string[];
  /** User metadata */
  metadata?: Record<string, unknown>;
  /** Whether to activate immediately */
  active?: boolean;
}

/**
 * Options for creating a role.
 */
export interface CreateRoleOptions {
  /** Role description */
  description?: string;
  /** Initial permissions */
  permissions?: Permission[];
}

/**
 * Options for creating an RLS policy.
 */
export interface CreateRLSPolicyOptions {
  /** Roles to apply policy to (empty = all roles) */
  roles?: string[];
  /** Whether to enable immediately */
  enabled?: boolean;
}

/**
 * Authentication and authorization client.
 *
 * Provides methods for managing users, roles, and row-level security policies.
 *
 * @example
 * ```typescript
 * const auth = new AuthClient(conn);
 *
 * // Create a user
 * await auth.createUser('alice', { password: 'secret123' });
 *
 * // Create a role
 * await auth.createRole('analyst', {
 *   permissions: [{ resource: 'NODE', action: 'READ' }]
 * });
 *
 * // Assign role to user
 * await auth.assignRole('alice', 'analyst');
 * ```
 */
export class AuthClient {
  private _conn: Connection;

  /**
   * Create a new auth client.
   *
   * @param conn - Connection to use
   */
  constructor(conn: Connection) {
    this._conn = conn;
  }

  // User Management

  /**
   * Create a new user.
   *
   * @param username - Username for the new user
   * @param options - User creation options
   */
  async createUser(username: string, options: CreateUserOptions): Promise<void> {
    this.validateUsername(username);
    this.validatePassword(options.password);

    const roles = options.roles?.join(', ') ?? '';
    const active = options.active !== false ? 'true' : 'false';

    const query = `
      CREATE USER $username
      SET password = $password
      ${roles ? `, roles = [${roles}]` : ''}
      , active = ${active}
    `.trim();

    await this._conn.exec(query, {
      params: {
        username,
        password: options.password,
      },
    });
  }

  /**
   * Delete a user.
   *
   * @param username - Username to delete
   */
  async deleteUser(username: string): Promise<void> {
    this.validateUsername(username);

    await this._conn.exec('DROP USER $username', {
      params: { username },
    });
  }

  /**
   * Get user information.
   *
   * @param username - Username to look up
   * @returns User information or null if not found
   */
  async getUser(username: string): Promise<User | null> {
    this.validateUsername(username);

    const result = await this._conn.queryAll('SHOW USER $username', { params: { username } });

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    if (!row) {
      return null;
    }
    return {
      username: row['username'] as string,
      roles: (row['roles'] as string[]) ?? [],
      active: (row['active'] as boolean) ?? true,
      createdAt: row['created_at'] ? new Date(row['created_at'] as string) : undefined,
      lastLoginAt: row['last_login'] ? new Date(row['last_login'] as string) : undefined,
      metadata: row['metadata'] as Record<string, unknown> | undefined,
    };
  }

  /**
   * List all users.
   *
   * @returns Array of users
   */
  async listUsers(): Promise<User[]> {
    const result = await this._conn.queryAll('SHOW USERS');

    return result.map((row) => ({
      username: row['username'] as string,
      roles: (row['roles'] as string[]) ?? [],
      active: (row['active'] as boolean) ?? true,
      createdAt: row['created_at'] ? new Date(row['created_at'] as string) : undefined,
      lastLoginAt: row['last_login'] ? new Date(row['last_login'] as string) : undefined,
    }));
  }

  /**
   * Change a user's password.
   *
   * @param username - Username
   * @param newPassword - New password
   */
  async changePassword(username: string, newPassword: string): Promise<void> {
    this.validateUsername(username);
    this.validatePassword(newPassword);

    await this._conn.exec('ALTER USER $username SET password = $password', {
      params: { username, password: newPassword },
    });
  }

  /**
   * Activate a user.
   *
   * @param username - Username to activate
   */
  async activateUser(username: string): Promise<void> {
    this.validateUsername(username);

    await this._conn.exec('ALTER USER $username SET active = true', {
      params: { username },
    });
  }

  /**
   * Deactivate a user.
   *
   * @param username - Username to deactivate
   */
  async deactivateUser(username: string): Promise<void> {
    this.validateUsername(username);

    await this._conn.exec('ALTER USER $username SET active = false', {
      params: { username },
    });
  }

  // Role Management

  /**
   * Create a new role.
   *
   * @param name - Role name
   * @param options - Role creation options
   */
  async createRole(name: string, options?: CreateRoleOptions): Promise<void> {
    this.validateRoleName(name);

    let query = 'CREATE ROLE $name';
    if (options?.description) {
      query += ' SET description = $description';
    }

    await this._conn.exec(query, {
      params: {
        name,
        description: options?.description,
      },
    });

    // Add permissions if provided
    if (options?.permissions) {
      for (const perm of options.permissions) {
        await this.grantPermission(name, perm);
      }
    }
  }

  /**
   * Delete a role.
   *
   * @param name - Role name to delete
   */
  async deleteRole(name: string): Promise<void> {
    this.validateRoleName(name);

    await this._conn.exec('DROP ROLE $name', {
      params: { name },
    });
  }

  /**
   * Get role information.
   *
   * @param name - Role name
   * @returns Role information or null if not found
   */
  async getRole(name: string): Promise<Role | null> {
    this.validateRoleName(name);

    const result = await this._conn.queryAll('SHOW ROLE $name', { params: { name } });

    const row = result[0];
    if (!row) {
      return null;
    }
    return {
      name: row['name'] as string,
      description: row['description'] as string | undefined,
      permissions: (row['permissions'] as Permission[]) ?? [],
      system: row['system'] as boolean | undefined,
    };
  }

  /**
   * List all roles.
   *
   * @returns Array of roles
   */
  async listRoles(): Promise<Role[]> {
    const result = await this._conn.queryAll('SHOW ROLES');

    return result.map((row) => ({
      name: row['name'] as string,
      description: row['description'] as string | undefined,
      permissions: (row['permissions'] as Permission[]) ?? [],
      system: row['system'] as boolean | undefined,
    }));
  }

  /**
   * Assign a role to a user.
   *
   * @param username - Username
   * @param roleName - Role to assign
   */
  async assignRole(username: string, roleName: string): Promise<void> {
    this.validateUsername(username);
    this.validateRoleName(roleName);

    await this._conn.exec('GRANT ROLE $role TO $user', {
      params: { role: roleName, user: username },
    });
  }

  /**
   * Revoke a role from a user.
   *
   * @param username - Username
   * @param roleName - Role to revoke
   */
  async revokeRole(username: string, roleName: string): Promise<void> {
    this.validateUsername(username);
    this.validateRoleName(roleName);

    await this._conn.exec('REVOKE ROLE $role FROM $user', {
      params: { role: roleName, user: username },
    });
  }

  /**
   * Grant a permission to a role.
   *
   * @param roleName - Role name
   * @param permission - Permission to grant
   */
  async grantPermission(roleName: string, permission: Permission): Promise<void> {
    this.validateRoleName(roleName);

    let query = `GRANT ${permission.action} ON ${permission.resource}`;
    if (permission.label) {
      query += `:${permission.label}`;
    }
    query += ' TO $role';

    await this._conn.exec(query, {
      params: { role: roleName },
    });
  }

  /**
   * Revoke a permission from a role.
   *
   * @param roleName - Role name
   * @param permission - Permission to revoke
   */
  async revokePermission(roleName: string, permission: Permission): Promise<void> {
    this.validateRoleName(roleName);

    let query = `REVOKE ${permission.action} ON ${permission.resource}`;
    if (permission.label) {
      query += `:${permission.label}`;
    }
    query += ' FROM $role';

    await this._conn.exec(query, {
      params: { role: roleName },
    });
  }

  // Row-Level Security

  /**
   * Create an RLS policy.
   *
   * @param name - Policy name
   * @param label - Target label
   * @param action - Policy action
   * @param predicate - GQL predicate expression
   * @param options - Additional options
   */
  async createRLSPolicy(
    name: string,
    label: string,
    action: 'READ' | 'WRITE' | 'ALL',
    predicate: string,
    options?: CreateRLSPolicyOptions
  ): Promise<void> {
    this.validatePolicyName(name);
    validateQuery(predicate);

    const enabled = options?.enabled !== false ? 'ENABLE' : 'DISABLE';
    const roles = options?.roles?.length ? `FOR ROLES (${options.roles.join(', ')})` : '';

    const query = `
      CREATE POLICY $name ON :${label}
      FOR ${action}
      ${roles}
      USING (${predicate})
      ${enabled}
    `.trim();

    await this._conn.exec(query, {
      params: { name },
    });
  }

  /**
   * Delete an RLS policy.
   *
   * @param name - Policy name
   * @param label - Target label
   */
  async deleteRLSPolicy(name: string, label: string): Promise<void> {
    this.validatePolicyName(name);

    await this._conn.exec(`DROP POLICY $name ON :${label}`, {
      params: { name },
    });
  }

  /**
   * Get RLS policy information.
   *
   * @param name - Policy name
   * @returns Policy information or null if not found
   */
  async getRLSPolicy(name: string): Promise<RLSPolicy | null> {
    this.validatePolicyName(name);

    const result = await this._conn.queryAll('SHOW POLICY $name', { params: { name } });

    const row = result[0];
    if (!row) {
      return null;
    }
    return {
      name: row['name'] as string,
      label: row['label'] as string,
      action: row['action'] as 'READ' | 'WRITE' | 'ALL',
      predicate: row['predicate'] as string,
      roles: row['roles'] as string[] | undefined,
      enabled: (row['enabled'] as boolean) ?? true,
    };
  }

  /**
   * List all RLS policies.
   *
   * @param label - Optional label to filter by
   * @returns Array of policies
   */
  async listRLSPolicies(label?: string): Promise<RLSPolicy[]> {
    const query = label ? `SHOW POLICIES ON :${label}` : 'SHOW POLICIES';
    const result = await this._conn.queryAll(query);

    return result.map((row) => ({
      name: row['name'] as string,
      label: row['label'] as string,
      action: row['action'] as 'READ' | 'WRITE' | 'ALL',
      predicate: row['predicate'] as string,
      roles: row['roles'] as string[] | undefined,
      enabled: (row['enabled'] as boolean) ?? true,
    }));
  }

  /**
   * Enable an RLS policy.
   *
   * @param name - Policy name
   * @param label - Target label
   */
  async enableRLSPolicy(name: string, label: string): Promise<void> {
    this.validatePolicyName(name);

    await this._conn.exec(`ALTER POLICY $name ON :${label} ENABLE`, {
      params: { name },
    });
  }

  /**
   * Disable an RLS policy.
   *
   * @param name - Policy name
   * @param label - Target label
   */
  async disableRLSPolicy(name: string, label: string): Promise<void> {
    this.validatePolicyName(name);

    await this._conn.exec(`ALTER POLICY $name ON :${label} DISABLE`, {
      params: { name },
    });
  }

  // Session Management

  /**
   * Get the current session user.
   *
   * @returns Current username
   */
  async currentUser(): Promise<string> {
    const result = await this._conn.queryAll('RETURN current_user() AS user');
    return (result[0]?.['user'] as string) ?? '';
  }

  /**
   * Get the current session roles.
   *
   * @returns Current roles
   */
  async currentRoles(): Promise<string[]> {
    const result = await this._conn.queryAll('RETURN current_roles() AS roles');
    return (result[0]?.['roles'] as string[]) ?? [];
  }

  /**
   * Check if the current session has a specific permission.
   *
   * @param resource - Resource type
   * @param action - Action to check
   * @param label - Optional label filter
   * @returns Whether permission is granted
   */
  async hasPermission(resource: string, action: string, label?: string): Promise<boolean> {
    const target = label ? `${resource}:${label}` : resource;
    const result = await this._conn.queryAll('RETURN has_permission($target, $action) AS allowed', {
      params: { target, action },
    });
    return (result[0]?.['allowed'] as boolean) ?? false;
  }

  // Validation helpers

  private validateUsername(username: string): void {
    if (!username || username.length === 0) {
      throw new SecurityError({
        type: 'validation',
        message: 'Username cannot be empty',
      });
    }
    if (username.length > 128) {
      throw new SecurityError({
        type: 'validation',
        message: 'Username too long (max 128 characters)',
      });
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(username)) {
      throw new SecurityError({
        type: 'validation',
        message: 'Invalid username format',
      });
    }
  }

  private validatePassword(password: string): void {
    if (!password || password.length < 8) {
      throw new SecurityError({
        type: 'validation',
        message: 'Password must be at least 8 characters',
      });
    }
    if (password.length > 256) {
      throw new SecurityError({
        type: 'validation',
        message: 'Password too long (max 256 characters)',
      });
    }
  }

  private validateRoleName(name: string): void {
    if (!name || name.length === 0) {
      throw new SecurityError({
        type: 'validation',
        message: 'Role name cannot be empty',
      });
    }
    if (name.length > 128) {
      throw new SecurityError({
        type: 'validation',
        message: 'Role name too long (max 128 characters)',
      });
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new SecurityError({
        type: 'validation',
        message: 'Invalid role name format',
      });
    }
  }

  private validatePolicyName(name: string): void {
    if (!name || name.length === 0) {
      throw new SecurityError({
        type: 'validation',
        message: 'Policy name cannot be empty',
      });
    }
    if (name.length > 128) {
      throw new SecurityError({
        type: 'validation',
        message: 'Policy name too long (max 128 characters)',
      });
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new SecurityError({
        type: 'validation',
        message: 'Invalid policy name format',
      });
    }
  }
}

/**
 * Create an auth client from a connection.
 */
export function createAuthClient(conn: Connection): AuthClient {
  return new AuthClient(conn);
}
