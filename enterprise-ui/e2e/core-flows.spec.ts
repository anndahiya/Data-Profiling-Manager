import { expect, test, type Page } from '@playwright/test';

async function loadDemoWorkspace(page: Page): Promise<void> {
  await page.goto('/overview');
  await expect(page.getByRole('heading', { level: 1, name: 'Data health overview' })).toBeVisible();
  await page.getByRole('button', { name: 'Load demo workspace' }).click();
  await expect(page.getByText('Customer master', { exact: true }).first()).toBeVisible();
}

async function openDemoAsset(page: Page): Promise<void> {
  await loadDemoWorkspace(page);
  await page.getByRole('link', { name: 'Data assets' }).click();
  await page.getByRole('link', { name: 'Customer master' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Customer master' })).toBeVisible();
}

test('demo workspace supports navigation, keyboard tabs, and DQ report download', async ({ page }) => {
  await openDemoAsset(page);

  const overviewTab = page.getByRole('tab', { name: 'Overview' });
  await overviewTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('columnheader', { name: 'Column' })).toBeVisible();

  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByRole('columnheader', { name: 'Run date' })).toBeVisible();

  await page.getByRole('tab', { name: 'Overview' }).click();
  await page.getByRole('link', { name: 'Open full report' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('customer_master_');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download DQ report' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
});

test('asset metadata can be edited and destructive deletion requires the exact name', async ({ page }) => {
  await openDemoAsset(page);

  await page.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit data asset' });
  await dialog.getByLabel('Asset name').fill('Customer master E2E');
  await dialog.getByLabel('Owner / steward').fill('Enterprise Data Office');
  await dialog.getByLabel('Tags').fill('customer, critical, test');
  await dialog.getByRole('button', { name: 'Save asset' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Customer master E2E' })).toBeVisible();
  await expect(page.getByText('Enterprise Data Office', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Delete' }).click();
  const deleteDialog = page.getByRole('dialog', { name: /Delete “Customer master E2E”/ });
  const deleteButton = deleteDialog.getByRole('button', { name: 'Delete asset and related data' });
  await expect(deleteButton).toBeDisabled();
  await deleteDialog.getByLabel('Type the asset name to confirm').fill('Customer master E2E');
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();

  await expect(page.getByRole('heading', { level: 1, name: 'Data assets' })).toBeVisible();
  await expect(page.getByText('0 assets', { exact: true })).toBeVisible();
});

test('retention settings persist and issue status changes update the workspace', async ({ page }) => {
  await loadDemoWorkspace(page);

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Runs retained per asset').fill('2');
  await page.getByLabel('Resolved issue retention (days)').fill('30');
  await page.getByRole('button', { name: 'Save retention settings' }).click();
  await expect(page.getByRole('status')).toContainText('Retention settings saved');

  await page.getByRole('link', { name: 'Issues' }).click();
  const issueRow = page.getByRole('row').filter({ hasText: 'Email is populated fell below 95%' });
  await expect(issueRow).toBeVisible();
  await issueRow.getByRole('combobox').selectOption('Acknowledged');
  await expect(issueRow.getByText('Acknowledged', { exact: true })).toBeVisible();
});

test('worker-backed profiling creates a browser asset without inventing a DQ score', async ({ page }) => {
  await page.goto('/profile');
  await page.getByLabel('Asset name').fill('Synthetic customers');
  await page.getByLabel('Owner / steward').fill('Test Steward');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'synthetic-customers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'customer_id,email,state,annual_income,updated_at',
      '001,one@example.com,NC,50000,2026-07-20',
      '002,two@example.com,VA,75000,2026-07-21',
      '003,,NC,62000,2026-07-22',
    ].join('\n')),
  });

  await page.getByRole('button', { name: 'Run profile' }).click();
  await expect(page).toHaveURL(/\/runs\//);
  await expect(page.getByRole('heading', { level: 1, name: 'synthetic-customers.csv' })).toBeVisible();
  await expect(page.getByText('No applicable governed rules were evaluated.')).toBeVisible();
  await expect(page.getByText('N/A', { exact: true }).first()).toBeVisible();
});

test('cancelling a large background profile saves no partial asset', async ({ page }) => {
  test.slow();
  await page.goto('/profile');
  await page.getByLabel('Asset name').fill('Cancelled profile');

  const rows = ['id,email,state,amount,updated_at'];
  for (let index = 0; index < 150_000; index += 1) {
    rows.push(`${String(index).padStart(7, '0')},user${index}@example.com,NC,${index % 100000},2026-07-20`);
  }
  await page.locator('input[type="file"]').setInputFiles({
    name: 'large-cancel.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(rows.join('\n')),
  });

  await page.getByRole('button', { name: 'Run profile' }).click();
  const cancel = page.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.getByRole('alert')).toContainText('Profiling was cancelled. No run was saved.');

  await page.getByRole('link', { name: 'Data assets' }).click();
  await expect(page.getByText('0 assets', { exact: true })).toBeVisible();
});
