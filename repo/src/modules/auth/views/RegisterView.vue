<script setup lang="ts">
import { useAuthStore } from '@/app/stores/useAuthStore';
import { AuthError } from '@/services/AuthService';
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

interface RegisterFormState {
  username: string;
  password: string;
  confirmPassword: string;
}

const router = useRouter();
const authStore = useAuthStore();

const form = reactive<RegisterFormState>({
  username: '',
  password: '',
  confirmPassword: ''
});

const isSubmitting = ref(false);
const submitError = ref('');

const usernameError = computed(() => {
  if (!form.username.trim()) {
    return 'Username is required';
  }

  return '';
});

const passwordError = computed(() => {
  if (!form.password) {
    return 'Password is required';
  }

  if (form.password.length < 8) {
    return 'Password must be at least 8 characters';
  }

  return '';
});

const confirmPasswordError = computed(() => {
  if (!form.confirmPassword) {
    return 'Confirm your password';
  }

  if (form.password !== form.confirmPassword) {
    return 'Passwords do not match';
  }

  return '';
});

const isFormValid = computed(
  () =>
    !usernameError.value &&
    !passwordError.value &&
    !confirmPasswordError.value &&
    Boolean(form.username.trim()) &&
    Boolean(form.password) &&
    Boolean(form.confirmPassword)
);

function mapRegisterError(error: unknown): string {
  if (error instanceof AuthError) {
    if (error.code === 'USERNAME_ALREADY_EXISTS') {
      return 'Username already exists';
    }

    if (error.code === 'PASSWORD_TOO_SHORT') {
      return 'Password must be at least 8 characters';
    }
  }

  if (error instanceof Error && error.message === 'Passwords do not match') {
    return 'Passwords do not match';
  }

  return error instanceof Error ? error.message : 'Unable to create account. Please try again.';
}

async function submitRegistration(): Promise<void> {
  submitError.value = '';

  if (!isFormValid.value) {
    if (usernameError.value) {
      submitError.value = usernameError.value;
      return;
    }

    if (passwordError.value) {
      submitError.value = passwordError.value;
      return;
    }

    submitError.value = confirmPasswordError.value;
    return;
  }

  isSubmitting.value = true;

  try {
    await authStore.register(form.username, form.password, form.confirmPassword);
    await router.replace({ name: 'login' });
  } catch (error: unknown) {
    submitError.value = mapRegisterError(error);
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <section class="auth-panel">
    <div class="auth-panel__head">
      <p class="auth-panel__eyebrow">Create Account</p>
      <h1>Set up your StudioOps account</h1>
      <p>Create a client account to book sessions and track your studio activity offline.</p>
    </div>

    <form class="auth-panel__form" @submit.prevent="submitRegistration">
      <label class="field">
        <span class="field__label">Username</span>
        <input
          v-model="form.username"
          class="input"
          name="username"
          autocomplete="username"
          placeholder="Choose a username"
        />
        <span v-if="form.username || submitError" class="field__error">
          {{ usernameError }}
        </span>
      </label>

      <label class="field">
        <span class="field__label">Password</span>
        <input
          v-model="form.password"
          type="password"
          class="input"
          name="password"
          autocomplete="new-password"
          placeholder="Create a password"
        />
        <span v-if="form.password || submitError" class="field__error">
          {{ passwordError }}
        </span>
      </label>

      <label class="field">
        <span class="field__label">Confirm Password</span>
        <input
          v-model="form.confirmPassword"
          type="password"
          class="input"
          name="confirmPassword"
          autocomplete="new-password"
          placeholder="Re-enter your password"
        />
        <span v-if="form.confirmPassword || submitError" class="field__error">
          {{ confirmPasswordError }}
        </span>
      </label>

      <p v-if="submitError" class="form-error">{{ submitError }}</p>

      <button type="submit" class="btn btn--primary btn--block" :disabled="!isFormValid || isSubmitting">
        {{ isSubmitting ? 'Creating account...' : 'Create account' }}
      </button>
    </form>

    <p class="auth-panel__footnote">
      Already have an account?
      <RouterLink :to="{ name: 'login' }" class="auth-link">Sign in</RouterLink>
    </p>
  </section>
</template>
