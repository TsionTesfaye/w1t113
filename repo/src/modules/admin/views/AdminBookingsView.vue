<script setup lang="ts">
import type { BookingStatus } from '@/app/types/domain';
import AppCard from '@/components/AppCard.vue';
import AppModal from '@/components/AppModal.vue';
import { useAdminBookingStore } from '@/modules/admin/stores/useAdminBookingStore';
import { useHealthFormsStore } from '@/modules/healthForms/stores/useHealthFormsStore';
import { useSearchStore } from '@/modules/search/stores/useSearchStore';
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

interface BookingFilters {
  date: string;
  status: '' | BookingStatus;
  photographerId: string;
}

interface CreateBookingFormState {
  clientId: string;
  photographerId: string;
  serviceId: string;
  date: string;
  slotId: string;
}

interface ServiceFormState {
  name: string;
  durationMinutes: number;
  price: number;
}

const adminBookingStore = useAdminBookingStore();
const formsStore = useHealthFormsStore();
const searchStore = useSearchStore();
const {
  results: searchResults,
  isLoading: isSearchLoading,
  errorMessage: searchErrorMessage
} = storeToRefs(searchStore);
const bookingSearchQuery = ref('');
let bookingSearchDebounceId: number | null = null;

const filters = reactive<BookingFilters>({
  date: '',
  status: '',
  photographerId: ''
});
const createForm = reactive<CreateBookingFormState>({
  clientId: '',
  photographerId: '',
  serviceId: '',
  date: adminBookingStore.createDate,
  slotId: ''
});

const statusOptions: BookingStatus[] = [
  'pending',
  'confirmed',
  'arrived',
  'started',
  'photographer_unavailable',
  'missed',
  'auto_completed',
  'completed',
  'canceled',
  'rescheduled'
];
const pendingCancelBookingId = ref<string | null>(null);
const pendingArchiveServiceId = ref<string | null>(null);
const createModalOpen = ref(false);
const serviceModalOpen = ref(false);
const serviceEditingId = ref<string | null>(null);
const serviceForm = reactive<ServiceFormState>({
  name: '',
  durationMinutes: 30,
  price: 0
});

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(value);
}

function getTodayDateKey(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatSlotLabel(startTime: number, endTime: number): string {
  return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

function toDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function statusClass(status: BookingStatus): string {
  if (status === 'completed' || status === 'auto_completed') {
    return 'pill pill--success';
  }

  if (status === 'canceled' || status === 'missed' || status === 'photographer_unavailable') {
    return 'pill pill--warning';
  }

  if (status === 'arrived' || status === 'started') {
    return 'pill pill--role-photographer';
  }

  return 'pill pill--role-client';
}

function formatStatus(status: BookingStatus): string {
  if (status === 'missed') {
    return 'Missed session';
  }

  if (status === 'auto_completed') {
    return 'Auto-completed';
  }

  if (status === 'photographer_unavailable') {
    return 'Photographer unavailable';
  }

  return status;
}

function formStatusLabel(status: string): string {
  if (status === 'submitted') {
    return 'Submitted';
  }

  if (status === 'draft') {
    return 'Draft';
  }

  if (status === 'unavailable') {
    return 'Unavailable';
  }

  return 'Not started';
}

const photographerOptions = computed(() => {
  const seen = new Map<string, string>();
  for (const booking of adminBookingStore.bookings) {
    if (!seen.has(booking.photographerId)) {
      seen.set(booking.photographerId, booking.photographerName);
    }
  }

  return [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
});

const hasBookingSearchQuery = computed(() => bookingSearchQuery.value.trim().length > 0);
const matchedBookingIds = computed(() => new Set(searchResults.value.map((result) => result.entityId)));
const searchResultByBookingId = computed(
  () => new Map(searchResults.value.map((result) => [result.entityId, result]))
);
const createSlotOptions = computed(() => adminBookingStore.createSlots);
const activeServiceOptions = computed(() => adminBookingStore.services.filter((service) => service.isActive));
const formSummaryByBookingId = computed(
  () => new Map(formsStore.bookingForms.map((item) => [item.bookingId, item]))
);

const filteredBookings = computed(() => {
  return adminBookingStore.bookings.filter((booking) => {
    if (hasBookingSearchQuery.value && !matchedBookingIds.value.has(booking.id)) {
      return false;
    }

    if (filters.date && toDateKey(booking.startTime) !== filters.date) {
      return false;
    }

    if (filters.status && booking.status !== filters.status) {
      return false;
    }

    if (filters.photographerId && booking.photographerId !== filters.photographerId) {
      return false;
    }

    return true;
  });
});

function canCancel(status: BookingStatus): boolean {
  return status !== 'completed' && status !== 'canceled';
}

function requestCancelBooking(bookingId: string): void {
  pendingCancelBookingId.value = bookingId;
}

function closeCancelModal(): void {
  pendingCancelBookingId.value = null;
}

function requestArchiveService(serviceId: string): void {
  pendingArchiveServiceId.value = serviceId;
}

function closeArchiveServiceModal(): void {
  pendingArchiveServiceId.value = null;
}

async function confirmCancelBooking(): Promise<void> {
  if (!pendingCancelBookingId.value) {
    return;
  }

  try {
    await adminBookingStore.cancelBooking(pendingCancelBookingId.value);
    closeCancelModal();
  } catch {
    // Store already handles error state.
  }
}

async function onStatusChange(bookingId: string, event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement;
  const nextStatus = select.value as BookingStatus;
  await adminBookingStore.updateBookingStatus(bookingId, nextStatus);
}

async function submitCreateBooking(): Promise<void> {
  if (!createForm.clientId || !createForm.photographerId || !createForm.serviceId || !createForm.slotId) {
    adminBookingStore.error = 'Client, photographer, service, and slot are required.';
    return;
  }

  await adminBookingStore.createBooking({
    clientId: createForm.clientId,
    photographerId: createForm.photographerId,
    serviceId: createForm.serviceId,
    slotId: createForm.slotId
  });
  closeCreateModal();
}

function resetServiceForm(): void {
  serviceEditingId.value = null;
  serviceForm.name = '';
  serviceForm.durationMinutes = 30;
  serviceForm.price = 0;
}

function openCreateServiceModal(): void {
  resetServiceForm();
  serviceModalOpen.value = true;
}

function openEditServiceModal(service: {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
}): void {
  serviceEditingId.value = service.id;
  serviceForm.name = service.name;
  serviceForm.durationMinutes = service.durationMinutes;
  serviceForm.price = service.price;
  serviceModalOpen.value = true;
}

function closeServiceModal(): void {
  serviceModalOpen.value = false;
  resetServiceForm();
}

async function submitServiceForm(): Promise<void> {
  const payload = {
    name: serviceForm.name,
    durationMinutes: serviceForm.durationMinutes,
    price: serviceForm.price
  };

  if (serviceEditingId.value) {
    await adminBookingStore.updateServiceItem(serviceEditingId.value, payload);
  } else {
    await adminBookingStore.createServiceItem(payload);
  }

  closeServiceModal();
}

async function confirmArchiveService(): Promise<void> {
  if (!pendingArchiveServiceId.value) {
    return;
  }

  await adminBookingStore.archiveServiceItem(pendingArchiveServiceId.value);
  closeArchiveServiceModal();
}

function openCreateModal(): void {
  createModalOpen.value = true;
}

function closeCreateModal(): void {
  createModalOpen.value = false;
  createForm.clientId = '';
  createForm.photographerId = '';
  createForm.serviceId = '';
  createForm.date = getTodayDateKey();
  createForm.slotId = '';
  adminBookingStore.createSlots = [];
}

onMounted(() => {
  searchStore.clear();
  void adminBookingStore.fetchAllBookings();
  void formsStore.fetchAccessibleBookingForms();
});

watch(bookingSearchQuery, (query) => {
  if (bookingSearchDebounceId !== null) {
    window.clearTimeout(bookingSearchDebounceId);
  }

  bookingSearchDebounceId = window.setTimeout(() => {
    void searchStore.search({ query, type: 'booking' });
  }, 300);
});

onBeforeUnmount(() => {
  if (bookingSearchDebounceId !== null) {
    window.clearTimeout(bookingSearchDebounceId);
    bookingSearchDebounceId = null;
  }
});

watch(
  [() => createForm.serviceId, () => createForm.photographerId, () => createForm.date],
  ([serviceId, photographerId, date]) => {
    createForm.slotId = '';
    void adminBookingStore.fetchCreateSlots({
      serviceId,
      photographerId,
      date
    });
  },
  { immediate: true }
);
</script>

<template>
  <section class="page-stack">
    <div class="page-header">
      <div>
        <h2>Admin Bookings</h2>
      </div>
      <button type="button" class="btn btn--primary" @click="openCreateModal">Create Booking</button>
    </div>

    <AppCard title="Service Catalog">
      <div class="page-header page-header--inline">
        <p class="muted">Configure active services for booking.</p>
        <button type="button" class="btn btn--outline" @click="openCreateServiceModal">
          New service
        </button>
      </div>

      <div v-if="adminBookingStore.services.length === 0" class="empty-state">
        <p class="muted">No services configured yet.</p>
      </div>

      <div v-else class="list-table admin-bookings-table">
        <div class="admin-bookings-row admin-bookings-row--head">
          <span>Name</span>
          <span>Duration</span>
          <span>Price</span>
          <span>Status</span>
          <span>Updated</span>
          <span>Actions</span>
        </div>
        <div
          v-for="service in adminBookingStore.services"
          :key="service.id"
          class="admin-bookings-row"
          :class="{ 'is-disabled-row': !service.isActive }"
        >
          <span>{{ service.name }}</span>
          <span>{{ service.durationMinutes }} min</span>
          <span>{{ formatCurrency(service.price) }}</span>
          <span>
            <span class="pill" :class="service.isActive ? 'pill--success' : 'pill--warning'">
              {{ service.isActive ? 'Active' : 'Archived' }}
            </span>
          </span>
          <span>{{ formatDateTime(service.updatedAt) }}</span>
          <span class="admin-bookings-actions">
            <button
              type="button"
              class="btn btn--ghost"
              :disabled="adminBookingStore.loading"
              @click="openEditServiceModal(service)"
            >
              Edit
            </button>
            <button
              type="button"
              class="btn btn--outline"
              :disabled="adminBookingStore.loading || !service.isActive"
              @click="requestArchiveService(service.id)"
            >
              Archive
            </button>
          </span>
        </div>
      </div>
    </AppCard>

    <AppCard title="Filters">
      <div class="content-grid content-grid--2">
        <label class="field">
          <span class="field__label">Search</span>
          <div class="context-search-row">
            <input
              v-model="bookingSearchQuery"
              type="search"
              class="input"
              placeholder="Search bookings..."
            />
            <button
              v-if="hasBookingSearchQuery"
              type="button"
              class="btn btn--ghost"
              @click="bookingSearchQuery = ''"
            >
              Clear
            </button>
            <button
              type="button"
              class="btn btn--outline"
              :disabled="isSearchLoading"
              @click="searchStore.rebuildIndex()"
            >
              Rebuild index
            </button>
          </div>
        </label>
        <label class="field">
          <span class="field__label">Date</span>
          <input v-model="filters.date" type="date" class="input" />
        </label>
        <label class="field">
          <span class="field__label">Status</span>
          <select v-model="filters.status" class="input">
            <option value="">All statuses</option>
            <option v-for="status in statusOptions" :key="status" :value="status">
              {{ formatStatus(status) }}
            </option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Photographer</span>
          <select v-model="filters.photographerId" class="input">
            <option value="">All photographers</option>
            <option v-for="option in photographerOptions" :key="option.id" :value="option.id">
              {{ option.name }}
            </option>
          </select>
        </label>
      </div>
    </AppCard>

    <AppCard title="Bookings">
      <p v-if="adminBookingStore.error" class="form-error">{{ adminBookingStore.error }}</p>
      <p v-else-if="searchErrorMessage" class="form-error">{{ searchErrorMessage }}</p>

      <div v-if="adminBookingStore.loading && adminBookingStore.bookings.length === 0" class="empty-state">
        <p class="muted">Loading bookings...</p>
      </div>

      <div v-else-if="filteredBookings.length === 0" class="empty-state">
        <p class="muted">
          {{ hasBookingSearchQuery ? 'No results found' : 'No bookings match the current filters.' }}
        </p>
      </div>

      <div v-else class="list-table admin-bookings-table">
        <div class="admin-bookings-row admin-bookings-row--head">
          <span>Time</span>
          <span>Service</span>
          <span>Client</span>
          <span>Photographer</span>
          <span>Status</span>
          <span>Health form</span>
          <span>Actions</span>
        </div>

        <div v-for="booking in filteredBookings" :key="booking.id" class="admin-bookings-row">
          <span>{{ formatDateTime(booking.startTime) }}</span>
          <span>
            {{ booking.serviceName }}
            <small
              v-if="hasBookingSearchQuery && searchResultByBookingId.get(booking.id)?.highlightedExcerpt"
              class="search-result-snippet"
              v-html="searchResultByBookingId.get(booking.id)?.highlightedExcerpt"
            />
          </span>
          <span>{{ booking.clientUsername }}</span>
          <span>{{ booking.photographerName }}</span>
          <span>
            <span :class="statusClass(booking.status)">
              {{ formatStatus(booking.status) }}
            </span>
          </span>
          <span class="admin-bookings-form">
            <span
              class="pill"
              :class="`pill--booking-${formSummaryByBookingId.get(booking.id)?.formStatus ?? 'not_started'}`"
            >
              {{ formStatusLabel(formSummaryByBookingId.get(booking.id)?.formStatus ?? 'not_started') }}
            </span>
            <RouterLink
              v-if="formSummaryByBookingId.get(booking.id)?.canOpen"
              :to="`/forms/${booking.id}`"
              class="btn btn--ghost"
            >
              View
            </RouterLink>
          </span>
          <span class="admin-bookings-actions">
            <button
              type="button"
              class="btn btn--outline"
              :disabled="!canCancel(booking.status) || adminBookingStore.loading"
              @click="requestCancelBooking(booking.id)"
            >
              Cancel
            </button>
            <select
              class="input admin-bookings-status-select"
              :value="booking.status"
              :disabled="adminBookingStore.loading"
              @change="onStatusChange(booking.id, $event)"
            >
              <option v-for="status in statusOptions" :key="status" :value="status">
                {{ formatStatus(status) }}
              </option>
            </select>
          </span>
        </div>
      </div>
    </AppCard>
  </section>

  <AppModal
    :open="createModalOpen"
    title="Create booking"
    confirm-text="Create booking"
    :confirm-disabled="
      adminBookingStore.loading ||
      !createForm.clientId ||
      !createForm.photographerId ||
      !createForm.serviceId ||
      !createForm.slotId
    "
    :loading="adminBookingStore.loading"
    @cancel="closeCreateModal"
    @confirm="submitCreateBooking"
  >
    <div class="content-grid content-grid--2">
      <label class="field">
        <span class="field__label">Client</span>
        <select v-model="createForm.clientId" class="input">
          <option value="">Select client</option>
          <option v-for="client in adminBookingStore.clients" :key="client.id" :value="client.id">
            {{ client.username }}
          </option>
        </select>
      </label>
      <label class="field">
        <span class="field__label">Photographer</span>
        <select v-model="createForm.photographerId" class="input">
          <option value="">Select photographer</option>
          <option
            v-for="photographer in adminBookingStore.photographers"
            :key="photographer.id"
            :value="photographer.id"
          >
            {{ photographer.username }}
          </option>
        </select>
      </label>
      <label class="field">
        <span class="field__label">Service</span>
        <select v-model="createForm.serviceId" class="input">
          <option value="">Select service</option>
          <option v-for="service in activeServiceOptions" :key="service.id" :value="service.id">
            {{ service.name }}
          </option>
        </select>
      </label>
      <label class="field">
        <span class="field__label">Date</span>
        <input v-model="createForm.date" type="date" class="input" :min="getTodayDateKey()" />
      </label>
      <label class="field field--full">
        <span class="field__label">Session slot</span>
        <select
          v-model="createForm.slotId"
          class="input"
          :disabled="adminBookingStore.createSlotsLoading || createSlotOptions.length === 0"
        >
          <option value="">
            {{
              adminBookingStore.createSlotsLoading
                ? 'Loading slots...'
                : createSlotOptions.length === 0
                  ? 'No available slots'
                  : 'Select a slot'
            }}
          </option>
          <option v-for="slot in createSlotOptions" :key="slot.id" :value="slot.id">
            {{ formatSlotLabel(slot.startTime, slot.endTime) }}
          </option>
        </select>
      </label>
    </div>
  </AppModal>

  <AppModal
    :open="serviceModalOpen"
    :title="serviceEditingId ? 'Edit service' : 'Create service'"
    :confirm-text="serviceEditingId ? 'Save changes' : 'Create service'"
    :confirm-disabled="
      adminBookingStore.loading ||
      !serviceForm.name.trim() ||
      serviceForm.durationMinutes <= 0 ||
      serviceForm.price < 0
    "
    :loading="adminBookingStore.loading"
    @cancel="closeServiceModal"
    @confirm="submitServiceForm"
  >
    <div class="content-grid content-grid--2">
      <label class="field field--full">
        <span class="field__label">Name</span>
        <input v-model="serviceForm.name" type="text" class="input" maxlength="120" />
      </label>
      <label class="field">
        <span class="field__label">Duration (minutes)</span>
        <select v-model.number="serviceForm.durationMinutes" class="input">
          <option :value="30">30</option>
          <option :value="60">60</option>
          <option :value="90">90</option>
          <option :value="120">120</option>
        </select>
      </label>
      <label class="field">
        <span class="field__label">Price (USD)</span>
        <input v-model.number="serviceForm.price" type="number" class="input" min="0" step="0.01" />
      </label>
    </div>
  </AppModal>

  <AppModal
    :open="Boolean(pendingArchiveServiceId)"
    title="Archive service"
    message="Archiving a service hides it from booking selection."
    confirm-text="Archive service"
    confirm-variant="danger"
    :loading="adminBookingStore.loading"
    @cancel="closeArchiveServiceModal"
    @confirm="confirmArchiveService"
  />

  <AppModal
    :open="Boolean(pendingCancelBookingId)"
    title="Cancel booking"
    message="Do you want to cancel this booking?"
    confirm-text="Cancel booking"
    confirm-variant="danger"
    :loading="adminBookingStore.loading"
    @cancel="closeCancelModal"
    @confirm="confirmCancelBooking"
  />
</template>
