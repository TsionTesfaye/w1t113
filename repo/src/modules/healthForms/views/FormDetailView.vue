<script setup lang="ts">
import type { FormField } from '@/app/types/domain';
import { useAuthStore } from '@/app/stores/useAuthStore';
import { useHealthFormsStore } from '@/modules/healthForms/stores/useHealthFormsStore';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const WIZARD_STEP_STORAGE_PREFIX = 'studioops.forms.wizard.step.';

const route = useRoute();
const authStore = useAuthStore();
const formsStore = useHealthFormsStore();
const showSubmitConfirm = ref(false);
const revealedSensitiveFieldIds = ref<Record<string, boolean>>({});
const currentStepIndex = ref(0);
const stepValidationError = ref('');
const attachmentActionError = ref('');

interface AttachmentAnswer {
  name: string;
  mimeType: string;
  data: string;
  size?: number;
  blob?: Blob;
}

const bookingId = computed(() => String(route.params.bookingId ?? ''));
const actorRole = computed(() => authStore.currentUser?.role ?? null);
const currentForm = computed(() => formsStore.currentForm);
const visibleFields = computed(() => formsStore.visibleFields);
const backRoute = computed(() => {
  if (actorRole.value === 'admin' || actorRole.value === 'photographer') {
    return '/forms/responses';
  }

  return '/forms';
});

const validationErrorsByFieldId = computed(() => {
  const map = new Map<string, string>();
  for (const error of formsStore.validationErrors) {
    if (!map.has(error.fieldId)) {
      map.set(error.fieldId, error.message);
    }
  }

  return map;
});

const isSubmitted = computed(() => currentForm.value?.response?.status === 'submitted');
const isReadOnlyViewer = computed(() => actorRole.value === 'admin' || actorRole.value === 'photographer');
const canEdit = computed(() => !isReadOnlyViewer.value && formsStore.canEditCurrentForm && !isSubmitted.value);
const hasDecryptionIssue = computed(() => Boolean(currentForm.value?.decryptionIssue));
const decryptionNoticeMessage = computed(() => {
  if (!hasDecryptionIssue.value) {
    return '';
  }

  return 'This response is encrypted. It can only be viewed during the original user session.';
});

const totalSteps = computed(() => visibleFields.value.length);
const currentStepField = computed<FormField | null>(() => {
  if (visibleFields.value.length === 0) {
    return null;
  }

  const safeIndex = Math.min(currentStepIndex.value, visibleFields.value.length - 1);
  return visibleFields.value[safeIndex] ?? null;
});
const currentStepNumber = computed(() => {
  if (totalSteps.value === 0) {
    return 0;
  }

  return Math.min(currentStepIndex.value + 1, totalSteps.value);
});
const isFirstStep = computed(() => currentStepIndex.value <= 0);
const isLastStep = computed(() => {
  if (totalSteps.value === 0) {
    return true;
  }

  return currentStepIndex.value >= totalSteps.value - 1;
});

function formatDateTimeRange(startTime: number, endTime: number): string {
  const start = new Date(startTime);
  const end = new Date(endTime);

  const date = start.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const startClock = start.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });
  const endClock = end.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });

  return `${date} · ${startClock} - ${endClock}`;
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function textValue(fieldId: string): string {
  const value = formsStore.answers[fieldId];
  return typeof value === 'string' ? value : '';
}

function selectedValue(fieldId: string): string {
  const value = formsStore.answers[fieldId];
  return typeof value === 'string' ? value : '';
}

function isChecked(fieldId: string): boolean {
  return formsStore.answers[fieldId] === true;
}

function updateField(fieldId: string, value: unknown): void {
  formsStore.updateAnswer(fieldId, value);
  stepValidationError.value = '';
}

function fieldError(fieldId: string): string {
  const serviceError = validationErrorsByFieldId.value.get(fieldId);
  if (serviceError) {
    return serviceError;
  }

  if (currentStepField.value?.id === fieldId) {
    return stepValidationError.value;
  }

  return '';
}

function hasOptions(field: FormField): boolean {
  return Array.isArray(field.options) && field.options.length > 0;
}

function formatReadOnlyValue(field: FormField): string {
  const value = formsStore.answers[field.id];

  if (field.type === 'checkbox') {
    return value === true ? 'Yes' : 'No';
  }

  if (typeof value === 'string') {
    if (field.sensitive && !isSensitiveVisible(field.id)) {
      return 'Hidden';
    }

    return value.trim().length > 0 ? value : 'No answer';
  }

  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => (typeof item === 'string' ? item.trim() : String(item)))
      .filter((item) => item.length > 0);
    return normalized.length > 0 ? normalized.join(', ') : 'No answer';
  }

  if (value === true) {
    return 'Yes';
  }

  if (value === false) {
    return 'No';
  }

  if (value === undefined || value === null) {
    return 'No answer';
  }

  return String(value);
}

function isSensitiveVisible(fieldId: string): boolean {
  return revealedSensitiveFieldIds.value[fieldId] === true;
}

function toggleSensitiveVisibility(fieldId: string): void {
  revealedSensitiveFieldIds.value = {
    ...revealedSensitiveFieldIds.value,
    [fieldId]: !isSensitiveVisible(fieldId)
  };
}

function isFieldAnswered(field: FormField): boolean {
  const value = formsStore.answers[field.id];

  if (field.type === 'file') {
    return (
      Boolean(value) &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as Partial<AttachmentAnswer>).name === 'string' &&
      typeof (value as Partial<AttachmentAnswer>).data === 'string'
    );
  }

  if (field.type === 'checkbox') {
    return value === true;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== undefined && value !== null;
}

function isAttachmentAnswer(value: unknown): value is AttachmentAnswer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<AttachmentAnswer>;
  const rawData = candidate.data;
  const nestedData =
    rawData && typeof rawData === 'object' && !Array.isArray(rawData)
      ? (rawData as { data?: unknown }).data
      : null;
  const data =
    typeof rawData === 'string'
      ? rawData
      : typeof nestedData === 'string'
        ? nestedData
        : '';

  return (
    typeof candidate.name === 'string' &&
    candidate.name.trim().length > 0 &&
    typeof candidate.mimeType === 'string' &&
    data.length > 0
  );
}

function attachmentValue(fieldId: string): AttachmentAnswer | null {
  const value = formsStore.answers[fieldId];
  if (!isAttachmentAnswer(value)) {
    return null;
  }

  const candidate = value as Partial<AttachmentAnswer>;
  const rawData = candidate.data;
  const nestedData =
    rawData && typeof rawData === 'object' && !Array.isArray(rawData)
      ? (rawData as { data?: unknown }).data
      : null;
  const data =
    typeof rawData === 'string'
      ? rawData
      : typeof nestedData === 'string'
        ? nestedData
        : '';

  return {
    name: candidate.name as string,
    mimeType: candidate.mimeType as string,
    data,
    ...(typeof candidate.size === 'number' && Number.isFinite(candidate.size)
      ? { size: candidate.size }
      : {})
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function extractBase64Payload(value: string): string | null {
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

function base64ToBytes(value: string): Uint8Array | null {
  const payload = extractBase64Payload(value)?.replace(/\s+/g, '');
  if (!payload) {
    return null;
  }

  let binary = '';
  try {
    binary = atob(payload);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function displayAttachmentName(fieldId: string, attachment: AttachmentAnswer): string {
  if (isSensitiveVisible(fieldId)) {
    return attachment.name;
  }

  return 'File uploaded';
}

function attachmentLabel(fieldId: string): string {
  const attachment = attachmentValue(fieldId);
  if (!attachment) {
    return '';
  }

  return displayAttachmentName(fieldId, attachment);
}

async function onAttachmentSelected(fieldId: string, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    updateField(fieldId, null);
    return;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], {
    type: file.type || 'application/octet-stream'
  });
  updateField(fieldId, {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    data: bytesToBase64(bytes),
    size: file.size,
    blob
  } satisfies AttachmentAnswer);
}

function clearAttachment(fieldId: string): void {
  updateField(fieldId, null);
}

function downloadAttachment(fieldId: string): void {
  attachmentActionError.value = '';
  const attachment = attachmentValue(fieldId);
  if (!attachment) {
    return;
  }

  const bytes = base64ToBytes(attachment.data);
  if (!bytes) {
    attachmentActionError.value = 'Attachment cannot be downloaded because stored data is invalid.';
    return;
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob =
    attachment.blob ??
    new Blob([buffer], {
      type: attachment.mimeType || 'application/octet-stream'
    });

  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = attachment.name;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function viewAttachment(fieldId: string): void {
  attachmentActionError.value = '';
  const attachment = attachmentValue(fieldId);
  if (!attachment) {
    return;
  }

  const bytes = base64ToBytes(attachment.data);
  if (!bytes) {
    attachmentActionError.value = 'Attachment cannot be previewed because stored data is invalid.';
    return;
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob =
    attachment.blob ??
    new Blob([buffer], {
    type: attachment.mimeType || 'application/octet-stream'
  });

  const url = window.URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
  }, 60_000);
}

function validateCurrentStep(): boolean {
  stepValidationError.value = '';

  if (!canEdit.value) {
    return true;
  }

  const field = currentStepField.value;
  if (!field || !field.required) {
    return true;
  }

  if (isFieldAnswered(field)) {
    return true;
  }

  stepValidationError.value = `${field.label} is required.`;
  return false;
}

function storageKeyForBooking(id: string): string {
  return `${WIZARD_STEP_STORAGE_PREFIX}${id}`;
}

function persistCurrentStep(): void {
  if (!bookingId.value) {
    return;
  }

  window.localStorage.setItem(storageKeyForBooking(bookingId.value), String(currentStepIndex.value));
}

function restoreCurrentStep(): void {
  if (!bookingId.value) {
    currentStepIndex.value = 0;
    return;
  }

  const saved = window.localStorage.getItem(storageKeyForBooking(bookingId.value));
  const parsed = saved ? Number.parseInt(saved, 10) : 0;
  if (!Number.isFinite(parsed) || parsed < 0) {
    currentStepIndex.value = 0;
    return;
  }

  currentStepIndex.value = parsed;
}

function clearStepProgress(): void {
  if (!bookingId.value) {
    return;
  }

  window.localStorage.removeItem(storageKeyForBooking(bookingId.value));
}

async function loadForm(): Promise<void> {
  if (!bookingId.value) {
    return;
  }

  attachmentActionError.value = '';
  revealedSensitiveFieldIds.value = {};
  stepValidationError.value = '';
  if (isReadOnlyViewer.value) {
    await formsStore.loadResponseForBooking(bookingId.value);
  } else {
    await formsStore.loadFormForBooking(bookingId.value);
  }
  restoreCurrentStep();

}

async function saveDraft(): Promise<void> {
  if (!canEdit.value) {
    return;
  }

  try {
    await formsStore.saveDraft();
    persistCurrentStep();
  } catch {
    // Store already exposes the user-facing error.
  }
}

function requestSubmit(): void {
  if (!canEdit.value) {
    return;
  }

  if (!validateCurrentStep()) {
    return;
  }

  showSubmitConfirm.value = true;
}

async function confirmSubmit(): Promise<void> {
  try {
    await formsStore.submitForm();
    showSubmitConfirm.value = false;
    currentStepIndex.value = 0;
    clearStepProgress();
  } catch {
    if (formsStore.validationErrors.length > 0) {
      const firstFieldError = formsStore.validationErrors[0];
      if (firstFieldError) {
        const index = visibleFields.value.findIndex((field) => field.id === firstFieldError.fieldId);
        if (index >= 0) {
          currentStepIndex.value = index;
        }
      }
    }
  }
}

function goToNextStep(): void {
  if (!validateCurrentStep()) {
    return;
  }

  if (isLastStep.value) {
    requestSubmit();
    return;
  }

  currentStepIndex.value += 1;
  persistCurrentStep();
}

function goToPreviousStep(): void {
  if (isFirstStep.value) {
    return;
  }

  stepValidationError.value = '';
  currentStepIndex.value -= 1;
  persistCurrentStep();
}

onMounted(async () => {
  await loadForm();
});

watch(bookingId, async () => {
  showSubmitConfirm.value = false;
  currentStepIndex.value = 0;
  await loadForm();
});

watch(isReadOnlyViewer, async () => {
  showSubmitConfirm.value = false;
  currentStepIndex.value = 0;
  await loadForm();
});

watch(
  () => visibleFields.value.length,
  () => {
    if (visibleFields.value.length === 0) {
      currentStepIndex.value = 0;
      return;
    }

    if (currentStepIndex.value > visibleFields.value.length - 1) {
      currentStepIndex.value = visibleFields.value.length - 1;
    }

    persistCurrentStep();
  }
);
</script>

<template>
  <section class="page-stack forms-page">
    <div class="page-header">
      <div>
        <h2>{{ isReadOnlyViewer ? 'Health Form Response' : 'Health Declaration' }}</h2>
        <p v-if="currentForm" class="muted">
          {{ currentForm.serviceName }} ·
          {{ formatDateTimeRange(currentForm.booking.startTime, currentForm.booking.endTime) }}
        </p>
      </div>
      <RouterLink :to="backRoute" class="btn btn--outline">Back</RouterLink>
    </div>

    <p v-if="formsStore.errorMessage" class="form-error">
      {{ formsStore.errorMessage }}
    </p>
    <p v-if="attachmentActionError" class="form-error">
      {{ attachmentActionError }}
    </p>
    <p v-if="formsStore.successMessage" class="admin-success">
      {{ formsStore.successMessage }}
    </p>

    <div v-if="formsStore.isLoadingForm" class="slot-empty-state">
      <p class="slot-empty-state__title">Loading form</p>
      <p class="slot-empty-state__subtitle">
        {{ isReadOnlyViewer ? 'Decrypting and preparing the response.' : 'Decrypting and preparing your declaration.' }}
      </p>
    </div>

    <div v-else-if="!currentForm" class="slot-empty-state">
      <p class="slot-empty-state__title">Form unavailable</p>
      <p class="slot-empty-state__subtitle">The selected booking form could not be loaded.</p>
    </div>

    <div v-else-if="!currentForm.template" class="slot-empty-state">
      <p class="slot-empty-state__title">No active form template</p>
      <p class="slot-empty-state__subtitle">
        The studio has not activated a health declaration template yet.
      </p>
    </div>

    <div v-else class="forms-detail">
      <div class="forms-detail__meta">
        <span class="pill">Booking status: {{ currentForm.booking.status }}</span>
        <span
          v-if="isSubmitted"
          class="pill pill--success"
        >
          Submitted
        </span>
        <span v-else-if="currentForm.response?.status === 'draft'" class="pill pill--warning">
          Draft saved
        </span>
        <span v-if="currentForm.response?.submittedAt" class="pill pill--role-client">
          Submitted {{ formatDateTime(currentForm.response.submittedAt) }}
        </span>
        <span v-if="isReadOnlyViewer" class="pill">Read-only</span>
      </div>

      <div v-if="decryptionNoticeMessage" class="forms-lock-banner">
        {{ decryptionNoticeMessage }}
      </div>

      <div v-if="currentForm.lockReason && !hasDecryptionIssue" class="forms-lock-banner">
        {{ currentForm.lockReason }}
      </div>

      <div v-if="totalSteps === 0" class="slot-empty-state slot-empty-state--compact">
        <p class="slot-empty-state__title">No visible form fields</p>
        <p class="slot-empty-state__subtitle">This form has no applicable questions for the current answers.</p>
      </div>

      <template v-else-if="!canEdit">
        <div class="forms-field-list">
          <article v-for="field in visibleFields" :key="field.id" class="forms-field">
            <label class="field__label">
              {{ field.label }}
              <span v-if="field.required">*</span>
              <span v-if="field.sensitive" class="forms-sensitive-tag">Sensitive</span>
              <button
                v-if="field.sensitive"
                type="button"
                class="btn btn--ghost forms-sensitive-toggle"
                @click="toggleSensitiveVisibility(field.id)"
              >
                {{ isSensitiveVisible(field.id) ? 'Hide' : 'Show' }}
              </button>
            </label>
            <p v-if="field.helpText" class="muted forms-field__help">{{ field.helpText }}</p>

            <template v-if="field.type === 'file'">
              <div v-if="attachmentValue(field.id)" class="forms-file-field__meta">
                <span class="muted">{{ attachmentLabel(field.id) }}</span>
                <div class="forms-file-field__actions">
                  <button type="button" class="btn btn--ghost" @click="viewAttachment(field.id)">View</button>
                  <button type="button" class="btn btn--ghost" @click="downloadAttachment(field.id)">
                    Download
                  </button>
                </div>
              </div>
              <div v-else-if="hasDecryptionIssue" class="forms-file-field__meta">
                <span class="muted">Encrypted file (unlock required)</span>
                <div class="forms-file-field__actions">
                  <button type="button" class="btn btn--ghost" disabled>View</button>
                  <button type="button" class="btn btn--ghost" disabled>Download</button>
                </div>
              </div>
              <p v-else class="muted">No file uploaded</p>
            </template>
            <p v-else class="forms-readonly-value">{{ formatReadOnlyValue(field) }}</p>
          </article>
        </div>
      </template>

      <template v-else>
        <div class="forms-wizard__header">
          <p class="forms-wizard__progress">Step {{ currentStepNumber }} of {{ totalSteps }}</p>
          <div class="forms-wizard__dots" role="presentation">
            <span
              v-for="index in totalSteps"
              :key="`wizard-step-${index}`"
              class="forms-wizard__dot"
              :class="{
                'is-complete': index - 1 < currentStepIndex,
                'is-active': index - 1 === currentStepIndex
              }"
            />
          </div>
        </div>

        <form class="forms-field-list" @submit.prevent="requestSubmit">
          <article v-if="currentStepField" :key="currentStepField.id" class="forms-field">
            <label class="field__label" :for="`field-${currentStepField.id}`">
              {{ currentStepField.label }}
              <span v-if="currentStepField.required">*</span>
              <span v-if="currentStepField.sensitive" class="forms-sensitive-tag">Sensitive</span>
              <button
                v-if="currentStepField.sensitive"
                type="button"
                class="btn btn--ghost forms-sensitive-toggle"
                :disabled="formsStore.isSaving"
                @click="toggleSensitiveVisibility(currentStepField.id)"
              >
                {{ isSensitiveVisible(currentStepField.id) ? 'Hide' : 'Show' }}
              </button>
            </label>
            <p v-if="currentStepField.helpText" class="muted forms-field__help">{{ currentStepField.helpText }}</p>

            <template v-if="currentStepField.type === 'text'">
              <input
                :id="`field-${currentStepField.id}`"
                class="input"
                :type="currentStepField.sensitive && !isSensitiveVisible(currentStepField.id) ? 'password' : 'text'"
                :placeholder="currentStepField.placeholder ?? ''"
                :value="textValue(currentStepField.id)"
                :disabled="!canEdit || formsStore.isSaving"
                @input="updateField(currentStepField.id, ($event.target as HTMLInputElement).value)"
              />
            </template>

            <template v-else-if="currentStepField.type === 'textarea'">
              <textarea
                :id="`field-${currentStepField.id}`"
                class="input forms-field__textarea"
                :class="{ 'forms-input--masked': currentStepField.sensitive && !isSensitiveVisible(currentStepField.id) }"
                rows="3"
                :placeholder="currentStepField.placeholder ?? ''"
                :value="textValue(currentStepField.id)"
                :disabled="!canEdit || formsStore.isSaving"
                @input="updateField(currentStepField.id, ($event.target as HTMLTextAreaElement).value)"
              />
            </template>

            <template v-else-if="currentStepField.type === 'checkbox'">
              <label class="checkbox forms-checkbox">
                <input
                  :id="`field-${currentStepField.id}`"
                  type="checkbox"
                  :checked="isChecked(currentStepField.id)"
                  :disabled="!canEdit || formsStore.isSaving"
                  @change="updateField(currentStepField.id, ($event.target as HTMLInputElement).checked)"
                />
                <span>{{ currentStepField.placeholder || 'Yes' }}</span>
              </label>
            </template>

            <template v-else-if="currentStepField.type === 'select' && hasOptions(currentStepField)">
              <select
                :id="`field-${currentStepField.id}`"
                class="input"
                :value="selectedValue(currentStepField.id)"
                :disabled="!canEdit || formsStore.isSaving"
                @change="updateField(currentStepField.id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">Select an option</option>
                <option v-for="option in currentStepField.options" :key="`${currentStepField.id}-${option}`" :value="option">
                  {{ option }}
                </option>
              </select>
            </template>

            <template v-else-if="currentStepField.type === 'radio' && hasOptions(currentStepField)">
              <div class="forms-radio-group">
                <label
                  v-for="option in currentStepField.options"
                  :key="`${currentStepField.id}-${option}`"
                  class="checkbox forms-radio-item"
                >
                  <input
                    :name="`field-${currentStepField.id}`"
                    type="radio"
                    :value="option"
                    :checked="selectedValue(currentStepField.id) === option"
                    :disabled="!canEdit || formsStore.isSaving"
                    @change="updateField(currentStepField.id, option)"
                  />
                  <span>{{ option }}</span>
                </label>
              </div>
            </template>

            <template v-else-if="currentStepField.type === 'file'">
              <div class="forms-file-field">
                <input
                  :id="`field-${currentStepField.id}`"
                  type="file"
                  class="input"
                  :disabled="!canEdit || formsStore.isSaving"
                  @change="onAttachmentSelected(currentStepField.id, $event)"
                />
                <div v-if="attachmentValue(currentStepField.id)" class="forms-file-field__meta">
                  <span class="muted">
                    {{ attachmentLabel(currentStepField.id) }}
                  </span>
                  <div class="forms-file-field__actions">
                    <button
                      type="button"
                      class="btn btn--ghost forms-sensitive-toggle"
                      :disabled="formsStore.isSaving"
                      @click="toggleSensitiveVisibility(currentStepField.id)"
                    >
                      {{ isSensitiveVisible(currentStepField.id) ? 'Hide' : 'Reveal' }}
                    </button>
                    <button
                      type="button"
                      class="btn btn--ghost"
                      :disabled="formsStore.isSaving"
                      @click="viewAttachment(currentStepField.id)"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      class="btn btn--ghost"
                      :disabled="formsStore.isSaving"
                      @click="downloadAttachment(currentStepField.id)"
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      class="btn btn--ghost"
                      :disabled="!canEdit || formsStore.isSaving"
                      @click="clearAttachment(currentStepField.id)"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            </template>

            <p v-if="fieldError(currentStepField.id)" class="field__error">
              {{ fieldError(currentStepField.id) }}
            </p>
          </article>

          <div class="forms-actions forms-actions--wizard">
            <button
              type="button"
              class="btn btn--outline"
              :disabled="isFirstStep || formsStore.isSaving"
              @click="goToPreviousStep"
            >
              Back
            </button>

            <div class="forms-actions__right">
              <button
                type="button"
                class="btn btn--outline"
                :disabled="!canEdit || formsStore.isSaving"
                @click="saveDraft"
              >
                Save draft
              </button>
              <button
                v-if="!isLastStep"
                type="button"
                class="btn btn--primary"
                :disabled="!canEdit || formsStore.isSaving || totalSteps === 0"
                @click="goToNextStep"
              >
                Next
              </button>
              <button
                v-else
                type="submit"
                class="btn btn--primary"
                :disabled="!canEdit || formsStore.isSaving || totalSteps === 0"
              >
                Submit form
              </button>
            </div>
          </div>
        </form>
      </template>
    </div>
  </section>

  <div v-if="showSubmitConfirm && !isReadOnlyViewer" class="booking-drawer-overlay" @click="showSubmitConfirm = false" />
  <div v-if="showSubmitConfirm && !isReadOnlyViewer" class="forms-confirm-modal">
    <h3>Submit health form?</h3>
    <p>After submitting, re-submission for this booking is blocked for 24 hours.</p>
    <div class="forms-confirm-modal__actions">
      <button type="button" class="btn btn--outline" @click="showSubmitConfirm = false">Cancel</button>
      <button type="button" class="btn btn--primary" :disabled="formsStore.isSaving" @click="confirmSubmit">
        Confirm submit
      </button>
    </div>
  </div>
</template>
