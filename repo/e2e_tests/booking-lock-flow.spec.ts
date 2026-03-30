import { expect, test } from '@playwright/test';
import { acquireAnyAvailableHold, currentDateKey, login, setupBaselineData } from './helpers';

const DB_NAME = 'studioops-offline';

async function expireAllSlotLocks(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async (dbName) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onerror = () => reject(request.error ?? new Error('Failed to open database'));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('slotLocks', 'readwrite');
        const store = tx.objectStore('slotLocks');
        const getAllRequest = store.getAll();
        getAllRequest.onerror = () => reject(getAllRequest.error ?? new Error('Failed to load locks'));
        getAllRequest.onsuccess = () => {
          const locks = Array.isArray(getAllRequest.result) ? getAllRequest.result : [];
          for (const lock of locks) {
            store.put({
              ...lock,
              expiresAt: Date.now() - 1_000
            });
          }
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error('Failed to expire locks'));
      };
    });
  }, DB_NAME);
}

test('booking lock expiry allows retry and prevents duplicate booking of same slot', async ({ page }) => {
  const admin = { username: 'owner_admin_lock', password: 'StrongPass!123' };
  const client = { username: 'client_lock', password: 'ClientPass!123' };
  const photographer = { username: 'photographer_lock', password: 'PhotoPass!123' };
  const serviceName = 'Headshots Lock Flow';
  const sessionDate = currentDateKey();

  await setupBaselineData(page, {
    admin,
    client,
    photographer,
    serviceName
  });

  await login(page, client.username, client.password);
  await expect(page).toHaveURL(/\/booking$/);
  await page.locator('input[type="date"]').first().fill(sessionDate);

  await acquireAnyAvailableHold(page);
  await expireAllSlotLocks(page);

  await page.reload();
  await expect(page).toHaveURL(/\/booking$/);
  await page.locator('input[type="date"]').first().fill(sessionDate);

  const selectedRange = await acquireAnyAvailableHold(page);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('No hold')).toBeVisible();

  await page.getByRole('link', { name: /My Bookings/i }).click();
  await expect(page.locator('.booking-compact-row').filter({ hasText: serviceName })).toHaveCount(1);
  await expect(page.locator('.booking-compact-row .pill').first()).toContainText('pending');

  await page.goto('/booking');
  await page.locator('input[type="date"]').first().fill(sessionDate);

  const bookedSlot = page.locator('.slot-chip', {
    has: page.locator('strong', { hasText: selectedRange })
  });
  await expect(bookedSlot.first()).toContainText('Fully booked');
});
