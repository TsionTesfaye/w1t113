import { getHealthFormService } from '@/app/providers/healthFormsProvider';
import { useAuthStore } from '@/app/stores/useAuthStore';
import type { FormResponse, FormTemplate } from '@/app/types/domain';
import type {
  FormBookingSummary,
  FormForBookingResult,
  FormTemplateInput,
  ValidationError
} from '@/services/HealthFormService';
import { HealthFormServiceError } from '@/services/HealthFormService';
import { defineStore } from 'pinia';

interface HealthFormsState {
  templates: FormTemplate[];
  bookingForms: FormBookingSummary[];
  currentForm: FormForBookingResult | null;
  answers: Record<string, unknown>;
  activeBookingId: string | null;
  isLoadingTemplates: boolean;
  isLoadingBookings: boolean;
  isLoadingForm: boolean;
  isSaving: boolean;
  errorMessage: string;
  successMessage: string;
  validationErrors: ValidationError[];
}

export const useHealthFormsStore = defineStore('healthForms', {
  state: (): HealthFormsState => ({
    templates: [],
    bookingForms: [],
    currentForm: null,
    answers: {},
    activeBookingId: null,
    isLoadingTemplates: false,
    isLoadingBookings: false,
    isLoadingForm: false,
    isSaving: false,
    errorMessage: '',
    successMessage: '',
    validationErrors: []
  }),

  getters: {
    currentTemplate(state): FormTemplate | null {
      return state.currentForm?.template ?? null;
    },

    visibleFields(state) {
      const template = state.currentForm?.template;
      const visibleIds = new Set(state.currentForm?.visibleFieldIds ?? []);
      if (!template) {
        return [];
      }

      return template.fields.filter((field) => visibleIds.has(field.id));
    },

    canEditCurrentForm(state): boolean {
      return Boolean(state.currentForm?.canEdit);
    }
  },

  actions: {
    clearFeedback(): void {
      this.errorMessage = '';
      this.successMessage = '';
      this.validationErrors = [];
    },

    async fetchAdminTemplates(): Promise<void> {
      const userId = useAuthStore().currentUser?.id;
      if (!userId) {
        return;
      }

      this.isLoadingTemplates = true;
      this.clearFeedback();

      try {
        this.templates = await getHealthFormService().getTemplates(userId);
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to load templates.';
      } finally {
        this.isLoadingTemplates = false;
      }
    },

    async createTemplate(templateInput: FormTemplateInput): Promise<FormTemplate | null> {
      const userId = useAuthStore().currentUser?.id;
      if (!userId) {
        throw new Error('Authentication is required.');
      }

      this.isSaving = true;
      this.clearFeedback();

      try {
        const template = await getHealthFormService().createTemplate(userId, templateInput);
        this.successMessage = 'Template created.';
        await this.fetchAdminTemplates();
        return template;
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to create template.';
        throw error;
      } finally {
        this.isSaving = false;
      }
    },

    async updateTemplate(templateId: string, templateInput: FormTemplateInput): Promise<FormTemplate | null> {
      const userId = useAuthStore().currentUser?.id;
      if (!userId) {
        throw new Error('Authentication is required.');
      }

      this.isSaving = true;
      this.clearFeedback();

      try {
        const template = await getHealthFormService().updateTemplate(userId, templateId, templateInput);
        this.successMessage = 'Template updated.';
        await this.fetchAdminTemplates();
        return template;
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to update template.';
        throw error;
      } finally {
        this.isSaving = false;
      }
    },

    async fetchClientBookingForms(): Promise<void> {
      await this.fetchAccessibleBookingForms();
    },

    async fetchAccessibleBookingForms(): Promise<void> {
      const userId = useAuthStore().currentUser?.id;
      if (!userId) {
        this.bookingForms = [];
        return;
      }

      this.isLoadingBookings = true;
      this.clearFeedback();

      try {
        this.bookingForms = await getHealthFormService().getAccessibleBookingForms(userId);
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to load booking forms.';
      } finally {
        this.isLoadingBookings = false;
      }
    },

    async loadFormForBooking(bookingId: string): Promise<void> {
      const userId = useAuthStore().currentUser?.id;
      if (!userId) {
        this.currentForm = null;
        this.answers = {};
        this.activeBookingId = null;
        return;
      }

      this.isLoadingForm = true;
      this.clearFeedback();

      try {
        const form = await getHealthFormService().getFormForBooking(userId, bookingId);
        this.currentForm = form;
        this.answers = { ...form.answers };
        this.activeBookingId = bookingId;
      } catch (error: unknown) {
        this.currentForm = null;
        this.answers = {};
        this.activeBookingId = bookingId;
        this.errorMessage = error instanceof Error ? error.message : 'Unable to load this form.';
      } finally {
        this.isLoadingForm = false;
      }
    },

    async loadResponseForBooking(bookingId: string): Promise<void> {
      const userId = useAuthStore().currentUser?.id;
      if (!userId) {
        this.currentForm = null;
        this.answers = {};
        this.activeBookingId = null;
        return;
      }

      this.isLoadingForm = true;
      this.clearFeedback();

      try {
        const form = await getHealthFormService().getFormResponseForBooking(userId, bookingId);
        this.currentForm = form;
        this.answers = { ...form.answers };
        this.activeBookingId = bookingId;
      } catch (error: unknown) {
        this.currentForm = null;
        this.answers = {};
        this.activeBookingId = bookingId;
        this.errorMessage = error instanceof Error ? error.message : 'Unable to load this form response.';
      } finally {
        this.isLoadingForm = false;
      }
    },

    updateAnswer(fieldId: string, value: unknown): void {
      if (!this.currentForm?.template) {
        return;
      }

      this.answers = {
        ...this.answers,
        [fieldId]: value
      };

      const visibleFields = getHealthFormService().evaluateVisibleFields(
        this.currentForm.template,
        this.answers
      );

      this.currentForm = {
        ...this.currentForm,
        visibleFieldIds: visibleFields.map((field) => field.id)
      };
    },

    async saveDraft(): Promise<FormResponse | null> {
      const userId = useAuthStore().currentUser?.id;
      const bookingId = this.currentForm?.booking.id ?? this.activeBookingId;
      if (!userId || !bookingId) {
        throw new Error('Booking context is missing.');
      }

      this.isSaving = true;
      this.clearFeedback();

      try {
        const response = await getHealthFormService().saveDraft(userId, bookingId, this.answers);
        this.successMessage = 'Draft saved.';
        await Promise.all([this.loadFormForBooking(bookingId), this.fetchClientBookingForms()]);
        return response;
      } catch (error: unknown) {
        if (error instanceof HealthFormServiceError) {
          this.validationErrors = error.validationErrors;
        }

        this.errorMessage = error instanceof Error ? error.message : 'Unable to save draft.';
        throw error;
      } finally {
        this.isSaving = false;
      }
    },

    async submitForm(): Promise<FormResponse | null> {
      const userId = useAuthStore().currentUser?.id;
      const bookingId = this.currentForm?.booking.id ?? this.activeBookingId;
      if (!userId || !bookingId) {
        throw new Error('Booking context is missing.');
      }

      this.isSaving = true;
      this.clearFeedback();

      try {
        const response = await getHealthFormService().submitForm(userId, bookingId, this.answers);
        this.successMessage = 'Form submitted successfully.';
        await Promise.all([this.loadFormForBooking(bookingId), this.fetchClientBookingForms()]);
        return response;
      } catch (error: unknown) {
        if (error instanceof HealthFormServiceError) {
          this.validationErrors = error.validationErrors;
        }

        this.errorMessage = error instanceof Error ? error.message : 'Unable to submit form.';
        throw error;
      } finally {
        this.isSaving = false;
      }
    }
  }
});
