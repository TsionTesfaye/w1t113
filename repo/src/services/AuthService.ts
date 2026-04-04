import { STORAGE_KEYS } from '@/app/constants/storageKeys';
import type {
  AuthenticatedUser,
  Session,
  User,
  UserNotificationPreferences,
  UserRole
} from '@/app/types/domain';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type { BookingService } from '@/services/BookingService';
import type { SearchService } from '@/services/SearchService';
import {
  createSalt,
  deriveEncryptionKey,
  generateToken,
  hashPassword,
  nowTimestamp,
  timingSafeEqual
} from '@/services/authCrypto';
import { logger } from '@/utils/logger';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const NON_REMEMBERED_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const ENABLE_DEFAULT_ADMIN_SEED =
  import.meta.env.DEV &&
  import.meta.env.MODE !== 'test' &&
  import.meta.env.VITE_AUTH_SEED_DEFAULT_ADMIN === 'true';
const DEFAULT_SEED_USERS: Array<{ username: string; password: string; role: UserRole }> = [
  { username: 'admin', password: 'admin123', role: 'admin' },
  { username: 'user1', password: 'user123', role: 'client' },
  { username: 'user2', password: 'user123', role: 'client' }
];

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'INVALID_USERNAME'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_DISABLED'
  | 'USERNAME_ALREADY_EXISTS'
  | 'PASSWORD_TOO_SHORT'
  | 'WEAK_PASSWORD'
  | 'FORBIDDEN'
  | 'USER_NOT_FOUND'
  | 'LAST_ADMIN_PROTECTION'
  | 'SELF_ACTION_FORBIDDEN'
  | 'BOOTSTRAP_NOT_ALLOWED'
  | 'SESSION_INVALID';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly lockUntil: number | null;

  constructor(code: AuthErrorCode, message: string, lockUntil: number | null = null) {
    super(message);
    this.code = code;
    this.lockUntil = lockUntil;
  }
}

export interface LoginInput {
  username: string;
  password: string;
  rememberMe: boolean;
}

export interface AuthenticatedSession {
  user: User;
  session: Session;
  hasActiveEncryptionKey: boolean;
}

export interface AuthService {
  isInitialAdminSetupRequired(): Promise<boolean>;
  bootstrapInitialAdmin(username: string, password: string): Promise<User>;
  register(username: string, password: string): Promise<User>;
  updateUser(actorId: string, targetUserId: string, updates: { username?: string }): Promise<User>;
  updateNotificationPreferences(
    actorId: string,
    targetUserId: string,
    updates: Partial<UserNotificationPreferences>
  ): Promise<User>;
  blockUser(userId: string, targetUserId: string): Promise<User>;
  unblockUser(userId: string, targetUserId: string): Promise<User>;
  getBlockedUsers(actorId: string, targetUserId?: string): Promise<User[]>;
  getAllUsers(actorId: string): Promise<User[]>;
  getUsersByIds(actorId: string, userIds: string[]): Promise<User[]>;
  findUserByUsername(actorId: string, username: string): Promise<User | null>;
  changeUserRole(adminId: string, targetUserId: string, newRole: UserRole): Promise<User>;
  setUserActiveStatus(adminId: string, targetUserId: string, isActive: boolean): Promise<User>;
  createUserByAdmin(adminId: string, username: string, password: string, role: UserRole): Promise<User>;
  login(input: LoginInput): Promise<AuthenticatedSession>;
  logout(): Promise<void>;
  loadSession(): Promise<AuthenticatedSession | null>;
  getCurrentSession(): Promise<AuthenticatedSession | null>;
  getActiveEncryptionKey(): CryptoKey | null;
  getCachedEncryptionKeyForUser(userId: string): CryptoKey | null;
}

function normalizeRegistrationUsername(value: string): string {
  return value.trim().toLowerCase();
}

function defaultNotificationPreferences(): UserNotificationPreferences {
  return {
    booking: true,
    messages: true,
    community: true
  };
}

function toPublicUser(user: AuthenticatedUser): User {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    notificationPreferences: user.notificationPreferences ?? defaultNotificationPreferences(),
    blockedUserIds: user.blockedUserIds ?? [],
    createdAt: user.createdAt,
    failedAttempts: user.failedAttempts,
    lockUntil: user.lockUntil
  };
}

function createId(): string {
  if ('randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `id-${generateToken()}`;
}

function sessionFromUser(userId: string, rememberMe: boolean): Session {
  const createdAt = nowTimestamp();

  return {
    id: createId(),
    userId,
    token: generateToken(),
    createdAt,
    expiresAt: rememberMe ? null : createdAt + NON_REMEMBERED_SESSION_TTL_MS,
    rememberMe
  };
}

class LocalAuthService implements AuthService {
  private readonly authRepository: AuthRepository;
  private readonly searchService: SearchService | null;
  private readonly bookingService: BookingService | null;
  private activeEncryptionKey: CryptoKey | null = null;
  private activeEncryptionKeyOwnerId: string | null = null;
  private volatileSessionToken: string | null = null;
  private seedPromise: Promise<void> | null = null;

  constructor(
    authRepository: AuthRepository,
    searchService: SearchService | null = null,
    bookingService: BookingService | null = null
  ) {
    this.authRepository = authRepository;
    this.searchService = searchService;
    this.bookingService = bookingService;
  }

  async register(usernameInput: string, password: string): Promise<User> {
    await this.ensureDefaultUsers();

    const username = normalizeRegistrationUsername(usernameInput);
    if (!username) {
      throw new AuthError('INVALID_CREDENTIALS', 'Username is required.');
    }

    if (password.length < 8) {
      throw new AuthError('PASSWORD_TOO_SHORT', 'Password must be at least 8 characters.');
    }

    const salt = createSalt();
    const passwordHash = await hashPassword(password, salt);
    const user: AuthenticatedUser = {
      id: createId(),
      username,
      role: 'client',
      isActive: true,
      notificationPreferences: defaultNotificationPreferences(),
      blockedUserIds: [],
      passwordHash,
      salt,
      createdAt: nowTimestamp(),
      failedAttempts: 0,
      lockUntil: null
    };

    try {
      await this.authRepository.createUser(user);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'USERNAME_ALREADY_EXISTS') {
        throw new AuthError('USERNAME_ALREADY_EXISTS', 'Username is already registered.');
      }

      throw error;
    }

    await this.searchService?.indexUser(toPublicUser(user));

    return toPublicUser(user);
  }

  async isInitialAdminSetupRequired(): Promise<boolean> {
    await this.ensureDefaultUsers();
    return this.requiresInitialAdminSetup();
  }

  async bootstrapInitialAdmin(usernameInput: string, password: string): Promise<User> {
    await this.ensureDefaultUsers();

    if (!(await this.requiresInitialAdminSetup())) {
      throw new AuthError(
        'BOOTSTRAP_NOT_ALLOWED',
        'Initial admin setup has already been completed.'
      );
    }

    const username = normalizeRegistrationUsername(usernameInput);
    if (!username) {
      throw new AuthError('INVALID_USERNAME', 'Username is required.');
    }

    this.assertStrongBootstrapPassword(password);

    const salt = createSalt();
    const passwordHash = await hashPassword(password, salt);
    const user: AuthenticatedUser = {
      id: createId(),
      username,
      role: 'admin',
      isActive: true,
      notificationPreferences: defaultNotificationPreferences(),
      blockedUserIds: [],
      passwordHash,
      salt,
      createdAt: nowTimestamp(),
      failedAttempts: 0,
      lockUntil: null
    };

    try {
      await this.authRepository.createUser(user);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'USERNAME_ALREADY_EXISTS') {
        throw new AuthError('USERNAME_ALREADY_EXISTS', 'Username is already registered.');
      }

      throw error;
    }

    await this.searchService?.indexUser(toPublicUser(user));
    return toPublicUser(user);
  }

  async updateUser(
    actorId: string,
    targetUserId: string,
    updates: { username?: string }
  ): Promise<User> {
    await this.ensureDefaultUsers();
    const actor = await this.requireActiveUserActor(actorId);
    this.assertCanAccessTargetUser(actor, targetUserId);
    const targetUser = await this.requireExistingUser(targetUserId);

    const username = typeof updates.username === 'string' ? normalizeRegistrationUsername(updates.username) : undefined;
    if (username !== undefined && !username) {
      throw new AuthError('INVALID_USERNAME', 'Username is required.');
    }

    try {
      const updatedUser = await this.authRepository.updateUser(targetUser.id, {
        username
      });
      await this.searchService?.indexUser(toPublicUser(updatedUser));
      return toPublicUser(updatedUser);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'USERNAME_ALREADY_EXISTS') {
        throw new AuthError('USERNAME_ALREADY_EXISTS', 'Username is already registered.');
      }

      if (error instanceof Error && error.message === 'INVALID_USERNAME') {
        throw new AuthError('INVALID_USERNAME', 'Username is required.');
      }

      throw error;
    }
  }

  async updateNotificationPreferences(
    actorId: string,
    targetUserId: string,
    updates: Partial<UserNotificationPreferences>
  ): Promise<User> {
    await this.ensureDefaultUsers();
    const actor = await this.requireActiveUserActor(actorId);
    this.assertCanAccessTargetUser(actor, targetUserId);
    const targetUser = await this.requireExistingUser(targetUserId);

    const nextPreferences: UserNotificationPreferences = {
      ...(targetUser.notificationPreferences ?? defaultNotificationPreferences()),
      ...(typeof updates.booking === 'boolean' ? { booking: updates.booking } : {}),
      ...(typeof updates.messages === 'boolean' ? { messages: updates.messages } : {}),
      ...(typeof updates.community === 'boolean' ? { community: updates.community } : {})
    };

    const updatedUser = await this.authRepository.updateNotificationPreferences(
      targetUser.id,
      nextPreferences
    );
    return toPublicUser(updatedUser);
  }

  async blockUser(userId: string, targetUserId: string): Promise<User> {
    await this.ensureDefaultUsers();
    const actor = await this.requireActiveUserActor(userId);

    if (actor.id === targetUserId) {
      throw new AuthError('SELF_ACTION_FORBIDDEN', 'You cannot block yourself.');
    }

    const target = await this.authRepository.findUserById(targetUserId);
    if (!target || !target.isActive) {
      throw new AuthError('USER_NOT_FOUND', 'User not found.');
    }

    const currentBlocked = new Set(actor.blockedUserIds ?? []);
    if (currentBlocked.has(target.id)) {
      return toPublicUser(actor);
    }

    currentBlocked.add(target.id);
    const updatedUser = await this.authRepository.setBlockedUsers(actor.id, [...currentBlocked]);
    return toPublicUser(updatedUser);
  }

  async unblockUser(userId: string, targetUserId: string): Promise<User> {
    await this.ensureDefaultUsers();
    const actor = await this.requireActiveUserActor(userId);

    const nextBlocked = (actor.blockedUserIds ?? []).filter((blockedUserId) => blockedUserId !== targetUserId);
    const updatedUser = await this.authRepository.setBlockedUsers(actor.id, nextBlocked);
    return toPublicUser(updatedUser);
  }

  async getBlockedUsers(actorId: string, targetUserId = actorId): Promise<User[]> {
    await this.ensureDefaultUsers();
    const actor = await this.requireActiveUserActor(actorId);
    this.assertCanAccessTargetUser(actor, targetUserId);
    const targetUser = await this.requireExistingUser(targetUserId);
    const blockedIds = new Set(targetUser.blockedUserIds ?? []);

    if (blockedIds.size === 0) {
      return [];
    }

    const users = await this.authRepository.getAllUsers();
    return users
      .filter((user) => blockedIds.has(user.id))
      .map((user) => toPublicUser(user));
  }

  async getAllUsers(actorId: string): Promise<User[]> {
    await this.ensureDefaultUsers();
    await this.requireActiveAdmin(actorId);
    const users = await this.authRepository.getAllUsers();

    return users
      .map((user) => toPublicUser(user))
      .sort((left, right) => left.username.localeCompare(right.username));
  }

  async getUsersByIds(actorId: string, userIds: string[]): Promise<User[]> {
    await this.ensureDefaultUsers();
    const actor = await this.requireActiveUserActor(actorId);
    const uniqueUserIds = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqueUserIds.length === 0) {
      return [];
    }

    const users = await this.authRepository.getAllUsers();
    const usersById = new Map(users.map((user) => [user.id, user]));

    if (actor.role === 'admin') {
      return uniqueUserIds
        .map((id) => usersById.get(id))
        .filter((user): user is AuthenticatedUser => Boolean(user && user.isActive))
        .map((user) => toPublicUser(user));
    }

    const allowedIds = new Set<string>([actor.id]);
    if (this.bookingService) {
      if (actor.role === 'client') {
        const bookings = await this.bookingService.getBookingsForUser(actor.id, actor.id);
        for (const booking of bookings) {
          allowedIds.add(booking.userId);
          allowedIds.add(booking.photographerId);
        }
      }

      if (actor.role === 'photographer') {
        const bookings = await this.bookingService.getBookingsForPhotographer(actor.id);
        for (const booking of bookings) {
          allowedIds.add(booking.userId);
          allowedIds.add(booking.photographerId);
        }
      }
    }

    return uniqueUserIds
      .filter((id) => allowedIds.has(id))
      .map((id) => usersById.get(id))
      .filter((user): user is AuthenticatedUser => Boolean(user && user.isActive))
      .map((user) => toPublicUser(user));
  }

  async findUserByUsername(actorId: string, usernameInput: string): Promise<User | null> {
    await this.ensureDefaultUsers();
    await this.requireActiveUserActor(actorId);
    const username = normalizeRegistrationUsername(usernameInput);
    if (!username) {
      return null;
    }

    const user = await this.authRepository.findUserByUsername(username);
    if (!user || !user.isActive) {
      return null;
    }

    return toPublicUser(user);
  }

  async changeUserRole(adminId: string, targetUserId: string, newRole: UserRole): Promise<User> {
    await this.ensureDefaultUsers();
    const adminUser = await this.requireActiveAdmin(adminId);
    const targetUser = await this.requireExistingUser(targetUserId);

    if (targetUser.id === adminUser.id && newRole !== 'admin') {
      throw new AuthError(
        'SELF_ACTION_FORBIDDEN',
        'You cannot change your own role away from admin.'
      );
    }

    if (targetUser.role === 'admin' && newRole !== 'admin' && targetUser.isActive) {
      await this.assertHasAnotherActiveAdmin(targetUser.id);
    }

    const updatedUser = await this.authRepository.updateUserRole(targetUserId, newRole);
    await this.searchService?.indexUser(toPublicUser(updatedUser));
    return toPublicUser(updatedUser);
  }

  async setUserActiveStatus(adminId: string, targetUserId: string, isActive: boolean): Promise<User> {
    await this.ensureDefaultUsers();
    const adminUser = await this.requireActiveAdmin(adminId);
    const targetUser = await this.requireExistingUser(targetUserId);

    if (targetUser.id === adminUser.id && !isActive) {
      throw new AuthError('SELF_ACTION_FORBIDDEN', 'You cannot deactivate your own account.');
    }

    if (targetUser.role === 'admin' && targetUser.isActive && !isActive) {
      await this.assertHasAnotherActiveAdmin(targetUser.id);
    }

    const updatedUser = await this.authRepository.updateUserStatus(targetUserId, isActive);
    await this.searchService?.indexUser(toPublicUser(updatedUser));
    if (
      this.bookingService &&
      targetUser.role === 'photographer' &&
      targetUser.isActive &&
      !isActive
    ) {
      await this.bookingService.markPhotographerUnavailableByAdmin(adminUser.id, targetUser.id);
    }
    return toPublicUser(updatedUser);
  }

  async createUserByAdmin(
    adminId: string,
    usernameInput: string,
    password: string,
    role: UserRole
  ): Promise<User> {
    await this.ensureDefaultUsers();
    await this.requireActiveAdmin(adminId);

    const username = normalizeRegistrationUsername(usernameInput);
    if (!username) {
      throw new AuthError('INVALID_CREDENTIALS', 'Username is required.');
    }

    if (password.length < 8) {
      throw new AuthError('PASSWORD_TOO_SHORT', 'Password must be at least 8 characters.');
    }

    const salt = createSalt();
    const passwordHash = await hashPassword(password, salt);

    const user: AuthenticatedUser = {
      id: createId(),
      username,
      role,
      isActive: true,
      notificationPreferences: defaultNotificationPreferences(),
      blockedUserIds: [],
      passwordHash,
      salt,
      createdAt: nowTimestamp(),
      failedAttempts: 0,
      lockUntil: null
    };

    try {
      await this.authRepository.createUser(user);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'USERNAME_ALREADY_EXISTS') {
        throw new AuthError('USERNAME_ALREADY_EXISTS', 'Username already exists');
      }

      throw error;
    }

    await this.searchService?.indexUser(toPublicUser(user));

    return toPublicUser(user);
  }

  async login(input: LoginInput): Promise<AuthenticatedSession> {
    await this.ensureDefaultUsers();

    const normalizedUsername = input.username.trim().toLowerCase();
    const password = input.password;
    if (!normalizedUsername || !password) {
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid username or password.');
    }

    const now = nowTimestamp();
    await this.authRepository.purgeExpiredSessions(now);

    const user = await this.authRepository.findUserByUsername(normalizedUsername);
    if (!user) {
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid username or password.');
    }

    if (!user.isActive) {
      throw new AuthError('ACCOUNT_DISABLED', 'This account is disabled.');
    }

    if (user.lockUntil !== null) {
      if (user.lockUntil > now) {
        throw new AuthError('ACCOUNT_LOCKED', 'Account is temporarily locked.', user.lockUntil);
      }

      await this.authRepository.updateLoginState(user.id, 0, null);
      user.failedAttempts = 0;
      user.lockUntil = null;
    }

    const attemptedHash = await hashPassword(password, user.salt);
    const isValid = timingSafeEqual(user.passwordHash, attemptedHash);

    if (!isValid) {
      const nextFailedAttempts = user.failedAttempts + 1;
      const shouldLock = nextFailedAttempts >= MAX_FAILED_ATTEMPTS;
      const nextLockUntil = shouldLock ? now + LOCKOUT_DURATION_MS : null;

      await this.authRepository.updateLoginState(
        user.id,
        shouldLock ? MAX_FAILED_ATTEMPTS : nextFailedAttempts,
        nextLockUntil
      );

      if (shouldLock) {
        throw new AuthError('ACCOUNT_LOCKED', 'Account is temporarily locked.', nextLockUntil);
      }

      throw new AuthError('INVALID_CREDENTIALS', 'Invalid username or password.');
    }

    await this.authRepository.updateLoginState(user.id, 0, null);

    const session = sessionFromUser(user.id, input.rememberMe);
    await this.authRepository.createSession(session);

    this.persistSessionTokenByPreference(session.token, input.rememberMe);
    this.clearEncryptionContext();
    this.activeEncryptionKey = await deriveEncryptionKey(password, user.salt);
    this.activeEncryptionKeyOwnerId = user.id;
    logger.info('AuthService login succeeded', {
      context: 'AuthService',
      rememberMe: input.rememberMe
    });

    return {
      user: {
        ...toPublicUser(user),
        failedAttempts: 0,
        lockUntil: null
      },
      session,
      hasActiveEncryptionKey: true
    };
  }

  async logout(): Promise<void> {
    const token = this.getSessionToken();

    if (token) {
      await this.authRepository.deleteSessionByToken(token);
    }

    this.clearSessionToken();
    this.clearEncryptionContext();
    logger.info('AuthService logout completed', { context: 'AuthService' });
  }

  async loadSession(): Promise<AuthenticatedSession | null> {
    await this.ensureDefaultUsers();

    const token = this.getSessionToken();
    if (!token) {
      this.clearEncryptionContext();
      logger.info('AuthService loadSession no token', { context: 'AuthService' });
      return null;
    }

    const now = nowTimestamp();
    await this.authRepository.purgeExpiredSessions(now);

    const session = await this.authRepository.findSessionByToken(token);
    if (!session) {
      this.clearSessionToken();
      this.clearEncryptionContext();
      logger.warn('AuthService loadSession invalid token', { context: 'AuthService' });
      return null;
    }

    if (session.expiresAt !== null && session.expiresAt <= now) {
      await this.authRepository.deleteSessionByToken(session.token);
      this.clearSessionToken();
      this.clearEncryptionContext();
      logger.warn('AuthService loadSession expired token', {
        context: 'AuthService'
      });
      return null;
    }

    const user = await this.authRepository.findUserById(session.userId);
    if (!user) {
      await this.authRepository.deleteSessionByToken(session.token);
      this.clearSessionToken();
      this.clearEncryptionContext();
      logger.warn('AuthService loadSession missing user', {
        context: 'AuthService'
      });
      return null;
    }

    if (!user.isActive) {
      await this.authRepository.deleteSessionByToken(session.token);
      this.clearSessionToken();
      this.clearEncryptionContext();
      logger.warn('AuthService loadSession inactive user', {
        context: 'AuthService'
      });
      return null;
    }

    if (
      this.activeEncryptionKeyOwnerId !== null &&
      this.activeEncryptionKeyOwnerId !== user.id
    ) {
      this.clearEncryptionContext();
    }

    logger.info('AuthService loadSession succeeded', {
      context: 'AuthService'
    });

    return {
      user: toPublicUser(user),
      session,
      hasActiveEncryptionKey:
        this.activeEncryptionKey !== null && this.activeEncryptionKeyOwnerId === user.id
    };
  }

  async getCurrentSession(): Promise<AuthenticatedSession | null> {
    return this.loadSession();
  }

  getActiveEncryptionKey(): CryptoKey | null {
    return this.activeEncryptionKey;
  }

  getCachedEncryptionKeyForUser(userId: string): CryptoKey | null {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      return null;
    }

    if (this.activeEncryptionKeyOwnerId !== normalizedUserId) {
      return null;
    }

    return this.activeEncryptionKey;
  }

  private persistSessionTokenByPreference(token: string, rememberMe: boolean): void {
    const localStorageRef = this.getLocalStorage();
    const sessionStorageRef = this.getSessionStorage();

    if (rememberMe) {
      this.volatileSessionToken = null;
      localStorageRef?.setItem(STORAGE_KEYS.sessionToken, token);
      sessionStorageRef?.removeItem(STORAGE_KEYS.sessionToken);
      return;
    }

    // Non-remembered sessions stay runtime-scoped only.
    this.volatileSessionToken = token;
    localStorageRef?.removeItem(STORAGE_KEYS.sessionToken);
    sessionStorageRef?.removeItem(STORAGE_KEYS.sessionToken);
  }

  private getSessionToken(): string | null {
    if (this.volatileSessionToken) {
      return this.volatileSessionToken;
    }

    return this.getLocalStorage()?.getItem(STORAGE_KEYS.sessionToken) ?? null;
  }

  private clearSessionToken(): void {
    this.volatileSessionToken = null;
    this.getLocalStorage()?.removeItem(STORAGE_KEYS.sessionToken);
    this.getSessionStorage()?.removeItem(STORAGE_KEYS.sessionToken);
  }

  private getLocalStorage():
    | Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
    | null {
    if (typeof window === 'undefined') {
      return null;
    }

    return window.localStorage ?? null;
  }

  private getSessionStorage():
    | Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
    | null {
    if (typeof window === 'undefined') {
      return null;
    }

    return window.sessionStorage ?? null;
  }

  private clearEncryptionContext(): void {
    this.activeEncryptionKey = null;
    this.activeEncryptionKeyOwnerId = null;
  }

  private async requireActiveAdmin(adminId: string): Promise<AuthenticatedUser> {
    const adminUser = await this.authRepository.findUserById(adminId);
    if (!adminUser || !adminUser.isActive || adminUser.role !== 'admin') {
      throw new AuthError('FORBIDDEN', 'Admin access is required.');
    }

    return adminUser;
  }

  private async requireActiveUserActor(actorId: string): Promise<AuthenticatedUser> {
    const actor = await this.authRepository.findUserById(actorId);
    if (!actor || !actor.isActive) {
      throw new AuthError('FORBIDDEN', 'Unauthorized');
    }

    return actor;
  }

  private assertCanAccessTargetUser(actor: AuthenticatedUser, targetUserId: string): void {
    if (actor.role !== 'admin' && actor.id !== targetUserId) {
      throw new AuthError('FORBIDDEN', 'Forbidden');
    }
  }

  private async requireExistingUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new AuthError('USER_NOT_FOUND', 'User not found.');
    }

    return user;
  }

  private async assertHasAnotherActiveAdmin(excludingUserId: string): Promise<void> {
    const users = await this.authRepository.getAllUsers();
    const activeAdmins = users.filter(
      (user) => user.role === 'admin' && user.isActive && user.id !== excludingUserId
    );

    if (activeAdmins.length === 0) {
      throw new AuthError(
        'LAST_ADMIN_PROTECTION',
        'At least one active admin must remain in the system.'
      );
    }
  }

  private async requiresInitialAdminSetup(): Promise<boolean> {
    const users = await this.authRepository.getAllUsers();
    return !users.some((user) => user.role === 'admin');
  }

  private assertStrongBootstrapPassword(password: string): void {
    const guidance =
      'Password must be at least 12 characters and include uppercase, lowercase, number, and symbol.';

    if (password.length < 12) {
      throw new AuthError('WEAK_PASSWORD', guidance);
    }

    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSymbol = /[^A-Za-z0-9]/.test(password);
    if (!hasUpper || !hasLower || !hasNumber || !hasSymbol) {
      throw new AuthError('WEAK_PASSWORD', guidance);
    }
  }

  private async ensureDefaultUsers(): Promise<void> {
    if (!ENABLE_DEFAULT_ADMIN_SEED) {
      return;
    }

    if (!this.seedPromise) {
      this.seedPromise = this.seedDefaultUsers();
    }

    await this.seedPromise;
  }

  private async seedDefaultUsers(): Promise<void> {
    for (const userSeed of DEFAULT_SEED_USERS) {
      const username = normalizeRegistrationUsername(userSeed.username);
      const existing = await this.authRepository.findUserByUsername(username);
      if (existing) {
        continue;
      }

      const salt = createSalt();
      const passwordHash = await hashPassword(userSeed.password, salt);

      try {
        await this.authRepository.createUser({
          id: createId(),
          username,
          role: userSeed.role,
          isActive: true,
          notificationPreferences: defaultNotificationPreferences(),
          blockedUserIds: [],
          passwordHash,
          salt,
          createdAt: nowTimestamp(),
          failedAttempts: 0,
          lockUntil: null
        });
        const createdUser = await this.authRepository.findUserByUsername(username);
        if (createdUser) {
          await this.searchService?.indexUser(toPublicUser(createdUser));
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'USERNAME_ALREADY_EXISTS') {
          continue;
        }

        throw error;
      }
    }
  }
}

export function createAuthService(
  authRepository: AuthRepository,
  searchService: SearchService | null = null,
  bookingService: BookingService | null = null
): AuthService {
  return new LocalAuthService(authRepository, searchService, bookingService);
}
