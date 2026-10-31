import { expect, test, type Page } from "@playwright/test";
import { buildAndroidBackup } from "./androidBackupFixture";

/**
 * Drives one continuous story through a single shared page/browser context (OPFS storage is
 * scoped to the context, so splitting across contexts would lose all prior state): shop setup,
 * sign in, billing (including a credit sale and receiving a payment against it), then backup and
 * restore. Covers the main flows named in the project's CI requirements end to end in a real
 * browser, not just unit-tested business logic.
 */
test.describe.serial("main flows", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("sets up the shop and owner account", async () => {
    await page.goto("/");
    await page.fill("#storeName", "E2E Test Store");
    await page.click('button:has-text("General item")');
    await page.fill("#adminName", "Owner");
    await page.fill("#pin", "1111");
    await page.fill("#confirmPin", "1111");
    await page.click('button:has-text("Create shop")');

    await expect(page.locator("text=Save your recovery codes")).toBeVisible();
    await page.click('button:has-text("I\'ve saved these codes")');
    await expect(page.locator("text=New bill")).toBeVisible();
  });

  test("adds a product and a customer", async () => {
    await page.click('button:has-text("Products")');
    await page.click('button:has-text("Add product")');
    await page.fill("#name", "Test Widget");
    await page.fill("#price", "250");
    await page.fill("#initialStock", "10");
    await page.click('button:has-text("Save product")');
    await expect(page.locator("text=Test Widget")).toBeVisible();
    await page.click('button:has-text("← Back")');

    await page.click('button:has-text("Customers")');
    await page.click('button:has-text("Add customer")');
    await page.fill("#custName", "Test Customer");
    await page.click('button:has-text("Save customer")');
    await expect(page.locator("text=Test Customer")).toBeVisible();
    await page.click('button:has-text("← Back")');
    await expect(page.locator("text=New bill")).toBeVisible();
  });

  test("signs out and back in", async () => {
    await page.click('button:has-text("Sign out")');
    await expect(page.locator('button:has-text("Owner")')).toBeVisible();
    await page.click('button:has-text("Owner")');
    await page.locator('[aria-label="PIN entry"]').waitFor();
    await page.keyboard.type("1111");
    await expect(page.locator("text=New bill")).toBeVisible();
  });

  test("makes a bill on credit for the customer", async () => {
    await page.click('button:has-text("New bill")');
    await expect(page.locator('.pos-product-grid button', { hasText: "Test Widget" })).toBeVisible();
    await page.click('.pos-product-grid button:has-text("Test Widget")');
    await expect(page.locator('button[aria-label="Remove item"]')).toHaveCount(1);
    await page.click('button[aria-label="Remove item"]');
    await expect(page.locator('button[aria-label="Remove item"]')).toHaveCount(0);
    await page.fill('input[placeholder*="Search products"]', "Test Widget");
    await page.click("text=Test Widget");
    await page.selectOption("#billingCustomer", { label: "Test Customer" });
    await page.click('button:has-text("Proceed to Payment")');
    await page.click('button:has-text("Continue to Payment")');
    await page.click('.payment-method-tile:has-text("Credit")');
    await page.click('button:has-text("Complete Sale")');

    await expect(page.locator('[class*="receiptTotal"]')).toBeVisible();
    await page.click('button:has-text("New bill")');
    await page.click('button:has-text("← Back")');
    await expect(page.locator("text=New bill")).toBeVisible();
  });

  test("receives a payment against the customer's balance", async () => {
    await page.click('button:has-text("Customers")');
    await page.click("text=Test Customer");
    const balanceValue = page.locator('[class*="balanceValue"]');
    await expect(balanceValue).toHaveText("₹250.00");

    page.once("dialog", (dialog) => void dialog.accept("100"));
    await page.click('button:has-text("Receive payment")');
    await expect(balanceValue).toHaveText("₹150.00");
    await page.click('button:has-text("← Back")');
    await page.click('button:has-text("← Back")');
  });

  test("backs up and restores, recovering the pre-backup state", async () => {
    await page.click('button:has-text("Backup")');
    await page.fill("#createPassphrase", "correct-horse-battery-staple");
    const downloadPromise = page.waitForEvent("download");
    await page.click('button:has-text("Create and download backup")');
    const download = await downloadPromise;
    const backupPath = await download.path();
    await expect(page.locator("text=Backup downloaded")).toBeVisible();

    // Change state after the backup so the restore has something real to recover.
    await page.click('button:has-text("← Back")');
    await page.click('button:has-text("Products")');
    await page.click('button:has-text("Add product")');
    await page.fill("#name", "Post-Backup Widget");
    await page.fill("#price", "99");
    await page.fill("#initialStock", "1");
    await page.click('button:has-text("Save product")');
    await expect(page.locator("text=Post-Backup Widget")).toBeVisible();
    await page.click('button:has-text("← Back")');

    await page.click('button:has-text("Backup")');
    await page.fill("#restorePassphrase", "correct-horse-battery-staple");
    page.once("dialog", (dialog) => void dialog.accept());
    const fileInput = page.locator('input[type=file]');
    await fileInput.setInputFiles(backupPath!);

    // The "Restored." confirmation is only visible for a moment — the bootstrap reload that
    // follows a db reference change can drop back to sign-in before it's reliably observable —
    // so the real assertion is the recovered data below, not the toast itself.
    await expect(page.locator('button:has-text("Owner")')).toBeVisible();
    await page.click('button:has-text("Owner")');
    await page.locator('[aria-label="PIN entry"]').waitFor();
    await page.keyboard.type("1111");
    await expect(page.locator("text=New bill")).toBeVisible();

    await page.click('button:has-text("Products")');
    await expect(page.locator("text=Test Widget")).toBeVisible();
    await expect(page.locator("text=Post-Backup Widget")).not.toBeVisible();
  });

  test("imports a backup made by the Android app", async () => {
    const passphrase = "android-backup-passphrase";
    const buffer = Buffer.from(await buildAndroidBackup(passphrase));

    await page.click('button:has-text("← Back")');
    await page.click('button:has-text("Backup")');
    await page.fill("#restorePassphrase", passphrase);
    page.on("dialog", (dialog) => void dialog.accept());
    await page.locator("input[type=file]").setInputFiles({ name: "android.auxobak", mimeType: "application/octet-stream", buffer });

    await expect(page.locator('button:has-text("Owner")')).toBeVisible();
    await page.click('button:has-text("Owner")');
    await page.locator('[aria-label="PIN entry"]').waitFor();
    await page.keyboard.type("1111");
    await expect(page.locator("text=Android Shop")).toBeVisible();

    await page.click('button:has-text("Products")');
    await expect(page.locator("text=Android Shirt")).toBeVisible();
    await expect(page.locator("text=Test Widget")).not.toBeVisible();
    await page.click('button:has-text("← Back")');

    await page.click('button:has-text("Customers")');
    await page.click("text=Asha Android");
    await expect(page.locator('[class*="balanceValue"]')).toHaveText("₹399.00");
  });
});
