// Browser acceptance journey for the credential-free Northstar demo, in headless Chromium.
//   npm run build && npm run test:browser [-- --shots artifacts/shots]
// Serves the production build from an in-process backend on a temporary data directory.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { startServer } from "../../backend/src/index";

const shotsArg = process.argv.indexOf("--shots");
const shotsDir = shotsArg >= 0 ? path.resolve(process.argv[shotsArg + 1]) : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

function check(cond: unknown, what: string) {
  if (!cond) throw new Error(`Browser journey failed: ${what}`);
  console.log(`ok  ${what}`);
}

async function main() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dl-browser-"));
  const { svc, server, port } = await startServer({ host: "127.0.0.1", port: 0, dataDir, anthropicApiKey: undefined, bosonApiKey: undefined, accessToken: undefined, serveStatic: true });
  const base = `http://127.0.0.1:${port}`;
  // CHROMIUM_PATH lets a machine with a preinstalled browser skip `npx playwright install chromium`.
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors: string[] = [];
  const watch = (p: Page) => {
    p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    p.on("pageerror", (e) => errors.push(String(e)));
  };
  const shot = async (p: Page, name: string) => shotsDir && (await p.screenshot({ path: path.join(shotsDir, `${name}.png`) }));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    watch(page);
    await page.goto(base + "/");
    await page.getByText("Create Northstar demo").click();
    await page.waitForURL(/projects\/prj_/);
    await page.waitForSelector("text=● Live", { timeout: 10000 });
    check(await page.getByText("SYNTHETIC", { exact: false }).first().isVisible(), "demo project is labelled synthetic");
    await shot(page, "01-overview");

    await page.getByRole("link", { name: "Research Plan", exact: true }).click();
    check(await page.getByText("C1", { exact: true }).first().isVisible(), "plan shows source-linked claims");
    await shot(page, "02-plan");

    await page.getByRole("link", { name: "Live Research", exact: true }).click();
    await page.getByRole("button", { name: "Start interview" }).click();
    await page.waitForSelector("text=Advance scripted respondent");
    const advance = async () => {
      await page.getByRole("button", { name: "Advance scripted respondent" }).click();
      await page.waitForTimeout(700);
    };
    await advance(); // consent
    await advance(); // staffing answer, which also covers capacity
    check(await page.getByText(/four hygienist positions short/).first().isVisible(), "expert answer appears in the transcript");
    await page.getByPlaceholder("Message the copilot…").fill("Investigate whether the cancellations were concentrated in specific clinics.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForTimeout(1200);
    await advance(); // cannot answer the network-wide trend
    check(await page.getByText(/Which locations and time periods were affected/).first().isVisible(), "directive becomes a neutral follow-up question");
    await shot(page, "03-live-follow-up");
    await advance();
    await advance(); // last answer: the interview ends gracefully
    await page.waitForTimeout(800);
    await shot(page, "04-live-ended");
    check(await page.getByText(/Ended: controller completed/).first().isVisible(), "interview ends gracefully after coverage is complete");
    await shot(page, "04-live-ended");

    await page.getByRole("link", { name: "Findings", exact: true }).click();
    await page.waitForTimeout(600);
    const causal = page.locator("div.rounded-md.border", { hasText: "Hygienist shortages caused the cancellations" }).first();
    check(await causal.isVisible(), "causal interpretation is shown as a finding");
    await causal.getByRole("button", { name: "Flag overstated interpretation" }).click();
    await causal.locator("textarea").fill("Causation is not established: one operator's account, and the 12% is a single-clinic estimate.");
    await causal.getByPlaceholder(/Clinic-level/).fill("Clinic-level cancellation logs matched to vacancy dates.");
    await causal.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(800);
    check(await causal.getByText(/flagged/i).first().isVisible(), "consultant can flag the finding with next evidence needed");
    await shot(page, "05-findings-flagged");

    await page.getByRole("button", { name: /twelve percent of active hygiene patients/ }).first().click();
    await page.waitForURL(/live\?interview=/);
    await page.waitForTimeout(800);
    const highlighted = await page.locator("mark.cite").first().textContent();
    check(highlighted?.includes("twelve percent"), "citation opens the transcript with the exact span highlighted");
    await shot(page, "06-citation");

    const projectUrl = page.url().replace(/\/live.*$/, "");
    const fresh = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage();
    watch(fresh);
    await fresh.goto(projectUrl);
    await fresh.getByPlaceholder("Message the copilot…").fill("Where were we?");
    await fresh.getByRole("button", { name: "Send", exact: true }).click();
    await fresh.waitForSelector("text=Citations:", { timeout: 10000 });
    check(true, "“Where were we?” answers from saved state in a fresh browser context, with citations");
    await shot(fresh, "07-where-were-we");
    check(errors.length === 0, `no browser console errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    svc.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
