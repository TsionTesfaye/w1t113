import {
  getCompletedStepKeys,
  getCurrentStep,
  getCurrentStepIndex,
  getStatusNote
} from '@/modules/messaging/utils/bookingStatusStepper';
import { describe, expect, it } from 'vitest';

describe('Booking status stepper mapping', () => {
  it('maps lifecycle states in sequence', () => {
    expect(getCompletedStepKeys('pending')).toEqual([]);
    expect(getCurrentStep('pending')).toBeNull();

    expect(getCompletedStepKeys('confirmed')).toEqual(['accepted']);
    expect(getCurrentStep('confirmed')).toBe('accepted');
    expect(getCurrentStepIndex('confirmed')).toBe(0);

    expect(getCompletedStepKeys('arrived')).toEqual(['accepted', 'arrived']);
    expect(getCurrentStep('arrived')).toBe('arrived');
    expect(getCurrentStepIndex('arrived')).toBe(1);

    expect(getCompletedStepKeys('started')).toEqual(['accepted', 'arrived', 'started']);
    expect(getCurrentStep('started')).toBe('started');
    expect(getCurrentStepIndex('started')).toBe(2);

    expect(getCompletedStepKeys('completed')).toEqual(['accepted', 'arrived', 'started', 'ended']);
    expect(getCurrentStep('completed')).toBe('ended');
    expect(getCurrentStepIndex('completed')).toBe(3);
  });

  it('exposes badge-note states without active step progress', () => {
    expect(getCurrentStep('missed')).toBeNull();
    expect(getStatusNote('missed')).toBe('Session marked as missed.');

    expect(getCurrentStep('canceled')).toBeNull();
    expect(getStatusNote('canceled')).toBe('Session canceled.');

    expect(getCurrentStep('photographer_unavailable')).toBeNull();
    expect(getStatusNote('photographer_unavailable')).toBe('Photographer unavailable.');
  });
});

