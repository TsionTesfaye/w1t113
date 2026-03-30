import { expect, test, type Page } from '@playwright/test';
import {
  acquireAnyAvailableHold,
  currentDateKey,
  login,
  logout,
  setupBaselineData
} from './helpers';

const DB_NAME = 'studioops-offline';

async function forceInAppDisabledByUsername(page: Page, username: string): Promise<void> {
  await page.evaluate(
    async ({ dbName, targetUsername }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => reject(request.error ?? new Error('Failed to open database'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['users', 'notificationPreferences'], 'readwrite');
          const usersStore = tx.objectStore('users');
          const usernameIndex = usersStore.index('username');
          const userRequest = usernameIndex.get(targetUsername.toLowerCase());
          userRequest.onerror = () => reject(userRequest.error ?? new Error('Failed to read user'));
          userRequest.onsuccess = () => {
            const user = userRequest.result as { id?: string } | undefined;
            if (!user?.id) {
              reject(new Error('Target user not found'));
              return;
            }

            const preferenceStore = tx.objectStore('notificationPreferences');
            preferenceStore.put({
              id: user.id,
              userId: user.id,
              inAppEnabled: false,
              emailEnabled: false,
              smsEnabled: false,
              booking: true,
              messages: true,
              community: true
            });
          };

          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error ?? new Error('Failed to update preference'));
        };
      });
    },
    {
      dbName: DB_NAME,
      targetUsername: username
    }
  );
}

async function confirmBookingFromAdminTable(
  page: Page,
  clientUsername: string,
  serviceName: string
): Promise<void> {
  await page.goto('/admin/bookings');
  const bookingRow = page
    .locator('.admin-bookings-row')
    .filter({ hasText: clientUsername.toLowerCase() })
    .filter({ hasText: serviceName });

  await expect(bookingRow.first()).toBeVisible();
  await expect(bookingRow.first().locator('.pill').first()).toContainText('pending');

  const statusSelect = bookingRow.first().locator('select.admin-bookings-status-select');
  await statusSelect.selectOption('confirmed');
  await expect(bookingRow.first().locator('.pill').first()).toContainText('confirmed');
}

test('in-app notifications remain active even when preference is altered', async ({ page }) => {
  const admin = { username: 'owner_admin_notif', password: 'StrongPass!123' };
  const client = { username: 'client_notif', password: 'ClientPass!123' };
  const photographer = { username: 'photographer_notif', password: 'PhotoPass!123' };
  const serviceName = 'Headshots Notifications Flow';
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
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('No hold')).toBeVisible();
  await logout(page);

  await login(page, admin.username, admin.password);
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await forceInAppDisabledByUsername(page, client.username);
  await confirmBookingFromAdminTable(page, client.username, serviceName);
  await logout(page);

  await login(page, client.username, client.password);
  await expect(page).toHaveURL(/\/booking$/);
  await page.goto('/notifications');
  await expect(page.getByText('Your booking has been confirmed.')).toBeVisible();
});
