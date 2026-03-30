<script setup lang="ts">
import type { Booking, BookingStatus } from '@/app/types/domain';
import {
  BOOKING_STATUS_STEPS,
  getCompletedStepKeys,
  getCurrentStep,
  getCurrentStepIndex,
  getStatusNote,
  type StepKey
} from '@/modules/messaging/utils/bookingStatusStepper';
import { computed } from 'vue';

const props = defineProps<{
  status?: BookingStatus | null;
  booking?: Pick<Booking, 'status'> | null;
}>();

const steps = BOOKING_STATUS_STEPS;

const completedStepKeys = computed(() => {
  const status = props.booking?.status ?? props.status;
  return getCompletedStepKeys(status);
});

const currentStep = computed<StepKey | null>(() => {
  const status = props.booking?.status ?? props.status;
  return getCurrentStep(status);
});

const currentStepIndex = computed(() => {
  const status = props.booking?.status ?? props.status;
  return getCurrentStepIndex(status);
});

const statusNote = computed(() => {
  const status = props.booking?.status ?? props.status;
  return getStatusNote(status);
});

function isCompleted(step: StepKey): boolean {
  return completedStepKeys.value.includes(step);
}

function isCurrent(step: StepKey): boolean {
  return currentStep.value === step;
}

function isConnectorComplete(index: number): boolean {
  return index < currentStepIndex.value;
}
</script>

<template>
  <div class="booking-status-stepper">
    <div class="booking-status-stepper__track">
      <template v-for="(step, index) in steps" :key="step.key">
        <div
          class="booking-status-stepper__step"
          :class="{
            'is-complete': isCompleted(step.key),
            'is-current': isCurrent(step.key)
          }"
        >
          <span class="booking-status-stepper__dot" />
          <span class="booking-status-stepper__label">{{ step.label }}</span>
        </div>
        <span
          v-if="index < steps.length - 1"
          class="booking-status-stepper__connector"
          :class="{ 'is-complete': isConnectorComplete(index) }"
        />
      </template>
    </div>
    <p v-if="statusNote" class="booking-status-stepper__note">{{ statusNote }}</p>
  </div>
</template>
