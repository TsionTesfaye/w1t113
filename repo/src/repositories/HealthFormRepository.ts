import type { FormField, FormFieldCondition, FormResponse, FormTemplate } from '@/app/types/domain';
import { indexedDbClient } from '@/db/indexedDbClient';

export interface HealthFormRepository {
  createTemplate(template: FormTemplate): Promise<void>;
  updateTemplate(template: FormTemplate): Promise<void>;
  getTemplates(): Promise<FormTemplate[]>;
  getActiveTemplates(): Promise<FormTemplate[]>;
  getTemplateById(templateId: string): Promise<FormTemplate | null>;
  saveResponse(response: FormResponse): Promise<void>;
  getResponseByBookingAndUser(bookingId: string, userId: string): Promise<FormResponse | null>;
  getResponsesByUser(userId: string): Promise<FormResponse[]>;
  getResponsesByBooking(bookingId: string): Promise<FormResponse[]>;
  getAllResponses(): Promise<FormResponse[]>;
  deleteResponse(responseId: string): Promise<void>;
}

function normalizeFormFieldCondition(
  condition: FormFieldCondition | Record<string, unknown> | undefined
): FormFieldCondition | undefined {
  if (!condition || typeof condition !== 'object') {
    return undefined;
  }

  const fieldId = typeof condition.fieldId === 'string' ? condition.fieldId : '';
  const operator = condition.operator;

  if (!fieldId) {
    return undefined;
  }

  if (operator !== 'equals' && operator !== 'notEquals' && operator !== 'includes') {
    return undefined;
  }

  return {
    fieldId,
    operator,
    value: condition.value
  };
}

function normalizeFormField(field: FormField | Record<string, unknown>): FormField | null {
  if (!field || typeof field !== 'object' || typeof field.id !== 'string' || typeof field.label !== 'string') {
    return null;
  }

  const type = field.type;
  if (
    type !== 'text' &&
    type !== 'textarea' &&
    type !== 'checkbox' &&
    type !== 'select' &&
    type !== 'radio' &&
    type !== 'file'
  ) {
    return null;
  }

  const normalized: FormField = {
    id: field.id,
    type,
    label: field.label,
    required: field.required === true
  };

  if (typeof field.placeholder === 'string') {
    normalized.placeholder = field.placeholder;
  }

  if (typeof field.helpText === 'string') {
    normalized.helpText = field.helpText;
  }

  if (field.sensitive === true) {
    normalized.sensitive = true;
  }

  if (Array.isArray(field.options)) {
    normalized.options = field.options.filter((option): option is string => typeof option === 'string');
  }

  const condition = normalizeFormFieldCondition(
    field.condition as FormFieldCondition | Record<string, unknown> | undefined
  );
  if (condition) {
    normalized.condition = condition;
  }

  return normalized;
}

function normalizeTemplate(
  template: FormTemplate | Record<string, unknown> | undefined
): FormTemplate | null {
  if (
    !template ||
    typeof template !== 'object' ||
    typeof template.id !== 'string' ||
    typeof template.name !== 'string' ||
    typeof template.createdBy !== 'string'
  ) {
    return null;
  }

  if (!Array.isArray(template.fields)) {
    return null;
  }

  const fields = template.fields
    .map((field) => normalizeFormField(field as FormField | Record<string, unknown>))
    .filter(Boolean) as FormField[];

  return {
    id: template.id,
    name: template.name,
    description: typeof template.description === 'string' ? template.description : undefined,
    isActive: template.isActive !== false,
    version: typeof template.version === 'number' && Number.isFinite(template.version) ? template.version : 1,
    fields,
    createdBy: template.createdBy,
    createdAt:
      typeof template.createdAt === 'number' && Number.isFinite(template.createdAt)
        ? template.createdAt
        : Date.now(),
    updatedAt:
      typeof template.updatedAt === 'number' && Number.isFinite(template.updatedAt)
        ? template.updatedAt
        : Date.now()
  };
}

function normalizeResponse(
  response: FormResponse | Record<string, unknown> | undefined
): FormResponse | null {
  if (
    !response ||
    typeof response !== 'object' ||
    typeof response.id !== 'string' ||
    typeof response.templateId !== 'string' ||
    typeof response.bookingId !== 'string' ||
    typeof response.userId !== 'string' ||
    typeof response.encryptedAnswers !== 'string'
  ) {
    return null;
  }

  const templateSnapshot = normalizeTemplate(
    response.templateSnapshot as FormTemplate | Record<string, unknown> | undefined
  );

  return {
    id: response.id,
    templateId: response.templateId,
    templateVersion:
      typeof response.templateVersion === 'number' && Number.isFinite(response.templateVersion)
        ? response.templateVersion
        : 1,
    bookingId: response.bookingId,
    userId: response.userId,
    encryptedAnswers: response.encryptedAnswers,
    status: response.status === 'submitted' ? 'submitted' : 'draft',
    submittedAt:
      typeof response.submittedAt === 'number' && Number.isFinite(response.submittedAt)
        ? response.submittedAt
        : null,
    createdAt:
      typeof response.createdAt === 'number' && Number.isFinite(response.createdAt)
        ? response.createdAt
        : Date.now(),
    updatedAt:
      typeof response.updatedAt === 'number' && Number.isFinite(response.updatedAt)
        ? response.updatedAt
        : Date.now(),
    templateSnapshot: templateSnapshot
      ? {
          id: templateSnapshot.id,
          name: templateSnapshot.name,
          description: templateSnapshot.description,
          version: templateSnapshot.version,
          fields: templateSnapshot.fields
        }
      : undefined
  };
}

function sortTemplates(templates: FormTemplate[]): FormTemplate[] {
  return [...templates].sort((left, right) => right.updatedAt - left.updatedAt);
}

function sortResponses(responses: FormResponse[]): FormResponse[] {
  return [...responses].sort((left, right) => right.updatedAt - left.updatedAt);
}

class IndexedDbHealthFormRepository implements HealthFormRepository {
  async createTemplate(template: FormTemplate): Promise<void> {
    await indexedDbClient.withTransaction(['formTemplates'], 'readwrite', async (transaction) => {
      await transaction.put('formTemplates', template);
    });
  }

  async updateTemplate(template: FormTemplate): Promise<void> {
    await indexedDbClient.withTransaction(['formTemplates'], 'readwrite', async (transaction) => {
      await transaction.put('formTemplates', template);
    });
  }

  async getTemplates(): Promise<FormTemplate[]> {
    return indexedDbClient.withTransaction(['formTemplates'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<FormTemplate | Record<string, unknown>>('formTemplates');
      const templates = records
        .map((record) => normalizeTemplate(record))
        .filter(Boolean) as FormTemplate[];
      return sortTemplates(templates);
    });
  }

  async getActiveTemplates(): Promise<FormTemplate[]> {
    return indexedDbClient.withTransaction(['formTemplates'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<FormTemplate | Record<string, unknown>>('formTemplates');
      const templates = records
        .map((record) => normalizeTemplate(record))
        .filter((template): template is FormTemplate => Boolean(template && template.isActive));
      return sortTemplates(templates);
    });
  }

  async getTemplateById(templateId: string): Promise<FormTemplate | null> {
    return indexedDbClient.withTransaction(['formTemplates'], 'readonly', async (transaction) => {
      const record = await transaction.get<FormTemplate | Record<string, unknown>>('formTemplates', templateId);
      return normalizeTemplate(record);
    });
  }

  async saveResponse(response: FormResponse): Promise<void> {
    await indexedDbClient.withTransaction(['formResponses'], 'readwrite', async (transaction) => {
      await transaction.put('formResponses', response);
    });
  }

  async getResponseByBookingAndUser(bookingId: string, userId: string): Promise<FormResponse | null> {
    return indexedDbClient.withTransaction(['formResponses'], 'readonly', async (transaction) => {
      const record = await transaction.getByIndex<FormResponse | Record<string, unknown>>(
        'formResponses',
        'bookingUser',
        [bookingId, userId]
      );
      return normalizeResponse(record);
    });
  }

  async getResponsesByUser(userId: string): Promise<FormResponse[]> {
    return indexedDbClient.withTransaction(['formResponses'], 'readonly', async (transaction) => {
      const records = await transaction.getAllByIndex<FormResponse | Record<string, unknown>>(
        'formResponses',
        'userId',
        userId
      );
      const responses = records
        .map((record) => normalizeResponse(record))
        .filter(Boolean) as FormResponse[];
      return sortResponses(responses);
    });
  }

  async getResponsesByBooking(bookingId: string): Promise<FormResponse[]> {
    return indexedDbClient.withTransaction(['formResponses'], 'readonly', async (transaction) => {
      const records = await transaction.getAllByIndex<FormResponse | Record<string, unknown>>(
        'formResponses',
        'bookingId',
        bookingId
      );
      const responses = records
        .map((record) => normalizeResponse(record))
        .filter(Boolean) as FormResponse[];
      return sortResponses(responses);
    });
  }

  async getAllResponses(): Promise<FormResponse[]> {
    return indexedDbClient.withTransaction(['formResponses'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<FormResponse | Record<string, unknown>>('formResponses');
      const responses = records
        .map((record) => normalizeResponse(record))
        .filter(Boolean) as FormResponse[];
      return sortResponses(responses);
    });
  }

  async deleteResponse(responseId: string): Promise<void> {
    await indexedDbClient.withTransaction(['formResponses'], 'readwrite', async (transaction) => {
      await transaction.delete('formResponses', responseId);
    });
  }
}

export function createHealthFormRepository(): HealthFormRepository {
  return new IndexedDbHealthFormRepository();
}
