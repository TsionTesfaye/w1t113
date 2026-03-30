export interface TimeSource {
  now(): number;
}

class BrowserTimeSource implements TimeSource {
  now(): number {
    return Date.now();
  }
}

export const timeSource: TimeSource = new BrowserTimeSource();

export function nowMs(): number {
  return timeSource.now();
}

export function startOfDayMs(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
