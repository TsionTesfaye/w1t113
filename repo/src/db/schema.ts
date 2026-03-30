export const DB_NAME = 'studioops-offline';
export const DB_VERSION = 11;

export const STORE_NAMES = [
  'users',
  'sessions',
  'serviceItems',
  'photographers',
  'availabilitySlots',
  'slotLocks',
  'bookings',
  'bookingEvents',
  'threads',
  'messages',
  'notifications',
  'notificationPreferences',
  'healthTemplates',
  'healthDrafts',
  'healthSubmissions',
  'formTemplates',
  'formResponses',
  'posts',
  'comments',
  'likes',
  'favorites',
  'follows',
  'reports',
  'blocks',
  'searchIndex',
  'outbox',
  'schedulerState',
  'appConfig',
  'auditEvents'
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

export interface StoreIndexDefinition {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
}

export interface StoreDefinition {
  keyPath: string;
  autoIncrement?: boolean;
  indexes?: StoreIndexDefinition[];
}

const DEFAULT_STORE_DEFINITION: StoreDefinition = {
  keyPath: 'id'
};

export const STORE_DEFINITIONS: Record<StoreName, StoreDefinition> = {
  users: {
    keyPath: 'id',
    indexes: [
      { name: 'username', keyPath: 'username', unique: true },
      { name: 'role', keyPath: 'role' },
      { name: 'isActive', keyPath: 'isActive' }
    ]
  },
  sessions: {
    keyPath: 'id',
    indexes: [
      { name: 'token', keyPath: 'token', unique: true },
      { name: 'userId', keyPath: 'userId' },
      { name: 'expiresAt', keyPath: 'expiresAt' }
    ]
  },
  serviceItems: {
    keyPath: 'id',
    indexes: [
      { name: 'isActive', keyPath: 'isActive' },
      { name: 'updatedAt', keyPath: 'updatedAt' }
    ]
  },
  photographers: {
    keyPath: 'id',
    indexes: [{ name: 'isActive', keyPath: 'isActive' }]
  },
  availabilitySlots: {
    keyPath: 'id',
    indexes: [
      { name: 'photographerId', keyPath: 'photographerId' },
      { name: 'startTime', keyPath: 'startTime' },
      { name: 'isBooked', keyPath: 'isBooked' }
    ]
  },
  slotLocks: {
    keyPath: 'id',
    indexes: [
      { name: 'slotId', keyPath: 'slotId' },
      { name: 'photographerId', keyPath: 'photographerId' },
      { name: 'dayKey', keyPath: 'dayKey' },
      { name: 'photographerDay', keyPath: ['photographerId', 'dayKey'] },
      { name: 'userId', keyPath: 'userId' },
      { name: 'expiresAt', keyPath: 'expiresAt' }
    ]
  },
  bookings: {
    keyPath: 'id',
    indexes: [
      { name: 'slotId', keyPath: 'slotId' },
      { name: 'photographerId', keyPath: 'photographerId' },
      { name: 'dayKey', keyPath: 'dayKey' },
      { name: 'photographerDay', keyPath: ['photographerId', 'dayKey'] },
      { name: 'userId', keyPath: 'userId' },
      { name: 'status', keyPath: 'status' },
      { name: 'createdAt', keyPath: 'createdAt' }
    ]
  },
  bookingEvents: DEFAULT_STORE_DEFINITION,
  threads: {
    keyPath: 'id',
    indexes: [{ name: 'bookingId', keyPath: 'bookingId', unique: true }]
  },
  messages: {
    keyPath: 'id',
    indexes: [
      { name: 'threadId', keyPath: 'threadId' },
      { name: 'threadCreatedAt', keyPath: ['threadId', 'createdAt'] },
      { name: 'createdAt', keyPath: 'createdAt' }
    ]
  },
  notifications: {
    keyPath: 'id',
    indexes: [
      { name: 'userId', keyPath: 'userId' },
      { name: 'userCreatedAt', keyPath: ['userId', 'createdAt'] },
      { name: 'userType', keyPath: ['userId', 'type'] },
      { name: 'read', keyPath: 'read' },
      { name: 'dedupKey', keyPath: 'dedupKey' },
      { name: 'createdAt', keyPath: 'createdAt' }
    ]
  },
  notificationPreferences: DEFAULT_STORE_DEFINITION,
  healthTemplates: DEFAULT_STORE_DEFINITION,
  healthDrafts: DEFAULT_STORE_DEFINITION,
  healthSubmissions: DEFAULT_STORE_DEFINITION,
  formTemplates: {
    keyPath: 'id',
    indexes: [
      { name: 'isActive', keyPath: 'isActive' },
      { name: 'updatedAt', keyPath: 'updatedAt' }
    ]
  },
  formResponses: {
    keyPath: 'id',
    indexes: [
      { name: 'bookingId', keyPath: 'bookingId' },
      { name: 'userId', keyPath: 'userId' },
      { name: 'bookingUser', keyPath: ['bookingId', 'userId'], unique: true },
      { name: 'status', keyPath: 'status' },
      { name: 'submittedAt', keyPath: 'submittedAt' }
    ]
  },
  posts: DEFAULT_STORE_DEFINITION,
  comments: DEFAULT_STORE_DEFINITION,
  likes: DEFAULT_STORE_DEFINITION,
  favorites: DEFAULT_STORE_DEFINITION,
  follows: DEFAULT_STORE_DEFINITION,
  reports: DEFAULT_STORE_DEFINITION,
  blocks: DEFAULT_STORE_DEFINITION,
  searchIndex: {
    keyPath: 'id',
    indexes: [
      { name: 'type', keyPath: 'type' },
      { name: 'createdAt', keyPath: 'createdAt' }
    ]
  },
  outbox: {
    keyPath: 'id',
    indexes: [
      { name: 'status', keyPath: 'status' },
      { name: 'nextRetryAt', keyPath: 'nextRetryAt' },
      { name: 'messageHash', keyPath: 'messageHash' },
      { name: 'idempotencyKey', keyPath: 'idempotencyKey', unique: true }
    ]
  },
  schedulerState: {
    keyPath: 'id',
    indexes: [{ name: 'lastRunAt', keyPath: 'lastRunAt' }]
  },
  appConfig: DEFAULT_STORE_DEFINITION,
  auditEvents: DEFAULT_STORE_DEFINITION
};
