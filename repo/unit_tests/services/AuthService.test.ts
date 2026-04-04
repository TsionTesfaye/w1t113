import type { AuthenticatedUser, Session } from '@/app/types/domain';
import type { AuthRepository } from '@/repositories/AuthRepository';
import { AuthError, createAuthService } from '@/services/AuthService';
import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  keys(): string[] {
    return [...this.map.keys()];
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
    this.sessions = this.sessions.filter(
      (session) => session.expiresAt === null || session.expiresAt > now
    );
  }
}

describe('AuthService', () => {
  let repository: InMemoryAuthRepository;
  let service: ReturnType<typeof createAuthService>;
  let localStorageMock: MemoryStorage;
  let sessionStorageMock: MemoryStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 9, 0, 0, 0));

    repository = new InMemoryAuthRepository();
    service = createAuthService(repository);

    localStorageMock = new MemoryStorage();
    sessionStorageMock = new MemoryStorage();
    (globalThis as { window?: { localStorage: MemoryStorage; sessionStorage: MemoryStorage } }).window = {
      localStorage: localStorageMock,
      sessionStorage: sessionStorageMock
    };
  });

  it('hashes password on register and stores no plaintext', async () => {
    const user = await service.register('client1', 'strongpass123');
    const stored = repository.users.find((candidate) => candidate.id === user.id);

    expect(stored).toBeTruthy();
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.salt).toBeTruthy();
    expect(stored?.passwordHash).not.toBe('strongpass123');
  });

  it('prevents duplicate registrations that differ only by casing', async () => {
    await service.register('john', 'strongpass123');

    await expect(service.register('JOHN', 'strongpass123')).rejects.toMatchObject({
      code: 'USERNAME_ALREADY_EXISTS'
    });

    expect(repository.users.filter((user) => user.username === 'john')).toHaveLength(1);
  });

  it('logs in with correct credentials and fails with wrong password', async () => {
    await service.register('client2', 'strongpass123');

    const success = await service.login({
      username: 'client2',
      password: 'strongpass123',
      rememberMe: false
    });
    expect(success.user.username).toBe('client2');

    await expect(
      service.login({
        username: 'client2',
        password: 'wrong-password',
        rememberMe: false
      })
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS'
    });
  });

  it('allows mixed-case login for an existing lowercase username', async () => {
    await service.register('john', 'strongpass123');

    const session = await service.login({
      username: 'JoHn',
      password: 'strongpass123',
      rememberMe: false
    });

    expect(session.user.username).toBe('john');
  });

  it('allows trim + mixed-case login for an existing lowercase username', async () => {
    await service.register('john', 'strongpass123');

    const session = await service.login({
      username: '  JoHn  ',
      password: 'strongpass123',
      rememberMe: false
    });

    expect(session.user.username).toBe('john');
  });

  it('fails login when username does not exist', async () => {
    await service.register('john', 'strongpass123');

    await expect(
      service.login({
        username: 'missing-user',
        password: 'strongpass123',
        rememberMe: false
      })
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS'
    });
  });

  it('accumulates failed attempts across username casing variants', async () => {
    await service.register('john', 'strongpass123');

    await expect(
      service.login({
        username: 'john',
        password: 'wrong-password',
        rememberMe: false
      })
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS'
    });

    await expect(
      service.login({
        username: 'JOHN',
        password: 'wrong-password',
        rememberMe: false
      })
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS'
    });

    const user = repository.users.find((candidate) => candidate.username === 'john');
    expect(user?.failedAttempts).toBe(2);
    expect(user?.lockUntil).toBeNull();
  });

  it('triggers and enforces lockout regardless of username casing', async () => {
    await service.register('john', 'strongpass123');

    const attempts = ['john', 'JOHN', 'jOhN', 'JoHn'];
    for (const username of attempts) {
      await expect(
        service.login({
          username,
          password: 'wrong-password',
          rememberMe: false
        })
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS'
      });
    }

    await expect(
      service.login({
        username: 'JOHN',
        password: 'wrong-password',
        rememberMe: false
      })
    ).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED'
    });

    await expect(
      service.login({
        username: 'jOhN',
        password: 'strongpass123',
        rememberMe: false
      })
    ).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED'
    });

    const user = repository.users.find((candidate) => candidate.username === 'john');
    expect(user?.failedAttempts).toBe(5);
    expect(typeof user?.lockUntil).toBe('number');
  });

  it('locks account after five failed attempts and blocks login during lock period', async () => {
    await service.register('client3', 'strongpass123');

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(
        service.login({
          username: 'client3',
          password: 'wrong-password',
          rememberMe: false
        })
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS'
      });
    }

    await expect(
      service.login({
        username: 'client3',
        password: 'wrong-password',
        rememberMe: false
      })
    ).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED'
    });

    await expect(
      service.login({
        username: 'client3',
        password: 'strongpass123',
        rememberMe: false
      })
    ).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED'
    });
  });

  it('allows login after lock expires and resets failed attempts', async () => {
    await service.register('client4', 'strongpass123');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await service.login({
          username: 'client4',
          password: 'wrong-password',
          rememberMe: false
        });
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(AuthError);
      }
    }

    const lockedUser = repository.users.find((user) => user.username === 'client4');
    expect(lockedUser?.lockUntil).not.toBeNull();

    vi.setSystemTime((lockedUser?.lockUntil ?? Date.now()) + 1_000);
    const session = await service.login({
      username: 'client4',
      password: 'strongpass123',
      rememberMe: true
    });

    expect(session.user.username).toBe('client4');
    const updated = repository.users.find((user) => user.username === 'client4');
    expect(updated?.failedAttempts).toBe(0);
    expect(updated?.lockUntil).toBeNull();
  });

  it('blocks login for deactivated users', async () => {
    const registered = await service.register('client-disabled', 'strongpass123');
    await repository.updateUserStatus(registered.id, false);

    await expect(
      service.login({
        username: 'client-disabled',
        password: 'strongpass123',
        rememberMe: false
      })
    ).rejects.toMatchObject({
      code: 'ACCOUNT_DISABLED'
    });
  });

  it('generates and persists session token on login', async () => {
    await service.register('client5', 'strongpass123');

    const session = await service.login({
      username: 'client5',
      password: 'strongpass123',
      rememberMe: true
    });

    expect(session.session.token).toBeTruthy();
    expect(localStorageMock.getItem('studioops.session.token')).toBe(session.session.token);
    expect(localStorageMock.keys()).toEqual(['studioops.session.token']);
    expect(sessionStorageMock.keys()).toEqual([]);
  });

  it('restores session across service reload using token-only local storage', async () => {
    await service.register('client6', 'strongpass123');
    const loginSession = await service.login({
      username: 'client6',
      password: 'strongpass123',
      rememberMe: true
    });

    const reloadedService = createAuthService(repository);
    const restoredSession = await reloadedService.loadSession();

    expect(localStorageMock.keys()).toEqual(['studioops.session.token']);
    expect(restoredSession?.session.token).toBe(loginSession.session.token);
    expect(restoredSession?.user.username).toBe('client6');
  });

  it('does not persist non-remembered sessions across service reload', async () => {
    await service.register('client7', 'strongpass123');
    const runtimeSession = await service.login({
      username: 'client7',
      password: 'strongpass123',
      rememberMe: false
    });

    expect(localStorageMock.keys()).toEqual([]);
    expect(sessionStorageMock.keys()).toEqual([]);

    const sameRuntime = await service.loadSession();
    expect(sameRuntime?.session.token).toBe(runtimeSession.session.token);

    const reloadedService = createAuthService(repository);
    const restoredSession = await reloadedService.loadSession();
    expect(restoredSession).toBeNull();
  });

  it('does not leak persisted session when switching from remember to non-remember user', async () => {
    await service.register('remember-user', 'strongpass123');
    await service.register('runtime-user', 'strongpass123');

    const remembered = await service.login({
      username: 'remember-user',
      password: 'strongpass123',
      rememberMe: true
    });
    expect(localStorageMock.getItem('studioops.session.token')).toBe(remembered.session.token);

    const runtime = await service.login({
      username: 'runtime-user',
      password: 'strongpass123',
      rememberMe: false
    });
    expect(localStorageMock.getItem('studioops.session.token')).toBeNull();

    const activeSession = await service.loadSession();
    expect(activeSession?.user.username).toBe('runtime-user');
    expect(activeSession?.session.token).toBe(runtime.session.token);

    const reloadedService = createAuthService(repository);
    const restoredSession = await reloadedService.loadSession();
    expect(restoredSession).toBeNull();
  });

  it('clears encryption keys on logout and never reuses keys across users', async () => {
    const userA = await service.register('client-a', 'strongpass123');
    const userB = await service.register('client-b', 'strongpass123');

    await service.login({
      username: 'client-a',
      password: 'strongpass123',
      rememberMe: false
    });

    const keyA = service.getActiveEncryptionKey();
    expect(keyA).not.toBeNull();
    expect(service.getCachedEncryptionKeyForUser(userA.id)).toBe(keyA);

    await service.logout();
    expect(service.getActiveEncryptionKey()).toBeNull();
    expect(service.getCachedEncryptionKeyForUser(userA.id)).toBeNull();
    expect(localStorageMock.getItem('studioops.session.token')).toBeNull();
    expect(sessionStorageMock.getItem('studioops.session.token')).toBeNull();

    await service.login({
      username: 'client-b',
      password: 'strongpass123',
      rememberMe: false
    });

    const keyB = service.getActiveEncryptionKey();
    expect(keyB).not.toBeNull();
    expect(service.getCachedEncryptionKeyForUser(userA.id)).toBeNull();
    expect(service.getCachedEncryptionKeyForUser(userB.id)).toBe(keyB);
  });

  it('supports one-time secure initial admin bootstrap', async () => {
    await expect(service.isInitialAdminSetupRequired()).resolves.toBe(true);

    await expect(service.bootstrapInitialAdmin('admin', 'weak-pass')).rejects.toMatchObject({
      code: 'WEAK_PASSWORD'
    });

    const bootstrapAdmin = await service.bootstrapInitialAdmin('owner_admin', 'StrongPass!123');
    expect(bootstrapAdmin.role).toBe('admin');

    await expect(service.isInitialAdminSetupRequired()).resolves.toBe(false);

    await expect(
      service.bootstrapInitialAdmin('another_admin', 'Another!Pass123')
    ).rejects.toMatchObject({
      code: 'BOOTSTRAP_NOT_ALLOWED'
    });
  });
});
