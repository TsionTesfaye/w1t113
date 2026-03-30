import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { installProviders } from './app/providers';
import { useAuthStore } from './app/stores/useAuthStore';
import { router } from './app/router';
import './styles/variables.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
installProviders(app);

async function bootstrap(): Promise<void> {
  const authStore = useAuthStore(pinia);
  try {
    await authStore.loadSession();
  } catch {
    // Continue rendering even if session restoration fails.
  }
  await router.isReady();
  app.mount('#app');
}

void bootstrap();
