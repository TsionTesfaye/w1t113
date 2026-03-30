import type {
  Booking,
  BookingStatus,
  Photographer,
  ServiceItem,
  SlotLock,
  TimeSlot
} from '@/app/types/domain';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type { BookingRepository } from '@/repositories/BookingRepository';
import type { MessageService } from '@/services/MessagingService';
import type { NotificationService } from '@/services/NotificationService';
import type { OutboxService } from '@/services/OutboxService';
import type { SearchService } from '@/services/SearchService';
import { nowMs, startOfDayMs } from '@/services/timeSource';
import { logger } from '@/utils/logger';

const LOCK_DURATION_MS = 10 * 60 * 1000;
const AUTO_COMPLETE_GRACE_MS = 15 * 60 * 1000;
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 17;
const LUNCH_START_HOUR = 12;
const LUNCH_END_HOUR = 13;
const ENABLE_AVAILABILITY_DEBUG = import.meta.env.DEV;
const BLOCKED_AVAILABILITY_SERVICE_ID = 'service-availability-blocked';

export type BookingServiceErrorCode =
  | 'SERVICE_NOT_FOUND'
  | 'INVALID_SERVICE'
  | 'SLOT_UNAVAILABLE'
  | 'LOCK_NOT_FOUND'
  | 'LOCK_EXPIRED'
  | 'ACTIVE_LOCK_EXISTS'
  | 'BOOKING_NOT_FOUND'
  | 'INVALID_STATUS_TRANSITION'
  | 'PAST_DATE_NOT_ALLOWED'
  | 'FORBIDDEN'
  | 'NO_PHOTOGRAPHERS_AVAILABLE'
  | 'INVALID_BOOKING'
  | 'CLIENT_NOT_FOUND'
  | 'PHOTOGRAPHER_NOT_FOUND'
  | 'BLOCKED_INTERACTION';

export class BookingServiceError extends Error {
  readonly code: BookingServiceErrorCode;

  constructor(code: BookingServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type BookingSlotState =
  | 'available'
  | 'booked'
  | 'lockedBySelf'
  | 'lockedByOther'
  | 'unavailable';

export interface BookingSlotView extends TimeSlot {
  state: BookingSlotState;
  lockId: string | null;
  lockExpiresAt: number | null;
  lockOwnerUserId: string | null;
  isLockActive: boolean;
  isLockedByCurrentUser: boolean;
  isAvailable: boolean;
  availablePhotographerIds: string[];
}

export interface ServiceItemInput {
  name: string;
  durationMinutes: number;
  price?: number;
}

export interface BookingService {
  getServices(): Promise<ServiceItem[]>;
  getServiceCatalog(adminId: string): Promise<ServiceItem[]>;
  createServiceItem(adminId: string, input: ServiceItemInput): Promise<ServiceItem>;
  updateServiceItem(adminId: string, serviceId: string, input: ServiceItemInput): Promise<ServiceItem>;
  archiveServiceItem(adminId: string, serviceId: string): Promise<ServiceItem>;
  getAvailableSlots(serviceId: string, date: string): Promise<TimeSlot[]>;
  getSlotsForDate(serviceId: string, date: string, userId: string): Promise<BookingSlotView[]>;
  getSlotsForAdmin(
    adminId: string,
    serviceId: string,
    date: string,
    photographerId: string
  ): Promise<BookingSlotView[]>;
  lockSlot(slotId: string, userId: string, serviceId: string): Promise<SlotLock>;
  confirmBooking(lockId: string, userId: string, serviceId: string): Promise<Booking>;
  createBookingByAdmin(
    adminId: string,
    input: {
      clientId?: string;
      clientUsername?: string;
      photographerId?: string;
      photographerUsername?: string;
      serviceId: string;
      slotId?: string;
      startTime?: number;
    }
  ): Promise<Booking>;
  blockPhotographerAvailability(
    photographerId: string,
    input: {
      startTime: number;
      endTime: number;
    }
  ): Promise<Booking>;
  cancelLock(lockId: string, userId: string): Promise<void>;
  getUserActiveLock(actorId: string, targetUserId?: string): Promise<SlotLock | null>;
  getBookingsForUser(actorId: string, targetUserId?: string): Promise<Booking[]>;
  getBookingsForPhotographer(userId: string): Promise<Booking[]>;
  getBlockedAvailabilityForPhotographer(userId: string): Promise<Booking[]>;
  getAllBookings(adminId: string): Promise<Booking[]>;
  updateBookingStatus(userId: string, bookingId: string, nextStatus: BookingStatus): Promise<Booking>;
  cancelBookingByUser(userId: string, bookingId: string): Promise<Booking>;
  cancelBookingByAdmin(adminId: string, bookingId: string): Promise<Booking>;
  updateBookingStatusByAdmin(
    adminId: string,
    bookingId: string,
    nextStatus: BookingStatus
  ): Promise<Booking>;
  markPhotographerUnavailableByAdmin(adminId: string, photographerId: string): Promise<number>;
  processDueReminders(now?: number): Promise<number>;
  processOverdueItems(now?: number): Promise<number>;
  cleanupExpiredLocks(now?: number): Promise<number>;
}

const VALID_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ['confirmed', 'canceled', 'missed', 'photographer_unavailable', 'rescheduled'],
  confirmed: ['arrived', 'canceled', 'missed', 'photographer_unavailable', 'rescheduled'],
  arrived: ['started', 'canceled', 'missed', 'photographer_unavailable'],
  started: ['completed', 'auto_completed', 'canceled', 'photographer_unavailable'],
  rescheduled: ['confirmed', 'canceled', 'missed', 'photographer_unavailable'],
  blocked: [],
  canceled: [],
  completed: [],
  photographer_unavailable: ['confirmed', 'canceled', 'rescheduled'],
  missed: [],
  auto_completed: []
};

const PHOTOGRAPHER_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ['confirmed'],
  confirmed: ['arrived'],
  arrived: ['started'],
  started: ['completed'],
  rescheduled: [],
  blocked: [],
  canceled: [],
  completed: [],
  photographer_unavailable: [],
  missed: [],
  auto_completed: []
};

interface TimeRange {
  startTime: number;
  endTime: number;
  dayKey: string;
}

interface PhotographerRangeEvaluation {
  availablePhotographers: Photographer[];
  bookedPhotographerIds: Set<string>;
  lockedBySelfPhotographerIds: Set<string>;
  lockedByOtherPhotographerIds: Set<string>;
  selfExactLock: SlotLock | null;
  representativeOtherLock: SlotLock | null;
  overlappingBookingCount: number;
  overlappingActiveLockCount: number;
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function toDateKey(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateRangeFromInput(date: string): { dayStart: number; dayEnd: number; dayKey: string } {
  const [yearRaw, monthRaw, dayRaw] = date.split('-').map((part) => Number.parseInt(part, 10));
  if (!yearRaw || !monthRaw || !dayRaw) {
    throw new BookingServiceError('SLOT_UNAVAILABLE', 'Invalid date supplied.');
  }

  const day = new Date(yearRaw, monthRaw - 1, dayRaw, 0, 0, 0, 0);
  const dayStart = day.getTime();
  const dayEnd = new Date(yearRaw, monthRaw - 1, dayRaw + 1, 0, 0, 0, 0).getTime();
  return { dayStart, dayEnd, dayKey: toDateKey(day) };
}

function dateRangeFromTimestamp(timestamp: number): { dayStart: number; dayEnd: number; dayKey: string } {
  const day = new Date(timestamp);
  const dayStartDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
  const dayStart = dayStartDate.getTime();
  return {
    dayStart,
    dayEnd: dayStart + 24 * 60 * 60 * 1000,
    dayKey: toDateKey(dayStartDate)
  };
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function isActiveLock(lock: SlotLock, now: number): boolean {
  return lock.expiresAt > now;
}

function buildSlotId(startTime: number, endTime: number): string {
  return `slot-${startTime}-${endTime}`;
}

function parseSlotId(slotId: string): { startTime: number; endTime: number } | null {
  const match = /^slot-(\d+)-(\d+)$/.exec(slotId);
  if (!match) {
    return null;
  }

  const startTime = Number.parseInt(match[1] ?? '', 10);
  const endTime = Number.parseInt(match[2] ?? '', 10);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return null;
  }

  return { startTime, endTime };
}

function getDurationMinutes(startTime: number, endTime: number): number {
  return Math.round((endTime - startTime) / (60 * 1000));
}

function generateServiceBlocks(dayStart: number, durationMinutes: number): TimeRange[] {
  const workStart = new Date(dayStart);
  workStart.setHours(WORK_START_HOUR, 0, 0, 0);

  const workEnd = new Date(dayStart);
  workEnd.setHours(WORK_END_HOUR, 0, 0, 0);

  const lunchStart = new Date(dayStart);
  lunchStart.setHours(LUNCH_START_HOUR, 0, 0, 0);

  const lunchEnd = new Date(dayStart);
  lunchEnd.setHours(LUNCH_END_HOUR, 0, 0, 0);

  const durationMs = durationMinutes * 60 * 1000;
  const blocks: TimeRange[] = [];
  let cursor = workStart.getTime();

  while (cursor + durationMs <= workEnd.getTime()) {
    const startTime = cursor;
    const endTime = cursor + durationMs;
    const overlapsLunch = startTime < lunchEnd.getTime() && endTime > lunchStart.getTime();

    if (!overlapsLunch) {
      blocks.push({
        startTime,
        endTime,
        dayKey: toDateKey(new Date(dayStart))
      });
    }

    cursor += durationMs;
  }

  return blocks;
}

function hasBookingRange(booking: Booking): boolean {
  return Number.isFinite(booking.startTime) && Number.isFinite(booking.endTime);
}

function normalizePhotographers(photographers: Photographer[]): Photographer[] {
  const byId = new Map<string, Photographer>();

  for (const photographer of photographers) {
    if (!photographer?.id) {
      continue;
    }

    byId.set(photographer.id, {
      id: photographer.id,
      name: photographer.name?.trim() || photographer.id,
      isActive: photographer.isActive !== false
    });
  }

  return [...byId.values()];
}

function hasMatchingBlock(blocks: TimeRange[], startTime: number, endTime: number): boolean {
  return blocks.some((block) => block.startTime === startTime && block.endTime === endTime);
}

function evaluatePhotographerAvailabilityForRange(
  photographers: Photographer[],
  bookings: Booking[],
  locks: SlotLock[],
  range: TimeRange,
  userId: string,
  now: number
): PhotographerRangeEvaluation {
  const photographerIds = new Set(photographers.map((photographer) => photographer.id));
  const bookedPhotographerIds = new Set<string>();
  const lockedBySelfPhotographerIds = new Set<string>();
  const lockedByOtherPhotographerIds = new Set<string>();
  let overlappingBookingCount = 0;
  let overlappingActiveLockCount = 0;

  let selfExactLock: SlotLock | null = null;
  let representativeOtherLock: SlotLock | null = null;

  for (const booking of bookings) {
    if (booking.status === 'canceled' || !hasBookingRange(booking)) {
      continue;
    }

    if (!photographerIds.has(booking.photographerId)) {
      continue;
    }

    if (overlaps(range.startTime, range.endTime, booking.startTime, booking.endTime)) {
      overlappingBookingCount += 1;
      bookedPhotographerIds.add(booking.photographerId);
    }
  }

  for (const lock of locks) {
    if (!isActiveLock(lock, now)) {
      continue;
    }

    if (!photographerIds.has(lock.photographerId)) {
      continue;
    }

    if (!overlaps(range.startTime, range.endTime, lock.startTime, lock.endTime)) {
      continue;
    }

    overlappingActiveLockCount += 1;

    if (lock.userId === userId) {
      lockedBySelfPhotographerIds.add(lock.photographerId);
      if (lock.startTime === range.startTime && lock.endTime === range.endTime) {
        selfExactLock = lock;
      }
      continue;
    }

    lockedByOtherPhotographerIds.add(lock.photographerId);
    if (!representativeOtherLock) {
      representativeOtherLock = lock;
    }
  }

  const availablePhotographers = photographers.filter((photographer) => {
    if (!photographer.isActive) {
      return false;
    }

    return (
      !bookedPhotographerIds.has(photographer.id) &&
      !lockedBySelfPhotographerIds.has(photographer.id) &&
      !lockedByOtherPhotographerIds.has(photographer.id)
    );
  });

  return {
    availablePhotographers,
    bookedPhotographerIds,
    lockedBySelfPhotographerIds,
    lockedByOtherPhotographerIds,
    selfExactLock,
    representativeOtherLock,
    overlappingBookingCount,
    overlappingActiveLockCount
  };
}

function determineSlotState(
  totalActivePhotographers: number,
  evaluation: PhotographerRangeEvaluation,
  isPastSlot: boolean
): BookingSlotState {
  if (totalActivePhotographers === 0) {
    return 'unavailable';
  }

  if (
    evaluation.overlappingBookingCount === 0 &&
    evaluation.overlappingActiveLockCount === 0 &&
    evaluation.availablePhotographers.length > 0 &&
    !isPastSlot
  ) {
    return 'available';
  }

  if (evaluation.bookedPhotographerIds.size >= totalActivePhotographers) {
    return 'booked';
  }

  if (evaluation.selfExactLock) {
    return 'lockedBySelf';
  }

  if (isPastSlot) {
    return 'unavailable';
  }

  if (evaluation.availablePhotographers.length === 0 && evaluation.lockedByOtherPhotographerIds.size > 0) {
    return 'lockedByOther';
  }

  if (evaluation.availablePhotographers.length === 0) {
    return 'unavailable';
  }

  return 'available';
}

function sortPhotographersDeterministic(photographers: Photographer[]): Photographer[] {
  return [...photographers].sort((left, right) => left.id.localeCompare(right.id));
}

function assertBookingHasPhotographer(booking: Booking): void {
  if (!booking.photographerId) {
    throw new BookingServiceError('INVALID_BOOKING', 'Booking is missing photographer assignment.');
  }
}

function isResolvedBookingStatus(status: BookingStatus): boolean {
  return (
    status === 'blocked' ||
    status === 'completed' ||
    status === 'canceled' ||
    status === 'missed' ||
    status === 'auto_completed' ||
    status === 'photographer_unavailable'
  );
}

function isTerminalBookingStatus(status: BookingStatus): boolean {
  return (
    status === 'blocked' ||
    status === 'canceled' ||
    status === 'missed' ||
    status === 'completed' ||
    status === 'auto_completed'
  );
}

function isPhotographerDeactivationImpactStatus(status: BookingStatus): boolean {
  return (
    status === 'pending' ||
    status === 'confirmed' ||
    status === 'arrived' ||
    status === 'started'
  );
}

class LocalBookingService implements BookingService {
  private readonly bookingRepository: BookingRepository;
  private readonly authRepository: AuthRepository;
  private readonly messageService: MessageService;
  private readonly notificationService: NotificationService;
  private readonly outboxService: OutboxService | null;
  private readonly searchService: SearchService | null;

  constructor(
    bookingRepository: BookingRepository,
    authRepository: AuthRepository,
    messageService: MessageService,
    notificationService: NotificationService,
    outboxService: OutboxService | null = null,
    searchService: SearchService | null = null
  ) {
    this.bookingRepository = bookingRepository;
    this.authRepository = authRepository;
    this.messageService = messageService;
    this.notificationService = notificationService;
    this.outboxService = outboxService;
    this.searchService = searchService;
  }

  async getServices(): Promise<ServiceItem[]> {
    const services = await this.bookingRepository.getServices();
    return services
      .filter((service) => service.isActive)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async getServiceCatalog(adminId: string): Promise<ServiceItem[]> {
    await this.requireActiveRole(adminId, 'admin');
    const services = await this.bookingRepository.getServices();
    return [...services].sort((left, right) => left.createdAt - right.createdAt);
  }

  async createServiceItem(adminId: string, input: ServiceItemInput): Promise<ServiceItem> {
    await this.requireActiveRole(adminId, 'admin');
    const nextService = this.normalizeServiceItemInput(createId('service'), input, nowMs());
    await this.bookingRepository.createServiceItem(nextService);
    return nextService;
  }

  async updateServiceItem(
    adminId: string,
    serviceId: string,
    input: ServiceItemInput
  ): Promise<ServiceItem> {
    await this.requireActiveRole(adminId, 'admin');
    const existing = await this.findServiceById(serviceId);
    if (!existing) {
      throw new BookingServiceError('SERVICE_NOT_FOUND', 'Selected service does not exist.');
    }

    const updated = this.normalizeServiceItemInput(serviceId, input, nowMs(), existing.createdAt, existing.isActive);
    await this.bookingRepository.updateServiceItem(updated);
    return updated;
  }

  async archiveServiceItem(adminId: string, serviceId: string): Promise<ServiceItem> {
    await this.requireActiveRole(adminId, 'admin');
    const archived = await this.bookingRepository.archiveServiceItem(serviceId);
    if (!archived) {
      throw new BookingServiceError('SERVICE_NOT_FOUND', 'Selected service does not exist.');
    }

    return archived;
  }

  async getAvailableSlots(serviceId: string, date: string): Promise<TimeSlot[]> {
    const views = await this.getSlotsForDate(serviceId, date, '');
    return views
      .filter((slot) => slot.state === 'available')
      .map((slot) => ({
        id: slot.id,
        photographerId: slot.photographerId,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isBooked: false
      }));
  }

  async getSlotsForDate(serviceId: string, date: string, userId: string): Promise<BookingSlotView[]> {
    if (userId) {
      await this.requireActiveUser(userId);
    }
    const service = await this.requireService(serviceId);
    const now = nowMs();
    const todayStart = startOfDayMs(now);
    const { dayStart, dayKey } = dateRangeFromInput(date);

    if (dayStart < todayStart) {
      return [];
    }

    const [photographersRaw, bookings, locksRaw] = await Promise.all([
      this.bookingRepository.getPhotographers(),
      this.bookingRepository.getBookingsForDay(dayKey),
      this.bookingRepository.getActiveLocksForDay(dayKey, now)
    ]);
    const locks = locksRaw.filter((lock) => isActiveLock(lock, now));

    const photographers = normalizePhotographers(photographersRaw);
    const activePhotographers = (
      await this.filterPhotographersByPrivacyRestrictions(
        userId,
        photographers.filter((photographer) => photographer.isActive)
      )
    );
    const blocks = generateServiceBlocks(dayStart, service.durationMinutes);
    const isToday = dayStart === todayStart;

    const result: BookingSlotView[] = [];

    for (const block of blocks) {
      const evaluation = evaluatePhotographerAvailabilityForRange(
        activePhotographers,
        bookings,
        locks,
        block,
        userId,
        now
      );
      const isPastSlot = isToday && block.startTime < now;
      const state = determineSlotState(activePhotographers.length, evaluation, isPastSlot);

      const representativeLock = evaluation.selfExactLock ?? evaluation.representativeOtherLock;
      const representativePhotographerId =
        evaluation.selfExactLock?.photographerId ??
        evaluation.availablePhotographers[0]?.id ??
        evaluation.representativeOtherLock?.photographerId ??
        activePhotographers[0]?.id ??
        '';

      result.push({
        id: buildSlotId(block.startTime, block.endTime),
        photographerId: representativePhotographerId,
        startTime: block.startTime,
        endTime: block.endTime,
        isBooked: state === 'booked',
        state,
        lockId: representativeLock?.id ?? null,
        lockExpiresAt: representativeLock?.expiresAt ?? null,
        lockOwnerUserId: representativeLock?.userId ?? null,
        isLockActive: state === 'lockedBySelf' || state === 'lockedByOther',
        isLockedByCurrentUser: state === 'lockedBySelf',
        isAvailable: state === 'available',
        availablePhotographerIds: evaluation.availablePhotographers.map((photographer) => photographer.id)
      });

      if (ENABLE_AVAILABILITY_DEBUG) {
        logger.info('BookingService availability evaluation', {
          context: 'BookingService',
          slotId: buildSlotId(block.startTime, block.endTime),
          startTime: block.startTime,
          endTime: block.endTime,
          photographers: activePhotographers.length,
          overlappingBookings: evaluation.overlappingBookingCount,
          activeLocks: evaluation.overlappingActiveLockCount,
          availablePhotographers: evaluation.availablePhotographers.length,
          state
        });
      }
    }

    return result.sort((left, right) => left.startTime - right.startTime);
  }

  async getSlotsForAdmin(
    adminId: string,
    serviceId: string,
    date: string,
    photographerId: string
  ): Promise<BookingSlotView[]> {
    await this.requireActiveRole(adminId, 'admin');
    const service = await this.requireService(serviceId);
    await this.resolvePhotographerForAdmin(photographerId);

    const now = nowMs();
    const todayStart = startOfDayMs(now);
    const { dayStart, dayKey } = dateRangeFromInput(date);
    if (dayStart < todayStart) {
      return [];
    }

    const [bookings, locksRaw] = await Promise.all([
      this.bookingRepository.getBookingsForDay(dayKey),
      this.bookingRepository.getActiveLocksForDay(dayKey, now)
    ]);
    const locks = locksRaw.filter((lock) => isActiveLock(lock, now));
    const blocks = generateServiceBlocks(dayStart, service.durationMinutes);
    const isToday = dayStart === todayStart;

    const result: BookingSlotView[] = [];
    for (const block of blocks) {
      const hasBookingConflict = bookings.some((booking) => {
        if (
          booking.status === 'canceled' ||
          booking.photographerId !== photographerId ||
          !hasBookingRange(booking)
        ) {
          return false;
        }

        return overlaps(block.startTime, block.endTime, booking.startTime, booking.endTime);
      });

      const conflictingLock =
        locks.find((lock) => {
          return (
            lock.photographerId === photographerId &&
            overlaps(block.startTime, block.endTime, lock.startTime, lock.endTime)
          );
        }) ?? null;

      const isPastSlot = isToday && block.startTime < now;
      let state: BookingSlotState = 'available';
      if (isPastSlot) {
        state = 'unavailable';
      } else if (hasBookingConflict) {
        state = 'booked';
      } else if (conflictingLock) {
        state = 'lockedByOther';
      }

      result.push({
        id: buildSlotId(block.startTime, block.endTime),
        photographerId,
        startTime: block.startTime,
        endTime: block.endTime,
        isBooked: state === 'booked',
        state,
        lockId: conflictingLock?.id ?? null,
        lockExpiresAt: conflictingLock?.expiresAt ?? null,
        lockOwnerUserId: conflictingLock?.userId ?? null,
        isLockActive: state === 'lockedByOther',
        isLockedByCurrentUser: false,
        isAvailable: state === 'available',
        availablePhotographerIds: state === 'available' ? [photographerId] : []
      });
    }

    return result.sort((left, right) => left.startTime - right.startTime);
  }

  async lockSlot(slotId: string, userId: string, serviceId: string): Promise<SlotLock> {
    await this.requireActiveUser(userId);
    const service = await this.requireService(serviceId);
    const parsedSlot = parseSlotId(slotId);
    if (!parsedSlot) {
      throw new BookingServiceError('SLOT_UNAVAILABLE', 'Selected slot is unavailable.');
    }

    const now = nowMs();
    const { dayStart, dayKey } = dateRangeFromTimestamp(parsedSlot.startTime);
    const todayStart = startOfDayMs(now);
    if (dayStart < todayStart) {
      throw new BookingServiceError('PAST_DATE_NOT_ALLOWED', 'Cannot create bookings in the past.');
    }

    if (parsedSlot.startTime < now) {
      throw new BookingServiceError('SLOT_UNAVAILABLE', 'Selected slot has already started.');
    }

    const expectedDuration = service.durationMinutes;
    const selectedDuration = getDurationMinutes(parsedSlot.startTime, parsedSlot.endTime);
    if (selectedDuration !== expectedDuration) {
      throw new BookingServiceError('SLOT_UNAVAILABLE', 'Selected slot does not match service duration.');
    }

    const validBlocks = generateServiceBlocks(dayStart, service.durationMinutes);
    if (!hasMatchingBlock(validBlocks, parsedSlot.startTime, parsedSlot.endTime)) {
      throw new BookingServiceError('SLOT_UNAVAILABLE', 'Selected slot is unavailable.');
    }

    const activeUserLock = await this.bookingRepository.getActiveLockByUser(userId, now);
    if (activeUserLock) {
      if (activeUserLock.slotId === slotId) {
        return activeUserLock;
      }

      throw new BookingServiceError(
        'ACTIVE_LOCK_EXISTS',
        'You already have an active lock. Confirm or cancel it first.'
      );
    }

    const range: TimeRange = {
      startTime: parsedSlot.startTime,
      endTime: parsedSlot.endTime,
      dayKey
    };

    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const nowAttempt = nowMs();
      const { photographers: assignablePhotographers, bookingCounts } =
        await this.getAssignablePhotographersForRange(
          range.dayKey,
          range.startTime,
          range.endTime,
          nowAttempt,
          userId
        );

      const chosenPhotographer = this.chooseLeastLoadedPhotographer(
        assignablePhotographers,
        bookingCounts
      );
      if (!chosenPhotographer) {
        if (assignablePhotographers.length === 0) {
          const availability = await this.getPrivacyAvailabilityForUser(userId);
          if (availability.hasPhotographers && !availability.hasAllowedPhotographers) {
            throw new BookingServiceError(
              'BLOCKED_INTERACTION',
              'You cannot book with this user due to privacy restrictions'
            );
          }
        }

        throw new BookingServiceError(
          'NO_PHOTOGRAPHERS_AVAILABLE',
          'No photographers available'
        );
      }

      const lock: SlotLock = {
        id: createId('lock'),
        slotId,
        photographerId: chosenPhotographer.id,
        userId,
        startTime: range.startTime,
        endTime: range.endTime,
        dayKey: range.dayKey,
        expiresAt: nowAttempt + LOCK_DURATION_MS
      };

      const createdLock = await this.bookingRepository.createLock(lock, nowAttempt);
      if (createdLock) {
        logger.info('BookingService slot lock created', {
          context: 'BookingService',
          event: 'slot_lock_created'
        });
        return createdLock;
      }
    }

    throw new BookingServiceError('SLOT_UNAVAILABLE', 'Selected slot is no longer available.');
  }

  async confirmBooking(lockId: string, userId: string, serviceId: string): Promise<Booking> {
    await this.requireActiveUser(userId);
    const service = await this.requireService(serviceId);
    const now = nowMs();
    const lock = await this.bookingRepository.getUserLock(lockId, userId, now);

    if (!lock) {
      throw new BookingServiceError('LOCK_EXPIRED', 'Your slot hold has expired. Please select again.');
    }

    if (lock.startTime < now) {
      throw new BookingServiceError('SLOT_UNAVAILABLE', 'Locked slot is no longer bookable.');
    }

    const lockDuration = getDurationMinutes(lock.startTime, lock.endTime);
    if (lockDuration !== service.durationMinutes) {
      throw new BookingServiceError(
        'SLOT_UNAVAILABLE',
        'Locked slot duration no longer matches selected service.'
      );
    }

    const { photographers: assignablePhotographers, bookingCounts } =
      await this.getAssignablePhotographersForRange(
        lock.dayKey,
        lock.startTime,
        lock.endTime,
        now,
        userId,
        new Set([lock.id])
      );
    const assignedPhotographer = this.chooseLeastLoadedPhotographer(
      assignablePhotographers,
      bookingCounts
    );
    if (!assignedPhotographer) {
      if (assignablePhotographers.length === 0) {
        const availability = await this.getPrivacyAvailabilityForUser(userId);
        if (availability.hasPhotographers && !availability.hasAllowedPhotographers) {
          throw new BookingServiceError(
            'BLOCKED_INTERACTION',
            'You cannot book with this user due to privacy restrictions'
          );
        }
      }

      throw new BookingServiceError('NO_PHOTOGRAPHERS_AVAILABLE', 'No photographers available');
    }

    const booking: Booking = {
      id: createId('booking'),
      userId,
      photographerId: assignedPhotographer.id,
      serviceId: service.id,
      slotId: lock.slotId,
      startTime: lock.startTime,
      endTime: lock.endTime,
      dayKey: lock.dayKey,
      status: 'pending',
      createdByUserId: userId,
      createdByRole: 'client',
      createdAt: now
    };

    const createdBooking = await this.bookingRepository.confirmLockAndCreateBooking(
      lock.id,
      userId,
      booking,
      now
    );

    if (!createdBooking) {
      logger.warn('BookingService confirmBooking failed due to availability race', {
        context: 'BookingService',
        event: 'booking_confirm_race_conflict'
      });
      throw new BookingServiceError(
        'SLOT_UNAVAILABLE',
        'Photographer is no longer available. Please choose another slot.'
      );
    }

    await this.messageService.getOrCreateThread(createdBooking.id);
    await this.searchService?.indexBooking(createdBooking);
    await this.enqueueOutboxBookingEvent(createdBooking, 'created');
    await this.notifyBookingCreated(createdBooking);
    logger.info('BookingService booking created', {
      context: 'BookingService',
      event: 'booking_created'
    });
    return createdBooking;
  }

  async createBookingByAdmin(
    adminId: string,
    input: {
      clientId?: string;
      clientUsername?: string;
      photographerId?: string;
      photographerUsername?: string;
      serviceId: string;
      slotId?: string;
      startTime?: number;
    }
  ): Promise<Booking> {
    await this.requireActiveRole(adminId, 'admin');

    const service = await this.requireService(input.serviceId);
    const client = await this.resolveClientForAdmin(input.clientId, input.clientUsername);
    const photographer = await this.resolvePhotographerForAdmin(
      input.photographerId,
      input.photographerUsername
    );

    if (client.id === photographer.id) {
      throw new BookingServiceError(
        'INVALID_BOOKING',
        'Photographers cannot be booked as their own client.'
      );
    }

    await this.ensureUsersNotBlocked(client.id, photographer.id);

    const parsedSlot = input.slotId ? parseSlotId(input.slotId) : null;
    const startTime: number = parsedSlot?.startTime ?? input.startTime ?? Number.NaN;
    if (!Number.isFinite(startTime)) {
      throw new BookingServiceError('SLOT_UNAVAILABLE', 'Selected slot is unavailable.');
    }

    const endTime = parsedSlot?.endTime ?? (startTime + service.durationMinutes * 60 * 1000);
    const now = nowMs();
    if (startTime <= now) {
      throw new BookingServiceError('SLOT_UNAVAILABLE', 'Selected start time is unavailable.');
    }

    const selectedDuration = getDurationMinutes(startTime, endTime);
    if (selectedDuration !== service.durationMinutes) {
      throw new BookingServiceError('SLOT_UNAVAILABLE', 'Selected slot does not match service duration.');
    }

    const { dayStart, dayKey } = dateRangeFromTimestamp(startTime);
    const validBlocks = generateServiceBlocks(dayStart, service.durationMinutes);
    if (!hasMatchingBlock(validBlocks, startTime, endTime)) {
      throw new BookingServiceError('SLOT_UNAVAILABLE', 'Selected slot is unavailable.');
    }

    const slotsForPhotographer = await this.getSlotsForAdmin(
      adminId,
      service.id,
      dayKey,
      photographer.id
    );
    const selectedSlotId = buildSlotId(startTime, endTime);
    const selectedSlot = slotsForPhotographer.find((slot) => slot.id === selectedSlotId);
    if (!selectedSlot || selectedSlot.state !== 'available') {
      throw new BookingServiceError(
        'SLOT_UNAVAILABLE',
        'Selected slot is no longer available for this photographer.'
      );
    }

    const booking: Booking = {
      id: createId('booking'),
      userId: client.id,
      photographerId: photographer.id,
      serviceId: service.id,
      slotId: selectedSlotId,
      startTime,
      endTime,
      dayKey,
      status: 'pending',
      createdByUserId: adminId,
      createdByRole: 'admin',
      createdAt: now
    };

    const createdBooking = await this.bookingRepository.createBookingDirect(booking, now);
    if (!createdBooking) {
      throw new BookingServiceError(
        'SLOT_UNAVAILABLE',
        'Photographer is no longer available for this time.'
      );
    }

    await this.messageService.getOrCreateThread(createdBooking.id);
    await this.searchService?.indexBooking(createdBooking);
    await this.enqueueOutboxBookingEvent(createdBooking, 'admin-create');
    await this.notifyBookingCreated(createdBooking);
    logger.info('BookingService admin booking created', {
      context: 'BookingService',
      event: 'admin_booking_created'
    });
    return createdBooking;
  }

  async blockPhotographerAvailability(
    photographerId: string,
    input: { startTime: number; endTime: number }
  ): Promise<Booking> {
    await this.requireActiveRole(photographerId, 'photographer');

    const startTime = input.startTime;
    const endTime = input.endTime;
    const now = nowMs();
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
      throw new BookingServiceError('INVALID_BOOKING', 'Invalid blocked availability range.');
    }

    if (startTime <= now) {
      throw new BookingServiceError(
        'SLOT_UNAVAILABLE',
        'Blocked availability must be in the future.'
      );
    }

    const { dayKey } = dateRangeFromTimestamp(startTime);
    const blockedEntry: Booking = {
      id: createId('booking-blocked'),
      userId: '',
      photographerId,
      serviceId: BLOCKED_AVAILABILITY_SERVICE_ID,
      slotId: buildSlotId(startTime, endTime),
      startTime,
      endTime,
      dayKey,
      status: 'blocked',
      createdByUserId: photographerId,
      createdAt: now
    };

    const created = await this.bookingRepository.createBookingDirect(blockedEntry, now);
    if (!created) {
      throw new BookingServiceError(
        'SLOT_UNAVAILABLE',
        'This block overlaps with existing bookings or blocked availability.'
      );
    }

    await this.searchService?.indexBooking(created);
    await this.enqueueOutboxBookingEvent(created, 'photographer-blocked-availability');
    return created;
  }

  async cancelLock(lockId: string, userId: string): Promise<void> {
    await this.requireActiveUser(userId);
    const deleted = await this.bookingRepository.deleteUserLock(lockId, userId);
    if (!deleted) {
      throw new BookingServiceError('LOCK_NOT_FOUND', 'Unable to cancel slot hold.');
    }
  }

  async getUserActiveLock(actorId: string, targetUserId = actorId): Promise<SlotLock | null> {
    await this.requireAuthorizedUserAccess(actorId, targetUserId);
    return this.bookingRepository.getActiveLockByUser(targetUserId, nowMs());
  }

  async getBookingsForUser(actorId: string, targetUserId = actorId): Promise<Booking[]> {
    await this.requireAuthorizedUserAccess(actorId, targetUserId);
    return this.bookingRepository.getBookingsByUser(targetUserId);
  }

  async getBookingsForPhotographer(userId: string): Promise<Booking[]> {
    await this.requireActiveRole(userId, 'photographer');
    const bookings = (await this.bookingRepository.getBookingsByPhotographer(userId)).filter(
      (booking) => booking.status !== 'blocked'
    );
    bookings.forEach((booking) => assertBookingHasPhotographer(booking));
    return [...bookings].sort((left, right) => left.startTime - right.startTime);
  }

  async getBlockedAvailabilityForPhotographer(userId: string): Promise<Booking[]> {
    await this.requireActiveRole(userId, 'photographer');
    const bookings = await this.bookingRepository.getBookingsByPhotographer(userId);
    return bookings
      .filter((booking) => booking.status === 'blocked')
      .sort((left, right) => left.startTime - right.startTime);
  }

  async getAllBookings(adminId: string): Promise<Booking[]> {
    await this.requireActiveRole(adminId, 'admin');
    const bookings = (await this.bookingRepository.getAllBookings()).filter(
      (booking) => booking.status !== 'blocked'
    );
    bookings.forEach((booking) => assertBookingHasPhotographer(booking));
    return [...bookings].sort((left, right) => left.startTime - right.startTime);
  }

  async updateBookingStatus(
    userId: string,
    bookingId: string,
    nextStatus: BookingStatus
  ): Promise<Booking> {
    await this.requireActiveRole(userId, 'photographer');

    const booking = await this.bookingRepository.getBookingById(bookingId);
    if (!booking) {
      throw new BookingServiceError('BOOKING_NOT_FOUND', 'Booking could not be found.');
    }
    assertBookingHasPhotographer(booking);

    if (booking.photographerId !== userId) {
      throw new BookingServiceError('FORBIDDEN', 'You can only update your own bookings.');
    }

    const validTransitions = PHOTOGRAPHER_STATUS_TRANSITIONS[booking.status];
    if (!validTransitions.includes(nextStatus)) {
      throw new BookingServiceError(
        'INVALID_STATUS_TRANSITION',
        `Cannot move booking from ${booking.status} to ${nextStatus}.`
      );
    }

    const now = nowMs();
    if (
      now > booking.endTime &&
      (nextStatus === 'arrived' || nextStatus === 'started' || nextStatus === 'completed')
    ) {
      throw new BookingServiceError(
        'INVALID_STATUS_TRANSITION',
        'Status updates are not allowed after the scheduled session end time.'
      );
    }

    const updated = await this.bookingRepository.updateBookingStatus(bookingId, nextStatus);
    await this.searchService?.indexBooking(updated);
    await this.enqueueOutboxBookingEvent(updated, 'photographer-status-update');
    await this.notifyPhotographerStatusUpdate(updated);
    if (nextStatus === 'confirmed') {
      await this.notifyBookingConfirmed(updated, userId, 'photographer');
    }
    logger.info('BookingService booking status updated by photographer', {
      context: 'BookingService',
      event: 'photographer_booking_status_updated',
      fromStatus: booking.status,
      toStatus: nextStatus
    });
    return updated;
  }

  async cancelBookingByAdmin(adminId: string, bookingId: string): Promise<Booking> {
    await this.requireActiveRole(adminId, 'admin');

    const booking = await this.bookingRepository.getBookingById(bookingId);
    if (!booking) {
      throw new BookingServiceError('BOOKING_NOT_FOUND', 'Booking could not be found.');
    }
    assertBookingHasPhotographer(booking);

    if (booking.status === 'canceled') {
      return booking;
    }

    if (
      booking.status === 'completed' ||
      booking.status === 'auto_completed' ||
      booking.status === 'missed'
    ) {
      throw new BookingServiceError(
        'INVALID_STATUS_TRANSITION',
        'This booking can no longer be canceled.'
      );
    }

    const canceled = await this.bookingRepository.updateBookingStatus(bookingId, 'canceled');
    await this.bookingRepository.deleteLocksForPhotographerRange(
      canceled.photographerId,
      canceled.startTime,
      canceled.endTime
    );

    await this.searchService?.indexBooking(canceled);
    await this.enqueueOutboxBookingEvent(canceled, 'admin-cancel');
    await this.notifyBookingCanceled(canceled, 'admin-cancel');
    logger.info('BookingService booking canceled by admin', {
      context: 'BookingService',
      event: 'booking_canceled_by_admin'
    });
    return canceled;
  }

  async cancelBookingByUser(userId: string, bookingId: string): Promise<Booking> {
    await this.requireActiveUser(userId);

    const booking = await this.bookingRepository.getBookingById(bookingId);
    if (!booking) {
      throw new BookingServiceError('BOOKING_NOT_FOUND', 'Booking could not be found.');
    }
    assertBookingHasPhotographer(booking);

    if (booking.userId !== userId) {
      throw new BookingServiceError('FORBIDDEN', 'You can only cancel your own bookings.');
    }

    if (booking.status === 'canceled') {
      return booking;
    }

    if (
      booking.status !== 'pending' &&
      booking.status !== 'confirmed' &&
      booking.status !== 'rescheduled' &&
      booking.status !== 'photographer_unavailable'
    ) {
      throw new BookingServiceError(
        'INVALID_STATUS_TRANSITION',
        `Cannot cancel booking in ${booking.status} status.`
      );
    }

    const canceled = await this.bookingRepository.updateBookingStatus(booking.id, 'canceled');
    await this.bookingRepository.deleteLocksForPhotographerRange(
      canceled.photographerId,
      canceled.startTime,
      canceled.endTime
    );
    await this.searchService?.indexBooking(canceled);
    await this.enqueueOutboxBookingEvent(canceled, 'client-cancel');
    await this.notifyBookingCanceled(canceled, 'client-cancel');
    logger.info('BookingService booking canceled by user', {
      context: 'BookingService',
      event: 'booking_canceled_by_client'
    });
    return canceled;
  }

  async updateBookingStatusByAdmin(
    adminId: string,
    bookingId: string,
    nextStatus: BookingStatus
  ): Promise<Booking> {
    await this.requireActiveRole(adminId, 'admin');
    const booking = await this.bookingRepository.getBookingById(bookingId);
    if (!booking) {
      throw new BookingServiceError('BOOKING_NOT_FOUND', 'Booking could not be found.');
    }
    assertBookingHasPhotographer(booking);

    if (isTerminalBookingStatus(booking.status)) {
      throw new BookingServiceError(
        'INVALID_STATUS_TRANSITION',
        `Cannot update booking in ${booking.status} status.`
      );
    }

    const validTransitions = VALID_STATUS_TRANSITIONS[booking.status];
    if (!validTransitions.includes(nextStatus)) {
      throw new BookingServiceError(
        'INVALID_STATUS_TRANSITION',
        `Cannot move booking from ${booking.status} to ${nextStatus}.`
      );
    }

    const now = nowMs();
    if (
      now > booking.endTime &&
      (nextStatus === 'arrived' || nextStatus === 'started' || nextStatus === 'completed')
    ) {
      throw new BookingServiceError(
        'INVALID_STATUS_TRANSITION',
        'Status updates are not allowed after the scheduled session end time.'
      );
    }

    const updated = await this.bookingRepository.updateBookingStatus(bookingId, nextStatus);
    await this.searchService?.indexBooking(updated);
    await this.enqueueOutboxBookingEvent(updated, 'admin-status-update');
    if (nextStatus === 'confirmed') {
      await this.messageService.getOrCreateThread(updated.id);
      await this.notifyBookingConfirmed(updated, adminId, 'admin');
    }

    if (nextStatus === 'canceled') {
      await this.notifyBookingCanceled(updated, 'admin-status');
    } else if (nextStatus === 'rescheduled') {
      await this.notifyBookingRescheduled(updated);
    }

    logger.info('BookingService booking status updated by admin', {
      context: 'BookingService',
      event: 'admin_booking_status_updated',
      fromStatus: booking.status,
      toStatus: nextStatus
    });

    return updated;
  }

  async markPhotographerUnavailableByAdmin(
    adminId: string,
    photographerId: string
  ): Promise<number> {
    await this.requireActiveRole(adminId, 'admin');

    const photographer = await this.authRepository.findUserById(photographerId);
    if (!photographer || photographer.role !== 'photographer') {
      throw new BookingServiceError('FORBIDDEN', 'Target user is not a photographer.');
    }

    const bookings = await this.bookingRepository.getBookingsByPhotographer(photographerId);
    const impactedBookings = bookings.filter((booking) =>
      isPhotographerDeactivationImpactStatus(booking.status)
    );

    if (impactedBookings.length === 0) {
      await this.bookingRepository.deleteLocksForPhotographer(photographerId);
      return 0;
    }

    let updatedCount = 0;
    for (const booking of impactedBookings) {
      const updated = await this.bookingRepository.updateBookingStatus(
        booking.id,
        'photographer_unavailable'
      );
      await this.searchService?.indexBooking(updated);
      await this.enqueueOutboxBookingStatusUpdated(updated, 'photographer-deactivated');
      await this.notifyPhotographerUnavailable(updated);
      updatedCount += 1;
    }

    await this.bookingRepository.deleteLocksForPhotographer(photographerId);
    logger.warn('BookingService photographer marked unavailable', {
      context: 'BookingService',
      event: 'photographer_marked_unavailable',
      updatedBookings: updatedCount,
      actorRole: 'admin'
    });
    return updatedCount;
  }

  async processDueReminders(now = nowMs()): Promise<number> {
    const bookings = await this.bookingRepository.getAllBookings();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    let createdCount = 0;

    for (const booking of bookings) {
      if (
        isResolvedBookingStatus(booking.status) ||
        booking.startTime <= now
      ) {
        continue;
      }

      const reminderDueAt = booking.startTime - twentyFourHoursMs;
      if (reminderDueAt > now) {
        continue;
      }

      const dedupKey = `booking-reminder-24h-${booking.id}-${booking.userId}`;
      const notification = await this.notificationService.createNotification(
        booking.userId,
        'booking.reminder.24h',
        'Reminder: you have a booking within 24 hours.',
        {
          bookingId: booking.id,
          startTime: booking.startTime,
          photographerId: booking.photographerId
        },
        dedupKey
      );

      if (notification) {
        createdCount += 1;
      }
    }

    return createdCount;
  }

  async processOverdueItems(now = nowMs()): Promise<number> {
    const bookings = await this.bookingRepository.getAllBookings();
    let resolvedCount = 0;

    for (const booking of bookings) {
      if (isResolvedBookingStatus(booking.status)) {
        continue;
      }

      const canBecomeMissed =
        booking.status === 'pending' ||
        booking.status === 'confirmed' ||
        booking.status === 'arrived';

      if (canBecomeMissed) {
        if (now <= booking.endTime) {
          continue;
        }

        const missedBooking = await this.bookingRepository.updateBookingStatus(booking.id, 'missed');
        await this.searchService?.indexBooking(missedBooking);
        await this.enqueueOutboxBookingStatusUpdated(missedBooking, 'scheduler-missed');
        await this.notifyBookingMissed(missedBooking);
        resolvedCount += 1;
        continue;
      }

      if (booking.status === 'started' && now > booking.endTime + AUTO_COMPLETE_GRACE_MS) {
        const autoCompletedBooking = await this.bookingRepository.updateBookingStatus(
          booking.id,
          'auto_completed'
        );
        await this.searchService?.indexBooking(autoCompletedBooking);
        await this.enqueueOutboxBookingStatusUpdated(
          autoCompletedBooking,
          'scheduler-auto-completed'
        );
        await this.notifyBookingAutoCompleted(autoCompletedBooking);
        resolvedCount += 1;
      }
    }

    return resolvedCount;
  }

  async cleanupExpiredLocks(now = nowMs()): Promise<number> {
    return this.bookingRepository.deleteExpiredLocks(now);
  }

  private async notifyBookingCreated(booking: Booking): Promise<void> {
    await this.notificationService.createNotification(
      booking.photographerId,
      'booking.created',
      'New booking assigned to your schedule.',
      {
        bookingId: booking.id,
        clientUserId: booking.userId,
        startTime: booking.startTime,
        endTime: booking.endTime,
        actorId: booking.userId
      },
      `booking-created-photographer-${booking.id}-${booking.photographerId}`
    );

    await this.notificationService.createNotification(
      booking.userId,
      'booking.pending',
      'Your booking request was submitted and is pending confirmation.',
      {
        bookingId: booking.id,
        photographerId: booking.photographerId,
        startTime: booking.startTime,
        endTime: booking.endTime,
        actorId: booking.userId
      },
      `booking-pending-client-${booking.id}-${booking.userId}`
    );
  }

  private async notifyBookingConfirmed(
    booking: Booking,
    actorId: string,
    source: 'photographer' | 'admin'
  ): Promise<void> {
    await this.notificationService.createNotification(
      booking.userId,
      'booking.confirmed',
      'Your booking has been confirmed.',
      {
        bookingId: booking.id,
        photographerId: booking.photographerId,
        startTime: booking.startTime,
        endTime: booking.endTime,
        actorId
      },
      `booking-confirmed-client-${booking.id}-${booking.userId}-${source}`
    );
  }

  private async enqueueOutboxBookingEvent(booking: Booking, source: string): Promise<void> {
    if (!this.outboxService) {
      return;
    }

    const stamp = nowMs();
    await this.outboxService.enqueue({
      type: 'booking.status.changed',
      payload: {
        bookingId: booking.id,
        source,
        status: booking.status,
        photographerId: booking.photographerId,
        userId: booking.userId,
        startTime: booking.startTime,
        endTime: booking.endTime,
        changedAt: stamp
      },
      idempotencyKey: `booking-${booking.id}-${booking.status}-${source}-${stamp}`
    });
  }

  private async enqueueOutboxBookingStatusUpdated(booking: Booking, source: string): Promise<void> {
    if (!this.outboxService) {
      return;
    }

    await this.outboxService.enqueue({
      type: 'booking_status_updated',
      payload: {
        bookingId: booking.id,
        newStatus: booking.status,
        source
      },
      idempotencyKey: `booking-status-updated-${booking.id}-${booking.status}`
    });
  }

  private async notifyBookingCanceled(booking: Booking, source: string): Promise<void> {
    await this.notificationService.createNotification(
      booking.userId,
      'booking.canceled',
      'Your booking was canceled.',
      {
        bookingId: booking.id,
        photographerId: booking.photographerId,
        source,
        actorId: booking.photographerId
      },
      `booking-canceled-client-${booking.id}-${booking.userId}-${source}`
    );

    await this.notificationService.createNotification(
      booking.photographerId,
      'booking.canceled',
      'A booking on your schedule was canceled.',
      {
        bookingId: booking.id,
        clientUserId: booking.userId,
        source,
        actorId: booking.userId
      },
      `booking-canceled-photographer-${booking.id}-${booking.photographerId}-${source}`
    );
  }

  private async notifyBookingRescheduled(booking: Booking): Promise<void> {
    await this.notificationService.createNotification(
      booking.userId,
      'booking.rescheduled',
      'Your booking status changed to rescheduled.',
      {
        bookingId: booking.id,
        photographerId: booking.photographerId,
        actorId: booking.photographerId
      },
      `booking-rescheduled-client-${booking.id}-${booking.userId}`
    );

    await this.notificationService.createNotification(
      booking.photographerId,
      'booking.rescheduled',
      'A booking on your schedule was marked as rescheduled.',
      {
        bookingId: booking.id,
        clientUserId: booking.userId,
        actorId: booking.userId
      },
      `booking-rescheduled-photographer-${booking.id}-${booking.photographerId}`
    );
  }

  private async notifyBookingMissed(booking: Booking): Promise<void> {
    await this.notificationService.createNotification(
      booking.userId,
      'booking.missed',
      'Your session was marked as missed',
      {
        bookingId: booking.id,
        photographerId: booking.photographerId,
        startTime: booking.startTime,
        endTime: booking.endTime,
        actorId: booking.photographerId
      },
      `booking-missed-client-${booking.id}-${booking.userId}`
    );

    await this.notificationService.createNotification(
      booking.photographerId,
      'booking.missed',
      'Session marked as missed (client did not arrive)',
      {
        bookingId: booking.id,
        clientUserId: booking.userId,
        startTime: booking.startTime,
        endTime: booking.endTime,
        actorId: booking.userId
      },
      `booking-missed-photographer-${booking.id}-${booking.photographerId}`
    );
  }

  private async notifyBookingAutoCompleted(booking: Booking): Promise<void> {
    await this.notificationService.createNotification(
      booking.userId,
      'booking.auto_completed',
      'Session automatically marked as completed',
      {
        bookingId: booking.id,
        photographerId: booking.photographerId,
        startTime: booking.startTime,
        endTime: booking.endTime,
        actorId: booking.photographerId
      },
      `booking-auto-completed-client-${booking.id}-${booking.userId}`
    );

    await this.notificationService.createNotification(
      booking.photographerId,
      'booking.auto_completed',
      'Session automatically marked as completed',
      {
        bookingId: booking.id,
        clientUserId: booking.userId,
        startTime: booking.startTime,
        endTime: booking.endTime,
        actorId: booking.userId
      },
      `booking-auto-completed-photographer-${booking.id}-${booking.photographerId}`
    );
  }

  private async notifyPhotographerStatusUpdate(booking: Booking): Promise<void> {
    await this.notificationService.createNotification(
      booking.userId,
      'booking.status.updated',
      `Your booking status is now ${booking.status}.`,
      {
        bookingId: booking.id,
        photographerId: booking.photographerId,
        status: booking.status,
        actorId: booking.photographerId
      },
      `booking-status-client-${booking.id}-${booking.userId}-${booking.status}`
    );
  }

  private async notifyPhotographerUnavailable(booking: Booking): Promise<void> {
    await this.notificationService.createNotification(
      booking.userId,
      'booking.photographer_unavailable',
      'Your photographer is no longer available. Please reschedule.',
      {
        bookingId: booking.id,
        photographerId: booking.photographerId,
        status: booking.status,
        actorId: booking.photographerId
      },
      `booking-photographer-unavailable-client-${booking.id}-${booking.userId}`
    );
  }

  private async requireActiveRole(
    userId: string,
    role: 'admin' | 'photographer'
  ): Promise<void> {
    const user = await this.authRepository.findUserById(userId);
    if (!user || !user.isActive || user.role !== role) {
      throw new BookingServiceError('FORBIDDEN', 'You are not allowed to perform this action.');
    }
  }

  private async requireActiveUser(userId: string): Promise<void> {
    const user = await this.authRepository.findUserById(userId);
    if (!user || !user.isActive) {
      throw new BookingServiceError('FORBIDDEN', 'Your account is unavailable.');
    }
  }

  private async requireAuthorizedUserAccess(actorId: string, targetUserId: string): Promise<void> {
    const actor = await this.authRepository.findUserById(actorId);
    if (!actor || !actor.isActive) {
      throw new BookingServiceError('FORBIDDEN', 'Unauthorized');
    }

    if (actor.role !== 'admin' && actor.id !== targetUserId) {
      throw new BookingServiceError('FORBIDDEN', 'Forbidden');
    }

    const target = await this.authRepository.findUserById(targetUserId);
    if (!target || !target.isActive) {
      throw new BookingServiceError('FORBIDDEN', 'Unauthorized');
    }
  }

  private async getAssignablePhotographersForRange(
    dayKey: string,
    startTime: number,
    endTime: number,
    now: number,
    userId = '',
    ignoredLockIds: Set<string> = new Set()
  ): Promise<{ photographers: Photographer[]; bookingCounts: Map<string, number> }> {
    const [photographersRaw, bookings, locksRaw] = await Promise.all([
      this.bookingRepository.getPhotographers(),
      this.bookingRepository.getBookingsForDay(dayKey),
      this.bookingRepository.getActiveLocksForDay(dayKey, now)
    ]);

    const activePhotographers = await this.filterPhotographersByPrivacyRestrictions(
      userId,
      sortPhotographersDeterministic(
        normalizePhotographers(photographersRaw).filter((photographer) => photographer.isActive)
      )
    );
    if (activePhotographers.length === 0) {
      return {
        photographers: [],
        bookingCounts: new Map<string, number>()
      };
    }

    const photographerIds = new Set(activePhotographers.map((photographer) => photographer.id));
    const bookingCounts = new Map<string, number>();

    for (const booking of bookings) {
      if (
        booking.status === 'canceled' ||
        booking.status === 'blocked' ||
        !photographerIds.has(booking.photographerId)
      ) {
        continue;
      }

      bookingCounts.set(booking.photographerId, (bookingCounts.get(booking.photographerId) ?? 0) + 1);
    }

    const activeLocks = locksRaw.filter(
      (lock) => isActiveLock(lock, now) && !ignoredLockIds.has(lock.id) && photographerIds.has(lock.photographerId)
    );

    const photographers = activePhotographers.filter((photographer) => {
      if (userId && photographer.id === userId) {
        return false;
      }

      const hasBookingConflict = bookings.some((booking) => {
        if (
          booking.status === 'canceled' ||
          booking.photographerId !== photographer.id ||
          !hasBookingRange(booking)
        ) {
          return false;
        }

        return overlaps(startTime, endTime, booking.startTime, booking.endTime);
      });
      if (hasBookingConflict) {
        return false;
      }

      const hasLockConflict = activeLocks.some((lock) => {
        if (lock.photographerId !== photographer.id) {
          return false;
        }

        return overlaps(startTime, endTime, lock.startTime, lock.endTime);
      });

      return !hasLockConflict;
    });

    return {
      photographers,
      bookingCounts
    };
  }

  private chooseLeastLoadedPhotographer(
    photographers: Photographer[],
    bookingCounts: Map<string, number>
  ): Photographer | null {
    const sorted = [...photographers].sort((left, right) => {
      const leftCount = bookingCounts.get(left.id) ?? 0;
      const rightCount = bookingCounts.get(right.id) ?? 0;
      if (leftCount !== rightCount) {
        return leftCount - rightCount;
      }

      return left.id.localeCompare(right.id);
    });

    return sorted[0] ?? null;
  }

  private async filterPhotographersByPrivacyRestrictions(
    userId: string,
    photographers: Photographer[]
  ): Promise<Photographer[]> {
    if (!userId) {
      return photographers;
    }

    const [actor, users] = await Promise.all([
      this.authRepository.findUserById(userId),
      this.authRepository.getAllUsers()
    ]);
    if (!actor || !actor.isActive) {
      return [];
    }

    const actorBlockedSet = new Set(actor.blockedUserIds ?? []);
    const usersById = new Map(users.map((user) => [user.id, user]));

    return photographers.filter((photographer) => {
      const photographerUser = usersById.get(photographer.id);
      if (!photographerUser || !photographerUser.isActive) {
        return false;
      }

      const photographerBlockedSet = new Set(photographerUser.blockedUserIds ?? []);
      return !actorBlockedSet.has(photographer.id) && !photographerBlockedSet.has(actor.id);
    });
  }

  private async getPrivacyAvailabilityForUser(userId: string): Promise<{
    hasPhotographers: boolean;
    hasAllowedPhotographers: boolean;
  }> {
    const photographers = normalizePhotographers(await this.bookingRepository.getPhotographers()).filter(
      (photographer) => photographer.isActive
    );
    const hasPhotographers = photographers.length > 0;

    const allowedPhotographers = await this.filterPhotographersByPrivacyRestrictions(userId, photographers);
    return {
      hasPhotographers,
      hasAllowedPhotographers: allowedPhotographers.length > 0
    };
  }

  private async resolveClientForAdmin(
    clientId?: string,
    clientUsername?: string
  ): Promise<{ id: string; username: string }> {
    let client = null;
    if (clientId) {
      client = await this.authRepository.findUserById(clientId);
    } else if (clientUsername) {
      client = await this.authRepository.findUserByUsername(clientUsername.trim().toLowerCase());
    }

    if (!client || !client.isActive || client.role !== 'client') {
      throw new BookingServiceError('CLIENT_NOT_FOUND', 'A valid active client is required.');
    }

    return {
      id: client.id,
      username: client.username
    };
  }

  private async resolvePhotographerForAdmin(
    photographerId?: string,
    photographerUsername?: string
  ): Promise<{ id: string; username: string }> {
    let photographer = null;
    if (photographerId) {
      photographer = await this.authRepository.findUserById(photographerId);
    } else if (photographerUsername) {
      photographer = await this.authRepository.findUserByUsername(
        photographerUsername.trim().toLowerCase()
      );
    }

    if (!photographer || !photographer.isActive || photographer.role !== 'photographer') {
      throw new BookingServiceError(
        'PHOTOGRAPHER_NOT_FOUND',
        'A valid active photographer is required.'
      );
    }

    return {
      id: photographer.id,
      username: photographer.username
    };
  }

  private async ensureUsersNotBlocked(clientId: string, photographerId: string): Promise<void> {
    const [client, photographer] = await Promise.all([
      this.authRepository.findUserById(clientId),
      this.authRepository.findUserById(photographerId)
    ]);
    if (!client || !photographer) {
      throw new BookingServiceError(
        'BLOCKED_INTERACTION',
        'You cannot book with this user due to privacy restrictions'
      );
    }

    const clientBlockedSet = new Set(client.blockedUserIds ?? []);
    const photographerBlockedSet = new Set(photographer.blockedUserIds ?? []);
    if (clientBlockedSet.has(photographer.id) || photographerBlockedSet.has(client.id)) {
      throw new BookingServiceError(
        'BLOCKED_INTERACTION',
        'You cannot book with this user due to privacy restrictions'
      );
    }
  }

  private async requireService(serviceId: string): Promise<ServiceItem> {
    const service = await this.findServiceById(serviceId);
    if (!service || !service.isActive) {
      throw new BookingServiceError('SERVICE_NOT_FOUND', 'Selected service does not exist.');
    }

    return service;
  }

  private async findServiceById(serviceId: string): Promise<ServiceItem | null> {
    const services = await this.bookingRepository.getServices();
    return services.find((service) => service.id === serviceId) ?? null;
  }

  private normalizeServiceItemInput(
    serviceId: string,
    input: ServiceItemInput,
    updatedAt: number,
    createdAt = updatedAt,
    isActive = true
  ): ServiceItem {
    const normalizedName = input.name.trim();
    if (!normalizedName) {
      throw new BookingServiceError('INVALID_SERVICE', 'Service name is required.');
    }

    const normalizedDuration = Number(input.durationMinutes);
    if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
      throw new BookingServiceError('INVALID_SERVICE', 'Service duration must be greater than zero.');
    }

    if (normalizedDuration % 30 !== 0) {
      throw new BookingServiceError(
        'INVALID_SERVICE',
        'Service duration must align to 30-minute slot increments.'
      );
    }

    const normalizedPrice =
      input.price === undefined || input.price === null
        ? 0
        : Number(input.price);
    if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
      throw new BookingServiceError('INVALID_SERVICE', 'Service price must be zero or greater.');
    }

    return {
      id: serviceId,
      name: normalizedName,
      durationMinutes: normalizedDuration,
      price: normalizedPrice,
      isActive,
      createdAt,
      updatedAt
    };
  }
}

export function createBookingService(
  bookingRepository: BookingRepository,
  authRepository: AuthRepository,
  messageService: MessageService,
  notificationService: NotificationService,
  outboxService: OutboxService | null = null,
  searchService: SearchService | null = null
): BookingService {
  return new LocalBookingService(
    bookingRepository,
    authRepository,
    messageService,
    notificationService,
    outboxService,
    searchService
  );
}
