import { expect, test } from '@playwright/test';
import { bootstrapFirstAdmin, clearClientStorage, login } from './helpers';

test('registers lowercase username and logs in successfully with trim + mixed casing', async ({
  page
}) => {
  const admin = { username: 'owner_admin_auth_norm', password: 'StrongPass!123' };
  const client = { username: 'john_auth_norm', password: 'ClientPass!123' };

  await clearClientStorage(page);
  await bootstrapFirstAdmin(page, admin);

  await page.goto('/register');
  await page.locator('input[name="username"]').fill(client.username);
  await page.locator('input[name="password"]').fill(client.password);
  await page.locator('input[name="confirmPassword"]').fill(client.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await login(page, `  ${client.username.toUpperCase()}  `, client.password);
  await expect(page).toHaveURL(/\/booking$/);

  await page.getByRole('button', { name: 'Edit profile' }).click();
  const profileModal = page.locator('.topbar-profile-modal');
  await expect(profileModal).toBeVisible();
  await expect(profileModal.getByLabel('Username')).toHaveValue(client.username);

  const sessionToken = await page.evaluate(() => localStorage.getItem('studioops.session.token'));
  expect(sessionToken).toBeTruthy();
});

test('login screen stays responsive on desktop and mobile viewport sizes', async ({ page }) => {
  await clearClientStorage(page);

  const viewports = [
    { width: 1366, height: 768 },
    { width: 390, height: 844 }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto('/login');
    await expect(page.locator('.auth-panel')).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(hasHorizontalOverflow).toBe(false);
  }
});
