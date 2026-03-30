import { defineStore } from 'pinia';

interface ShellState {
  sidebarExpanded: boolean;
  sidebarOpen: boolean;
  isCompactLayout: boolean;
}

export const useShellStore = defineStore('shell', {
  state: (): ShellState => ({
    sidebarExpanded: true,
    sidebarOpen: false,
    isCompactLayout: false
  }),
  actions: {
    setCompactLayout(isCompact: boolean): void {
      this.isCompactLayout = isCompact;
      if (!isCompact) {
        this.sidebarOpen = false;
      }
    },
    toggleSidebar(): void {
      if (this.isCompactLayout) {
        this.sidebarOpen = !this.sidebarOpen;
        return;
      }

      this.sidebarExpanded = !this.sidebarExpanded;
    },
    closeSidebar(): void {
      this.sidebarOpen = false;
    },
    openSidebar(): void {
      this.sidebarOpen = true;
    }
  }
});
