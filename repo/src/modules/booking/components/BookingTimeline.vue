<script setup lang="ts">
import type { BookingStatus } from '@/app/types/domain';
import { computed } from 'vue';

interface TimelineStep {
  key: string;
  label: string;
  at: number;
  terminal: boolean;
}

const props = defineProps<{
  status: BookingStatus;
  createdAt: number;
  startTime: number;
  endTime: number;
}>();

const steps = computed<TimelineStep[]>(() => {
  const timeline: TimelineStep[] = [];
  const status = props.status;

  const hasConfirmed =
    status === 'confirmed' ||
    status === 'arrived' ||
    status === 'started' ||
    status === 'completed' ||
    status === 'auto_completed' ||
    status === 'canceled' ||
    status === 'missed' ||
    status === 'photographer_unavailable' ||
    status === 'rescheduled';

  if (hasConfirmed) {
    timeline.push({
      key: 'confirmed',
      label: 'Confirmed',
      at: props.createdAt,
      terminal: false
    });
  }

  if (
    status === 'arrived' ||
    status === 'started' ||
    status === 'completed' ||
    status === 'auto_completed'
  ) {
    timeline.push({
      key: 'arrived',
      label: 'Arrived',
      at: props.startTime,
      terminal: false
    });
  }

  if (status === 'started' || status === 'completed' || status === 'auto_completed') {
    timeline.push({
      key: 'started',
      label: 'Started',
      at: props.startTime,
      terminal: false
    });
  }

  if (status === 'completed' || status === 'auto_completed') {
    timeline.push({
      key: 'ended',
      label: 'Ended',
      at: props.endTime,
      terminal: false
    });
    return timeline;
  }

  if (status === 'canceled' || status === 'photographer_unavailable') {
    timeline.push({
      key: 'canceled',
      label: 'Cancelled',
      at: props.startTime,
      terminal: true
    });
    return timeline;
  }

  if (status === 'missed') {
    timeline.push({
      key: 'missed',
      label: 'Missed',
      at: props.endTime,
      terminal: true
    });
  }

  return timeline;
});

function formatStepTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
</script>

<template>
  <div class="booking-timeline">
    <p class="booking-timeline__title">Booking lifecycle</p>
    <p v-if="steps.length === 0" class="muted booking-timeline__empty">
      No lifecycle steps completed yet.
    </p>
    <ul v-else class="booking-timeline__list">
      <li
        v-for="step in steps"
        :key="step.key"
        class="booking-timeline__item"
        :class="{ 'is-terminal': step.terminal }"
      >
        <span class="booking-timeline__icon">{{ step.terminal ? '✖' : '✔' }}</span>
        <span class="booking-timeline__label">{{ step.label }}</span>
        <span class="booking-timeline__time">{{ formatStepTime(step.at) }}</span>
      </li>
    </ul>
  </div>
</template>
