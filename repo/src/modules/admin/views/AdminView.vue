<script setup lang="ts">
import { DB_VERSION } from '@/db/schema';
import { useAdminConfigStore } from '@/modules/admin/stores/useAdminConfigStore';
import AppCard from '@/components/AppCard.vue';
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';

const configStore = useAdminConfigStore();
const notificationSettings = computed(() => {
  return (
    configStore.notificationSettings ?? {
      booking: true,
      messages: true,
      community: true
    }
  );
});
let successAlertTimerId: number | null = null;

onMounted(() => {
  void configStore.loadConfig();
});

watch(
  () => configStore.successMessage,
  (message) => {
    if (successAlertTimerId !== null) {
      window.clearTimeout(successAlertTimerId);
      successAlertTimerId = null;
    }

    if (!message) {
      return;
    }

    successAlertTimerId = window.setTimeout(() => {
      configStore.clearFeedback();
      successAlertTimerId = null;
    }, 3500);
  }
);

onBeforeUnmount(() => {
  if (successAlertTimerId !== null) {
    window.clearTimeout(successAlertTimerId);
    successAlertTimerId = null;
  }
});
</script>

<template>
  <section class="page-stack">
    <div class="page-header">
      <div>
        <h2>Configuration</h2>
        <p class="muted">Manage local system preferences for this offline workspace.</p>
      </div>
    </div>

    <div v-if="configStore.errorMessage" class="app-alert app-alert--error" role="alert">
      <span>{{ configStore.errorMessage }}</span>
      <button type="button" class="btn btn--ghost" @click="configStore.clearFeedback">Dismiss</button>
    </div>
    <div v-else-if="configStore.successMessage" class="app-alert app-alert--success" role="status">
      <span>{{ configStore.successMessage }}</span>
      <button type="button" class="btn btn--ghost" @click="configStore.clearFeedback">Dismiss</button>
    </div>

    <div class="admin-settings-sections">
      <section class="admin-settings-section">
        <h3 class="admin-settings-section__title">System settings</h3>
        <AppCard title="Notification preferences">
          <label class="checkbox admin-settings__toggle">
            <input
              type="checkbox"
              :checked="notificationSettings.booking"
              :disabled="configStore.isLoading || configStore.isSaving"
              @change="
                configStore.updateNotificationSettings({
                  booking: ($event.target as HTMLInputElement).checked
                })
              "
            />
            <span>Booking notifications</span>
          </label>
          <label class="checkbox admin-settings__toggle">
            <input
              type="checkbox"
              :checked="notificationSettings.messages"
              :disabled="configStore.isLoading || configStore.isSaving"
              @change="
                configStore.updateNotificationSettings({
                  messages: ($event.target as HTMLInputElement).checked
                })
              "
            />
            <span>Message notifications</span>
          </label>
          <label class="checkbox admin-settings__toggle">
            <input
              type="checkbox"
              :checked="notificationSettings.community"
              :disabled="configStore.isLoading || configStore.isSaving"
              @change="
                configStore.updateNotificationSettings({
                  community: ($event.target as HTMLInputElement).checked
                })
              "
            />
            <span>Community notifications</span>
          </label>
          <p class="muted">
            Disabled categories are blocked system-wide for all users.
          </p>
        </AppCard>
      </section>

      <section class="admin-settings-section">
        <h3 class="admin-settings-section__title">System info</h3>
        <AppCard>
          <dl class="admin-settings__info">
            <div>
              <dt>Mode</dt>
              <dd>Offline-first (local-only)</dd>
            </div>
            <div>
              <dt>IndexedDB schema</dt>
              <dd>v{{ DB_VERSION }}</dd>
            </div>
            <div>
              <dt>Scheduler</dt>
              <dd>Runs every 60 seconds while app is open</dd>
            </div>
          </dl>
        </AppCard>
      </section>
    </div>
  </section>
</template>
