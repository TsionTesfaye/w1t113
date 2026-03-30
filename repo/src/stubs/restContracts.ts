import type { BookingStatus, UserRole } from '@/app/types/domain';

// Development-time backend contract stubs (offline-first runtime).
// These mirror future REST payload shapes for eventual Express/MySQL integration.

export interface BookingResponseContract {
  id: string;
  userId: string;
  photographerId: string;
  serviceId: string;
  startTime: number;
  endTime: number;
  status: BookingStatus;
}

export interface UserResponseContract {
  id: string;
  username: string;
  role: UserRole;
  isActive: boolean;
  createdAt: number;
}

export interface NotificationResponseContract {
  id: string;
  userId: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: number;
}

export interface HealthFormResponseContract {
  id: string;
  bookingId: string;
  userId: string;
  templateId: string;
  templateVersion: number;
  encryptedAnswers: string;
  status: 'draft' | 'submitted';
  submittedAt: number | null;
}
