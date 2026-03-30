<script setup lang="ts">
import { STORAGE_KEYS } from '@/app/constants/storageKeys';
import { useShellStore } from '@/app/stores/useShellStore';
import AppSidebar from '@/app/layout/AppSidebar.vue';
import AppTopbar from '@/app/layout/AppTopbar.vue';
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';

const shellStore = useShellStore();
const route = useRoute();

let mediaQuery: MediaQueryList | null = null;

function syncCompactLayout(): void {
  if (!mediaQuery) {
    return;
  }

  shellStore.setCompactLayout(mediaQuery.matches);
}

function handleMediaQueryChange(): void {
  syncCompactLayout();
}

onMounted(() => {
  const persistedSidebarState = window.localStorage.getItem(STORAGE_KEYS.sidebarPreference);
  if (persistedSidebarState === 'collapsed') {
    shellStore.sidebarExpanded = false;
  }

  mediaQuery = window.matchMedia('(max-width: 1023px)');
  syncCompactLayout();
  mediaQuery.addEventListener('change', handleMediaQueryChange);
});

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', handleMediaQueryChange);
});

watch(
  () => shellStore.sidebarExpanded,
  (isExpanded) => {
    window.localStorage.setItem(
      STORAGE_KEYS.sidebarPreference,
      isExpanded ? 'expanded' : 'collapsed'
    );
  }
);

watch(
  () => route.fullPath,
  () => {
    if (shellStore.isCompactLayout) {
      shellStore.closeSidebar();
    }
  }
);
</script>

<template>
  <div class="dashboard-shell">
    <aside
      :class="[
        'shell-sidebar',
        {
          'is-collapsed': !shellStore.sidebarExpanded && !shellStore.isCompactLayout,
          'is-open': shellStore.sidebarOpen && shellStore.isCompactLayout
        }
      ]"
    >
      <AppSidebar
        :collapsed="!shellStore.sidebarExpanded && !shellStore.isCompactLayout"
        :compact="shellStore.isCompactLayout"
        @navigate="shellStore.closeSidebar"
      />
    </aside>

    <button
      v-if="shellStore.isCompactLayout && shellStore.sidebarOpen"
      class="shell-overlay"
      type="button"
      aria-label="Close sidebar"
      @click="shellStore.closeSidebar"
    />

    <section
      :class="[
        'shell-main',
        {
          'is-sidebar-collapsed': !shellStore.sidebarExpanded && !shellStore.isCompactLayout
        }
      ]"
    >
      <AppTopbar @toggle-sidebar="shellStore.toggleSidebar" />
      <main class="shell-content">
        <RouterView />
      </main>
    </section>
  </div>
</template>
