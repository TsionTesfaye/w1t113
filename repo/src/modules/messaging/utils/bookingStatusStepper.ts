import type { BookingStatus } from '@/app/types/domain';

export type StepKey = 'accepted' | 'arrived' | 'started' | 'ended';

export interface Step {
  key: StepKey;
  label: string;
}

export const BOOKING_STATUS_STEPS: Step[] = [
  { key: 'accepted', label: 'Accepted' },
  { key: 'arrived', label: 'Arrived' },
  { key: 'started', label: 'Started' },
  { key: 'ended', label: 'Ended' }
];

const completedStepKeysByStatus: Record<BookingStatus, StepKey[]> = {
  pending: [],
  confirmed: ['accepted'],
  arrived: ['accepted', 'arrived'],
  started: ['accepted', 'arrived', 'started'],
  rescheduled: [],
  blocked: [],
  canceled: [],
  completed: ['accepted', 'arrived', 'started', 'ended'],
  photographer_unavailable: [],
  missed: [],
  auto_completed: ['accepted', 'arrived', 'started', 'ended']
};

const currentStepByStatus: Record<BookingStatus, StepKey | null> = {
  pending: null,
  confirmed: 'accepted',
  arrived: 'arrived',
  started: 'started',
  rescheduled: null,
  blocked: null,
  canceled: null,
  completed: 'ended',
  photographer_unavailable: null,
  missed: null,
  auto_completed: 'ended'
};

const statusNoteByStatus: Partial<Record<BookingStatus, string>> = {
  missed: 'Session marked as missed.',
  canceled: 'Session canceled.',
  photographer_unavailable: 'Photographer unavailable.',
  auto_completed: 'Session auto-completed.'
};

export function getCompletedStepKeys(status: BookingStatus | null | undefined): StepKey[] {
  if (!status) {
    return [];
  }

  return completedStepKeysByStatus[status] ?? [];
}

export function getCurrentStep(status: BookingStatus | null | undefined): StepKey | null {
  if (!status) {
    return null;
  }

  return currentStepByStatus[status] ?? null;
}

export function getStatusNote(status: BookingStatus | null | undefined): string | null {
  if (!status) {
    return null;
  }

  return statusNoteByStatus[status] ?? null;
}

export function getCurrentStepIndex(status: BookingStatus | null | undefined): number {
  const currentStep = getCurrentStep(status);
  if (!currentStep) {
    return -1;
  }

  const index = BOOKING_STATUS_STEPS.findIndex((step) => step.key === currentStep);
  return index >= 0 ? index : -1;
}

