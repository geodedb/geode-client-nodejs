/**
 * Unit tests for Authentication and Authorization Client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AuthClient,
  type User,
  type Role,
  type Permission,
  type RLSPolicy,
} from '../../src/auth.js';
import type { Connection } from '../../src/connection.js';
import { SecurityError } from '../../src/errors.js';

// Mock connection
const createMockConnection = () => ({
  query: vi.fn().mockResolvedValue({ rows: [], columns: [] }),
  queryAll: vi.fn().mockResolvedValue([]),
  exec: vi.fn().mockResolvedValue(undefined),
  state: 'idle' as const,
});

describe('AuthClient', () => {
  let mockConn: ReturnType<typeof createMockConnection>;
  let auth: AuthClient;

  beforeEach(() => {
    mockConn = createMockConnection();
    auth = new AuthClient(mockConn as unknown as Connection);
  });

  describe('User Management', () => {
    describe('createUser', () => {
      it('should create a user with password', async () => {
        await auth.createUser('alice', { password: 'securePass123' });

        expect(mockConn.exec).toHaveBeenCalled();
        const callArgs = mockConn.exec.mock.calls[0];
        expect(callArgs[0]).toContain('CREATE USER');
        expect(callArgs[1].params.username).toBe('alice');
        expect(callArgs[1].params.password).toBe('securePass123');
      });

      it('should reject empty username', async () => {
        await expect(auth.createUser('', { password: 'secret123' })).rejects.toThrow(SecurityError);
      });

      it('should reject too long username', async () => {
        const longName = 'a'.repeat(129);
        await expect(auth.createUser(longName, { password: 'secret123' })).rejects.toThrow(
          'Username too long'
        );
      });

      it('should reject invalid username format', async () => {
        await expect(auth.createUser('123invalid', { password: 'secret123' })).rejects.toThrow(
          'Invalid username format'
        );
      });

      it('should reject short password', async () => {
        await expect(auth.createUser('alice', { password: 'short' })).rejects.toThrow(
          'at least 8 characters'
        );
      });

      it('should reject empty password', async () => {
        await expect(auth.createUser('alice', { password: '' })).rejects.toThrow(
          'at least 8 characters'
        );
      });

      it('should reject too long password', async () => {
        const longPass = 'a'.repeat(257);
        await expect(auth.createUser('alice', { password: longPass })).rejects.toThrow(
          'Password too long'
        );
      });

      // GAP #19: Regex character escaping tests
      describe('password policy special character escaping', () => {
        it('should accept password with hyphen when hyphen is in specialChars', async () => {
          // The hyphen should be treated literally, not as a character range
          auth.setPasswordPolicy({
            requireSpecialChar: true,
            specialChars: 'a-z!@#', // Hyphen should match literal '-', not a-z range
          });

          await auth.createUser('alice', {
            password: 'Password-123', // Contains hyphen
          });

          expect(mockConn.exec).toHaveBeenCalled();
        });

        it('should reject password without hyphen when only hyphen is special char', async () => {
          // If only hyphen is the special char, password without hyphen should fail
          auth.setPasswordPolicy({
            requireSpecialChar: true,
            specialChars: '-', // Only hyphen as special char
          });

          await expect(
            auth.createUser('alice', {
              password: 'PasswordABC123', // No hyphen, no special chars
            })
          ).rejects.toThrow('special character');
        });

        it('should handle specialChars with regex metacharacters', async () => {
          // Test that regex metacharacters are properly escaped
          auth.setPasswordPolicy({
            requireSpecialChar: true,
            specialChars: '$^.+*', // Regex metacharacters
          });

          await auth.createUser('alice', {
            password: 'Password$123', // Contains $
          });

          expect(mockConn.exec).toHaveBeenCalled();
        });

        it('should reject when password lacks required special char from escaped set', async () => {
          auth.setPasswordPolicy({
            requireSpecialChar: true,
            specialChars: '[]{}()', // Bracket characters that need escaping
          });

          await expect(
            auth.createUser('alice', {
              password: 'PasswordABC123', // No special chars
            })
          ).rejects.toThrow('special character');
        });
      });
    });

    describe('deleteUser', () => {
      it('should delete a user', async () => {
        await auth.deleteUser('alice');

        expect(mockConn.exec).toHaveBeenCalled();
        expect(mockConn.exec.mock.calls[0][0]).toContain('DROP USER');
      });

      it('should validate username', async () => {
        await expect(auth.deleteUser('')).rejects.toThrow(SecurityError);
      });
    });

    describe('getUser', () => {
      it('should get user information', async () => {
        mockConn.queryAll.mockResolvedValueOnce([
          {
            username: 'alice',
            roles: ['admin', 'analyst'],
            active: true,
            created_at: '2024-01-01T00:00:00Z',
          },
        ]);

        const user = await auth.getUser('alice');

        expect(user).not.toBeNull();
        expect(user?.username).toBe('alice');
        expect(user?.roles).toContain('admin');
        expect(user?.active).toBe(true);
      });

      it('should return null for non-existent user', async () => {
        mockConn.queryAll.mockResolvedValueOnce([]);

        const user = await auth.getUser('nonexistent');

        expect(user).toBeNull();
      });
    });

    describe('listUsers', () => {
      it('should list all users', async () => {
        mockConn.queryAll.mockResolvedValueOnce([
          { username: 'alice', roles: ['admin'], active: true },
          { username: 'bob', roles: ['user'], active: true },
        ]);

        const users = await auth.listUsers();

        expect(users).toHaveLength(2);
        expect(users[0].username).toBe('alice');
        expect(users[1].username).toBe('bob');
      });
    });

    describe('changePassword', () => {
      it('should change user password', async () => {
        await auth.changePassword('alice', 'newSecurePass123');

        expect(mockConn.exec).toHaveBeenCalled();
        expect(mockConn.exec.mock.calls[0][0]).toContain('ALTER USER');
        expect(mockConn.exec.mock.calls[0][0]).toContain('password');
      });

      it('should validate new password', async () => {
        await expect(auth.changePassword('alice', 'short')).rejects.toThrow(
          'at least 8 characters'
        );
      });
    });

    describe('activateUser / deactivateUser', () => {
      it('should activate a user', async () => {
        await auth.activateUser('alice');

        expect(mockConn.exec).toHaveBeenCalled();
        expect(mockConn.exec.mock.calls[0][0]).toContain('active = true');
      });

      it('should deactivate a user', async () => {
        await auth.deactivateUser('alice');

        expect(mockConn.exec).toHaveBeenCalled();
        expect(mockConn.exec.mock.calls[0][0]).toContain('active = false');
      });
    });
  });

  describe('Role Management', () => {
    describe('createRole', () => {
      it('should create a role', async () => {
        await auth.createRole('analyst');

        expect(mockConn.exec).toHaveBeenCalled();
        expect(mockConn.exec.mock.calls[0][0]).toContain('CREATE ROLE');
      });

      it('should create role with description', async () => {
        await auth.createRole('analyst', { description: 'Data analyst role' });

        expect(mockConn.exec.mock.calls[0][0]).toContain('description');
      });

      it('should reject invalid role name', async () => {
        await expect(auth.createRole('123invalid')).rejects.toThrow('Invalid role name format');
      });
    });

    describe('deleteRole', () => {
      it('should delete a role', async () => {
        await auth.deleteRole('analyst');

        expect(mockConn.exec).toHaveBeenCalled();
        expect(mockConn.exec.mock.calls[0][0]).toContain('DROP ROLE');
      });
    });

    describe('getRole', () => {
      it('should get role information', async () => {
        mockConn.queryAll.mockResolvedValueOnce([
          {
            name: 'analyst',
            description: 'Data analyst role',
            permissions: [{ resource: 'NODE', action: 'READ' }],
          },
        ]);

        const role = await auth.getRole('analyst');

        expect(role).not.toBeNull();
        expect(role?.name).toBe('analyst');
        expect(role?.description).toBe('Data analyst role');
      });

      it('should return null for non-existent role', async () => {
        mockConn.queryAll.mockResolvedValueOnce([]);

        const role = await auth.getRole('nonexistent');

        expect(role).toBeNull();
      });
    });

    describe('listRoles', () => {
      it('should list all roles', async () => {
        mockConn.queryAll.mockResolvedValueOnce([
          { name: 'admin', permissions: [] },
          { name: 'analyst', permissions: [] },
        ]);

        const roles = await auth.listRoles();

        expect(roles).toHaveLength(2);
      });
    });

    describe('assignRole / revokeRole', () => {
      it('should assign role to user', async () => {
        await auth.assignRole('alice', 'analyst');

        expect(mockConn.exec).toHaveBeenCalled();
        expect(mockConn.exec.mock.calls[0][0]).toContain('GRANT ROLE');
      });

      it('should revoke role from user', async () => {
        await auth.revokeRole('alice', 'analyst');

        expect(mockConn.exec).toHaveBeenCalled();
        expect(mockConn.exec.mock.calls[0][0]).toContain('REVOKE ROLE');
      });
    });

    describe('grantPermission / revokePermission', () => {
      it('should grant permission to role', async () => {
        await auth.grantPermission('analyst', { resource: 'NODE', action: 'READ' });

        expect(mockConn.exec).toHaveBeenCalled();
        expect(mockConn.exec.mock.calls[0][0]).toContain('GRANT READ ON NODE');
      });

      it('should grant permission with label filter', async () => {
        await auth.grantPermission('analyst', {
          resource: 'NODE',
          action: 'READ',
          label: 'Person',
        });

        expect(mockConn.exec.mock.calls[0][0]).toContain('NODE:Person');
      });

      it('should revoke permission from role', async () => {
        await auth.revokePermission('analyst', { resource: 'NODE', action: 'READ' });

        expect(mockConn.exec).toHaveBeenCalled();
        expect(mockConn.exec.mock.calls[0][0]).toContain('REVOKE READ ON NODE');
      });
    });
  });

  describe('Row-Level Security', () => {
    describe('createRLSPolicy', () => {
      it('should create an RLS policy', async () => {
        await auth.createRLSPolicy(
          'tenant_isolation',
          'Document',
          'ALL',
          'n.tenant_id = current_user().tenant_id'
        );

        expect(mockConn.exec).toHaveBeenCalled();
        expect(mockConn.exec.mock.calls[0][0]).toContain('CREATE POLICY');
        expect(mockConn.exec.mock.calls[0][0]).toContain('Document');
        expect(mockConn.exec.mock.calls[0][0]).toContain('FOR ALL');
      });

      it('should create policy for specific roles', async () => {
        await auth.createRLSPolicy('tenant_isolation', 'Document', 'READ', 'n.visible = true', {
          roles: ['analyst', 'viewer'],
        });

        expect(mockConn.exec.mock.calls[0][0]).toContain('FOR ROLES');
      });

      it('should reject invalid policy name', async () => {
        await expect(
          auth.createRLSPolicy('123invalid', 'Document', 'READ', 'true')
        ).rejects.toThrow('Invalid policy name format');
      });
    });

    describe('deleteRLSPolicy', () => {
      it('should delete an RLS policy', async () => {
        await auth.deleteRLSPolicy('tenant_isolation', 'Document');

        expect(mockConn.exec).toHaveBeenCalled();
        expect(mockConn.exec.mock.calls[0][0]).toContain('DROP POLICY');
      });
    });

    describe('getRLSPolicy', () => {
      it('should get policy information', async () => {
        mockConn.queryAll.mockResolvedValueOnce([
          {
            name: 'tenant_isolation',
            label: 'Document',
            action: 'ALL',
            predicate: 'n.tenant_id = 1',
            enabled: true,
          },
        ]);

        const policy = await auth.getRLSPolicy('tenant_isolation');

        expect(policy).not.toBeNull();
        expect(policy?.name).toBe('tenant_isolation');
        expect(policy?.label).toBe('Document');
        expect(policy?.enabled).toBe(true);
      });
    });

    describe('listRLSPolicies', () => {
      it('should list all policies', async () => {
        mockConn.queryAll.mockResolvedValueOnce([
          { name: 'p1', label: 'A', action: 'READ', predicate: 'true', enabled: true },
          { name: 'p2', label: 'B', action: 'WRITE', predicate: 'true', enabled: true },
        ]);

        const policies = await auth.listRLSPolicies();

        expect(policies).toHaveLength(2);
      });

      it('should filter by label', async () => {
        await auth.listRLSPolicies('Document');

        expect(mockConn.queryAll).toHaveBeenCalled();
        expect(mockConn.queryAll.mock.calls[0][0]).toContain(':Document');
      });
    });

    describe('enableRLSPolicy / disableRLSPolicy', () => {
      it('should enable policy', async () => {
        await auth.enableRLSPolicy('tenant_isolation', 'Document');

        expect(mockConn.exec.mock.calls[0][0]).toContain('ENABLE');
      });

      it('should disable policy', async () => {
        await auth.disableRLSPolicy('tenant_isolation', 'Document');

        expect(mockConn.exec.mock.calls[0][0]).toContain('DISABLE');
      });
    });
  });

  describe('Session Management', () => {
    describe('currentUser', () => {
      it('should get current user', async () => {
        mockConn.queryAll.mockResolvedValueOnce([{ user: 'alice' }]);

        const user = await auth.currentUser();

        expect(user).toBe('alice');
      });

      it('should return empty string if no user', async () => {
        mockConn.queryAll.mockResolvedValueOnce([]);

        const user = await auth.currentUser();

        expect(user).toBe('');
      });
    });

    describe('currentRoles', () => {
      it('should get current roles', async () => {
        mockConn.queryAll.mockResolvedValueOnce([{ roles: ['admin', 'analyst'] }]);

        const roles = await auth.currentRoles();

        expect(roles).toContain('admin');
        expect(roles).toContain('analyst');
      });

      it('should return empty array if no roles', async () => {
        mockConn.queryAll.mockResolvedValueOnce([]);

        const roles = await auth.currentRoles();

        expect(roles).toEqual([]);
      });
    });

    describe('hasPermission', () => {
      it('should check permission', async () => {
        mockConn.queryAll.mockResolvedValueOnce([{ allowed: true }]);

        const allowed = await auth.hasPermission('NODE', 'READ');

        expect(allowed).toBe(true);
      });

      it('should check permission with label', async () => {
        mockConn.queryAll.mockResolvedValueOnce([{ allowed: true }]);

        await auth.hasPermission('NODE', 'READ', 'Person');

        expect(mockConn.queryAll).toHaveBeenCalled();
        expect(mockConn.queryAll.mock.calls[0][1].params.target).toBe('NODE:Person');
      });

      it('should return false if no permission', async () => {
        mockConn.queryAll.mockResolvedValueOnce([{ allowed: false }]);

        const allowed = await auth.hasPermission('NODE', 'WRITE');

        expect(allowed).toBe(false);
      });
    });
  });
});

describe('Auth Types', () => {
  describe('User interface', () => {
    it('should support all user fields', () => {
      const user: User = {
        username: 'alice',
        roles: ['admin', 'analyst'],
        active: true,
        createdAt: new Date(),
        lastLoginAt: new Date(),
        metadata: { department: 'Engineering' },
      };

      expect(user.username).toBe('alice');
      expect(user.roles).toContain('admin');
      expect(user.active).toBe(true);
      expect(user.metadata?.department).toBe('Engineering');
    });
  });

  describe('Role interface', () => {
    it('should support all role fields', () => {
      const role: Role = {
        name: 'analyst',
        description: 'Data analyst role',
        permissions: [
          { resource: 'NODE', action: 'READ' },
          { resource: 'EDGE', action: 'READ' },
        ],
        system: false,
      };

      expect(role.name).toBe('analyst');
      expect(role.permissions).toHaveLength(2);
    });
  });

  describe('Permission interface', () => {
    it('should support all permission fields', () => {
      const perm: Permission = {
        resource: 'NODE',
        action: 'READ',
        label: 'Person',
        properties: ['name', 'email'],
      };

      expect(perm.resource).toBe('NODE');
      expect(perm.label).toBe('Person');
      expect(perm.properties).toContain('name');
    });
  });

  describe('RLSPolicy interface', () => {
    it('should support all policy fields', () => {
      const policy: RLSPolicy = {
        name: 'tenant_isolation',
        label: 'Document',
        action: 'ALL',
        predicate: 'n.tenant_id = current_user().tenant_id',
        roles: ['user', 'analyst'],
        enabled: true,
      };

      expect(policy.name).toBe('tenant_isolation');
      expect(policy.action).toBe('ALL');
      expect(policy.roles).toContain('user');
    });
  });
});
