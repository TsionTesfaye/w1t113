import { expect, test } from '@playwright/test';
import { login, setupBaselineData } from './helpers';

async function searchFromTopbar(
  page: import('@playwright/test').Page,
  query: string
): Promise<void> {
  const searchInput = page.locator('input[placeholder="Search…"]');
  await searchInput.click();
  await searchInput.fill(query);
}

test('admin tokenizer config update changes search behavior after rebuild', async ({ page }) => {
  const admin = { username: 'owner_admin_search', password: 'StrongPass!123' };
  const client = { username: 'alex_search', password: 'ClientPass!123' };
  const photographer = { username: 'photographer_search', password: 'PhotoPass!123' };
  const serviceName = 'Headshots Search Config';

  await setupBaselineData(page, {
    admin,
    client,
    photographer,
    serviceName
  });

  await login(page, admin.username, admin.password);
  await expect(page).toHaveURL(/\/admin\/dashboard$/);

  await searchFromTopbar(page, 'alex');
  await expect(page.locator('.topbar-search-dropdown__item').first()).toBeVisible();

  await page.goto('/admin/data');
  await page.getByLabel('Minimum token length').fill('5');
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await page.getByRole('button', { name: 'Rebuild index' }).click();

  await searchFromTopbar(page, 'alex');
  await expect(page.getByText('No results found. Try different keywords or check spelling.')).toBeVisible();

  await page.goto('/admin/data');
  await page.getByLabel('Minimum token length').fill('1');
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await page.getByRole('button', { name: 'Rebuild index' }).click();

  await searchFromTopbar(page, 'alex');
  await expect(page.locator('.topbar-search-dropdown__item').first()).toBeVisible();
});
