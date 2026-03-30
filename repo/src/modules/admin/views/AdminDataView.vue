<script setup lang="ts">
import AppCard from '@/components/AppCard.vue';
import { useImportExportStore } from '@/modules/admin/stores/useImportExportStore';
import { useSearchStore } from '@/modules/search/stores/useSearchStore';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const importExportStore = useImportExportStore();
const searchStore = useSearchStore();
const synonymsDraft = ref('');
const synonymsError = ref('');
const tokenizerStrategy = ref<'whitespace' | 'simple' | 'alphanumeric'>('simple');
const minTokenLengthDraft = ref('1');
const stopwordsDraft = ref('[]');

function toSynonymsJson(value: Record<string, string[]>): string {
  return JSON.stringify(value, null, 2);
}

async function loadSearchConfig(): Promise<void> {
  synonymsError.value = '';

  try {
    await searchStore.fetchSearchConfig();
    synonymsDraft.value = toSynonymsJson(searchStore.synonyms);
    tokenizerStrategy.value = searchStore.tokenizerConfig?.strategy ?? 'simple';
    minTokenLengthDraft.value = String(searchStore.tokenizerConfig?.minTokenLength ?? 1);
    stopwordsDraft.value = JSON.stringify(searchStore.tokenizerConfig?.stopwords ?? [], null, 2);
  } catch (error: unknown) {
    synonymsError.value =
      error instanceof Error ? error.message : 'Unable to load search configuration.';
  }
}

async function saveSearchConfig(): Promise<void> {
  synonymsError.value = '';

  let parsed: unknown;
  try {
    parsed = JSON.parse(synonymsDraft.value);
  } catch {
    synonymsError.value = 'Synonyms must be valid JSON.';
    return;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    synonymsError.value = 'Synonyms must be a key-value object.';
    return;
  }

  const normalized: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      synonymsError.value = `Synonyms for "${key}" must be an array of words.`;
      return;
    }

    normalized[key] = value.map((entry) => String(entry));
  }

  let stopwords: string[] = [];
  if (stopwordsDraft.value.trim().length > 0) {
    let parsedStopwords: unknown;
    try {
      parsedStopwords = JSON.parse(stopwordsDraft.value);
    } catch {
      synonymsError.value = 'Stopwords must be valid JSON array.';
      return;
    }

    if (!Array.isArray(parsedStopwords)) {
      synonymsError.value = 'Stopwords must be a JSON array of words.';
      return;
    }
    stopwords = parsedStopwords.map((entry) => String(entry));
  }

  const minTokenLength = Number.parseInt(minTokenLengthDraft.value, 10);
  if (!Number.isFinite(minTokenLength) || minTokenLength < 1) {
    synonymsError.value = 'Minimum token length must be at least 1.';
    return;
  }

  try {
    await searchStore.saveSearchConfig({
      synonyms: normalized,
      tokenizer: {
        strategy: tokenizerStrategy.value,
        minTokenLength,
        stopwords
      }
    });
    await loadSearchConfig();
  } catch (error: unknown) {
    synonymsError.value =
      error instanceof Error ? error.message : 'Unable to save search configuration.';
  }
}

async function onImportSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  try {
    await importExportStore.importBackupFile(file);
    await router.go(0);
  } catch {
    // Store already exposes user-friendly error.
  } finally {
    input.value = '';
  }
}

onMounted(() => {
  void loadSearchConfig();
});
</script>

<template>
  <section class="page-stack">
    <div class="page-header">
      <div>
        <h2>Data Backup & Restore</h2>
        <p class="muted">Export or restore local IndexedDB data using validated JSON backups.</p>
      </div>
    </div>

    <p v-if="importExportStore.errorMessage" class="form-error">{{ importExportStore.errorMessage }}</p>
    <p v-if="importExportStore.successMessage" class="admin-success">{{ importExportStore.successMessage }}</p>

    <div class="content-grid content-grid--2">
      <AppCard title="Export">
        <p class="muted">
          Export all local records from IndexedDB into a JSON backup file.
        </p>
        <div class="admin-link-row">
          <button
            type="button"
            class="btn btn--primary"
            :disabled="importExportStore.isLoading"
            @click="importExportStore.exportBackup"
          >
            Export backup
          </button>
        </div>
      </AppCard>

      <AppCard title="Import">
        <p class="muted">
          Import replaces current local data after schema validation succeeds.
        </p>
        <label class="field">
          <span class="field__label">Backup JSON file</span>
          <input
            type="file"
            class="input"
            accept="application/json,.json"
            :disabled="importExportStore.isLoading"
            @change="onImportSelected"
          />
        </label>
      </AppCard>

      <AppCard title="Search configuration">
        <p class="muted">
          Configure tokenizer behavior and synonym groups used during local indexing and querying.
        </p>
        <label class="field">
          <span class="field__label">Tokenizer strategy</span>
          <select
            v-model="tokenizerStrategy"
            class="input"
            :disabled="searchStore.isLoading"
          >
            <option value="whitespace">Whitespace</option>
            <option value="simple">Simple</option>
            <option value="alphanumeric">Alphanumeric</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Minimum token length</span>
          <input
            v-model="minTokenLengthDraft"
            type="number"
            class="input"
            min="1"
            :disabled="searchStore.isLoading"
          />
        </label>
        <label class="field">
          <span class="field__label">Stopwords (JSON array)</span>
          <textarea
            v-model="stopwordsDraft"
            class="input"
            rows="4"
            :disabled="searchStore.isLoading"
          />
        </label>
        <label class="field">
          <span class="field__label">Synonyms JSON</span>
          <textarea
            v-model="synonymsDraft"
            class="input"
            rows="8"
            :disabled="searchStore.isLoading"
          />
        </label>
        <p v-if="synonymsError" class="form-error">{{ synonymsError }}</p>
        <div class="admin-link-row">
          <button
            type="button"
            class="btn btn--outline"
            :disabled="searchStore.isLoading"
            @click="loadSearchConfig"
          >
            Reload
          </button>
          <button
            type="button"
            class="btn btn--outline"
            :disabled="searchStore.isLoading"
            @click="searchStore.rebuildIndex"
          >
            Rebuild index
          </button>
          <button
            type="button"
            class="btn btn--primary"
            :disabled="searchStore.isLoading"
            @click="saveSearchConfig"
          >
            Save configuration
          </button>
        </div>
      </AppCard>
    </div>
  </section>
</template>
