// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import BookingView from '@/modules/booking/views/BookingView.vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockAuthStore = {
  currentUser: { id: string; role: string } | null;
};

type MockBookingStore = {
  services: Array<{ id: string; name: string; durationMinutes: number; price: number }>;
  selectedServiceId: string | null;
  selectedDate: string;
  slots: Array<{
    id: string;
    photographerId: string;
    startTime: number;
    endTime: number;
    isBooked: boolean;
    state: 'available' | 'booked' | 'lockedBySelf' | 'lockedByOther' | 'unavailable';
    lockId: string | null;
    lockExpiresAt: number | null;
    lockOwnerUserId: string | null;
    isLockActive: boolean;
    isLockedByCurrentUser: boolean;
    isAvailable: boolean;
    availablePhotographerIds: string[];
  }>;
  activeLock: {
    id: string;
    slotId: string;
    photographerId: string;
    userId: string;
    startTime: number;
    endTime: number;
    dayKey: string;
    expiresAt: number;
  } | null;
  activeLockSlot: {
    id: string;
    photographerId: string;
    startTime: number;
    endTime: number;
  } | null;
  drawerOpen: boolean;
  isBusy: boolean;
  errorMessage: string;
  lockCountdownLabel: string;
  canConfirm: boolean;
  availableCount: number;
  lockedCount: number;
  minSelectableDate: string;
  selectedService: { id: string; name: string; durationMinutes: number; price: number } | null;
  initialize: ReturnType<typeof vi.fn>;
  setSelectedService: ReturnType<typeof vi.fn>;
  setSelectedDate: ReturnType<typeof vi.fn>;
  selectSlot: ReturnType<typeof vi.fn>;
  confirmBooking: ReturnType<typeof vi.fn>;
  cancelLock: ReturnType<typeof vi.fn>;
  closeDrawer: ReturnType<typeof vi.fn>;
  stopLockTicker: ReturnType<typeof vi.fn>;
};

let mockAuthStore: MockAuthStore;
let mockBookingStore: MockBookingStore;

vi.mock('@/app/stores/useAuthStore', () => ({
  useAuthStore: () => mockAuthStore
}));

vi.mock('@/modules/booking/stores/useBookingStore', () => ({
  useBookingStore: () => mockBookingStore
}));

function createMockBookingStore(canConfirm: boolean): MockBookingStore {
  const startTime = Date.now() + 60 * 60 * 1000;
  const endTime = startTime + 30 * 60 * 1000;
  const service = {
    id: 'service-1',
    name: 'Headshots',
    durationMinutes: 30,
    price: 175
  };

  return {
    services: [service],
    selectedServiceId: service.id,
    selectedDate: '2026-03-31',
    slots: [],
    activeLock: {
      id: 'lock-1',
      slotId: 'slot-1',
      photographerId: 'photo-1',
      userId: 'client-1',
      startTime,
      endTime,
      dayKey: '2026-03-31',
      expiresAt: Date.now() + 9 * 60 * 1000
    },
    activeLockSlot: {
      id: 'slot-1',
      photographerId: 'photo-1',
      startTime,
      endTime
    },
    drawerOpen: true,
    isBusy: false,
    errorMessage: '',
    lockCountdownLabel: '09:00',
    canConfirm,
    availableCount: 3,
    lockedCount: 1,
    minSelectableDate: '2026-03-30',
    selectedService: service,
    initialize: vi.fn(async () => undefined),
    setSelectedService: vi.fn(async () => undefined),
    setSelectedDate: vi.fn(async () => undefined),
    selectSlot: vi.fn(async () => undefined),
    confirmBooking: vi.fn(async () => undefined),
    cancelLock: vi.fn(async () => undefined),
    closeDrawer: vi.fn(() => undefined),
    stopLockTicker: vi.fn(() => undefined)
  };
}

describe('BookingView drawer interactions', () => {
  beforeEach(() => {
    mockAuthStore = {
      currentUser: {
        id: 'client-1',
        role: 'client'
      }
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps confirm action disabled when booking store disallows confirmation', () => {
    mockBookingStore = createMockBookingStore(false);
    const wrapper = mount(BookingView, {
      global: {
        stubs: {
          RouterLink: true
        }
      }
    });

    const confirmButton = wrapper
      .findAll('button')
      .find((button) => button.text().trim() === 'Confirm');

    expect(confirmButton).toBeDefined();
    expect(confirmButton?.attributes('disabled')).toBeDefined();
    expect(mockBookingStore.initialize).toHaveBeenCalledTimes(1);
  });

  it('enables confirm action and triggers booking confirmation when allowed', async () => {
    mockBookingStore = createMockBookingStore(true);
    const wrapper = mount(BookingView, {
      global: {
        stubs: {
          RouterLink: true
        }
      }
    });

    const confirmButton = wrapper
      .findAll('button')
      .find((button) => button.text().trim() === 'Confirm');

    expect(confirmButton).toBeDefined();
    expect(confirmButton?.attributes('disabled')).toBeUndefined();

    await confirmButton?.trigger('click');
    expect(mockBookingStore.confirmBooking).toHaveBeenCalledTimes(1);
  });
});
