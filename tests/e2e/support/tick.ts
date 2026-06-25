import { expect, type Page } from "@playwright/test";
import { E2E } from "./env";

/** Drive the real engine the way Vercel Cron does — POST /api/mime/tick with the
 *  CRON_SECRET bearer (set in playwright.config webServer.env). Shared by the
 *  formation + occurrence FSM e2e. */
export async function tickEngine(page: Page) {
  const res = await page.request.post(`${E2E.appBaseUrl}/api/mime/tick`, {
    headers: { authorization: `Bearer ${E2E.cronSecret}` },
  });
  expect(res.ok(), `tick failed: ${res.status()}`).toBeTruthy();
}
