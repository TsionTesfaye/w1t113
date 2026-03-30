import type {
  Booking,
  FormField,
  FormFieldConditionOperator,
  FormResponse,
  FormTemplate,
  UserRole
} from '@/app/types/domain';
import type { AuthService } from '@/services/AuthService';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type { BookingRepository } from '@/repositories/BookingRepository';
import type { HealthFormRepository } from '@/repositories/HealthFormRepository';
import type { NotificationService } from '@/services/NotificationService';
import { nowMs } from '@/services/timeSource';

const MAX_TEMPLATE_NAME_LENGTH = 120;
const MAX_TEMPLATE_DESCRIPTION_LENGTH = 400;
const MAX_FIELD_LABEL_LENGTH = 120;
const MAX_FIELD_HELP_TEXT_LENGTH = 240;
const MAX_FIELD_PLACEHOLDER_LENGTH = 120;
const MAX_TEXT_VALUE_LENGTH = 2000;
const MAX_ATTACHMENT_NAME_LENGTH = 180;
const MAX_ATTACHMENT_MIME_LENGTH = 120;
const MAX_ATTACHMENT_BASE64_LENGTH = 8_000_000;
const DUPLICATE_SUBMISSION_WINDOW_MS = 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type FormFieldTypeInput = FormField['type'];

export interface FormFieldInput {
  id?: string;
  type: FormFieldTypeInput;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  helpText?: string;
  sensitive?: boolean;
  condition?: {
    fieldId: string;
    operator: FormFieldConditionOperator;
    value: unknown;
  };
}

export interface FormTemplateInput {
  name: string;
  description?: string;
  isActive?: boolean;
  fields: FormFieldInput[];
}

export interface ValidationError {
  fieldId: string;
  message: string;
}

export interface FormBookingSummary {
  bookingId: string;
  serviceName: string;
  bookingStatus: Booking['status'];
  startTime: number;
  endTime: number;
  formStatus: 'not_started' | 'draft' | 'submitted' | 'unavailable';
  submittedAt: number | null;
  canOpen: boolean;
  note: string | null;
}

export interface FormForBookingResult {
  booking: Booking;
  serviceName: string;
  template: FormTemplate | null;
  response: FormResponse | null;
  answers: Record<string, unknown>;
  visibleFieldIds: string[];
  canEdit: boolean;
  lockReason: string | null;
  decryptionIssue: string | null;
}

export type HealthFormServiceErrorCode =
  | 'FORBIDDEN'
  | 'USER_NOT_FOUND'
  | 'BOOKING_NOT_FOUND'
  | 'TEMPLATE_NOT_FOUND'
  | 'NO_ACTIVE_TEMPLATE'
  | 'INVALID_TEMPLATE'
  | 'INVALID_CONDITION'
  | 'INVALID_ANSWER'
  | 'VALIDATION_FAILED'
  | 'ENCRYPTION_KEY_UNAVAILABLE'
  | 'DECRYPTION_FAILED'
  | 'DUPLICATE_SUBMISSION'
  | 'BOOKING_CANCELED';

export class HealthFormServiceError extends Error {
  readonly code: HealthFormServiceErrorCode;
  readonly validationErrors: ValidationError[];

  constructor(code: HealthFormServiceErrorCode, message: string, validationErrors: ValidationError[] = []) {
    super(message);
    this.code = code;
    this.validationErrors = validationErrors;
  }
}

export interface HealthFormService {
  createTemplate(adminId: string, templateInput: FormTemplateInput): Promise<FormTemplate>;
  updateTemplate(adminId: string, templateId: string, templateInput: FormTemplateInput): Promise<FormTemplate>;
  getTemplates(actorId: string): Promise<FormTemplate[]>;
  getActiveTemplates(): Promise<FormTemplate[]>;
  getAccessibleBookingForms(actorId: string): Promise<FormBookingSummary[]>;
  getClientBookingForms(userId: string): Promise<FormBookingSummary[]>;
  getFormForBooking(userId: string, bookingId: string): Promise<FormForBookingResult>;
  getFormResponseForBooking(actorId: string, bookingId: string): Promise<FormForBookingResult>;
  saveDraft(userId: string, bookingId: string, answers: Record<string, unknown>): Promise<FormResponse>;
  submitForm(userId: string, bookingId: string, answers: Record<string, unknown>): Promise<FormResponse>;
  getUserFormResponses(userId: string): Promise<FormResponse[]>;
  evaluateVisibleFields(template: FormTemplate, answers: Record<string, unknown>): FormField[];
  validateAnswers(
    template: FormTemplate,
    visibleFields: FormField[],
    answers: Record<string, unknown>
  ): ValidationError[];
  encryptAnswers(userId: string, plainAnswers: Record<string, unknown>): Promise<string>;
  decryptAnswers(userId: string, encryptedAnswers: string): Promise<Record<string, unknown>>;
  checkDuplicateSubmissionWindow(userId: string, bookingId: string): Promise<void>;
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createResponseId(bookingId: string, userId: string): string {
  return `form-response-${bookingId}-${userId}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function sanitizeSingleLine(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function sanitizeText(input: string): string {
  return input.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength);
}

function isNonEmptyValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== undefined && value !== null;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'string' && typeof right === 'string') {
    return left.trim() === right.trim();
  }

  return left === right;
}

function evaluateConditionValue(
  operator: FormFieldConditionOperator,
  referenceValue: unknown,
  conditionValue: unknown
): boolean {
  if (operator === 'equals') {
    return valuesEqual(referenceValue, conditionValue);
  }

  if (operator === 'notEquals') {
    return !valuesEqual(referenceValue, conditionValue);
  }

  if (Array.isArray(referenceValue)) {
    return referenceValue.some((item) => valuesEqual(item, conditionValue));
  }

  if (typeof referenceValue === 'string') {
    return referenceValue.toLowerCase().includes(String(conditionValue ?? '').toLowerCase());
  }

  return false;
}

function getFieldTypeLabel(type: FormField['type']): string {
  switch (type) {
    case 'text':
      return 'text';
    case 'textarea':
      return 'text area';
    case 'checkbox':
      return 'checkbox';
    case 'select':
      return 'select';
    case 'radio':
      return 'radio';
    case 'file':
      return 'file';
    default:
      return 'field';
  }
}

function isAttachmentValue(
  value: unknown
): value is { name: string; mimeType: string; data: string; size?: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<{ name: unknown; mimeType: unknown; data: unknown; size: unknown }>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.mimeType === 'string' &&
    typeof candidate.data === 'string' &&
    candidate.name.trim().length > 0 &&
    candidate.data.length > 0
  );
}

function isEncryptedPayloadEnvelope(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as { iv?: unknown; ciphertext?: unknown };
    return typeof parsed.iv === 'string' && typeof parsed.ciphertext === 'string';
  } catch {
    return false;
  }
}

function isEncryptedPayloadEnvelopeObject(
  value: unknown
): value is { iv: string; ciphertext: string; v?: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<{ iv: unknown; ciphertext: unknown; v: unknown }>;
  return typeof candidate.iv === 'string' && typeof candidate.ciphertext === 'string';
}

function extractAttachmentDataPayload(candidateData: unknown): {
  base64Data: string | null;
  encryptedPayload: string | null;
} {
  if (typeof candidateData === 'string') {
    if (isEncryptedPayloadEnvelope(candidateData)) {
      return {
        base64Data: null,
        encryptedPayload: candidateData
      };
    }

    return {
      base64Data: candidateData,
      encryptedPayload: null
    };
  }

  if (!candidateData || typeof candidateData !== 'object' || Array.isArray(candidateData)) {
    return {
      base64Data: null,
      encryptedPayload: null
    };
  }

  if (isEncryptedPayloadEnvelopeObject(candidateData)) {
    return {
      base64Data: null,
      encryptedPayload: JSON.stringify(candidateData)
    };
  }

  const wrapped = candidateData as { data?: unknown };
  if (typeof wrapped.data === 'string') {
    if (isEncryptedPayloadEnvelope(wrapped.data)) {
      return {
        base64Data: null,
        encryptedPayload: wrapped.data
      };
    }

    return {
      base64Data: wrapped.data,
      encryptedPayload: null
    };
  }

  if (isEncryptedPayloadEnvelopeObject(wrapped.data)) {
    return {
      base64Data: null,
      encryptedPayload: JSON.stringify(wrapped.data)
    };
  }

  return {
    base64Data: null,
    encryptedPayload: null
  };
}

function normalizeAttachmentBase64Payload(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.toLowerCase().startsWith('data:')) {
    const commaIndex = trimmed.indexOf(',');
    if (commaIndex === -1) {
      return null;
    }

    const header = trimmed.slice(0, commaIndex).toLowerCase();
    if (!header.includes(';base64')) {
      return null;
    }

    const payload = trimmed.slice(commaIndex + 1).trim();
    return payload.length > 0 ? payload : null;
  }

  return trimmed;
}

function toTemplateSnapshot(template: FormTemplate): FormResponse['templateSnapshot'] {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    version: template.version,
    fields: template.fields
  };
}

function asRenderTemplate(
  template: FormTemplate | FormResponse['templateSnapshot'] | null | undefined
): FormTemplate | null {
  if (!template) {
    return null;
  }

  if ('createdBy' in template) {
    return template;
  }

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    isActive: true,
    version: template.version,
    fields: template.fields,
    createdBy: '',
    createdAt: 0,
    updatedAt: 0
  };
}

class LocalHealthFormService implements HealthFormService {
  private readonly formsRepository: HealthFormRepository;
  private readonly authRepository: AuthRepository;
  private readonly bookingRepository: BookingRepository;
  private readonly notificationService: NotificationService;
  private readonly authService: AuthService;

  constructor(
    formsRepository: HealthFormRepository,
    authRepository: AuthRepository,
    bookingRepository: BookingRepository,
    notificationService: NotificationService,
    authService: AuthService
  ) {
    this.formsRepository = formsRepository;
    this.authRepository = authRepository;
    this.bookingRepository = bookingRepository;
    this.notificationService = notificationService;
    this.authService = authService;
  }

  async createTemplate(adminId: string, templateInput: FormTemplateInput): Promise<FormTemplate> {
    await this.requireActiveRole(adminId, 'admin');

    const now = nowMs();
    const normalizedTemplate = this.normalizeTemplateInput(templateInput);
    const template: FormTemplate = {
      id: createId('form-template'),
      name: normalizedTemplate.name,
      description: normalizedTemplate.description,
      isActive: normalizedTemplate.isActive,
      version: 1,
      fields: normalizedTemplate.fields,
      createdBy: adminId,
      createdAt: now,
      updatedAt: now
    };

    await this.formsRepository.createTemplate(template);
    return template;
  }

  async updateTemplate(
    adminId: string,
    templateId: string,
    templateInput: FormTemplateInput
  ): Promise<FormTemplate> {
    await this.requireActiveRole(adminId, 'admin');
    const existing = await this.formsRepository.getTemplateById(templateId);
    if (!existing) {
      throw new HealthFormServiceError('TEMPLATE_NOT_FOUND', 'Template could not be found.');
    }

    const normalizedTemplate = this.normalizeTemplateInput(templateInput);
    const now = nowMs();
    const updatedTemplate: FormTemplate = {
      ...existing,
      name: normalizedTemplate.name,
      description: normalizedTemplate.description,
      isActive: normalizedTemplate.isActive,
      fields: normalizedTemplate.fields,
      version: existing.version + 1,
      updatedAt: now
    };

    await this.formsRepository.updateTemplate(updatedTemplate);
    return updatedTemplate;
  }

  async getTemplates(actorId: string): Promise<FormTemplate[]> {
    await this.requireActiveRole(actorId, 'admin');
    return this.formsRepository.getTemplates();
  }

  async getActiveTemplates(): Promise<FormTemplate[]> {
    return this.formsRepository.getActiveTemplates();
  }

  async getClientBookingForms(userId: string): Promise<FormBookingSummary[]> {
    await this.requireActiveRole(userId, 'client');

    const [bookings, services, activeTemplates] = await Promise.all([
      this.bookingRepository.getBookingsByUser(userId),
      this.bookingRepository.getServices(),
      this.formsRepository.getActiveTemplates()
    ]);

    const servicesById = new Map(services.map((service) => [service.id, service]));
    const hasActiveTemplate = activeTemplates.length > 0;

    const items = await Promise.all(
      bookings.map(async (booking) => {
        const response = await this.formsRepository.getResponseByBookingAndUser(booking.id, userId);
        const serviceName = servicesById.get(booking.serviceId)?.name ?? 'Session';

        if (response?.status === 'submitted') {
          return {
            bookingId: booking.id,
            serviceName,
            bookingStatus: booking.status,
            startTime: booking.startTime,
            endTime: booking.endTime,
            formStatus: 'submitted' as const,
            submittedAt: response.submittedAt,
            canOpen: true,
            note: null
          };
        }

        if (booking.status === 'canceled') {
          return {
            bookingId: booking.id,
            serviceName,
            bookingStatus: booking.status,
            startTime: booking.startTime,
            endTime: booking.endTime,
            formStatus: 'unavailable' as const,
            submittedAt: response?.submittedAt ?? null,
            canOpen: false,
            note: 'Booking was canceled. Editing is disabled.'
          };
        }

        if (!hasActiveTemplate && !response) {
          return {
            bookingId: booking.id,
            serviceName,
            bookingStatus: booking.status,
            startTime: booking.startTime,
            endTime: booking.endTime,
            formStatus: 'unavailable' as const,
            submittedAt: null,
            canOpen: false,
            note: 'No active form template is available.'
          };
        }

        if (response?.status === 'draft') {
          return {
            bookingId: booking.id,
            serviceName,
            bookingStatus: booking.status,
            startTime: booking.startTime,
            endTime: booking.endTime,
            formStatus: 'draft' as const,
            submittedAt: null,
            canOpen: true,
            note: null
          };
        }

        return {
          bookingId: booking.id,
          serviceName,
          bookingStatus: booking.status,
          startTime: booking.startTime,
          endTime: booking.endTime,
          formStatus: 'not_started' as const,
          submittedAt: null,
          canOpen: hasActiveTemplate,
          note: null
        };
      })
    );

    return items.sort((left, right) => right.startTime - left.startTime);
  }

  async getAccessibleBookingForms(actorId: string): Promise<FormBookingSummary[]> {
    const actor = await this.requireActiveUser(actorId);
    if (actor.role === 'client') {
      return this.getClientBookingForms(actor.id);
    }

    if (actor.role !== 'admin' && actor.role !== 'photographer') {
      throw new HealthFormServiceError('FORBIDDEN', 'You are not allowed to view booking health forms.');
    }

    const [bookings, services] = await Promise.all([
      actor.role === 'admin'
        ? this.bookingRepository.getAllBookings()
        : this.bookingRepository.getBookingsByPhotographer(actor.id),
      this.bookingRepository.getServices()
    ]);

    const servicesById = new Map(services.map((service) => [service.id, service]));
    const items = await Promise.all(
      bookings
        .filter((booking) => booking.status !== 'blocked')
        .map(async (booking) => {
          const response = await this.formsRepository.getResponseByBookingAndUser(booking.id, booking.userId);
          const serviceName = servicesById.get(booking.serviceId)?.name ?? 'Session';

          if (!response) {
            return {
              bookingId: booking.id,
              serviceName,
              bookingStatus: booking.status,
              startTime: booking.startTime,
              endTime: booking.endTime,
              formStatus: 'not_started' as const,
              submittedAt: null,
              canOpen: false,
              note: 'No health response has been submitted yet.'
            };
          }

          return {
            bookingId: booking.id,
            serviceName,
            bookingStatus: booking.status,
            startTime: booking.startTime,
            endTime: booking.endTime,
            formStatus: response.status,
            submittedAt: response.submittedAt,
            canOpen: false,
            note:
              response.status === 'submitted'
                ? 'Encrypted response content is client-session only. Staff can review submission status and timestamps.'
                : 'Client draft is not available for external review until submitted.'
          };
        })
    );

    return items.sort((left, right) => right.startTime - left.startTime);
  }

  async getFormForBooking(userId: string, bookingId: string): Promise<FormForBookingResult> {
    await this.requireActiveRole(userId, 'client');

    const [booking, services, response] = await Promise.all([
      this.requireOwnedBooking(userId, bookingId),
      this.bookingRepository.getServices(),
      this.formsRepository.getResponseByBookingAndUser(bookingId, userId)
    ]);

    const serviceName = services.find((service) => service.id === booking.serviceId)?.name ?? 'Session';
    const template = await this.resolveTemplateForResponse(response);
    const duplicateWindowBlocked =
      response?.status === 'submitted' &&
      typeof response.submittedAt === 'number' &&
      nowMs() - response.submittedAt < DUPLICATE_SUBMISSION_WINDOW_MS;

    let answers: Record<string, unknown> = {};
    let decryptionIssue: string | null = null;

    if (response) {
      try {
        answers = await this.decryptAnswers(userId, response.encryptedAnswers);
        answers = await this.resolveAttachmentAnswers(userId, template, answers);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unable to decrypt saved answers.';
        decryptionIssue = message;
      }
    }

    const visibleFieldIds = template ? this.evaluateVisibleFields(template, answers).map((field) => field.id) : [];

    let canEdit = Boolean(template);
    let lockReason: string | null = null;

    if (!template) {
      canEdit = false;
      lockReason = 'No active form template is available.';
    } else if (booking.status === 'canceled') {
      canEdit = false;
      lockReason = 'This booking is canceled. Form editing is disabled.';
    } else if (decryptionIssue && response?.status === 'draft') {
      canEdit = false;
      lockReason = 'Re-authentication is required to access your encrypted draft.';
    } else if (duplicateWindowBlocked) {
      canEdit = false;
      lockReason = 'You already submitted this form within the last 24 hours.';
    }

    return {
      booking,
      serviceName,
      template,
      response,
      answers,
      visibleFieldIds,
      canEdit,
      lockReason,
      decryptionIssue
    };
  }

  async getFormResponseForBooking(actorId: string, bookingId: string): Promise<FormForBookingResult> {
    const actor = await this.requireActiveUser(actorId);
    if (actor.role === 'moderator') {
      throw new HealthFormServiceError('FORBIDDEN', 'You are not allowed to view health form responses.');
    }

    const [booking, services] = await Promise.all([
      this.bookingRepository.getBookingById(bookingId),
      this.bookingRepository.getServices()
    ]);

    if (!booking) {
      throw new HealthFormServiceError('BOOKING_NOT_FOUND', 'Booking could not be found.');
    }

    if (actor.role === 'client' && booking.userId !== actor.id) {
      throw new HealthFormServiceError('FORBIDDEN', 'You can only access your own booking forms.');
    }

    if (actor.role === 'photographer' && booking.photographerId !== actor.id) {
      throw new HealthFormServiceError('FORBIDDEN', 'You can only access forms for your assigned bookings.');
    }

    const serviceName = services.find((service) => service.id === booking.serviceId)?.name ?? 'Session';
    const rawResponse = await this.formsRepository.getResponseByBookingAndUser(bookingId, booking.userId);
    const response =
      actor.role === 'client' || rawResponse?.status === 'submitted'
        ? rawResponse
        : null;
    const template = await this.resolveTemplateForResponse(response);

    let answers: Record<string, unknown> = {};
    let decryptionIssue: string | null = null;

    if (response) {
      try {
        answers = await this.decryptAnswers(booking.userId, response.encryptedAnswers);
        answers = await this.resolveAttachmentAnswers(booking.userId, template, answers);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unable to decrypt saved answers.';
        decryptionIssue = message;
      }
    }

    const visibleFieldIds = template ? this.evaluateVisibleFields(template, answers).map((field) => field.id) : [];
    const lockReason = response ? 'Read-only response view.' : 'No submitted response is available for this booking.';

    return {
      booking,
      serviceName,
      template,
      response,
      answers,
      visibleFieldIds,
      canEdit: false,
      lockReason,
      decryptionIssue
    };
  }

  async saveDraft(userId: string, bookingId: string, answers: Record<string, unknown>): Promise<FormResponse> {
    await this.requireActiveRole(userId, 'client');
    const booking = await this.requireOwnedBooking(userId, bookingId);

    if (booking.status === 'canceled') {
      throw new HealthFormServiceError(
        'BOOKING_CANCELED',
        'Cannot edit form draft for a canceled booking.'
      );
    }

    const existingResponse = await this.formsRepository.getResponseByBookingAndUser(bookingId, userId);
    const template = await this.resolveTemplateForResponse(existingResponse);

    if (!template) {
      throw new HealthFormServiceError('NO_ACTIVE_TEMPLATE', 'No active form template is available.');
    }

    if (
      existingResponse?.status === 'submitted' &&
      typeof existingResponse.submittedAt === 'number' &&
      nowMs() - existingResponse.submittedAt < DUPLICATE_SUBMISSION_WINDOW_MS
    ) {
      throw new HealthFormServiceError(
        'DUPLICATE_SUBMISSION',
        'You cannot submit another form for this booking within 24 hours.'
      );
    }

    const encryptedAnswers = await this.encryptAnswers(userId, this.normalizeAnswerPayload(answers, template));
    const now = nowMs();
    const response: FormResponse = {
      id: existingResponse?.id ?? createResponseId(bookingId, userId),
      templateId: template.id,
      templateVersion: template.version,
      bookingId,
      userId,
      encryptedAnswers,
      status: 'draft',
      submittedAt: null,
      createdAt: existingResponse?.createdAt ?? now,
      updatedAt: now,
      templateSnapshot: toTemplateSnapshot(template)
    };

    await this.formsRepository.saveResponse(response);
    return response;
  }

  async submitForm(userId: string, bookingId: string, answers: Record<string, unknown>): Promise<FormResponse> {
    await this.requireActiveRole(userId, 'client');
    const booking = await this.requireOwnedBooking(userId, bookingId);

    if (booking.status === 'canceled') {
      throw new HealthFormServiceError(
        'BOOKING_CANCELED',
        'Cannot submit a health form for a canceled booking.'
      );
    }

    await this.checkDuplicateSubmissionWindow(userId, bookingId);

    const existingResponse = await this.formsRepository.getResponseByBookingAndUser(bookingId, userId);
    const template = await this.resolveTemplateForResponse(existingResponse);
    if (!template) {
      throw new HealthFormServiceError('NO_ACTIVE_TEMPLATE', 'No active form template is available.');
    }

    const normalizedAnswers = this.normalizeAnswerPayload(answers, template);
    const visibleFields = this.evaluateVisibleFields(template, normalizedAnswers);
    const validationErrors = this.validateAnswers(template, visibleFields, normalizedAnswers);
    if (validationErrors.length > 0) {
      throw new HealthFormServiceError(
        'VALIDATION_FAILED',
        'Please complete required fields before submitting.',
        validationErrors
      );
    }

    const encryptedAnswers = await this.encryptAnswers(userId, normalizedAnswers);
    const now = nowMs();
    const response: FormResponse = {
      id: existingResponse?.id ?? createResponseId(bookingId, userId),
      templateId: template.id,
      templateVersion: template.version,
      bookingId,
      userId,
      encryptedAnswers,
      status: 'submitted',
      submittedAt: now,
      createdAt: existingResponse?.createdAt ?? now,
      updatedAt: now,
      templateSnapshot: toTemplateSnapshot(template)
    };

    await this.formsRepository.saveResponse(response);
    await this.notifyFormSubmitted(response, booking);
    return response;
  }

  async getUserFormResponses(userId: string): Promise<FormResponse[]> {
    await this.requireActiveRole(userId, 'client');
    return this.formsRepository.getResponsesByUser(userId);
  }

  evaluateVisibleFields(template: FormTemplate, answers: Record<string, unknown>): FormField[] {
    const fieldIds = new Set(template.fields.map((field) => field.id));

    return template.fields.filter((field) => {
      if (!field.condition) {
        return true;
      }

      if (!fieldIds.has(field.condition.fieldId)) {
        return false;
      }

      const referenceValue = answers[field.condition.fieldId];
      return evaluateConditionValue(field.condition.operator, referenceValue, field.condition.value);
    });
  }

  validateAnswers(
    _template: FormTemplate,
    visibleFields: FormField[],
    answers: Record<string, unknown>
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const field of visibleFields) {
      const value = answers[field.id];

      if (field.type === 'checkbox' && value !== undefined && typeof value !== 'boolean') {
        errors.push({
          fieldId: field.id,
          message: `${field.label} must be a checkbox value.`
        });
      }

      if ((field.type === 'select' || field.type === 'radio') && isNonEmptyValue(value)) {
        const options = field.options ?? [];
        if (typeof value !== 'string' || !options.includes(value)) {
          errors.push({
            fieldId: field.id,
            message: `${field.label} must be one of the available options.`
          });
        }
      }

      if (field.type === 'file' && isNonEmptyValue(value) && !isAttachmentValue(value)) {
        errors.push({
          fieldId: field.id,
          message: `${field.label} must be a valid attachment.`
        });
        continue;
      }

      if (!field.required) {
        continue;
      }

      if (field.type === 'checkbox') {
        if (value !== true) {
          errors.push({
            fieldId: field.id,
            message: `${field.label} must be checked.`
          });
        }
        continue;
      }

      if (!isNonEmptyValue(value)) {
        errors.push({
          fieldId: field.id,
          message: `${field.label} is required.`
        });
        continue;
      }

      if (field.type === 'file' && !isAttachmentValue(value)) {
        errors.push({
          fieldId: field.id,
          message: `${field.label} is required.`
        });
      }
    }

    return errors;
  }

  async encryptAnswers(userId: string, plainAnswers: Record<string, unknown>): Promise<string> {
    const key = await this.requireEncryptionKey(userId);
    const payload = JSON.stringify(plainAnswers);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv
      },
      key,
      encoder.encode(payload)
    );

    return JSON.stringify({
      v: 1,
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(encrypted))
    });
  }

  async decryptAnswers(userId: string, encryptedAnswers: string): Promise<Record<string, unknown>> {
    const payload = await this.decryptPayloadText(userId, encryptedAnswers);
    let value: unknown;
    try {
      value = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      throw new HealthFormServiceError('DECRYPTION_FAILED', 'Stored form data is corrupted.');
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private async decryptPayloadText(userId: string, encryptedPayload: string): Promise<string> {
    const key = await this.requireEncryptionKey(userId);
    let parsed: { v?: unknown; iv?: unknown; ciphertext?: unknown };

    try {
      parsed = JSON.parse(encryptedPayload) as { v?: unknown; iv?: unknown; ciphertext?: unknown };
    } catch {
      throw new HealthFormServiceError('DECRYPTION_FAILED', 'Stored form data is corrupted.');
    }

    if (typeof parsed.iv !== 'string' || typeof parsed.ciphertext !== 'string') {
      throw new HealthFormServiceError('DECRYPTION_FAILED', 'Stored form data is corrupted.');
    }

    try {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toArrayBuffer(fromBase64(parsed.iv))
        },
        key,
        toArrayBuffer(fromBase64(parsed.ciphertext))
      );

      return decoder.decode(decrypted);
    } catch {
      throw new HealthFormServiceError(
        'DECRYPTION_FAILED',
        'Unable to decrypt form data. Please sign in again to unlock secure data.'
      );
    }
  }

  async checkDuplicateSubmissionWindow(userId: string, bookingId: string): Promise<void> {
    const response = await this.formsRepository.getResponseByBookingAndUser(bookingId, userId);
    if (!response || response.status !== 'submitted' || typeof response.submittedAt !== 'number') {
      return;
    }

    const now = nowMs();
    if (now - response.submittedAt < DUPLICATE_SUBMISSION_WINDOW_MS) {
      throw new HealthFormServiceError(
        'DUPLICATE_SUBMISSION',
        'You cannot submit another form for this booking within 24 hours.'
      );
    }
  }

  private normalizeTemplateInput(input: FormTemplateInput): {
    name: string;
    description?: string;
    isActive: boolean;
    fields: FormField[];
  } {
    const name = truncate(sanitizeSingleLine(input.name ?? ''), MAX_TEMPLATE_NAME_LENGTH);
    if (!name) {
      throw new HealthFormServiceError('INVALID_TEMPLATE', 'Template name is required.');
    }

    const description = input.description
      ? truncate(sanitizeText(input.description), MAX_TEMPLATE_DESCRIPTION_LENGTH)
      : undefined;

    if (!Array.isArray(input.fields) || input.fields.length === 0) {
      throw new HealthFormServiceError('INVALID_TEMPLATE', 'At least one field is required.');
    }

    const fields: FormField[] = input.fields.map((fieldInput, index) => {
      const id = sanitizeSingleLine(fieldInput.id ?? '') || createId(`form-field-${index + 1}`);
      const type = fieldInput.type;
      if (
        type !== 'text' &&
        type !== 'textarea' &&
        type !== 'checkbox' &&
        type !== 'select' &&
        type !== 'radio' &&
        type !== 'file'
      ) {
        throw new HealthFormServiceError('INVALID_TEMPLATE', `Unsupported field type at row ${index + 1}.`);
      }

      const label = truncate(sanitizeSingleLine(fieldInput.label ?? ''), MAX_FIELD_LABEL_LENGTH);
      if (!label) {
        throw new HealthFormServiceError('INVALID_TEMPLATE', `Field label is required at row ${index + 1}.`);
      }

      const placeholder = fieldInput.placeholder
        ? truncate(sanitizeSingleLine(fieldInput.placeholder), MAX_FIELD_PLACEHOLDER_LENGTH)
        : undefined;
      const helpText = fieldInput.helpText
        ? truncate(sanitizeText(fieldInput.helpText), MAX_FIELD_HELP_TEXT_LENGTH)
        : undefined;

      let options: string[] | undefined;
      if (type === 'select' || type === 'radio') {
        const normalizedOptions = (fieldInput.options ?? [])
          .map((option) => sanitizeSingleLine(option))
          .filter((option) => option.length > 0);

        const uniqueOptions = [...new Set(normalizedOptions)];
        if (uniqueOptions.length === 0) {
          throw new HealthFormServiceError(
            'INVALID_TEMPLATE',
            `${label} (${getFieldTypeLabel(type)}) must include at least one option.`
          );
        }

        options = uniqueOptions;
      }

      const condition = fieldInput.condition
        ? {
            fieldId: sanitizeSingleLine(fieldInput.condition.fieldId),
            operator: fieldInput.condition.operator,
            value: fieldInput.condition.value
          }
        : undefined;

      return {
        id,
        type,
        label,
        placeholder,
        required: fieldInput.required === true,
        options,
        helpText,
        sensitive: fieldInput.sensitive === true,
        condition
      };
    });

    const fieldIds = new Set<string>();
    for (const field of fields) {
      if (fieldIds.has(field.id)) {
        throw new HealthFormServiceError('INVALID_TEMPLATE', 'Field IDs must be unique.');
      }

      fieldIds.add(field.id);
    }

    this.validateFieldConditions(fields, fieldIds);

    return {
      name,
      description,
      isActive: input.isActive !== false,
      fields
    };
  }

  private validateFieldConditions(fields: FormField[], fieldIds: Set<string>): void {
    const dependencyByFieldId = new Map<string, string>();

    for (const field of fields) {
      if (!field.condition) {
        continue;
      }

      if (!fieldIds.has(field.condition.fieldId)) {
        throw new HealthFormServiceError(
          'INVALID_CONDITION',
          `Condition reference "${field.condition.fieldId}" for "${field.label}" is invalid.`
        );
      }

      if (field.condition.fieldId === field.id) {
        throw new HealthFormServiceError(
          'INVALID_CONDITION',
          `Field "${field.label}" cannot reference itself in a condition.`
        );
      }

      dependencyByFieldId.set(field.id, field.condition.fieldId);
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (fieldId: string): boolean => {
      if (visiting.has(fieldId)) {
        return true;
      }

      if (visited.has(fieldId)) {
        return false;
      }

      visiting.add(fieldId);
      const dependency = dependencyByFieldId.get(fieldId);
      if (dependency && visit(dependency)) {
        return true;
      }

      visiting.delete(fieldId);
      visited.add(fieldId);
      return false;
    };

    for (const field of fields) {
      if (visit(field.id)) {
        throw new HealthFormServiceError(
          'INVALID_CONDITION',
          'Circular field visibility conditions are not supported.'
        );
      }
    }
  }

  private normalizeAnswerPayload(answers: Record<string, unknown>, template: FormTemplate): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    const fieldMap = new Map(template.fields.map((field) => [field.id, field]));

    for (const [fieldId, rawValue] of Object.entries(answers)) {
      const field = fieldMap.get(fieldId);
      if (!field) {
        continue;
      }

      if (field.type === 'file') {
        if (!isAttachmentValue(rawValue)) {
          continue;
        }

        if (rawValue.data.length > MAX_ATTACHMENT_BASE64_LENGTH) {
          throw new HealthFormServiceError(
            'INVALID_ANSWER',
            `${field.label} attachment is too large to store offline.`
          );
        }

        const normalizedName = truncate(sanitizeSingleLine(rawValue.name), MAX_ATTACHMENT_NAME_LENGTH);
        const normalizedMime = truncate(sanitizeSingleLine(rawValue.mimeType), MAX_ATTACHMENT_MIME_LENGTH);

        normalized[fieldId] = {
          name: normalizedName || 'attachment.bin',
          mimeType: normalizedMime || 'application/octet-stream',
          data: rawValue.data,
          ...(typeof rawValue.size === 'number' && Number.isFinite(rawValue.size)
            ? { size: rawValue.size }
            : {})
        };
        continue;
      }

      if (typeof rawValue === 'string') {
        normalized[fieldId] = truncate(sanitizeText(rawValue), MAX_TEXT_VALUE_LENGTH);
        continue;
      }

      if (Array.isArray(rawValue)) {
        normalized[fieldId] = rawValue.map((value) => (typeof value === 'string' ? sanitizeText(value) : value));
        continue;
      }

      normalized[fieldId] = rawValue;
    }

    return normalized;
  }

  private async notifyFormSubmitted(response: FormResponse, booking: Booking): Promise<void> {
    await this.notificationService.createNotification(
      response.userId,
      'forms.submitted.client',
      'Health form submitted successfully.',
      {
        bookingId: response.bookingId,
        responseId: response.id,
        actorId: response.userId
      },
      `forms-submitted-client-${response.id}-${response.submittedAt ?? response.updatedAt}`
    );

    const users = await this.authRepository.getAllUsers();
    const activeAdmins = users.filter((user) => user.role === 'admin' && user.isActive && user.id !== response.userId);

    await Promise.all(
      activeAdmins.map(async (admin) => {
        await this.notificationService.createNotification(
          admin.id,
          'forms.submitted.admin',
          'A client submitted a health form.',
          {
            bookingId: response.bookingId,
            responseId: response.id,
            clientId: response.userId,
            actorId: response.userId
          },
          `forms-submitted-admin-${response.id}-${admin.id}-${response.submittedAt ?? response.updatedAt}`
        );
      })
    );

    if (booking.photographerId && booking.photographerId !== response.userId) {
      await this.notificationService.createNotification(
        booking.photographerId,
        'forms.submitted.photographer',
        'A client health form was submitted for an assigned booking.',
        {
          bookingId: response.bookingId,
          responseId: response.id,
          clientId: response.userId,
          actorId: response.userId
        },
        `forms-submitted-photographer-${response.id}-${booking.photographerId}-${response.submittedAt ?? response.updatedAt}`
      );
    }
  }

  private async resolveTemplateForResponse(response: FormResponse | null): Promise<FormTemplate | null> {
    if (response?.templateSnapshot) {
      return asRenderTemplate(response.templateSnapshot);
    }

    if (response) {
      const template = await this.formsRepository.getTemplateById(response.templateId);
      if (template) {
        return template;
      }
    }

    const activeTemplates = await this.formsRepository.getActiveTemplates();
    return activeTemplates[0] ?? null;
  }

  private async requireOwnedBooking(userId: string, bookingId: string): Promise<Booking> {
    const booking = await this.bookingRepository.getBookingById(bookingId);
    if (!booking) {
      throw new HealthFormServiceError('BOOKING_NOT_FOUND', 'Booking could not be found.');
    }

    if (booking.userId !== userId) {
      throw new HealthFormServiceError('FORBIDDEN', 'You can only access your own booking forms.');
    }

    return booking;
  }

  private async requireActiveRole(userId: string, role: UserRole): Promise<void> {
    const user = await this.requireActiveUser(userId);

    if (user.role !== role) {
      throw new HealthFormServiceError('FORBIDDEN', 'You are not allowed to perform this action.');
    }
  }

  private async requireActiveUser(userId: string) {
    const user = await this.authRepository.findUserById(userId);
    if (!user || !user.isActive) {
      throw new HealthFormServiceError('USER_NOT_FOUND', 'User account is unavailable.');
    }

    return user;
  }

  private async resolveAttachmentAnswers(
    userId: string,
    template: FormTemplate | null,
    answers: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (!template) {
      return answers;
    }

    const nextAnswers: Record<string, unknown> = { ...answers };
    const fileFields = template.fields.filter((field) => field.type === 'file');
    for (const field of fileFields) {
      const value = answers[field.id];
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }

      const candidate = value as Partial<{ name: unknown; mimeType: unknown; data: unknown; size: unknown }>;
      if (typeof candidate.name !== 'string' || typeof candidate.mimeType !== 'string') {
        continue;
      }

      const extracted = extractAttachmentDataPayload(candidate.data);
      let data = extracted.base64Data ?? '';
      let name = candidate.name.trim() || 'attachment.bin';
      let mimeType = candidate.mimeType.trim() || 'application/octet-stream';
      let size: number | undefined =
        typeof candidate.size === 'number' && Number.isFinite(candidate.size) ? candidate.size : undefined;

      if (extracted.encryptedPayload) {
        try {
          const decryptedPayload = await this.decryptPayloadText(userId, extracted.encryptedPayload);
          data = this.normalizeDecryptedAttachmentData(decryptedPayload);
        } catch {
          name = 'File unavailable';
          mimeType = 'text/plain';
          data = btoa('File unavailable');
          size = undefined;
        }
      }

      nextAnswers[field.id] = {
        name,
        mimeType,
        data,
        ...(typeof size === 'number' ? { size } : {})
      };
    }

    return nextAnswers;
  }

  private normalizeDecryptedAttachmentData(payload: string): string {
    let normalized = payload;

    try {
      const parsed = JSON.parse(payload) as unknown;
      if (typeof parsed === 'string') {
        normalized = parsed;
      } else if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof (parsed as { data?: unknown }).data === 'string'
      ) {
        normalized = (parsed as { data: string }).data;
      }
    } catch {
      // Keep raw decrypted payload.
    }

    const base64Payload = normalizeAttachmentBase64Payload(normalized);
    if (!base64Payload) {
      throw new HealthFormServiceError('DECRYPTION_FAILED', 'Stored form data is corrupted.');
    }

    try {
      atob(base64Payload);
      return base64Payload;
    } catch {
      throw new HealthFormServiceError('DECRYPTION_FAILED', 'Stored form data is corrupted.');
    }
  }

  private async requireEncryptionKey(userId: string): Promise<CryptoKey> {
    const session = await this.authService.getCurrentSession();
    if (!session) {
      throw new HealthFormServiceError(
        'ENCRYPTION_KEY_UNAVAILABLE',
        'Please sign in again to unlock encrypted form data.'
      );
    }

    if (session.user.id !== userId) {
      throw new HealthFormServiceError(
        'FORBIDDEN',
        'Encrypted form data can only be decrypted by the original user session.'
      );
    }

    const activeKey = this.authService.getActiveEncryptionKey();
    if (activeKey) {
      return activeKey;
    }

    throw new HealthFormServiceError(
      'ENCRYPTION_KEY_UNAVAILABLE',
      'Please sign in again to unlock encrypted form data.'
    );
  }
}

export function createHealthFormService(
  formsRepository: HealthFormRepository,
  authRepository: AuthRepository,
  bookingRepository: BookingRepository,
  notificationService: NotificationService,
  authService: AuthService
): HealthFormService {
  return new LocalHealthFormService(
    formsRepository,
    authRepository,
    bookingRepository,
    notificationService,
    authService
  );
}
