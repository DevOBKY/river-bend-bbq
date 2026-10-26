import { expect, test, type Page } from '@playwright/test';

// The value for a datetime-local input, a few days from now at noon.
function pickupInDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.toISOString().slice(0, 10)}T12:00`;
}

async function fillCheckout(page: Page, pickup: string) {
  await page.getByLabel('Name').fill('Sam Lee');
  await page.getByLabel('Email').fill('sam@example.com');
  await page.getByLabel('Pickup time').fill(pickup);
  await page.getByRole('button', { name: /Place order/ }).click();
}

test('a customer orders barbecue for pickup', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Catering menu' })).toBeVisible();

  const pork = page.getByRole('listitem').filter({ hasText: 'Pulled pork (lb)' });
  await pork.getByRole('button', { name: 'Add to order' }).click();
  await pork.getByRole('button', { name: 'Add to order' }).click();
  await expect(page.getByRole('link', { name: 'Cart (2)' })).toBeVisible();

  await page.getByRole('link', { name: 'Cart (2)' }).click();
  await expect(page.getByText('Total $29.98')).toBeVisible();

  await fillCheckout(page, pickupInDays(3));
  await expect(page.getByRole('heading', { name: 'Thanks, Sam Lee!' })).toBeVisible();
  await expect(page.getByText(/Order #\d+ is booked/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cart (0)' })).toBeVisible();
});

test("the server's rules show up on the form", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('listitem').filter({ hasText: 'Brisket (lb)' }).getByRole('button').click();
  await page.getByRole('link', { name: /Cart/ }).click();

  // Two hours from now, written in local time the way a datetime-local input expects.
  const soon = new Date(Date.now() + 2 * 3_600_000);
  const local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60_000);
  await fillCheckout(page, local.toISOString().slice(0, 16));

  await expect(page.getByRole('alert')).toHaveText("Catering orders need at least 24 hours' notice");
});

test('staff sign in and mark an order ready', async ({ page }) => {
  await page.goto('/staff');
  await page.getByLabel('Email').fill('pat@riverbend.example');
  await page.getByLabel('Password').fill('smoked-brisket-42');
  await page.getByRole('button', { name: 'Sign in' }).click();

  const rotary = page.getByRole('listitem').filter({ hasText: 'Owensboro Rotary Club' });
  await rotary.getByRole('button', { name: 'Mark ready' }).click();
  await expect(rotary).toBeHidden(); // it leaves the "placed" list

  await page.getByRole('button', { name: 'ready', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Owensboro Rotary Club' })).toBeVisible();
});
