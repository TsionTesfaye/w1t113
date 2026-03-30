<script setup lang="ts">
import { useAuthStore } from '@/app/stores/useAuthStore';
import { AuthError } from '@/services/AuthService';
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

interface LoginFormState {
  username: string;
  password: string;
  rememberMe: boolean;
}

interface BootstrapFormState {
  username: string;
  password: string;
  confirmPassword: string;
}

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const form = reactive<LoginFormState>({
  username: '',
  password: '',
  rememberMe: false
});

const bootstrapForm = reactive<BootstrapFormState>({
  username: '',
  password: '',
  confirmPassword: ''
});

const isSubmitting = ref(false);
const errorMessage = ref('');
const bootstrapError = ref('');
const bootstrapSuccess = ref('');
const isBootstrapping = ref(false);

async function submitLogin(): Promise<void> {
  if (authStore.bootstrapRequired) {
    errorMessage.value = 'Initial admin setup is required before signing in.';
    return;
  }

  errorMessage.value = '';

  if (!form.username.trim() || !form.password.trim()) {
    errorMessage.value = 'Enter both username and password to continue.';
    return;
  }

  isSubmitting.value = true;

  try {
    await authStore.login(form.username, form.password, form.rememberMe);

    let fallbackTarget = '/booking';
    const role = authStore.currentUser?.role;
    if (role === 'admin') {
      fallbackTarget = '/admin/dashboard';
    } else if (role === 'photographer') {
      fallbackTarget = '/photographer/schedule';
    } else if (role === 'moderator') {
      fallbackTarget = '/community';
    }

    const redirectTarget = typeof route.query.redirect === 'string' ? route.query.redirect : fallbackTarget;

    await router.replace(redirectTarget);
  } catch (error: unknown) {
    if (error instanceof AuthError && error.code === 'ACCOUNT_LOCKED' && error.lockUntil) {
      const retryAt = new Date(error.lockUntil).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
      errorMessage.value = `Account locked. Try again after ${retryAt}.`;
      return;
    }

    errorMessage.value =
      error instanceof Error ? error.message : 'Unable to sign in. Please try again.';
  } finally {
    isSubmitting.value = false;
  }
}

async function submitBootstrap(): Promise<void> {
  bootstrapError.value = '';
  bootstrapSuccess.value = '';

  if (!bootstrapForm.username.trim()) {
    bootstrapError.value = 'Username is required.';
    return;
  }

  if (!bootstrapForm.password || !bootstrapForm.confirmPassword) {
    bootstrapError.value = 'Password and confirmation are required.';
    return;
  }

  isBootstrapping.value = true;
  try {
    await authStore.bootstrapInitialAdmin(
      bootstrapForm.username,
      bootstrapForm.password,
      bootstrapForm.confirmPassword
    );
    bootstrapSuccess.value = 'Initial admin created. You can now sign in.';
    bootstrapForm.password = '';
    bootstrapForm.confirmPassword = '';
    form.username = bootstrapForm.username.trim().toLowerCase();
  } catch (error: unknown) {
    bootstrapError.value =
      error instanceof Error ? error.message : 'Unable to complete initial admin setup.';
  } finally {
    isBootstrapping.value = false;
  }
}

onMounted(() => {
  void authStore.checkInitialAdminSetup();
});
</script>

<template>
  <section class="auth-panel">
    <div class="auth-panel__head">
      <p class="auth-panel__eyebrow">Welcome Back</p>
      <h1>Sign in to StudioOps</h1>
      <p>Manage schedules, messages, forms, and moderation from one offline workspace.</p>
    </div>

    <form v-if="authStore.bootstrapRequired" class="auth-panel__form" @submit.prevent="submitBootstrap">
      <p class="muted">
        No admin account exists. Create the first admin to bootstrap this installation.
      </p>

      <label class="field">
        <span class="field__label">Admin username</span>
        <input
          v-model="bootstrapForm.username"
          class="input"
          name="bootstrap-username"
          autocomplete="username"
          placeholder="Create admin username"
        />
      </label>

      <label class="field">
        <span class="field__label">Password</span>
        <input
          v-model="bootstrapForm.password"
          type="password"
          class="input"
          name="bootstrap-password"
          autocomplete="new-password"
          placeholder="Create strong password"
        />
      </label>

      <label class="field">
        <span class="field__label">Confirm password</span>
        <input
          v-model="bootstrapForm.confirmPassword"
          type="password"
          class="input"
          name="bootstrap-confirm-password"
          autocomplete="new-password"
          placeholder="Confirm password"
        />
      </label>

      <p v-if="bootstrapError" class="form-error">{{ bootstrapError }}</p>
      <p v-if="bootstrapSuccess" class="admin-success">{{ bootstrapSuccess }}</p>

      <button type="submit" class="btn btn--primary btn--block" :disabled="isBootstrapping">
        {{ isBootstrapping ? 'Creating admin...' : 'Create first admin' }}
      </button>
    </form>

    <form v-else class="auth-panel__form" @submit.prevent="submitLogin">
      <label class="field">
        <span class="field__label">Username</span>
        <input
          v-model="form.username"
          class="input"
          name="username"
          autocomplete="username"
          placeholder="Enter your username"
        />
      </label>

      <label class="field">
        <span class="field__label">Password</span>
        <input
          v-model="form.password"
          type="password"
          class="input"
          name="password"
          autocomplete="current-password"
          placeholder="Enter your password"
        />
      </label>

      <label class="checkbox">
        <input v-model="form.rememberMe" type="checkbox" />
        <span>Remember me on this device</span>
      </label>

      <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>

      <button type="submit" class="btn btn--primary btn--block" :disabled="isSubmitting">
        {{ isSubmitting ? 'Signing in...' : 'Sign In' }}
      </button>
    </form>

    <p v-if="!authStore.bootstrapRequired" class="auth-panel__footnote">
      Don&apos;t have an account?
      <RouterLink :to="{ name: 'register' }" class="auth-link">Sign up</RouterLink>
    </p>
  </section>
</template>
