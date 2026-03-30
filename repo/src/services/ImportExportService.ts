import type { StoreName } from '@/db/schema';
import { DB_VERSION, STORE_NAMES } from '@/db/schema';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type { ImportExportRepository } from '@/repositories/ImportExportRepository';
import { nowMs } from '@/services/timeSource';
import { logger } from '@/utils/logger';

const USER_ROLES = new Set(['admin', 'photographer', 'client', 'moderator']);
const BOOKING_STATUSES = new Set([
  'pending',
  'confirmed',
  'arrived',
  'started',
  'rescheduled',
  'blocked',
  'canceled',
  'completed',
  'photographer_unavailable',
  'missed',
  'auto_completed'
]);
const BOOKING_EVENT_TYPES = new Set(['accepted', 'arrived', 'started', 'ended']);
const FORM_FIELD_TYPES = new Set(['text', 'textarea', 'checkbox', 'select', 'radio', 'file']);
const FORM_FIELD_OPERATORS = new Set(['equals', 'notEquals', 'includes']);
const FORM_RESPONSE_STATUSES = new Set(['draft', 'submitted']);
const POST_TYPES = new Set(['post', 'question']);
const REPORT_TARGET_TYPES = new Set(['post', 'comment']);
const REPORT_STATUSES = new Set(['open', 'resolved']);
const SEARCH_TYPES = new Set(['booking', 'user', 'post']);
const TOKENIZER_STRATEGIES = new Set(['whitespace', 'simple', 'alphanumeric']);
const OUTBOX_STATUSES = new Set(['pending', 'processing', 'failed', 'completed']);
const ALLOWED_STORE_FIELDS: Partial<Record<StoreName, Set<string>>> = {
  users: new Set([
    'id',
    'username',
    'role',
    'isActive',
    'passwordHash',
    'salt',
    'createdAt',
    'failedAttempts',
    'lockUntil',
    'notificationPreferences',
    'blockedUserIds'
  ]),
  sessions: new Set(['id', 'userId', 'token', 'createdAt', 'expiresAt', 'rememberMe']),
  serviceItems: new Set([
    'id',
    'name',
    'durationMinutes',
    'price',
    'isActive',
    'createdAt',
    'updatedAt'
  ]),
  photographers: new Set(['id', 'name', 'isActive']),
  availabilitySlots: new Set(['id', 'photographerId', 'startTime', 'endTime', 'isBooked']),
  slotLocks: new Set([
    'id',
    'slotId',
    'photographerId',
    'userId',
    'startTime',
    'endTime',
    'dayKey',
    'expiresAt'
  ]),
  bookings: new Set([
    'id',
    'userId',
    'photographerId',
    'serviceId',
    'slotId',
    'startTime',
    'endTime',
    'dayKey',
    'status',
    'createdByUserId',
    'createdByRole',
    'createdAt'
  ]),
  bookingEvents: new Set(['id', 'bookingId', 'type', 'createdAt', 'metadata']),
  threads: new Set(['id', 'bookingId', 'participants', 'createdAt']),
  messages: new Set([
    'id',
    'threadId',
    'senderId',
    'senderRole',
    'senderDisplayName',
    'content',
    'createdAt',
    'readBy'
  ]),
  notifications: new Set([
    'id',
    'userId',
    'type',
    'message',
    'metadata',
    'read',
    'createdAt',
    'dedupKey'
  ]),
  notificationPreferences: new Set([
    'id',
    'userId',
    'inAppEnabled',
    'emailEnabled',
    'smsEnabled',
    'booking',
    'messages',
    'community'
  ]),
  formTemplates: new Set([
    'id',
    'name',
    'description',
    'isActive',
    'version',
    'fields',
    'createdBy',
    'createdAt',
    'updatedAt'
  ]),
  formResponses: new Set([
    'id',
    'templateId',
    'templateVersion',
    'bookingId',
    'userId',
    'encryptedAnswers',
    'status',
    'submittedAt',
    'createdAt',
    'updatedAt',
    'templateSnapshot'
  ]),
  posts: new Set([
    'id',
    'authorId',
    'authorRole',
    'type',
    'content',
    'createdAt',
    'likeCount',
    'favoriteCount',
    'acceptedAnswerId'
  ]),
  comments: new Set(['id', 'postId', 'authorId', 'authorRole', 'parentId', 'content', 'createdAt', 'likeCount']),
  likes: new Set(['id', 'userId', 'postId', 'commentId', 'createdAt']),
  favorites: new Set(['id', 'userId', 'postId', 'createdAt']),
  follows: new Set(['id', 'followerId', 'followingId', 'createdAt']),
  reports: new Set(['id', 'reporterId', 'targetId', 'targetType', 'reason', 'createdAt', 'status']),
  blocks: new Set(['id', 'blockerId', 'blockedUserId', 'createdAt']),
  searchIndex: new Set(['id', 'type', 'title', 'content', 'tokens', 'createdAt', 'metadata']),
  outbox: new Set(['id', 'type', 'payload', 'idempotencyKey', 'messageHash', 'retryCount', 'nextRetryAt', 'status']),
  schedulerState: new Set(['id', 'lastRunAt', 'lastStartupReconciliationAt']),
  appConfig: new Set(['id', 'notificationSettings', 'synonyms', 'tokenizer', 'updatedAt'])
};

export interface ImportValidationDetail {
  store: StoreName;
  index: number;
  id?: string;
  field?: string;
  issue: string;
}

export interface ImportValidationResult {
  valid: boolean;
  errors: string[];
  details: ImportValidationDetail[];
}

export class ImportExportValidationError extends Error {
  readonly code = 'INVALID_IMPORT';
  readonly details: ImportValidationDetail[];

  constructor(message: string, details: ImportValidationDetail[]) {
    super(message);
    this.details = details;
  }
}

export interface ImportExportService {
  exportBackup(actorId: string): Promise<Blob>;
  validateImport(actorId: string, rawJson: string): Promise<ImportValidationResult>;
  importBackup(actorId: string, rawJson: string): Promise<void>;
}

interface BackupEnvelope {
  schemaVersion: number;
  exportedAt: number;
  stores: Record<StoreName, unknown[]>;
}

type GenericRecord = Record<string, unknown>;

const BACKUP_ENVELOPE_KEYS = new Set(['schemaVersion', 'exportedAt', 'stores']);

interface ValidationContext {
  stores: Record<StoreName, unknown[]>;
  details: ImportValidationDetail[];
  idsByStore: Record<StoreName, Set<string>>;
}

function isRecord(value: unknown): value is GenericRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createInvalidImportError(
  message: string,
  details: ImportValidationDetail[] = []
): ImportExportValidationError {
  const normalizedDetails =
    details.length > 0
      ? details
      : [
        {
            store: 'appConfig' as StoreName,
            index: -1,
            issue: message
          }
        ];

  return new ImportExportValidationError(message, normalizedDetails);
}

function readId(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  return typeof value.id === 'string' && value.id.trim().length > 0 ? value.id : null;
}

function parseBackup(rawJson: string): BackupEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw createInvalidImportError('Invalid JSON file.');
  }

  if (!isRecord(parsed)) {
    throw createInvalidImportError('Backup format is invalid.');
  }

  for (const key of Object.keys(parsed)) {
    if (!BACKUP_ENVELOPE_KEYS.has(key)) {
      throw createInvalidImportError(`Backup contains unsupported top-level key "${key}".`);
    }
  }

  const schemaVersion = parsed.schemaVersion;
  const storesValue = parsed.stores;
  if (
    typeof schemaVersion !== 'number' ||
    !Number.isFinite(schemaVersion) ||
    !isRecord(storesValue)
  ) {
    throw createInvalidImportError('Backup schema is invalid.');
  }

  for (const key of Object.keys(storesValue)) {
    if (!(STORE_NAMES as readonly string[]).includes(key)) {
      throw createInvalidImportError(`Backup schema contains unknown store "${key}".`);
    }
  }

  const normalizedStores = {} as Record<StoreName, unknown[]>;
  for (const storeName of STORE_NAMES) {
    const value = storesValue[storeName];
    if (!Array.isArray(value)) {
      throw createInvalidImportError(`Backup schema is missing required store "${storeName}".`);
    }

    normalizedStores[storeName] = value;
  }

  return {
    schemaVersion,
    exportedAt:
      typeof parsed.exportedAt === 'number' && Number.isFinite(parsed.exportedAt) ? parsed.exportedAt : 0,
    stores: normalizedStores
  };
}

function addDetail(
  details: ImportValidationDetail[],
  store: StoreName,
  index: number,
  issue: string,
  id?: string,
  field?: string
): void {
  details.push({
    store,
    index,
    issue,
    ...(id ? { id } : {}),
    ...(field ? { field } : {})
  });
}

function getRecord(
  context: ValidationContext,
  store: StoreName,
  index: number
): GenericRecord | null {
  const record = context.stores[store][index];
  if (!isRecord(record)) {
    addDetail(context.details, store, index, 'Record must be an object.');
    return null;
  }

  return record;
}

function expectString(
  context: ValidationContext,
  store: StoreName,
  index: number,
  record: GenericRecord,
  field: string,
  options: { optional?: boolean; nonEmpty?: boolean } = {}
): string | null {
  const value = record[field];
  const optional = options.optional === true;
  const nonEmpty = options.nonEmpty !== false;

  if (value === undefined || value === null) {
    if (!optional) {
      addDetail(context.details, store, index, `Missing required string field "${field}".`, readId(record) ?? undefined, field);
    }
    return null;
  }

  if (typeof value !== 'string') {
    addDetail(context.details, store, index, `Field "${field}" must be a string.`, readId(record) ?? undefined, field);
    return null;
  }

  if (nonEmpty && value.trim().length === 0) {
    addDetail(context.details, store, index, `Field "${field}" cannot be empty.`, readId(record) ?? undefined, field);
    return null;
  }

  return value;
}

function expectNumber(
  context: ValidationContext,
  store: StoreName,
  index: number,
  record: GenericRecord,
  field: string,
  options: { optional?: boolean; min?: number } = {}
): number | null {
  const value = record[field];
  const optional = options.optional === true;

  if (value === undefined || value === null) {
    if (!optional) {
      addDetail(context.details, store, index, `Missing required number field "${field}".`, readId(record) ?? undefined, field);
    }
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addDetail(context.details, store, index, `Field "${field}" must be a finite number.`, readId(record) ?? undefined, field);
    return null;
  }

  if (typeof options.min === 'number' && value < options.min) {
    addDetail(context.details, store, index, `Field "${field}" must be >= ${options.min}.`, readId(record) ?? undefined, field);
    return null;
  }

  return value;
}

function expectBoolean(
  context: ValidationContext,
  store: StoreName,
  index: number,
  record: GenericRecord,
  field: string,
  options: { optional?: boolean } = {}
): boolean | null {
  const value = record[field];
  const optional = options.optional === true;
  if (value === undefined || value === null) {
    if (!optional) {
      addDetail(context.details, store, index, `Missing required boolean field "${field}".`, readId(record) ?? undefined, field);
    }
    return null;
  }

  if (typeof value !== 'boolean') {
    addDetail(context.details, store, index, `Field "${field}" must be a boolean.`, readId(record) ?? undefined, field);
    return null;
  }

  return value;
}

function expectNullableNumber(
  context: ValidationContext,
  store: StoreName,
  index: number,
  record: GenericRecord,
  field: string
): number | null {
  const value = record[field];
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addDetail(context.details, store, index, `Field "${field}" must be null or number.`, readId(record) ?? undefined, field);
    return null;
  }

  return value;
}

function expectNullableString(
  context: ValidationContext,
  store: StoreName,
  index: number,
  record: GenericRecord,
  field: string
): string | null {
  const value = record[field];
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    addDetail(context.details, store, index, `Field "${field}" must be null or string.`, readId(record) ?? undefined, field);
    return null;
  }

  return value;
}

function expectStringArray(
  context: ValidationContext,
  store: StoreName,
  index: number,
  record: GenericRecord,
  field: string,
  options: { optional?: boolean } = {}
): string[] | null {
  const value = record[field];
  const optional = options.optional === true;
  if (value === undefined || value === null) {
    if (!optional) {
      addDetail(context.details, store, index, `Missing required array field "${field}".`, readId(record) ?? undefined, field);
    }
    return null;
  }

  if (!Array.isArray(value)) {
    addDetail(context.details, store, index, `Field "${field}" must be an array.`, readId(record) ?? undefined, field);
    return null;
  }

  const invalidIndex = value.findIndex((item) => typeof item !== 'string');
  if (invalidIndex >= 0) {
    addDetail(context.details, store, index, `Field "${field}" must contain only strings.`, readId(record) ?? undefined, field);
    return null;
  }

  return value as string[];
}

function expectEnum(
  context: ValidationContext,
  store: StoreName,
  index: number,
  record: GenericRecord,
  field: string,
  enumSet: Set<string>,
  options: { optional?: boolean } = {}
): string | null {
  const value = record[field];
  const optional = options.optional === true;
  if (value === undefined || value === null) {
    if (!optional) {
      addDetail(context.details, store, index, `Missing required enum field "${field}".`, readId(record) ?? undefined, field);
    }
    return null;
  }

  if (typeof value !== 'string' || !enumSet.has(value)) {
    addDetail(context.details, store, index, `Field "${field}" contains invalid value.`, readId(record) ?? undefined, field);
    return null;
  }

  return value;
}

function expectObjectOrNull(
  context: ValidationContext,
  store: StoreName,
  index: number,
  record: GenericRecord,
  field: string,
  options: { optional?: boolean } = {}
): GenericRecord | null {
  const value = record[field];
  const optional = options.optional === true;
  if (value === undefined) {
    if (!optional) {
      addDetail(context.details, store, index, `Missing required object field "${field}".`, readId(record) ?? undefined, field);
    }
    return null;
  }

  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    addDetail(context.details, store, index, `Field "${field}" must be an object or null.`, readId(record) ?? undefined, field);
    return null;
  }

  return value;
}

function hasStoreId(context: ValidationContext, store: StoreName, id: string): boolean {
  return context.idsByStore[store].has(id);
}

function validateForeignKey(
  context: ValidationContext,
  sourceStore: StoreName,
  index: number,
  sourceRecord: GenericRecord,
  field: string,
  targetStore: StoreName
): void {
  const value = expectString(context, sourceStore, index, sourceRecord, field);
  if (!value) {
    return;
  }

  if (!hasStoreId(context, targetStore, value)) {
    addDetail(
      context.details,
      sourceStore,
      index,
      `Field "${field}" references missing ${targetStore} record "${value}".`,
      readId(sourceRecord) ?? undefined,
      field
    );
  }
}

function validateUserRecord(context: ValidationContext, index: number): void {
  const record = getRecord(context, 'users', index);
  if (!record) {
    return;
  }

  expectString(context, 'users', index, record, 'id');
  expectString(context, 'users', index, record, 'username');
  expectEnum(context, 'users', index, record, 'role', USER_ROLES);
  expectBoolean(context, 'users', index, record, 'isActive');
  expectString(context, 'users', index, record, 'passwordHash');
  expectString(context, 'users', index, record, 'salt');
  expectNumber(context, 'users', index, record, 'createdAt');
  expectNumber(context, 'users', index, record, 'failedAttempts', { min: 0 });
  expectNullableNumber(context, 'users', index, record, 'lockUntil');
  const preferences = expectObjectOrNull(context, 'users', index, record, 'notificationPreferences');
  if (preferences) {
    for (const key of ['booking', 'messages', 'community']) {
      if (typeof preferences[key] !== 'boolean') {
        addDetail(context.details, 'users', index, `notificationPreferences.${key} must be boolean.`, readId(record) ?? undefined, `notificationPreferences.${key}`);
      }
    }
  }
  expectStringArray(context, 'users', index, record, 'blockedUserIds');
}

function validateRecordByStore(context: ValidationContext, store: StoreName, index: number): void {
  const record = getRecord(context, store, index);
  if (!record) {
    return;
  }

  const allowedFields = ALLOWED_STORE_FIELDS[store];
  if (allowedFields) {
    for (const key of Object.keys(record)) {
      if (!allowedFields.has(key)) {
        addDetail(
          context.details,
          store,
          index,
          `Field "${key}" is not allowed for store "${store}".`,
          readId(record) ?? undefined,
          key
        );
      }
    }
  }

  const recordId = expectString(context, store, index, record, 'id');
  if (!recordId) {
    return;
  }

  switch (store) {
    case 'users':
      validateUserRecord(context, index);
      return;
    case 'sessions':
      validateForeignKey(context, 'sessions', index, record, 'userId', 'users');
      expectString(context, 'sessions', index, record, 'token');
      expectNumber(context, 'sessions', index, record, 'createdAt');
      expectNullableNumber(context, 'sessions', index, record, 'expiresAt');
      expectBoolean(context, 'sessions', index, record, 'rememberMe');
      return;
    case 'serviceItems':
      expectString(context, 'serviceItems', index, record, 'name');
      expectNumber(context, 'serviceItems', index, record, 'durationMinutes', { min: 1 });
      expectBoolean(context, 'serviceItems', index, record, 'isActive');
      expectNumber(context, 'serviceItems', index, record, 'createdAt');
      expectNumber(context, 'serviceItems', index, record, 'updatedAt');
      expectNumber(context, 'serviceItems', index, record, 'price', { optional: true, min: 0 });
      return;
    case 'photographers':
      expectString(context, 'photographers', index, record, 'name');
      expectBoolean(context, 'photographers', index, record, 'isActive');
      if (!hasStoreId(context, 'users', recordId)) {
        addDetail(context.details, 'photographers', index, `Photographer id "${recordId}" must reference an existing user record.`, recordId, 'id');
      }
      return;
    case 'availabilitySlots':
      validateForeignKey(context, 'availabilitySlots', index, record, 'photographerId', 'users');
      expectNumber(context, 'availabilitySlots', index, record, 'startTime');
      expectNumber(context, 'availabilitySlots', index, record, 'endTime');
      expectBoolean(context, 'availabilitySlots', index, record, 'isBooked');
      return;
    case 'slotLocks':
      expectString(context, 'slotLocks', index, record, 'slotId');
      validateForeignKey(context, 'slotLocks', index, record, 'photographerId', 'users');
      validateForeignKey(context, 'slotLocks', index, record, 'userId', 'users');
      expectNumber(context, 'slotLocks', index, record, 'startTime');
      expectNumber(context, 'slotLocks', index, record, 'endTime');
      expectString(context, 'slotLocks', index, record, 'dayKey');
      expectNumber(context, 'slotLocks', index, record, 'expiresAt');
      return;
    case 'bookings':
      validateForeignKey(context, 'bookings', index, record, 'userId', 'users');
      validateForeignKey(context, 'bookings', index, record, 'photographerId', 'users');
      validateForeignKey(context, 'bookings', index, record, 'serviceId', 'serviceItems');
      expectString(context, 'bookings', index, record, 'slotId');
      expectNumber(context, 'bookings', index, record, 'startTime');
      expectNumber(context, 'bookings', index, record, 'endTime');
      expectString(context, 'bookings', index, record, 'dayKey');
      expectEnum(context, 'bookings', index, record, 'status', BOOKING_STATUSES);
      expectNumber(context, 'bookings', index, record, 'createdAt');
      expectEnum(context, 'bookings', index, record, 'createdByRole', new Set(['client', 'admin']), {
        optional: true
      });
      const createdByUserId = expectString(context, 'bookings', index, record, 'createdByUserId', {
        optional: true
      });
      if (createdByUserId && !hasStoreId(context, 'users', createdByUserId)) {
        addDetail(context.details, 'bookings', index, `createdByUserId references missing user "${createdByUserId}".`, readId(record) ?? undefined, 'createdByUserId');
      }
      return;
    case 'bookingEvents':
      validateForeignKey(context, 'bookingEvents', index, record, 'bookingId', 'bookings');
      expectEnum(context, 'bookingEvents', index, record, 'type', BOOKING_EVENT_TYPES);
      if (typeof record.createdAt !== 'string' && typeof record.createdAt !== 'number') {
        addDetail(context.details, 'bookingEvents', index, 'Field "createdAt" must be string or number.', readId(record) ?? undefined, 'createdAt');
      }
      expectObjectOrNull(context, 'bookingEvents', index, record, 'metadata');
      return;
    case 'threads':
      validateForeignKey(context, 'threads', index, record, 'bookingId', 'bookings');
      const participants = expectStringArray(context, 'threads', index, record, 'participants');
      if (participants) {
        for (const participantId of participants) {
          if (!hasStoreId(context, 'users', participantId)) {
            addDetail(context.details, 'threads', index, `Participant "${participantId}" is missing from users store.`, readId(record) ?? undefined, 'participants');
          }
        }
      }
      expectNumber(context, 'threads', index, record, 'createdAt');
      return;
    case 'messages':
      validateForeignKey(context, 'messages', index, record, 'threadId', 'threads');
      validateForeignKey(context, 'messages', index, record, 'senderId', 'users');
      expectString(context, 'messages', index, record, 'content');
      expectNumber(context, 'messages', index, record, 'createdAt');
      expectStringArray(context, 'messages', index, record, 'readBy');
      expectEnum(context, 'messages', index, record, 'senderRole', USER_ROLES, { optional: true });
      expectString(context, 'messages', index, record, 'senderDisplayName', { optional: true });
      return;
    case 'notifications':
      validateForeignKey(context, 'notifications', index, record, 'userId', 'users');
      expectString(context, 'notifications', index, record, 'type');
      expectString(context, 'notifications', index, record, 'message');
      expectBoolean(context, 'notifications', index, record, 'read');
      expectNumber(context, 'notifications', index, record, 'createdAt');
      expectNullableString(context, 'notifications', index, record, 'dedupKey');
      expectObjectOrNull(context, 'notifications', index, record, 'metadata');
      return;
    case 'notificationPreferences':
      validateForeignKey(context, 'notificationPreferences', index, record, 'userId', 'users');
      expectBoolean(context, 'notificationPreferences', index, record, 'inAppEnabled');
      expectBoolean(context, 'notificationPreferences', index, record, 'emailEnabled');
      expectBoolean(context, 'notificationPreferences', index, record, 'smsEnabled');
      expectBoolean(context, 'notificationPreferences', index, record, 'booking');
      expectBoolean(context, 'notificationPreferences', index, record, 'messages');
      expectBoolean(context, 'notificationPreferences', index, record, 'community');
      return;
    case 'healthTemplates':
      expectString(context, 'healthTemplates', index, record, 'name', { optional: true });
      return;
    case 'healthDrafts':
      const draftBookingId = expectString(context, 'healthDrafts', index, record, 'bookingId', {
        optional: true
      });
      if (draftBookingId && !hasStoreId(context, 'bookings', draftBookingId)) {
        addDetail(context.details, 'healthDrafts', index, `bookingId references missing booking "${draftBookingId}".`, readId(record) ?? undefined, 'bookingId');
      }
      const draftUserId = expectString(context, 'healthDrafts', index, record, 'userId', {
        optional: true
      });
      if (draftUserId && !hasStoreId(context, 'users', draftUserId)) {
        addDetail(context.details, 'healthDrafts', index, `userId references missing user "${draftUserId}".`, readId(record) ?? undefined, 'userId');
      }
      return;
    case 'healthSubmissions':
      const submissionBookingId = expectString(
        context,
        'healthSubmissions',
        index,
        record,
        'bookingId',
        {
          optional: true
        }
      );
      if (submissionBookingId && !hasStoreId(context, 'bookings', submissionBookingId)) {
        addDetail(context.details, 'healthSubmissions', index, `bookingId references missing booking "${submissionBookingId}".`, readId(record) ?? undefined, 'bookingId');
      }
      const submissionClientId =
        expectString(context, 'healthSubmissions', index, record, 'clientId', { optional: true }) ??
        expectString(context, 'healthSubmissions', index, record, 'userId', { optional: true });
      if (submissionClientId && !hasStoreId(context, 'users', submissionClientId)) {
        addDetail(context.details, 'healthSubmissions', index, `client/user id references missing user "${submissionClientId}".`, readId(record) ?? undefined, 'clientId');
      }
      return;
    case 'formTemplates':
      expectString(context, 'formTemplates', index, record, 'name');
      expectBoolean(context, 'formTemplates', index, record, 'isActive');
      expectNumber(context, 'formTemplates', index, record, 'version', { min: 1 });
      validateForeignKey(context, 'formTemplates', index, record, 'createdBy', 'users');
      expectNumber(context, 'formTemplates', index, record, 'createdAt');
      expectNumber(context, 'formTemplates', index, record, 'updatedAt');
      const fields = record.fields;
      if (!Array.isArray(fields)) {
        addDetail(context.details, 'formTemplates', index, 'Field "fields" must be an array.', readId(record) ?? undefined, 'fields');
      } else {
        fields.forEach((fieldValue, fieldIndex) => {
          if (!isRecord(fieldValue)) {
            addDetail(context.details, 'formTemplates', index, `fields[${fieldIndex}] must be an object.`, readId(record) ?? undefined, 'fields');
            return;
          }
          if (typeof fieldValue.id !== 'string' || fieldValue.id.trim().length === 0) {
            addDetail(context.details, 'formTemplates', index, `fields[${fieldIndex}].id must be non-empty string.`, readId(record) ?? undefined, 'fields');
          }
          if (typeof fieldValue.label !== 'string' || fieldValue.label.trim().length === 0) {
            addDetail(context.details, 'formTemplates', index, `fields[${fieldIndex}].label must be non-empty string.`, readId(record) ?? undefined, 'fields');
          }
          if (typeof fieldValue.required !== 'boolean') {
            addDetail(context.details, 'formTemplates', index, `fields[${fieldIndex}].required must be boolean.`, readId(record) ?? undefined, 'fields');
          }
          if (typeof fieldValue.type !== 'string' || !FORM_FIELD_TYPES.has(fieldValue.type)) {
            addDetail(context.details, 'formTemplates', index, `fields[${fieldIndex}].type is invalid.`, readId(record) ?? undefined, 'fields');
          }
          if (
            (fieldValue.type === 'select' || fieldValue.type === 'radio') &&
            (!Array.isArray(fieldValue.options) || fieldValue.options.some((option) => typeof option !== 'string'))
          ) {
            addDetail(context.details, 'formTemplates', index, `fields[${fieldIndex}].options must be string array.`, readId(record) ?? undefined, 'fields');
          }
          if (fieldValue.condition !== undefined) {
            if (!isRecord(fieldValue.condition)) {
              addDetail(context.details, 'formTemplates', index, `fields[${fieldIndex}].condition must be object.`, readId(record) ?? undefined, 'fields');
            } else {
              if (typeof fieldValue.condition.fieldId !== 'string') {
                addDetail(context.details, 'formTemplates', index, `fields[${fieldIndex}].condition.fieldId must be string.`, readId(record) ?? undefined, 'fields');
              }
              if (
                typeof fieldValue.condition.operator !== 'string' ||
                !FORM_FIELD_OPERATORS.has(fieldValue.condition.operator)
              ) {
                addDetail(context.details, 'formTemplates', index, `fields[${fieldIndex}].condition.operator is invalid.`, readId(record) ?? undefined, 'fields');
              }
            }
          }
        });
      }
      return;
    case 'formResponses':
      validateForeignKey(context, 'formResponses', index, record, 'templateId', 'formTemplates');
      validateForeignKey(context, 'formResponses', index, record, 'bookingId', 'bookings');
      validateForeignKey(context, 'formResponses', index, record, 'userId', 'users');
      expectNumber(context, 'formResponses', index, record, 'templateVersion', { min: 1 });
      expectString(context, 'formResponses', index, record, 'encryptedAnswers');
      expectEnum(context, 'formResponses', index, record, 'status', FORM_RESPONSE_STATUSES);
      expectNullableNumber(context, 'formResponses', index, record, 'submittedAt');
      expectNumber(context, 'formResponses', index, record, 'createdAt');
      expectNumber(context, 'formResponses', index, record, 'updatedAt');
      return;
    case 'posts':
      validateForeignKey(context, 'posts', index, record, 'authorId', 'users');
      expectEnum(context, 'posts', index, record, 'authorRole', USER_ROLES);
      expectEnum(context, 'posts', index, record, 'type', POST_TYPES);
      expectString(context, 'posts', index, record, 'content');
      expectNumber(context, 'posts', index, record, 'createdAt');
      expectNumber(context, 'posts', index, record, 'likeCount', { min: 0 });
      expectNumber(context, 'posts', index, record, 'favoriteCount', { optional: true, min: 0 });
      const acceptedAnswerId = expectString(context, 'posts', index, record, 'acceptedAnswerId', {
        optional: true
      });
      if (acceptedAnswerId && !hasStoreId(context, 'comments', acceptedAnswerId)) {
        addDetail(context.details, 'posts', index, `acceptedAnswerId references missing comment "${acceptedAnswerId}".`, readId(record) ?? undefined, 'acceptedAnswerId');
      }
      return;
    case 'comments':
      validateForeignKey(context, 'comments', index, record, 'postId', 'posts');
      validateForeignKey(context, 'comments', index, record, 'authorId', 'users');
      expectEnum(context, 'comments', index, record, 'authorRole', USER_ROLES);
      expectString(context, 'comments', index, record, 'content');
      expectNumber(context, 'comments', index, record, 'createdAt');
      expectNumber(context, 'comments', index, record, 'likeCount', { min: 0 });
      const parentId = expectNullableString(context, 'comments', index, record, 'parentId');
      if (parentId && !hasStoreId(context, 'comments', parentId)) {
        addDetail(context.details, 'comments', index, `parentId references missing comment "${parentId}".`, readId(record) ?? undefined, 'parentId');
      }
      return;
    case 'likes':
      validateForeignKey(context, 'likes', index, record, 'userId', 'users');
      const postId = expectString(context, 'likes', index, record, 'postId', { optional: true });
      const commentId = expectString(context, 'likes', index, record, 'commentId', { optional: true });
      if (!postId && !commentId) {
        addDetail(context.details, 'likes', index, 'Either "postId" or "commentId" is required.', readId(record) ?? undefined);
      }
      if (postId && !hasStoreId(context, 'posts', postId)) {
        addDetail(context.details, 'likes', index, `postId references missing post "${postId}".`, readId(record) ?? undefined, 'postId');
      }
      if (commentId && !hasStoreId(context, 'comments', commentId)) {
        addDetail(context.details, 'likes', index, `commentId references missing comment "${commentId}".`, readId(record) ?? undefined, 'commentId');
      }
      expectNumber(context, 'likes', index, record, 'createdAt');
      return;
    case 'favorites':
      validateForeignKey(context, 'favorites', index, record, 'userId', 'users');
      validateForeignKey(context, 'favorites', index, record, 'postId', 'posts');
      expectNumber(context, 'favorites', index, record, 'createdAt');
      return;
    case 'follows':
      validateForeignKey(context, 'follows', index, record, 'followerId', 'users');
      validateForeignKey(context, 'follows', index, record, 'followingId', 'users');
      expectNumber(context, 'follows', index, record, 'createdAt');
      return;
    case 'reports':
      validateForeignKey(context, 'reports', index, record, 'reporterId', 'users');
      expectEnum(context, 'reports', index, record, 'targetType', REPORT_TARGET_TYPES);
      expectString(context, 'reports', index, record, 'targetId');
      expectString(context, 'reports', index, record, 'reason');
      expectNumber(context, 'reports', index, record, 'createdAt');
      expectEnum(context, 'reports', index, record, 'status', REPORT_STATUSES);
      {
        const targetType = typeof record.targetType === 'string' ? record.targetType : null;
        const targetId = typeof record.targetId === 'string' ? record.targetId : null;
        if (targetType === 'post' && targetId && !hasStoreId(context, 'posts', targetId)) {
          addDetail(context.details, 'reports', index, `targetId references missing post "${targetId}".`, readId(record) ?? undefined, 'targetId');
        }
        if (targetType === 'comment' && targetId && !hasStoreId(context, 'comments', targetId)) {
          addDetail(context.details, 'reports', index, `targetId references missing comment "${targetId}".`, readId(record) ?? undefined, 'targetId');
        }
      }
      return;
    case 'blocks':
      expectString(context, 'blocks', index, record, 'blockerId', { optional: true });
      expectString(context, 'blocks', index, record, 'blockedUserId', { optional: true });
      expectNumber(context, 'blocks', index, record, 'createdAt', { optional: true });
      return;
    case 'searchIndex':
      expectEnum(context, 'searchIndex', index, record, 'type', SEARCH_TYPES);
      expectString(context, 'searchIndex', index, record, 'title');
      expectString(context, 'searchIndex', index, record, 'content');
      expectStringArray(context, 'searchIndex', index, record, 'tokens');
      expectNumber(context, 'searchIndex', index, record, 'createdAt');
      expectObjectOrNull(context, 'searchIndex', index, record, 'metadata');
      return;
    case 'outbox':
      expectString(context, 'outbox', index, record, 'type');
      expectObjectOrNull(context, 'outbox', index, record, 'payload');
      expectString(context, 'outbox', index, record, 'idempotencyKey');
      expectString(context, 'outbox', index, record, 'messageHash');
      expectNumber(context, 'outbox', index, record, 'retryCount', { min: 0 });
      expectString(context, 'outbox', index, record, 'nextRetryAt');
      expectEnum(context, 'outbox', index, record, 'status', OUTBOX_STATUSES);
      return;
    case 'schedulerState':
      expectString(context, 'schedulerState', index, record, 'id');
      expectNullableString(context, 'schedulerState', index, record, 'lastRunAt');
      expectNullableString(context, 'schedulerState', index, record, 'lastStartupReconciliationAt');
      return;
    case 'appConfig':
      expectString(context, 'appConfig', index, record, 'id');
      {
        const configId = typeof record.id === 'string' ? record.id : '';
        if (configId === 'admin-config') {
          const settings = expectObjectOrNull(context, 'appConfig', index, record, 'notificationSettings');
          if (settings) {
            const asRecord = settings as GenericRecord;
            for (const key of ['booking', 'messages', 'community']) {
              if (typeof asRecord[key] !== 'boolean') {
                addDetail(
                  context.details,
                  'appConfig',
                  index,
                  `notificationSettings.${key} must be a boolean.`,
                  readId(record) ?? undefined,
                  `notificationSettings.${key}`
                );
              }
            }
          }
          expectNumber(context, 'appConfig', index, record, 'updatedAt');
          return;
        }

        if (configId === 'search-config' || configId === 'search-synonyms') {
          const synonyms = record.synonyms;
          if (synonyms !== undefined && !isRecord(synonyms)) {
            addDetail(
              context.details,
              'appConfig',
              index,
              'synonyms must be an object map.',
              readId(record) ?? undefined,
              'synonyms'
            );
          }
          if (isRecord(synonyms)) {
            for (const [key, value] of Object.entries(synonyms)) {
              if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
                addDetail(
                  context.details,
                  'appConfig',
                  index,
                  `synonyms.${key} must be an array of strings.`,
                  readId(record) ?? undefined,
                  'synonyms'
                );
              }
            }
          }

          if (configId === 'search-config') {
            const tokenizer = expectObjectOrNull(context, 'appConfig', index, record, 'tokenizer');
            if (tokenizer) {
              const strategy = typeof tokenizer.strategy === 'string' ? tokenizer.strategy : null;
              if (!strategy || !TOKENIZER_STRATEGIES.has(strategy)) {
                addDetail(
                  context.details,
                  'appConfig',
                  index,
                  'tokenizer.strategy is invalid.',
                  readId(record) ?? undefined,
                  'tokenizer.strategy'
                );
              }

              if (
                typeof tokenizer.minTokenLength !== 'number' ||
                !Number.isFinite(tokenizer.minTokenLength) ||
                tokenizer.minTokenLength < 1
              ) {
                addDetail(
                  context.details,
                  'appConfig',
                  index,
                  'tokenizer.minTokenLength must be a number >= 1.',
                  readId(record) ?? undefined,
                  'tokenizer.minTokenLength'
                );
              }

              if (
                tokenizer.stopwords !== undefined &&
                (!Array.isArray(tokenizer.stopwords) ||
                  tokenizer.stopwords.some((entry) => typeof entry !== 'string'))
              ) {
                addDetail(
                  context.details,
                  'appConfig',
                  index,
                  'tokenizer.stopwords must be an array of strings.',
                  readId(record) ?? undefined,
                  'tokenizer.stopwords'
                );
              }
            }
          }

          expectNumber(context, 'appConfig', index, record, 'updatedAt');
          return;
        }

        addDetail(
          context.details,
          'appConfig',
          index,
          `Unsupported appConfig id "${configId}".`,
          readId(record) ?? undefined,
          'id'
        );
      }
      return;
    case 'auditEvents':
      expectString(context, 'auditEvents', index, record, 'id');
      {
        const userId = expectString(context, 'auditEvents', index, record, 'userId', { optional: true });
        if (userId && !hasStoreId(context, 'users', userId)) {
          addDetail(context.details, 'auditEvents', index, `userId references missing user "${userId}".`, readId(record) ?? undefined, 'userId');
        }
      }
      return;
    default:
      return;
  }
}

function buildValidationContext(stores: Record<StoreName, unknown[]>): ValidationContext {
  const idsByStore = {} as Record<StoreName, Set<string>>;
  for (const storeName of STORE_NAMES) {
    idsByStore[storeName] = new Set<string>();
  }

  return {
    stores,
    details: [],
    idsByStore
  };
}

function validateStores(stores: Record<StoreName, unknown[]>): ImportValidationDetail[] {
  const context = buildValidationContext(stores);

  for (const storeName of STORE_NAMES) {
    const records = stores[storeName];

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!isRecord(record)) {
        addDetail(context.details, storeName, index, 'Record must be an object.');
        continue;
      }

      const id = readId(record);
      if (!id) {
        addDetail(context.details, storeName, index, 'Record requires non-empty "id" field.', undefined, 'id');
        continue;
      }

      if (context.idsByStore[storeName].has(id)) {
        addDetail(context.details, storeName, index, `Duplicate id "${id}" in store "${storeName}".`, id, 'id');
        continue;
      }

      context.idsByStore[storeName].add(id);
    }
  }

  for (const storeName of STORE_NAMES) {
    for (let index = 0; index < stores[storeName].length; index += 1) {
      validateRecordByStore(context, storeName, index);
    }
  }

  return context.details;
}

function formatValidationDetail(detail: ImportValidationDetail): string {
  const identity = detail.id ? ` (${detail.id})` : '';
  return `${detail.store}[${detail.index}]${identity}: ${detail.issue}`;
}

function ensureValidImportPayload(parsed: BackupEnvelope): void {
  const details: ImportValidationDetail[] = [];
  if (parsed.schemaVersion !== DB_VERSION) {
    details.push({
      store: 'appConfig',
      index: -1,
      field: 'schemaVersion',
      issue: `Incompatible backup version: expected ${DB_VERSION}, got ${parsed.schemaVersion}.`
    });
  }

  details.push(...validateStores(parsed.stores));

  if (details.length > 0) {
    throw new ImportExportValidationError('Import payload validation failed.', details);
  }
}

class LocalImportExportService implements ImportExportService {
  private readonly repository: ImportExportRepository;
  private readonly authRepository: AuthRepository;

  constructor(repository: ImportExportRepository, authRepository: AuthRepository) {
    this.repository = repository;
    this.authRepository = authRepository;
  }

  private async requireActiveAdmin(actorId: string): Promise<void> {
    const actor = await this.authRepository.findUserById(actorId);
    if (!actor || !actor.isActive) {
      throw new Error('Unauthorized');
    }

    if (actor.role !== 'admin') {
      throw new Error('Forbidden');
    }
  }

  async exportBackup(actorId: string): Promise<Blob> {
    await this.requireActiveAdmin(actorId);
    const stores = await this.repository.exportStores();
    const payload: BackupEnvelope = {
      schemaVersion: DB_VERSION,
      exportedAt: nowMs(),
      stores
    };
    logger.info('ImportExportService export created', {
      context: 'ImportExportService',
      status: 'success',
      schemaVersion: payload.schemaVersion,
      storeCount: STORE_NAMES.length
    });

    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  }

  async validateImport(actorId: string, rawJson: string): Promise<ImportValidationResult> {
    await this.requireActiveAdmin(actorId);
    try {
      const parsed = parseBackup(rawJson);
      ensureValidImportPayload(parsed);

      return {
        valid: true,
        errors: [],
        details: []
      };
    } catch (error: unknown) {
      if (error instanceof ImportExportValidationError) {
        return {
          valid: false,
          errors: error.details.map((detail) => formatValidationDetail(detail)),
          details: error.details
        };
      }

      logger.error('ImportExportService validation failed', {
        context: 'ImportExportService',
        status: 'error'
      });
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Import validation failed.'],
        details: []
      };
    }
  }

  async importBackup(actorId: string, rawJson: string): Promise<void> {
    await this.requireActiveAdmin(actorId);
    const parsed = parseBackup(rawJson);
    ensureValidImportPayload(parsed);
    await this.repository.replaceStores(parsed.stores);
    logger.info('ImportExportService import completed', {
      context: 'ImportExportService',
      status: 'success',
      schemaVersion: parsed.schemaVersion,
      storeCount: STORE_NAMES.length
    });
  }
}

export function createImportExportService(
  repository: ImportExportRepository,
  authRepository: AuthRepository
): ImportExportService {
  return new LocalImportExportService(repository, authRepository);
}
