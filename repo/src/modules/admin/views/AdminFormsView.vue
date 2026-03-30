<script setup lang="ts">
import type { FormTemplate } from '@/app/types/domain';
import { useHealthFormsStore } from '@/modules/healthForms/stores/useHealthFormsStore';
import type { FormFieldInput, FormTemplateInput } from '@/services/HealthFormService';
import { computed, onMounted, reactive, ref } from 'vue';

const formsStore = useHealthFormsStore();
const editingTemplateId = ref<string | null>(null);

const editorState = reactive<FormTemplateInput>({
  name: '',
  description: '',
  isActive: true,
  fields: []
});

function createEmptyField(type: FormFieldInput['type'] = 'text'): FormFieldInput {
  return {
    id: crypto.randomUUID(),
    type,
    label: '',
    placeholder: '',
    required: false,
    options: type === 'select' || type === 'radio' ? [''] : undefined,
    helpText: '',
    sensitive: false,
    condition: undefined
  };
}

const templates = computed(() => formsStore.templates);

const canSubmit = computed(() => {
  return editorState.name.trim().length > 0 && editorState.fields.length > 0 && !formsStore.isSaving;
});

function resetEditor(): void {
  editingTemplateId.value = null;
  editorState.name = '';
  editorState.description = '';
  editorState.isActive = true;
  editorState.fields = [];
  formsStore.clearFeedback();
}

function addField(type: FormFieldInput['type'] = 'text'): void {
  editorState.fields.push(createEmptyField(type));
}

function removeField(fieldId: string): void {
  editorState.fields = editorState.fields.filter((field) => field.id !== fieldId);
}

function moveField(fieldId: string, direction: -1 | 1): void {
  const index = editorState.fields.findIndex((field) => field.id === fieldId);
  if (index < 0) {
    return;
  }

  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= editorState.fields.length) {
    return;
  }

  const swapped = [...editorState.fields];
  const current = swapped[index];
  swapped[index] = swapped[nextIndex] as FormFieldInput;
  swapped[nextIndex] = current as FormFieldInput;
  editorState.fields = swapped;
}

function normalizeTemplateForEditor(template: FormTemplate): FormTemplateInput {
  return {
    name: template.name,
    description: template.description ?? '',
    isActive: template.isActive,
    fields: template.fields.map((field) => ({
      id: field.id,
      type: field.type,
      label: field.label,
      placeholder: field.placeholder ?? '',
      required: field.required,
      options: field.options ? [...field.options] : undefined,
      helpText: field.helpText ?? '',
      sensitive: field.sensitive === true,
      condition: field.condition
        ? {
            fieldId: field.condition.fieldId,
            operator: field.condition.operator,
            value: field.condition.value
          }
        : undefined
    }))
  };
}

function editTemplate(template: FormTemplate): void {
  const normalized = normalizeTemplateForEditor(template);
  editingTemplateId.value = template.id;
  editorState.name = normalized.name;
  editorState.description = normalized.description ?? '';
  editorState.isActive = normalized.isActive ?? true;
  editorState.fields = normalized.fields;
  formsStore.clearFeedback();
}

function conditionOptions(fieldId: string): FormFieldInput[] {
  return editorState.fields.filter((field) => field.id !== fieldId);
}

function optionsAsText(field: FormFieldInput): string {
  return (field.options ?? []).join(', ');
}

function setOptionsFromText(field: FormFieldInput, text: string): void {
  field.options = text.split(',').map((entry) => entry.trim());
}

function setFieldType(field: FormFieldInput, type: FormFieldInput['type']): void {
  field.type = type;

  if (type === 'select' || type === 'radio') {
    field.options = field.options && field.options.length > 0 ? field.options : [''];
  } else {
    field.options = undefined;
  }
}

async function submitTemplate(): Promise<void> {
  const payload: FormTemplateInput = {
    name: editorState.name,
    description: editorState.description,
    isActive: editorState.isActive,
    fields: editorState.fields.map((field) => ({
      id: field.id,
      type: field.type,
      label: field.label,
      placeholder: field.placeholder,
      required: field.required,
      options: field.options,
      helpText: field.helpText,
      sensitive: field.sensitive,
      condition: field.condition
    }))
  };

  try {
    if (editingTemplateId.value) {
      await formsStore.updateTemplate(editingTemplateId.value, payload);
    } else {
      await formsStore.createTemplate(payload);
    }

    resetEditor();
  } catch {
    // Store already exposes the user-facing error.
  }
}

async function toggleTemplateActive(template: FormTemplate): Promise<void> {
  const payload = normalizeTemplateForEditor(template);
  payload.isActive = !template.isActive;

  try {
    await formsStore.updateTemplate(template.id, payload);
  } catch {
    // Store already exposes the user-facing error.
  }
}

onMounted(async () => {
  await formsStore.fetchAdminTemplates();
});
</script>

<template>
  <section class="page-stack admin-forms-page">
    <div class="page-header">
      <div>
        <h2>Form Templates</h2>
        <p class="muted">Create and manage reusable health declaration templates.</p>
      </div>
      <button type="button" class="btn btn--outline" @click="resetEditor">New template</button>
    </div>

    <p v-if="formsStore.errorMessage" class="form-error">
      {{ formsStore.errorMessage }}
    </p>
    <p v-if="formsStore.successMessage" class="admin-success">
      {{ formsStore.successMessage }}
    </p>

    <div class="admin-forms-layout">
      <section class="card admin-form-editor">
        <header class="card__header">
          <h3 class="card__title">{{ editingTemplateId ? 'Edit template' : 'Create template' }}</h3>
          <p class="card__subtitle">Fields and conditions are validated in the service layer.</p>
        </header>

        <form class="admin-form-editor__form" @submit.prevent="submitTemplate">
          <label class="field">
            <span class="field__label">Template name</span>
            <input v-model="editorState.name" type="text" class="input" maxlength="120" />
          </label>

          <label class="field">
            <span class="field__label">Description</span>
            <textarea
              v-model="editorState.description"
              class="input admin-form-editor__textarea"
              rows="2"
              maxlength="400"
            />
          </label>

          <label class="checkbox">
            <input v-model="editorState.isActive" type="checkbox" />
            <span>Template is active</span>
          </label>

          <div class="admin-form-editor__fields">
            <div class="admin-form-editor__fields-head">
              <h4>Fields</h4>
              <div class="admin-form-editor__field-add">
                <button type="button" class="btn btn--outline" @click="addField('text')">Add text</button>
                <button type="button" class="btn btn--outline" @click="addField('checkbox')">Add checkbox</button>
                <button type="button" class="btn btn--outline" @click="addField('select')">Add select</button>
                <button type="button" class="btn btn--outline" @click="addField('file')">Add file</button>
              </div>
            </div>

            <div v-if="editorState.fields.length === 0" class="slot-empty-state">
              <p class="slot-empty-state__title">No fields yet</p>
              <p class="slot-empty-state__subtitle">Add fields to build your template.</p>
            </div>

            <article
              v-for="(field, index) in editorState.fields"
              :key="field.id"
              class="admin-form-field"
            >
              <div class="admin-form-field__head">
                <strong>Field {{ index + 1 }}</strong>
                <div class="admin-form-field__controls">
                  <button
                    type="button"
                    class="btn btn--outline"
                    :disabled="index === 0"
                    @click="moveField(field.id ?? '', -1)"
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    class="btn btn--outline"
                    :disabled="index === editorState.fields.length - 1"
                    @click="moveField(field.id ?? '', 1)"
                  >
                    Down
                  </button>
                  <button type="button" class="btn btn--outline" @click="removeField(field.id ?? '')">
                    Remove
                  </button>
                </div>
              </div>

              <div class="admin-form-field__grid">
                <label class="field">
                  <span class="field__label">Type</span>
                  <select
                    :value="field.type"
                    class="input"
                    @change="setFieldType(field, ($event.target as HTMLSelectElement).value as FormFieldInput['type'])"
                  >
                    <option value="text">Text</option>
                    <option value="textarea">Textarea</option>
                    <option value="checkbox">Checkbox</option>
                    <option value="select">Select</option>
                    <option value="radio">Radio</option>
                    <option value="file">File upload</option>
                  </select>
                </label>

                <label class="field">
                  <span class="field__label">Label</span>
                  <input v-model="field.label" type="text" class="input" maxlength="120" />
                </label>

                <label class="field">
                  <span class="field__label">Placeholder</span>
                  <input v-model="field.placeholder" type="text" class="input" maxlength="120" />
                </label>

                <label class="field">
                  <span class="field__label">Help text</span>
                  <input v-model="field.helpText" type="text" class="input" maxlength="240" />
                </label>
              </div>

              <label v-if="field.type === 'select' || field.type === 'radio'" class="field">
                <span class="field__label">Options (comma-separated)</span>
                <input
                  :value="optionsAsText(field)"
                  type="text"
                  class="input"
                  @input="setOptionsFromText(field, ($event.target as HTMLInputElement).value)"
                />
              </label>

              <div class="admin-form-field__toggles">
                <label class="checkbox">
                  <input v-model="field.required" type="checkbox" />
                  <span>Required</span>
                </label>
                <label class="checkbox">
                  <input v-model="field.sensitive" type="checkbox" />
                  <span>Sensitive</span>
                </label>
              </div>

              <details class="admin-form-field__condition">
                <summary>Conditional visibility</summary>
                <div class="admin-form-field__condition-grid">
                  <label class="field">
                    <span class="field__label">Depends on field</span>
                    <select
                      class="input"
                      :value="field.condition?.fieldId ?? ''"
                      @change="
                        field.condition = {
                          fieldId: ($event.target as HTMLSelectElement).value,
                          operator: field.condition?.operator ?? 'equals',
                          value: field.condition?.value ?? ''
                        }
                      "
                    >
                      <option value="">Always visible</option>
                      <option
                        v-for="optionField in conditionOptions(field.id ?? '')"
                        :key="`cond-${field.id}-${optionField.id}`"
                        :value="optionField.id"
                      >
                        {{ optionField.label || optionField.id }}
                      </option>
                    </select>
                  </label>

                  <label v-if="field.condition?.fieldId" class="field">
                    <span class="field__label">Operator</span>
                    <select
                      class="input"
                      :value="field.condition.operator"
                      @change="
                        field.condition = {
                          fieldId: field.condition?.fieldId ?? '',
                          operator: ($event.target as HTMLSelectElement).value as 'equals' | 'notEquals' | 'includes',
                          value: field.condition?.value ?? ''
                        }
                      "
                    >
                      <option value="equals">Equals</option>
                      <option value="notEquals">Not equals</option>
                      <option value="includes">Includes</option>
                    </select>
                  </label>

                  <label v-if="field.condition?.fieldId" class="field">
                    <span class="field__label">Value</span>
                    <input
                      class="input"
                      type="text"
                      :value="String(field.condition?.value ?? '')"
                      @input="
                        field.condition = {
                          fieldId: field.condition?.fieldId ?? '',
                          operator: field.condition?.operator ?? 'equals',
                          value: ($event.target as HTMLInputElement).value
                        }
                      "
                    />
                  </label>
                </div>
              </details>
            </article>
          </div>

          <div class="admin-form-editor__actions">
            <button
              type="submit"
              class="btn btn--primary"
              :disabled="!canSubmit"
            >
              {{ editingTemplateId ? 'Update template' : 'Create template' }}
            </button>
          </div>
        </form>
      </section>

      <section class="card admin-form-list">
        <header class="card__header">
          <h3 class="card__title">Templates</h3>
          <p class="card__subtitle">Newest templates appear first.</p>
        </header>

        <div v-if="formsStore.isLoadingTemplates" class="slot-empty-state">
          <p class="slot-empty-state__title">Loading templates</p>
        </div>
        <div v-else-if="templates.length === 0" class="slot-empty-state">
          <p class="slot-empty-state__title">No templates yet</p>
        </div>
        <div v-else class="admin-form-list__rows">
          <article v-for="template in templates" :key="template.id" class="admin-form-list__row">
            <div class="admin-form-list__main">
              <strong>{{ template.name }}</strong>
              <small class="muted">v{{ template.version }} · {{ template.fields.length }} fields</small>
              <small v-if="template.description" class="muted">{{ template.description }}</small>
            </div>
            <div class="admin-form-list__actions">
              <span class="pill" :class="template.isActive ? 'pill--success' : 'pill--warning'">
                {{ template.isActive ? 'Active' : 'Inactive' }}
              </span>
              <button type="button" class="btn btn--outline" @click="editTemplate(template)">Edit</button>
              <button type="button" class="btn btn--outline" @click="toggleTemplateActive(template)">
                {{ template.isActive ? 'Deactivate' : 'Activate' }}
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>
