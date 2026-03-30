// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import FormDetailView from '@/modules/healthForms/views/FormDetailView.vue';
import { describe, expect, it, vi } from 'vitest';

const DUPLICATE_ERROR_MESSAGE = 'You cannot submit another form for this booking within 24 hours.';

const mockAuthStore = reactive({
  currentUser: {
    id: 'client-1',
    role: 'client'
  }
});

const mockFormsStore = reactive({
  templates: [],
  bookingForms: [],
  currentForm: {
    booking: {
      id: 'booking-1',
      userId: 'client-1',
      photographerId: 'photographer-1',
      serviceId: 'service-1',
      slotId: 'slot-1',
      startTime: Date.now() + 60 * 60 * 1000,
      endTime: Date.now() + 90 * 60 * 1000,
      dayKey: '2026-03-31',
      status: 'confirmed',
      createdAt: Date.now()
    },
    serviceName: 'Headshots',
    template: {
      id: 'template-1',
      name: 'Health Declaration',
      isActive: true,
      version: 1,
      fields: [
        {
          id: 'symptoms',
          type: 'text',
          label: 'Symptoms',
          required: true
        }
      ],
      createdBy: 'admin-1',
      createdAt: Date.now(),
      updatedAt: Date.now()
    },
    response: null,
    answers: {
      symptoms: 'none'
    },
    visibleFieldIds: ['symptoms'],
    canEdit: true,
    lockReason: null,
    decryptionIssue: null
  },
  answers: {
    symptoms: 'none'
  } as Record<string, unknown>,
  activeBookingId: 'booking-1',
  isLoadingTemplates: false,
  isLoadingBookings: false,
  isLoadingForm: false,
  isSaving: false,
  errorMessage: '',
  successMessage: '',
  validationErrors: [] as Array<{ fieldId: string; message: string }>,
  visibleFields: [
    {
      id: 'symptoms',
      type: 'text',
      label: 'Symptoms',
      required: true
    }
  ],
  canEditCurrentForm: true,
  clearFeedback: vi.fn(),
  fetchAdminTemplates: vi.fn(async () => undefined),
  createTemplate: vi.fn(async () => null),
  updateTemplate: vi.fn(async () => null),
  fetchClientBookingForms: vi.fn(async () => undefined),
  fetchAccessibleBookingForms: vi.fn(async () => undefined),
  loadFormForBooking: vi.fn(async () => undefined),
  loadResponseForBooking: vi.fn(async () => undefined),
  updateAnswer: vi.fn((fieldId: string, value: unknown) => {
    mockFormsStore.answers[fieldId] = value;
  }),
  saveDraft: vi.fn(async () => null),
  submitForm: vi.fn(async () => {
    mockFormsStore.errorMessage = DUPLICATE_ERROR_MESSAGE;
    throw new Error(DUPLICATE_ERROR_MESSAGE);
  })
});

vi.mock('@/app/stores/useAuthStore', () => ({
  useAuthStore: () => mockAuthStore
}));

vi.mock('@/modules/healthForms/stores/useHealthFormsStore', () => ({
  useHealthFormsStore: () => mockFormsStore
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: {
      bookingId: 'booking-1'
    }
  }),
  RouterLink: {
    template: '<a><slot /></a>'
  }
}));

describe('FormDetailView wizard interactions', () => {
  it('opens submit confirmation modal and surfaces duplicate-submit feedback', async () => {
    const wrapper = mount(FormDetailView, {
      global: {
        stubs: {
          RouterLink: true
        }
      }
    });

    await flushPromises();

    const submitButton = wrapper
      .findAll('button')
      .find((button) => button.text().trim() === 'Submit form');
    expect(submitButton).toBeDefined();

    await submitButton?.trigger('submit');
    await submitButton?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Submit health form?');

    const confirmButton = wrapper
      .findAll('button')
      .find((button) => button.text().trim() === 'Confirm submit');
    expect(confirmButton).toBeDefined();

    await confirmButton?.trigger('click');
    await flushPromises();

    expect(mockFormsStore.submitForm).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain(DUPLICATE_ERROR_MESSAGE);
  });
});
