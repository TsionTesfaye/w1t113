import type { AuthenticatedUser, Booking, FormResponse, FormTemplate, ServiceItem } from '@/app/types/domain';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type { BookingRepository } from '@/repositories/BookingRepository';
import type { HealthFormRepository } from '@/repositories/HealthFormRepository';
import type { NotificationService } from '@/services/NotificationService';
import type { AuthService } from '@/services/AuthService';
import { HealthFormServiceError, createHealthFormService } from '@/services/HealthFormService';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN_ID = 'admin-1';
const CLIENT_ID = 'client-1';
const PHOTOGRAPHER_ID = 'photographer-1';
const BOOKING_ID = 'booking-1';
const SERVICE_ID = 'service-headshots-30';
const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function createEncryptedPayloadEnvelope(key: CryptoKey, plainText: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    key,
    encoder.encode(plainText)
  );

  return JSON.stringify({
    v: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  });
}

class InMemoryFormsRepository implements HealthFormRepository {
  templates: FormTemplate[] = [];
  responses: FormResponse[] = [];

  async createTemplate(template: FormTemplate): Promise<void> {
    this.templates.push({ ...template });
  }

  async updateTemplate(template: FormTemplate): Promise<void> {
    const index = this.templates.findIndex((candidate) => candidate.id === template.id);
    if (index === -1) {
      this.templates.push({ ...template });
      return;
    }

    this.templates[index] = { ...template };
  }

  async getTemplates(): Promise<FormTemplate[]> {
    return [...this.templates].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async getActiveTemplates(): Promise<FormTemplate[]> {
    return this.templates
      .filter((template) => template.isActive)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async getTemplateById(templateId: string): Promise<FormTemplate | null> {
    return this.templates.find((template) => template.id === templateId) ?? null;
  }

  async saveResponse(response: FormResponse): Promise<void> {
    const index = this.responses.findIndex((candidate) => candidate.id === response.id);
    if (index === -1) {
      this.responses.push({ ...response });
      return;
    }

    this.responses[index] = { ...response };
  }

  async getResponseByBookingAndUser(bookingId: string, userId: string): Promise<FormResponse | null> {
    return this.responses.find((response) => response.bookingId === bookingId && response.userId === userId) ?? null;
  }

  async getResponsesByUser(userId: string): Promise<FormResponse[]> {
    return this.responses.filter((response) => response.userId === userId);
  }

  async getResponsesByBooking(bookingId: string): Promise<FormResponse[]> {
    return this.responses.filter((response) => response.bookingId === bookingId);
  }

  async getAllResponses(): Promise<FormResponse[]> {
    return [...this.responses];
  }

  async deleteResponse(responseId: string): Promise<void> {
    this.responses = this.responses.filter((response) => response.id !== responseId);
  }
}

function createAuthRepositoryMock(): AuthRepository {
  const users: AuthenticatedUser[] = [
    {
      id: ADMIN_ID,
      username: 'admin',
      role: 'admin',
      isActive: true,
      passwordHash: 'hash',
      salt: 'salt',
      createdAt: Date.now(),
      failedAttempts: 0,
      lockUntil: null
    },
    {
      id: CLIENT_ID,
      username: 'client',
      role: 'client',
      isActive: true,
      passwordHash: 'hash',
      salt: 'salt',
      createdAt: Date.now(),
      failedAttempts: 0,
      lockUntil: null
    },
    {
      id: PHOTOGRAPHER_ID,
      username: 'photographer',
      role: 'photographer',
      isActive: true,
      passwordHash: 'hash',
      salt: 'salt',
      createdAt: Date.now(),
      failedAttempts: 0,
      lockUntil: null
    }
  ];

  return {
    getUserByUsername: vi.fn(async (username: string) => users.find((user) => user.username === username) ?? null),
    findUserByUsername: vi.fn(async (username: string) => users.find((user) => user.username === username) ?? null),
    findUserById: vi.fn(async (userId: string) => users.find((user) => user.id === userId) ?? null),
    getAllUsers: vi.fn(async () => [...users]),
    listUsers: vi.fn(async () => [...users]),
    createUser: vi.fn(async () => undefined),
    updateUserRole: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    updateUserStatus: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    updateLoginState: vi.fn(async () => undefined),
    createSession: vi.fn(async () => undefined),
    findSessionByToken: vi.fn(async () => null),
    deleteSessionByToken: vi.fn(async () => undefined),
    purgeExpiredSessions: vi.fn(async () => undefined)
  };
}

function createBookingRepositoryMock(): BookingRepository {
  const booking: Booking = {
    id: BOOKING_ID,
    userId: CLIENT_ID,
    photographerId: PHOTOGRAPHER_ID,
    serviceId: SERVICE_ID,
    slotId: 'slot-1',
    startTime: new Date(2026, 2, 30, 9, 0, 0, 0).getTime(),
    endTime: new Date(2026, 2, 30, 9, 30, 0, 0).getTime(),
    dayKey: '2026-03-30',
    status: 'confirmed',
    createdAt: Date.now()
  };

  const services: ServiceItem[] = [
    {
      id: SERVICE_ID,
      name: 'Headshots - 30 min - $175',
      durationMinutes: 30,
      price: 175
    }
  ];

  return {
    getServices: vi.fn(async () => [...services]),
    upsertServices: vi.fn(async () => undefined),
    getPhotographers: vi.fn(async () => []),
    getBookingsForDay: vi.fn(async () => [booking]),
    getAllBookings: vi.fn(async () => [booking]),
    getBookingsByPhotographer: vi.fn(async () => [booking]),
    getActiveLocksForDay: vi.fn(async () => []),
    getAllLocks: vi.fn(async () => []),
    getUserLock: vi.fn(async () => null),
    getActiveLockByUser: vi.fn(async () => null),
    createLock: vi.fn(async () => null),
    deleteUserLock: vi.fn(async () => false),
    deleteLocksForPhotographerRange: vi.fn(async () => 0),
    deleteExpiredLocks: vi.fn(async () => 0),
    confirmLockAndCreateBooking: vi.fn(async () => null),
    getBookingById: vi.fn(async (bookingId: string) => (bookingId === BOOKING_ID ? { ...booking } : null)),
    getBookingsByUser: vi.fn(async (userId: string) => (userId === CLIENT_ID ? [{ ...booking }] : [])),
    updateBookingStatus: vi.fn(async () => {
      throw new Error('not implemented');
    })
  };
}

describe('FormsService', () => {
  let formsRepository: InMemoryFormsRepository;
  let bookingRepository: BookingRepository;
  let service: ReturnType<typeof createHealthFormService>;
  let notificationService: NotificationService;
  let sessionKey: CryptoKey;
  let activeKey: CryptoKey | null;
  let sessionUserId: string | null;
  let sessionRole: 'admin' | 'client' | 'photographer' | 'moderator';

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 9, 0, 0, 0));

    formsRepository = new InMemoryFormsRepository();
    bookingRepository = createBookingRepositoryMock();
    sessionKey = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
    );
    activeKey = sessionKey;
    sessionUserId = CLIENT_ID;
    sessionRole = 'client';

    notificationService = {
      createNotification: vi.fn(async () => null),
      getUserNotifications: vi.fn(async () => []),
      markAsRead: vi.fn(async () => undefined),
      markAllAsRead: vi.fn(async () => undefined),
      getUnreadCount: vi.fn(async () => 0)
    };

    const resolveSession = () => {
      if (!sessionUserId) {
        return null;
      }

      return {
        user: {
          id: sessionUserId,
          username: sessionRole,
          role: sessionRole,
          isActive: true,
          createdAt: Date.now(),
          failedAttempts: 0,
          lockUntil: null
        },
        session: {
          id: 'session-1',
          userId: sessionUserId,
          token: 'token-1',
          createdAt: Date.now(),
          expiresAt: null,
          rememberMe: true
        },
        hasActiveEncryptionKey: Boolean(activeKey)
      };
    };

    const authServiceMock: AuthService = {
      isInitialAdminSetupRequired: vi.fn(async () => false),
      bootstrapInitialAdmin: vi.fn(async () => {
        throw new Error('not implemented');
      }),
      register: vi.fn(async () => {
        throw new Error('not implemented');
      }),
      getAllUsers: vi.fn(async () => []),
      changeUserRole: vi.fn(async () => {
        throw new Error('not implemented');
      }),
      setUserActiveStatus: vi.fn(async () => {
        throw new Error('not implemented');
      }),
      createUserByAdmin: vi.fn(async () => {
        throw new Error('not implemented');
      }),
      login: vi.fn(async () => {
        throw new Error('not implemented');
      }),
      logout: vi.fn(async () => undefined),
      loadSession: vi.fn(async () => resolveSession()),
      getCurrentSession: vi.fn(async () => resolveSession()),
      getActiveEncryptionKey: vi.fn(() => sessionKey),
      getCachedEncryptionKeyForUser: vi.fn(() => sessionKey)
    };

    const mutableAuthServiceMock: AuthService = {
      ...authServiceMock,
      getActiveEncryptionKey: vi.fn(() => activeKey),
      getCachedEncryptionKeyForUser: vi.fn(() => activeKey)
    };

    service = createHealthFormService(
      formsRepository,
      createAuthRepositoryMock(),
      bookingRepository,
      notificationService,
      mutableAuthServiceMock
    );
  });

  async function createTemplateWithCondition(): Promise<FormTemplate> {
    return service.createTemplate(ADMIN_ID, {
      name: 'Health declaration',
      description: 'Session intake',
      isActive: true,
      fields: [
        {
          id: 'has-allergies',
          type: 'radio',
          label: 'Do you have allergies?',
          required: true,
          options: ['yes', 'no']
        },
        {
          id: 'allergy-details',
          type: 'textarea',
          label: 'Please specify allergies',
          required: true,
          sensitive: true,
          condition: {
            fieldId: 'has-allergies',
            operator: 'equals',
            value: 'yes'
          }
        }
      ]
    });
  }

  async function createTemplateWithFileField(): Promise<FormTemplate> {
    return service.createTemplate(ADMIN_ID, {
      name: 'Health declaration with file',
      description: 'Includes attachment',
      isActive: true,
      fields: [
        {
          id: 'consent',
          type: 'radio',
          label: 'Consent',
          required: true,
          options: ['yes', 'no']
        },
        {
          id: 'medical-file',
          type: 'file',
          label: 'Medical attachment',
          required: false,
          sensitive: true
        }
      ]
    });
  }

  it('enforces required fields and rejects empty submission', async () => {
    await createTemplateWithCondition();

    await expect(service.submitForm(CLIENT_ID, BOOKING_ID, {})).rejects.toMatchObject({
      code: 'VALIDATION_FAILED'
    });
  });

  it('shows conditional fields only when condition is satisfied', async () => {
    const template = await createTemplateWithCondition();
    const hidden = service.evaluateVisibleFields(template, { 'has-allergies': 'no' });
    const shown = service.evaluateVisibleFields(template, { 'has-allergies': 'yes' });

    expect(hidden.map((field) => field.id)).toEqual(['has-allergies']);
    expect(shown.map((field) => field.id)).toEqual(['has-allergies', 'allergy-details']);
  });

  it('supports wizard-like step progression with per-step validation', async () => {
    const template = await createTemplateWithCondition();

    const stepOneFields = service.evaluateVisibleFields(template, {});
    const stepOneErrors = service.validateAnswers(template, stepOneFields, {});
    expect(stepOneErrors.some((error) => error.fieldId === 'has-allergies')).toBe(true);

    const stepOneAnswers = { 'has-allergies': 'yes' };
    const stepTwoFields = service.evaluateVisibleFields(template, stepOneAnswers);
    const stepTwoErrors = service.validateAnswers(
      template,
      stepTwoFields.filter((field) => field.id === 'allergy-details'),
      stepOneAnswers
    );
    expect(stepTwoErrors.some((error) => error.fieldId === 'allergy-details')).toBe(true);

    const completeAnswers = {
      'has-allergies': 'yes',
      'allergy-details': 'Pollen'
    };
    const completeErrors = service.validateAnswers(template, stepTwoFields, completeAnswers);
    expect(completeErrors).toEqual([]);
  });

  it('ignores hidden required fields and accepts valid conditional submission', async () => {
    await createTemplateWithCondition();
    const response = await service.submitForm(CLIENT_ID, BOOKING_ID, {
      'has-allergies': 'no'
    });

    expect(response.status).toBe('submitted');
    expect(response.submittedAt).not.toBeNull();
  });

  it('saves draft with partial data and reloads decrypted draft answers', async () => {
    await createTemplateWithCondition();
    await service.saveDraft(CLIENT_ID, BOOKING_ID, {
      'has-allergies': 'yes'
    });

    const loaded = await service.getFormForBooking(CLIENT_ID, BOOKING_ID);
    expect(loaded.response?.status).toBe('draft');
    expect(loaded.answers['has-allergies']).toBe('yes');
  });

  it('blocks duplicate submit within 24 hours and allows after window', async () => {
    await createTemplateWithCondition();

    await service.submitForm(CLIENT_ID, BOOKING_ID, {
      'has-allergies': 'yes',
      'allergy-details': 'Peanuts'
    });

    await expect(
      service.submitForm(CLIENT_ID, BOOKING_ID, {
        'has-allergies': 'yes',
        'allergy-details': 'Peanuts'
      })
    ).rejects.toMatchObject({
      code: 'DUPLICATE_SUBMISSION'
    });

    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1_000);
    const next = await service.submitForm(CLIENT_ID, BOOKING_ID, {
      'has-allergies': 'yes',
      'allergy-details': 'Peanuts'
    });
    expect(next.status).toBe('submitted');
  });

  it('encrypts answers before storage and decrypts them when loaded', async () => {
    await createTemplateWithCondition();
    await service.saveDraft(CLIENT_ID, BOOKING_ID, {
      'has-allergies': 'yes',
      'allergy-details': 'Severe pollen allergy'
    });

    const stored = formsRepository.responses[0];
    expect(stored?.encryptedAnswers).toBeTruthy();
    expect(stored?.encryptedAnswers).not.toContain('Severe pollen allergy');

    const loaded = await service.getFormForBooking(CLIENT_ID, BOOKING_ID);
    expect(loaded.answers['allergy-details']).toBe('Severe pollen allergy');
  });

  it('fails decryption safely when session key changes (wrong password scenario)', async () => {
    await createTemplateWithCondition();
    await service.saveDraft(CLIENT_ID, BOOKING_ID, {
      'has-allergies': 'yes',
      'allergy-details': 'Private value'
    });

    activeKey = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
    );

    const loaded = await service.getFormForBooking(CLIENT_ID, BOOKING_ID);
    expect(loaded.decryptionIssue).toBeTruthy();
    expect(loaded.answers['allergy-details']).toBeUndefined();
    expect(loaded.canEdit).toBe(false);
  });

  it('denies cross-user decryption after logout/login role switch', async () => {
    await createTemplateWithCondition();
    await service.saveDraft(CLIENT_ID, BOOKING_ID, {
      'has-allergies': 'yes',
      'allergy-details': 'Highly private'
    });

    const stored = formsRepository.responses[0];
    if (!stored) {
      throw new Error('Missing stored form response');
    }

    const ownerDecrypted = await service.decryptAnswers(CLIENT_ID, stored.encryptedAnswers);
    expect(ownerDecrypted['allergy-details']).toBe('Highly private');

    sessionUserId = null;
    activeKey = null;

    sessionUserId = PHOTOGRAPHER_ID;
    sessionRole = 'photographer';
    activeKey = sessionKey;

    await expect(service.decryptAnswers(CLIENT_ID, stored.encryptedAnswers)).rejects.toMatchObject({
      code: 'FORBIDDEN'
    });
  });

  it('decrypts nested file.data payload for submitted responses', async () => {
    const template = await createTemplateWithFileField();
    const nestedData = await createEncryptedPayloadEnvelope(sessionKey, JSON.stringify('RklMRQ=='));

    const encryptedAnswers = await service.encryptAnswers(CLIENT_ID, {
      consent: 'yes',
      'medical-file': {
        name: 'medical-note.pdf',
        mimeType: 'application/pdf',
        data: nestedData,
        size: 4
      }
    });

    await formsRepository.saveResponse({
      id: 'form-response-file',
      templateId: template.id,
      templateVersion: template.version,
      bookingId: BOOKING_ID,
      userId: CLIENT_ID,
      encryptedAnswers,
      status: 'submitted',
      submittedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      templateSnapshot: {
        id: template.id,
        name: template.name,
        description: template.description,
        version: template.version,
        fields: template.fields
      }
    });

    const loaded = await service.getFormResponseForBooking(ADMIN_ID, BOOKING_ID);
    const attachment = loaded.answers['medical-file'] as
      | { name: string; mimeType: string; data: string; size?: number }
      | undefined;

    expect(attachment?.name).toBe('medical-note.pdf');
    expect(attachment?.mimeType).toBe('application/pdf');
    expect(attachment?.data).toBe('RklMRQ==');
  });

  it('decrypts nested file.data payload when encrypted envelope is stored as object', async () => {
    const template = await createTemplateWithFileField();
    const nestedDataObject = JSON.parse(
      await createEncryptedPayloadEnvelope(sessionKey, JSON.stringify('RklMRQ=='))
    ) as { v: number; iv: string; ciphertext: string };

    const encryptedAnswers = await service.encryptAnswers(CLIENT_ID, {
      consent: 'yes',
      'medical-file': {
        name: 'medical-note.pdf',
        mimeType: 'application/pdf',
        data: nestedDataObject,
        size: 4
      }
    });

    await formsRepository.saveResponse({
      id: 'form-response-file-object-payload',
      templateId: template.id,
      templateVersion: template.version,
      bookingId: BOOKING_ID,
      userId: CLIENT_ID,
      encryptedAnswers,
      status: 'submitted',
      submittedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      templateSnapshot: {
        id: template.id,
        name: template.name,
        description: template.description,
        version: template.version,
        fields: template.fields
      }
    });

    const loaded = await service.getFormResponseForBooking(ADMIN_ID, BOOKING_ID);
    const attachment = loaded.answers['medical-file'] as
      | { name: string; mimeType: string; data: string; size?: number }
      | undefined;

    expect(attachment?.name).toBe('medical-note.pdf');
    expect(attachment?.mimeType).toBe('application/pdf');
    expect(attachment?.data).toBe('RklMRQ==');
  });

  it('normalizes data-url attachment payloads after decryption', async () => {
    const template = await createTemplateWithFileField();
    const nestedData = await createEncryptedPayloadEnvelope(sessionKey, JSON.stringify('data:text/plain;base64,RklMRQ=='));

    const encryptedAnswers = await service.encryptAnswers(CLIENT_ID, {
      consent: 'yes',
      'medical-file': {
        name: 'medical-note.txt',
        mimeType: 'text/plain',
        data: nestedData,
        size: 4
      }
    });

    await formsRepository.saveResponse({
      id: 'form-response-file-data-url',
      templateId: template.id,
      templateVersion: template.version,
      bookingId: BOOKING_ID,
      userId: CLIENT_ID,
      encryptedAnswers,
      status: 'submitted',
      submittedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      templateSnapshot: {
        id: template.id,
        name: template.name,
        description: template.description,
        version: template.version,
        fields: template.fields
      }
    });

    const loaded = await service.getFormResponseForBooking(ADMIN_ID, BOOKING_ID);
    const attachment = loaded.answers['medical-file'] as
      | { name: string; mimeType: string; data: string; size?: number }
      | undefined;

    expect(attachment?.name).toBe('medical-note.txt');
    expect(attachment?.mimeType).toBe('text/plain');
    expect(attachment?.data).toBe('RklMRQ==');
  });

  it('keeps file field with fallback when nested attachment decryption fails', async () => {
    const template = await createTemplateWithFileField();
    const nestedData = JSON.stringify({
      v: 1,
      iv: 'invalid-iv',
      ciphertext: 'invalid-ciphertext'
    });

    const encryptedAnswers = await service.encryptAnswers(CLIENT_ID, {
      consent: 'yes',
      'medical-file': {
        name: 'broken-file.pdf',
        mimeType: 'application/pdf',
        data: nestedData
      }
    });

    await formsRepository.saveResponse({
      id: 'form-response-file-fallback',
      templateId: template.id,
      templateVersion: template.version,
      bookingId: BOOKING_ID,
      userId: CLIENT_ID,
      encryptedAnswers,
      status: 'submitted',
      submittedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      templateSnapshot: {
        id: template.id,
        name: template.name,
        description: template.description,
        version: template.version,
        fields: template.fields
      }
    });

    const loaded = await service.getFormResponseForBooking(ADMIN_ID, BOOKING_ID);
    const attachment = loaded.answers['medical-file'] as
      | { name: string; mimeType: string; data: string; size?: number }
      | undefined;

    expect(attachment?.name).toBe('File unavailable');
    expect(attachment?.data).toBeTruthy();
  });
});
