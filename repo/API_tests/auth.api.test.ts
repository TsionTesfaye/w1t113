import type { AuthenticatedUser, Session } from '@/app/types/domain';
import type { AuthRepository } from '@/repositories/AuthRepository';
import { createAuthService } from '@/services/AuthService';
import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class InMemoryAuthRepository implements AuthRepository {
  users: AuthenticatedUser[] = [];
  sessions: Session[] = [];

  async getUserByUsername(username: string): Promise<AuthenticatedUser | null> {
    return this.users.find((user) => user.username === username) ?? null;
  }

  async findUserByUsername(username: string): Promise<AuthenticatedUser | null> {
    return this.users.find((user) => user.username === username) ?? null;
  }

  async findUserById(userId: string): Promise<AuthenticatedUser | null> {
    return this.users.find((user) => user.id === userId) ?? null;
  }

  async getAllUsers(): Promise<AuthenticatedUser[]> {
    return [...this.users];
  }

  async listUsers(): Promise<AuthenticatedUser[]> {
    return [...this.users];
  }

  async createUser(user: AuthenticatedUser): Promise<void> {
    const exists = this.users.some((candidate) => candidate.username === user.username);
    if (exists) {
      throw new Error('USERNAME_ALREADY_EXISTS');
    }

    this.users.push({ ...user });
  }

  async updateUserRole(userId: string, role: AuthenticatedUser['role']): Promise<AuthenticatedUser> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    user.role = role;
    return { ...user };
  }

  async updateUserStatus(userId: string, isActive: boolean): Promise<AuthenticatedUser> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    user.isActive = isActive;
    return { ...user };
  }

  async updateUser(userId: string, updates: { username?: string }): Promise<AuthenticatedUser> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    if (typeof updates.username === 'string') {
      const normalized = updates.username.trim();
      if (!normalized) {
        throw new Error('INVALID_USERNAME');
      }

      const duplicate = this.users.some(
        (candidate) => candidate.id !== userId && candidate.username === normalized
      );
      if (duplicate) {
        throw new Error('USERNAME_ALREADY_EXISTS');
      }

      user.username = normalized;
    }

    return { ...user };
  }

  async updateNotificationPreferences(
    userId: string,
    notificationPreferences: AuthenticatedUser['notificationPreferences']
  ): Promise<AuthenticatedUser> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    user.notificationPreferences = { ...notificationPreferences };
    return { ...user };
  }

  async setBlockedUsers(userId: string, blockedUserIds: string[]): Promise<AuthenticatedUser> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    user.blockedUserIds = [...blockedUserIds];
    return { ...user };
  }

  async updateLoginState(userId: string, failedAttempts: number, lockUntil: number | null): Promise<void> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      return;
    }

    user.failedAttempts = failedAttempts;
    user.lockUntil = lockUntil;
  }

  async createSession(session: Session): Promise<void> {
    this.sessions.push({ ...session });
  }

  async findSessionByToken(token: string): Promise<Session | null> {
    return this.sessions.find((session) => session.token === token) ?? null;
  }

  async deleteSessionByToken(token: string): Promise<void> {
    this.sessions = this.sessions.filter((session) => session.token !== token);
  }

  async purgeExpiredSessions(now: number): Promise<void> {
    this.sessions = this.sessions.filter((session) => session.expiresAt === null || session.expiresAt > now);
  }
}

describe('Auth API contract (offline service layer)', () => {
  let repository: InMemoryAuthRepository;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 9, 0, 0, 0));
    repository = new InMemoryAuthRepository();

    (globalThis as { window?: { localStorage: MemoryStorage } }).window = {
      localStorage: new MemoryStorage()
    };
  });

  it('returns INVALID_CREDENTIALS for unknown login', async () => {
    const service = createAuthService(repository);

    await expect(
      service.login({
        username: 'missing-user',
        password: 'bad-password',
        rememberMe: false
      })
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS'
    });
  });

  it('creates session contract for valid credentials', async () => {
    const service = createAuthService(repository);
    await service.register('api-user', 'password123');

    const session = await service.login({
      username: 'api-user',
      password: 'password123',
      rememberMe: true
    });

    expect(session.user.username).toBe('api-user');
    expect(session.session.userId).toBe(session.user.id);
    expect(typeof session.session.token).toBe('string');
    expect(session.session.token.length).toBeGreaterThan(10);
  });
});
