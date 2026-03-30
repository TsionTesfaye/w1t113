type LogLevel = 'info' | 'warn' | 'error';

interface LogRecord {
  level: LogLevel;
  context: string;
  message: string;
  metadata?: unknown;
  timestamp: string;
}

const SENSITIVE_KEY_PATTERN =
  /(id|user|username|token|query|content|password|secret|hash|salt|payload|dedup|thread|booking|message)/i;
const SENSITIVE_VALUE_MASK = '[REDACTED]';
const MAX_STRING_LENGTH = 80;

function isVerboseLoggingEnabled(): boolean {
  const envVerbose = import.meta.env.DEV && import.meta.env.VITE_VERBOSE_LOGS === 'true';
  const globalVerbose =
    typeof globalThis !== 'undefined' &&
    Boolean((globalThis as { __STUDIOOPS_VERBOSE_LOGS?: unknown }).__STUDIOOPS_VERBOSE_LOGS);
  return envVerbose || globalVerbose;
}

function truncate(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_STRING_LENGTH)}...`;
}

function sanitizeMetadata(value: unknown, keyHint = ''): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    if (SENSITIVE_KEY_PATTERN.test(keyHint)) {
      return SENSITIVE_VALUE_MASK;
    }
    return isVerboseLoggingEnabled() ? value : truncate(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    if (!isVerboseLoggingEnabled() && value.length > 10) {
      return `[array:${value.length}]`;
    }
    return value.map((item) => sanitizeMetadata(item, keyHint));
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of entries) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        sanitized[key] = SENSITIVE_VALUE_MASK;
        continue;
      }
      sanitized[key] = sanitizeMetadata(nestedValue, key);
    }

    return sanitized;
  }

  return String(value);
}

function write(level: LogLevel, message: string, metadata?: unknown): void {
  const sanitizedMetadata = sanitizeMetadata(metadata);
  const record: LogRecord = {
    level,
    context:
      sanitizedMetadata &&
      typeof sanitizedMetadata === 'object' &&
      !Array.isArray(sanitizedMetadata) &&
      'context' in sanitizedMetadata
        ? String((sanitizedMetadata as { context?: unknown }).context ?? 'app')
        : 'app',
    message,
    metadata: sanitizedMetadata,
    timestamp: new Date().toISOString()
  };

  if (level === 'error') {
    console.error(record);
    return;
  }

  if (level === 'warn') {
    console.warn(record);
    return;
  }

  console.log(record);
}

export const logger = {
  info: (message: string, metadata?: unknown): void => {
    write('info', message, metadata);
  },
  warn: (message: string, metadata?: unknown): void => {
    write('warn', message, metadata);
  },
  error: (message: string, metadata?: unknown): void => {
    write('error', message, metadata);
  }
};
