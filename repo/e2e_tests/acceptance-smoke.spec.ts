import { expect, test } from '@playwright/test';

const DB_NAME = 'studioops-offline';

function currentDateKey(): string {
  const date = new Date();
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function clearClientStorage(page: import('@playwright/test').Page): Promise<void> {
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

async function login(
  page: import('@playwright/test').Page,
  username: string,
  password: string
): Promise<void> {
  await page.goto('/login');
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  const rememberMe = page.getByRole('checkbox', { name: 'Remember me on this device' });
  if (!(await rememberMe.isChecked())) {
    await rememberMe.check();
  }
  await page.getByRole('button', { name: 'Sign In' }).click();
}

async function logout(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: /Log Out/i }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test('clean-db first-run smoke: bootstrap -> booking pending -> confirmation -> forms duplicate block', async ({
  page
}) => {
  const adminUsername = 'owner_admin_smoke';
  const adminPassword = 'StrongPass!123';
  const clientUsername = 'client_smoke';
  const clientPassword = 'ClientPass!123';
  const photographerUsername = 'photographer_smoke';
  const photographerPassword = 'PhotoPass!123';
  const serviceName = 'Headshots E2E 30';
  const sessionDate = currentDateKey();

  await clearClientStorage(page);

  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Create first admin' })).toBeVisible();
  await page.locator('input[name="bootstrap-username"]').fill(adminUsername);
  await page.locator('input[name="bootstrap-password"]').fill(adminPassword);
  await page.locator('input[name="bootstrap-confirm-password"]').fill(adminPassword);
  await page.getByRole('button', { name: 'Create first admin' }).click();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

  await login(page, adminUsername, adminPassword);
  await expect(page).toHaveURL(/\/admin\/dashboard$/);

  await page.goto('/admin/users');
  const createUserForm = page.locator('form.admin-user-form');
  await createUserForm.getByLabel('Username').fill(photographerUsername);
  await createUserForm.getByLabel('Password').fill(photographerPassword);
  await createUserForm.getByLabel('Role').selectOption('photographer');
  await createUserForm.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByText('User created successfully.')).toBeVisible();

  await createUserForm.getByLabel('Username').fill(clientUsername);
  await createUserForm.getByLabel('Password').fill(clientPassword);
  await createUserForm.getByLabel('Role').selectOption('client');
  await createUserForm.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByText('User created successfully.')).toBeVisible();

  await page.goto('/admin/bookings');
  await page.getByRole('button', { name: 'New service' }).click();
  const createServiceModal = page.getByRole('dialog', { name: 'Create service' });
  await createServiceModal.getByLabel('Name').fill(serviceName);
  await createServiceModal.getByLabel('Duration (minutes)').selectOption('30');
  await createServiceModal.getByLabel('Price (USD)').fill('175');
  await createServiceModal.getByRole('button', { name: 'Create service' }).click();
  await expect(createServiceModal).toBeHidden();

  await page.goto('/admin/forms');
  await page.getByLabel('Template name').fill('Health Declaration E2E');
  await page.getByRole('button', { name: 'Add text' }).click();
  await page.locator('.admin-form-field').first().getByLabel('Label').fill('Symptoms');
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(page.locator('.admin-form-list__row').filter({ hasText: 'Health Declaration E2E' })).toHaveCount(1);

  await logout(page);

  await login(page, clientUsername, clientPassword);
  await expect(page).toHaveURL(/\/booking$/);
  await page.locator('input[type="date"]').first().fill(sessionDate);
  const availableSlots = page.locator('.slot-chip.is-available');
  await expect(availableSlots.first()).toBeVisible();

  let holdAcquired = false;
  const slotCount = await availableSlots.count();
  for (let index = 0; index < Math.min(slotCount, 5); index += 1) {
    await availableSlots.nth(index).click();
    try {
      await expect(page.getByText(/^Hold:/)).toBeVisible({ timeout: 4000 });
      holdAcquired = true;
      break;
    } catch {
      // Try the next candidate slot.
    }
  }

  expect(holdAcquired).toBe(true);
  await expect(page.getByRole('heading', { name: 'Confirm Booking' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('No hold')).toBeVisible();
  await expect(page.locator('.form-error')).toHaveCount(0);

  await page.getByRole('link', { name: /My Bookings/i }).click();
  await expect(page.getByText(serviceName).first()).toBeVisible();
  await expect(page.locator('.booking-compact-row .pill').first()).toContainText('pending');

  await logout(page);

  await login(page, photographerUsername, photographerPassword);
  await expect(page).toHaveURL(/\/photographer\/schedule$/);
  await page.getByRole('button', { name: 'Confirm' }).first().click();
  await expect(page.locator('.booking-compact-row .pill').first()).toContainText('confirmed');

  await logout(page);

  await login(page, clientUsername, clientPassword);
  await expect(page).toHaveURL(/\/booking$/);
  await page.getByRole('link', { name: /Forms/i }).click();
  await page.getByRole('link', { name: 'Open' }).first().click();
  await page.getByRole('button', { name: 'Submit form' }).click();
  await expect(page.getByRole('heading', { name: 'Submit health form?' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm submit' }).click();
  await expect(page.getByText('You already submitted this form within the last 24 hours.')).toBeVisible();
});
