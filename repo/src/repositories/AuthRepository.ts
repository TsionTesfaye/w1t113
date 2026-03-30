import type {
  AuthenticatedUser,
  Session,
  UserNotificationPreferences
} from '@/app/types/domain';
import { indexedDbClient } from '@/db/indexedDbClient';

export interface AuthRepository {
  getUserByUsername(username: string): Promise<AuthenticatedUser | null>;
  findUserByUsername(username: string): Promise<AuthenticatedUser | null>;
  findUserById(userId: string): Promise<AuthenticatedUser | null>;
  getAllUsers(): Promise<AuthenticatedUser[]>;
  listUsers(): Promise<AuthenticatedUser[]>;
  createUser(user: AuthenticatedUser): Promise<void>;
  updateUser(userId: string, updates: { username?: string }): Promise<AuthenticatedUser>;
  updateNotificationPreferences(
    userId: string,
    preferences: UserNotificationPreferences
  ): Promise<AuthenticatedUser>;
  setBlockedUsers(userId: string, blockedUserIds: string[]): Promise<AuthenticatedUser>;
  updateUserRole(userId: string, role: AuthenticatedUser['role']): Promise<AuthenticatedUser>;
  updateUserStatus(userId: string, isActive: boolean): Promise<AuthenticatedUser>;
  updateLoginState(userId: string, failedAttempts: number, lockUntil: number | null): Promise<void>;
  createSession(session: Session): Promise<void>;
  findSessionByToken(token: string): Promise<Session | null>;
  deleteSessionByToken(token: string): Promise<void>;
  purgeExpiredSessions(now: number): Promise<void>;
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeNotificationPreferences(
  value: Partial<UserNotificationPreferences> | undefined
): UserNotificationPreferences {
  return {
    booking: value?.booking !== false,
    messages: value?.messages !== false,
    community: value?.community !== false
  };
}

function normalizeBlockedUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }

    const normalized = item.trim();
    if (!normalized) {
      continue;
    }

    unique.add(normalized);
  }

  return [...unique];
}

function toAuthenticatedUser(user: AuthenticatedUser): AuthenticatedUser {
  return {
    ...user,
    username: normalizeUsername(user.username),
    isActive: user.isActive !== false,
    notificationPreferences: normalizeNotificationPreferences(user.notificationPreferences),
    blockedUserIds: normalizeBlockedUserIds(user.blockedUserIds),
    failedAttempts: Number.isFinite(user.failedAttempts) ? user.failedAttempts : 0,
    lockUntil: user.lockUntil ?? null
  };
}

class IndexedDbAuthRepository implements AuthRepository {
  async getUserByUsername(username: string): Promise<AuthenticatedUser | null> {
    const normalizedUsername = normalizeUsername(username);

    return indexedDbClient.withTransaction(['users'], 'readonly', async (transaction) => {
      const user = await transaction.getByIndex<AuthenticatedUser>(
        'users',
        'username',
        normalizedUsername
      );
      return user ? toAuthenticatedUser(user) : null;
    });
  }

  async findUserByUsername(username: string): Promise<AuthenticatedUser | null> {
    return indexedDbClient.withTransaction(['users'], 'readonly', async (transaction) => {
      const user = await transaction.getByIndex<AuthenticatedUser>('users', 'username', username);
      return user ? toAuthenticatedUser(user) : null;
    });
  }

  async findUserById(userId: string): Promise<AuthenticatedUser | null> {
    return indexedDbClient.withTransaction(['users'], 'readonly', async (transaction) => {
      const user = await transaction.get<AuthenticatedUser>('users', userId);
      return user ? toAuthenticatedUser(user) : null;
    });
  }

  async getAllUsers(): Promise<AuthenticatedUser[]> {
    return indexedDbClient.withTransaction(['users'], 'readonly', async (transaction) => {
      const users = await transaction.getAll<AuthenticatedUser>('users');
      return users.map((user) => toAuthenticatedUser(user));
    });
  }

  async listUsers(): Promise<AuthenticatedUser[]> {
    return this.getAllUsers();
  }

  async createUser(user: AuthenticatedUser): Promise<void> {
    await indexedDbClient.withTransaction(['users'], 'readwrite', async (transaction) => {
      const normalizedUser = toAuthenticatedUser(user);
      const existing = await transaction.getByIndex<AuthenticatedUser>(
        'users',
        'username',
        normalizedUser.username
      );
      if (existing) {
        throw new Error('USERNAME_ALREADY_EXISTS');
      }

      await transaction.put('users', normalizedUser);
    });
  }

  async updateUser(userId: string, updates: { username?: string }): Promise<AuthenticatedUser> {
    return indexedDbClient.withTransaction(['users'], 'readwrite', async (transaction) => {
      const user = await transaction.get<AuthenticatedUser>('users', userId);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      const normalizedUser = toAuthenticatedUser(user);
      const nextUsername =
        typeof updates.username === 'string' ? normalizeUsername(updates.username) : normalizedUser.username;

      if (!nextUsername) {
        throw new Error('INVALID_USERNAME');
      }

      if (nextUsername !== normalizedUser.username) {
        const existing = await transaction.getByIndex<AuthenticatedUser>('users', 'username', nextUsername);
        if (existing && existing.id !== userId) {
          throw new Error('USERNAME_ALREADY_EXISTS');
        }
      }

      const updatedUser: AuthenticatedUser = {
        ...normalizedUser,
        username: nextUsername
      };

      await transaction.put('users', updatedUser);
      return updatedUser;
    });
  }

  async updateUserRole(userId: string, role: AuthenticatedUser['role']): Promise<AuthenticatedUser> {
    return indexedDbClient.withTransaction(['users'], 'readwrite', async (transaction) => {
      const user = await transaction.get<AuthenticatedUser>('users', userId);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      const normalizedUser = toAuthenticatedUser(user);
      const updatedUser = {
        ...normalizedUser,
        role
      };

      await transaction.put('users', updatedUser);
      return updatedUser;
    });
  }

  async updateNotificationPreferences(
    userId: string,
    preferences: UserNotificationPreferences
  ): Promise<AuthenticatedUser> {
    return indexedDbClient.withTransaction(['users'], 'readwrite', async (transaction) => {
      const user = await transaction.get<AuthenticatedUser>('users', userId);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      const normalizedUser = toAuthenticatedUser(user);
      const updatedUser: AuthenticatedUser = {
        ...normalizedUser,
        notificationPreferences: normalizeNotificationPreferences(preferences)
      };

      await transaction.put('users', updatedUser);
      return updatedUser;
    });
  }

  async setBlockedUsers(userId: string, blockedUserIds: string[]): Promise<AuthenticatedUser> {
    return indexedDbClient.withTransaction(['users'], 'readwrite', async (transaction) => {
      const user = await transaction.get<AuthenticatedUser>('users', userId);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      const normalizedUser = toAuthenticatedUser(user);
      const updatedUser: AuthenticatedUser = {
        ...normalizedUser,
        blockedUserIds: normalizeBlockedUserIds(blockedUserIds).filter(
          (targetUserId) => targetUserId !== normalizedUser.id
        )
      };

      await transaction.put('users', updatedUser);
      return updatedUser;
    });
  }

  async updateUserStatus(userId: string, isActive: boolean): Promise<AuthenticatedUser> {
    return indexedDbClient.withTransaction(['users'], 'readwrite', async (transaction) => {
      const user = await transaction.get<AuthenticatedUser>('users', userId);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      const normalizedUser = toAuthenticatedUser(user);
      const updatedUser = {
        ...normalizedUser,
        isActive
      };

      await transaction.put('users', updatedUser);
      return updatedUser;
    });
  }

  async updateLoginState(userId: string, failedAttempts: number, lockUntil: number | null): Promise<void> {
    await indexedDbClient.withTransaction(['users'], 'readwrite', async (transaction) => {
      const user = await transaction.get<AuthenticatedUser>('users', userId);
      if (!user) {
        return;
      }

      const normalizedUser = toAuthenticatedUser(user);
      await transaction.put('users', {
        ...normalizedUser,
        failedAttempts,
        lockUntil
      });
    });
  }

  async createSession(session: Session): Promise<void> {
    await indexedDbClient.withTransaction(['sessions'], 'readwrite', async (transaction) => {
      await transaction.put('sessions', session);
    });
  }

  async findSessionByToken(token: string): Promise<Session | null> {
    return indexedDbClient.withTransaction(['sessions'], 'readonly', async (transaction) => {
      const session = await transaction.getByIndex<Session>('sessions', 'token', token);
      return session ?? null;
    });
  }

  async deleteSessionByToken(token: string): Promise<void> {
    await indexedDbClient.withTransaction(['sessions'], 'readwrite', async (transaction) => {
      const session = await transaction.getByIndex<Session>('sessions', 'token', token);
      if (!session) {
        return;
      }

      await transaction.delete('sessions', session.id);
    });
  }

  async purgeExpiredSessions(now: number): Promise<void> {
    await indexedDbClient.withTransaction(['sessions'], 'readwrite', async (transaction) => {
      const sessions = await transaction.getAll<Session>('sessions');

      for (const session of sessions) {
        if (session.expiresAt !== null && session.expiresAt <= now) {
          await transaction.delete('sessions', session.id);
        }
      }
    });
  }
}

export function createAuthRepository(): AuthRepository {
  return new IndexedDbAuthRepository();
}
