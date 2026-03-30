import type { App } from 'vue';
import { startScheduler } from '@/app/providers/schedulerProvider';

export function installProviders(_app: App): void {
  void startScheduler();
}
