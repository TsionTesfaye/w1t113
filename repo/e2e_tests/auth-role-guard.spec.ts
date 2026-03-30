import { expect, test } from '@playwright/test';
import {
  bootstrapFirstAdmin,
  clearClientStorage,
  createUserFromAdmin,
  login,
  logout
} from './helpers';

test('auth + role guards redirect unauthenticated and unauthorized users', async ({ page }) => {
  const admin = { username: 'owner_admin_guard', password: 'StrongPass!123' };
  const photographer = { username: 'photo_guard', password: 'PhotoPass!123' };

  await clearClientStorage(page);

  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/login\?redirect=\/admin\/users$/);

  await bootstrapFirstAdmin(page, admin);
  await login(page, admin.username, admin.password);
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await page.goto('/admin/users');
  await createUserFromAdmin(page, { ...photographer, role: 'photographer' });
  await logout(page);

  await login(page, photographer.username, photographer.password);
  await expect(page).toHaveURL(/\/photographer\/schedule$/);

  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/photographer\/schedule$/);

  await page.goto('/booking');
  await expect(page).toHaveURL(/\/photographer\/schedule$/);
});
