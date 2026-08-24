import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

let playwright;
try {
  playwright = await import("playwright");
} catch (error) {
  const bundledPath = process.env.CODEX_PLAYWRIGHT_PATH || path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright", "index.mjs");
  if (!process.env.USERPROFILE && !process.env.CODEX_PLAYWRIGHT_PATH) throw error;
  playwright = await import(pathToFileURL(bundledPath).href);
}
const { chromium } = playwright;

const baseUrl = (process.env.E2E_BASE_URL || "https://repair-costing.vercel.app").replace(/\/$/, "");
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const expectedCompany = process.env.E2E_EXPECTED_COMPANY;
const browserChannel = process.env.E2E_BROWSER_CHANNEL || "chrome";

const browser = await chromium.launch({ headless: true, channel: browserChannel });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

async function textVisible(text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await textVisible("Survey & Remedial Costing Platform");
  await textVisible("Sign in to Costing Platform");
  assert.equal(await page.getByLabel("Email address").isVisible(), true);
  assert.equal(await page.getByLabel("Password").isVisible(), true);
  console.log("PASS public login shell");

  if (!email || !password) {
    console.log("SKIP authenticated workflow: set E2E_EMAIL and E2E_PASSWORD for a dedicated company-admin test account.");
  } else {
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.includes("auth"), { timeout: 30_000 });
    await textVisible("Dashboard");
    if (expectedCompany) await textVisible(expectedCompany);
    console.log("PASS authenticated dashboard");

    await page.goto(`${baseUrl}/new-project`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "New Project", exact: true }).waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await page.getByLabel("Project Reference").inputValue(), "");
    assert.equal(await page.getByLabel("Client").inputValue(), "");
    console.log("PASS clean new-project state");

    const reference = `E2E-${Date.now()}`;
    await page.getByRole("button", { name: /2\. Project/ }).click();
    await page.getByLabel("Project Reference").fill(reference);
    await page.getByLabel("Client").fill("Automated Browser Test");
    await page.getByRole("button", { name: "Save Draft", exact: true }).first().click();
    await page.waitForURL(/\/projects\//, { timeout: 30_000 });
    const projectId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop() || "");
    assert.ok(projectId);
    await textVisible(reference);
    console.log("PASS project save");

    await page.getByRole("button", { name: "Continue Costing" }).click();
    await page.waitForURL(/\/new-project\//, { timeout: 20_000 });
    await page.getByRole("button", { name: /2\. Project/ }).click();
    assert.equal(await page.getByLabel("Project Reference").inputValue(), reference);
    assert.equal(await page.getByLabel("Client").inputValue(), "Automated Browser Test");
    console.log("PASS saved draft reload");

    await page.goto(`${baseUrl}/projects/${encodeURIComponent(projectId)}`, { waitUntil: "domcontentloaded" });
    const recycleButton = page.getByRole("button", { name: "Move to Recycle Bin" });
    if (await recycleButton.isVisible()) {
      await recycleButton.click();
      await page.getByLabel("Reason").fill("Automated browser-test cleanup");
      await page.getByLabel("Project reference").fill(reference);
      await page.getByRole("button", { name: "Move to Recycle Bin", exact: true }).last().click();
      await page.waitForURL(/\/project-search/, { timeout: 20_000 });
      console.log("PASS reversible project archive");
    } else {
      console.log("SKIP archive cleanup: test account does not have project-delete permission.");
    }
  }
} finally {
  await browser.close();
}
