import { logger } from '@/utils/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('logger', () => {
  const originalVerboseFlag = (globalThis as { __STUDIOOPS_VERBOSE_LOGS?: unknown })
    .__STUDIOOPS_VERBOSE_LOGS;

  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis as { __STUDIOOPS_VERBOSE_LOGS?: unknown }).__STUDIOOPS_VERBOSE_LOGS =
      originalVerboseFlag;
  });

  it('redacts sensitive metadata keys even when verbose mode is enabled', () => {
    (globalThis as { __STUDIOOPS_VERBOSE_LOGS?: unknown }).__STUDIOOPS_VERBOSE_LOGS = true;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logger.info('test log', {
      context: 'LoggerTest',
      userId: 'user-123',
      query: 'headshots session',
      nested: {
        token: 'secret-token',
        content: 'sensitive body'
      },
      count: 2
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [record] = logSpy.mock.calls[0] ?? [];
    expect(record).toMatchObject({
      level: 'info',
      context: 'LoggerTest',
      message: 'test log'
    });
    expect(record.metadata).toMatchObject({
      context: 'LoggerTest',
      userId: '[REDACTED]',
      query: '[REDACTED]',
      nested: {
        token: '[REDACTED]',
        content: '[REDACTED]'
      },
      count: 2
    });
  });
});
