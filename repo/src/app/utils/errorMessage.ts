const STACK_TRACE_PATTERN = /\bat\s+\S+/i;

export function toUserErrorMessage(error: unknown, fallback: string): string {
  const rawMessage =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';

  const normalized = rawMessage.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return fallback;
  }

  if (normalized === 'Unauthorized') {
    return 'Your session has expired. Please sign in again.';
  }

  if (normalized === 'Forbidden') {
    return 'You do not have permission to perform this action.';
  }

  if (STACK_TRACE_PATTERN.test(normalized)) {
    return fallback;
  }

  return normalized;
}
