import { expect, type Page } from '@playwright/test';

export const DB_NAME = 'studioops-offline';

export interface UserCredentials {
  username: string;
  password: string;
}

export function currentDateKey(): string {
  const date = new Date();
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function clearClientStorage(page: Page): Promise<void> {
  await page.goto('/login');
  await page.evaluate(async (dbName) => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }, DB_NAME);
}

export async function login(
  page: Page,
  username: string,
  password: string,
  rememberMe = true
): Promise<void> {
  await page.goto('/login');
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  const rememberMeCheckbox = page.getByRole('checkbox', { name: 'Remember me on this device' });
  if (rememberMe) {
    if (!(await rememberMeCheckbox.isChecked())) {
      await rememberMeCheckbox.check();
    }
  } else if (await rememberMeCheckbox.isChecked()) {
    await rememberMeCheckbox.uncheck();
  }
  await page.getByRole('button', { name: 'Sign In' }).click();
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Log Out/i }).click();
  await expect(page).toHaveURL(/\/login$/);
}

export async function bootstrapFirstAdmin(
  page: Page,
  admin: UserCredentials
): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Create first admin' })).toBeVisible();
  await page.locator('input[name="bootstrap-username"]').fill(admin.username);
  await page.locator('input[name="bootstrap-password"]').fill(admin.password);
  await page.locator('input[name="bootstrap-confirm-password"]').fill(admin.password);
  await page.getByRole('button', { name: 'Create first admin' }).click();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
}

export async function createUserFromAdmin(
  page: Page,
  user: UserCredentials & { role: 'admin' | 'client' | 'photographer' | 'moderator' }
): Promise<void> {
  const createUserForm = page.locator('form.admin-user-form');
  await createUserForm.getByLabel('Username').fill(user.username);
  await createUserForm.getByLabel('Password').fill(user.password);
  await createUserForm.getByLabel('Role').selectOption(user.role);
  await createUserForm.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByText('User created successfully.')).toBeVisible();
}

export async function createServiceFromAdmin(
  page: Page,
  service: { name: string; durationMinutes: '30' | '90'; price: string }
): Promise<void> {
  await page.getByRole('button', { name: 'New service' }).click();
  const createServiceModal = page.getByRole('dialog', { name: 'Create service' });
  await createServiceModal.getByLabel('Name').fill(service.name);
  await createServiceModal.getByLabel('Duration (minutes)').selectOption(service.durationMinutes);
  await createServiceModal.getByLabel('Price (USD)').fill(service.price);
  await createServiceModal.getByRole('button', { name: 'Create service' }).click();
  await expect(createServiceModal).toBeHidden();
}

export async function createHealthTemplateFromAdmin(
  page: Page,
  templateName: string,
  fieldLabel = 'Symptoms'
): Promise<void> {
  await page.goto('/admin/forms');
  await page.getByLabel('Template name').fill(templateName);
  await page.getByRole('button', { name: 'Add text' }).click();
  await page.locator('.admin-form-field').first().getByLabel('Label').fill(fieldLabel);
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(page.locator('.admin-form-list__row').filter({ hasText: templateName })).toHaveCount(1);
}

export async function setupBaselineData(
  page: Page,
  setup: {
    admin: UserCredentials;
    client: UserCredentials;
    photographer: UserCredentials;
    serviceName: string;
    includeFormTemplate?: boolean;
  }
): Promise<void> {
  await clearClientStorage(page);
  await bootstrapFirstAdmin(page, setup.admin);
  await login(page, setup.admin.username, setup.admin.password);
  await expect(page).toHaveURL(/\/admin\/dashboard$/);

  await page.goto('/admin/users');
  await createUserFromAdmin(page, { ...setup.photographer, role: 'photographer' });
  await createUserFromAdmin(page, { ...setup.client, role: 'client' });

  await page.goto('/admin/bookings');
  await createServiceFromAdmin(page, {
    name: setup.serviceName,
    durationMinutes: '30',
    price: '175'
  });

  if (setup.includeFormTemplate) {
    await createHealthTemplateFromAdmin(page, 'Health Declaration E2E');
  }

  await logout(page);
}

export async function acquireAnyAvailableHold(page: Page): Promise<string> {
  const availableSlots = page.locator('.slot-chip.is-available');
  await expect(availableSlots.first()).toBeVisible();

  let acquiredLabel = '';
  const slotCount = await availableSlots.count();
  for (let index = 0; index < Math.min(slotCount, 8); index += 1) {
    const slot = availableSlots.nth(index);
    acquiredLabel = ((await slot.locator('strong').textContent()) ?? '').trim();
    await slot.click();
    try {
      await expect(page.getByText(/^Hold:/)).toBeVisible({ timeout: 4000 });
      return acquiredLabel;
    } catch {
      // Try next slot candidate.
    }
  }

  throw new Error('Unable to acquire slot hold');
}
