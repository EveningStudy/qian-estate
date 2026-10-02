import { expect, test } from "@playwright/test";

// Read-only baseline. Add application-specific interaction tests only after
// inspecting the web owner's controls; do not replace their test files.
test("Qian Estate renders a healthy, non-empty application shell", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    errors.push(`${request.url()}: ${request.failure()?.errorText}`);
  });

  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.ok(), "Entry document must return success").toBeTruthy();
  await expect(page).toHaveTitle(/栖岸/);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#root")).toBeVisible();
  await expect(page.locator("#root")).toContainText(/栖岸|房源|房产/);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(
    page.getByRole("button").or(page.getByRole("link")).first(),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("loaded.png"),
    fullPage: false,
  });
  expect(
    errors,
    "No browser runtime, console, network, or HTTP errors",
  ).toEqual([]);
});
