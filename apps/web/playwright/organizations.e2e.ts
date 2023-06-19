import { expect } from "@playwright/test";
import { createHash } from "crypto";
import { totp } from "otplib";

import { test } from "./lib/fixtures";

test.use({ baseURL: "http://app.cal.local:3000/" });

test.describe.configure({ mode: "serial" });

test.afterEach(({ users }) => users.deleteAll());

const generateCode = (email: string) => {
  const secret = createHash("md5")
    .update(email + process.env.CALENDSO_ENCRYPTION_KEY)
    .digest("hex");

  totp.options = { step: 90 };
  return totp.generate(secret);
};

test.describe("Organizations v1", () => {
  test("Creation", async ({ page, users }) => {
    const user = await users.create();
    await user.login();
    await page.goto("/settings/organizations/new");
    await page.waitForLoadState("networkidle");

    await test.step("Step 1", async () => {
      // Check required fields
      await page.locator("button[type=submit]").click();
      await expect(page.locator(".text-red-700")).toHaveCount(3);

      // happy path
      await page.locator("input[name=adminEmail]").fill(`john@${user.username}-org.com`);
      expect(await page.locator("input[name=name]").inputValue()).toEqual(
        `${user.username}-org`.charAt(0).toUpperCase() + `${user.username}-org`.slice(1)
      );
      expect(await page.locator("input[name=slug]").inputValue()).toEqual(`${user.username}-org`);

      await test.step("Verification", async () => {
        await page.locator("button[type=submit]").click();
        await page.waitForLoadState("networkidle");
        await expect(page.locator("#modal-title")).toBeVisible();
        await page.locator("input[name='2fa1']").fill(generateCode(`john@${user.username}-org.com`));
        await page.locator("button:text('Verify')").click();
        await page.waitForURL("/settings/organizations/*/set-password");
        await page.locator("button[type=submit]").click();
        await expect(page.locator(".text-red-700")).toHaveCount(3);
        await page.locator("input[name='password']").fill("ADMIN_user2023$");
        await page.locator("button[type=submit]").click();
      });
    });
  });
});
