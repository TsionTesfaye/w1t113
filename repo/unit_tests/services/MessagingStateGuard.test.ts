import { isBookingMessagingActive } from '@/services/MessagingService';
import { describe, expect, it } from 'vitest';

describe('Messaging booking state guard', () => {
  it('enables messaging only for active booking lifecycle states', () => {
    expect(isBookingMessagingActive('pending')).toBe(true);
    expect(isBookingMessagingActive('confirmed')).toBe(true);
    expect(isBookingMessagingActive('arrived')).toBe(true);
    expect(isBookingMessagingActive('started')).toBe(true);

    expect(isBookingMessagingActive('completed')).toBe(false);
    expect(isBookingMessagingActive('canceled')).toBe(false);
    expect(isBookingMessagingActive('missed')).toBe(false);
    expect(isBookingMessagingActive('auto_completed')).toBe(false);
    expect(isBookingMessagingActive('photographer_unavailable')).toBe(false);
    expect(isBookingMessagingActive('rescheduled')).toBe(false);
  });
});

