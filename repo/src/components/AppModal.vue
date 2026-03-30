<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'primary' | 'danger';
  confirmDisabled?: boolean;
  loading?: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

function onOverlayClick(): void {
  emit('cancel');
}
</script>

<template>
  <div v-if="open">
    <div class="app-modal-overlay" @click="onOverlayClick" />
    <div class="app-modal" role="dialog" aria-modal="true" :aria-label="title">
      <header class="app-modal__header">
        <h3>{{ title }}</h3>
      </header>

      <div class="app-modal__body">
        <p v-if="message" class="app-modal__message">{{ message }}</p>
        <slot />
      </div>

      <footer class="app-modal__actions">
        <button type="button" class="btn btn--outline" :disabled="loading" @click="emit('cancel')">
          {{ cancelText ?? 'Cancel' }}
        </button>
        <button
          type="button"
          :class="confirmVariant === 'danger' ? 'btn btn--danger' : 'btn btn--primary'"
          :disabled="loading || confirmDisabled"
          @click="emit('confirm')"
        >
          {{ loading ? 'Please wait...' : confirmText ?? 'Confirm' }}
        </button>
      </footer>
    </div>
  </div>
</template>
