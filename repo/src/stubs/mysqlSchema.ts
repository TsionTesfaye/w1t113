// Development-time relational schema stubs (offline-first runtime).
// These are placeholders for future MySQL table mapping.

export const USERS_TABLE = {
  id: 'varchar(64)',
  username: 'varchar(120) unique',
  password_hash: 'text',
  salt: 'text',
  role: "enum('admin','client','photographer','moderator')",
  is_active: 'boolean',
  created_at: 'bigint',
  failed_attempts: 'int',
  lock_until: 'bigint nullable'
} as const;

export const BOOKINGS_TABLE = {
  id: 'varchar(64)',
  user_id: 'varchar(64)',
  photographer_id: 'varchar(64)',
  service_id: 'varchar(64)',
  start_time: 'bigint',
  end_time: 'bigint',
  status: 'varchar(48)',
  created_at: 'bigint'
} as const;

export const HEALTH_FORM_RESPONSES_TABLE = {
  id: 'varchar(64)',
  booking_id: 'varchar(64)',
  user_id: 'varchar(64)',
  template_id: 'varchar(64)',
  template_version: 'int',
  encrypted_answers: 'longtext',
  status: "enum('draft','submitted')",
  submitted_at: 'bigint nullable',
  created_at: 'bigint',
  updated_at: 'bigint'
} as const;
