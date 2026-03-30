import { expect, test } from '@playwright/test';
import {
  acquireAnyAvailableHold,
  currentDateKey,
  login,
  logout,
  setupBaselineData
} from './helpers';

test('health forms block duplicate submissions within 24 hours', async ({ page }) => {
  const admin = { username: 'owner_admin_forms', password: 'StrongPass!123' };
  const client = { username: 'client_forms', password: 'ClientPass!123' };
  const photographer = { username: 'photographer_forms', password: 'PhotoPass!123' };
  const serviceName = 'Headshots Forms Flow';
  const sessionDate = currentDateKey();

  await setupBaselineData(page, {
    admin,
    client,
    photographer,
    serviceName,
    includeFormTemplate: true
  });

  await login(page, client.username, client.password);
  await expect(page).toHaveURL(/\/booking$/);
  await page.locator('input[type="date"]').first().fill(sessionDate);
  await acquireAnyAvailableHold(page);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await logout(page);

  await login(page, photographer.username, photographer.password);
  await expect(page).toHaveURL(/\/photographer\/schedule$/);
  await page.getByRole('button', { name: 'Confirm' }).first().click();
  await expect(page.locator('.booking-compact-row .pill').first()).toContainText('confirmed');
  await logout(page);

  await login(page, client.username, client.password);
  await page.getByRole('link', { name: /Forms/i }).click();
  await page.getByRole('link', { name: 'Open' }).first().click();
  const formInput = page.locator('.forms-field-list textarea, .forms-field-list input[type="text"]').first();
  if (await formInput.count()) {
    await formInput.fill('No symptoms');
  }
  await page.getByRole('button', { name: 'Submit form' }).click();
  await expect(page.getByRole('heading', { name: 'Submit health form?' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm submit' }).click();
  await expect(page.getByText('You already submitted this form within the last 24 hours.')).toBeVisible();
});
