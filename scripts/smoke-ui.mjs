import { mkdir } from "node:fs/promises";
import process from "node:process";
import puppeteer from "puppeteer-core";

const baseURL = process.env.APP_URL ?? "http://127.0.0.1:5820";
const outputDirectory = process.env.EVIDENCE_DIR ?? ".artifacts/visual-proof";
const chromePath =
  process.env.CHROME_PATH ??
  "/home/zin-kg/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

async function waitUntilReady(page) {
  await page.waitForFunction(() => document.querySelector(".proofbar")?.textContent?.includes("ready"));
}

async function stageReview(page) {
  await waitUntilReady(page);
  const eligible = await page.$$("input[type=checkbox]:not(:disabled)");
  if (eligible.length < 2) throw new Error("Expected two eligible prescriptions.");
  await eligible[0].click();
  await eligible[1].click();
  await page.click(".nav .primary");
  await page.waitForSelector('input[type="radio"]');
  await page.click('input[type="radio"]');
  await page.click(".nav .primary");
  await page.waitForSelector(".submit");
}

await mkdir(outputDirectory, { recursive: true });
process.stdout.write("Launching headless Chrome.\n");
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  dumpio: true,
  timeout: 10_000,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--no-first-run",
  ],
});
process.stdout.write("Headless Chrome launched.\n");

try {
  const [stalePage] = await browser.pages();
  stalePage.setDefaultTimeout(10_000);
  stalePage.on("pageerror", (error) => process.stderr.write(`Browser error: ${error.message}\n`));
  await stalePage.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await stalePage.goto(baseURL, { waitUntil: "domcontentloaded" });
  await stageReview(stalePage);
  await stalePage.waitForFunction(async () => {
    const tools = await document.modelContext?.getTools();
    return tools?.some((tool) => tool.name === "submit_refill");
  });
  const webMcp = await stalePage.evaluate(async () => {
    const modelContext = document.modelContext;
    if (!modelContext) return { supported: false, tools: [] };
    const tools = await modelContext.getTools();
    return { supported: true, tools: tools.map((tool) => tool.name).sort() };
  });
  for (const requiredTool of ["review_order", "submit_refill", "reload_current_record"]) {
    if (!webMcp.tools.includes(requiredTool)) {
      throw new Error(`Review-step WebMCP tool missing: ${requiredTool}`);
    }
  }
  await stalePage.screenshot({ path: `${outputDirectory}/review.png`, fullPage: true });
  process.stdout.write("Browser review staged on the current ETag.\n");

  const current = await fetch(`${baseURL}/api/order`).then((response) => response.json());
  const competingResponse = await fetch(`${baseURL}/api/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedVersion: current.order.version,
      expectedEtag: current.etag,
      selectedPrescriptionIds: ["rx-1", "rx-2"],
      chosenPharmacyId: "ph-1",
      confirmed: true,
    }),
  });
  if (competingResponse.status !== 200) {
    throw new Error(`Competing session did not commit (${competingResponse.status}).`);
  }
  process.stdout.write("Competing session committed against the shared proof server.\n");

  await stalePage.click(".submit");
  await stalePage.waitForSelector(".conflict");
  const conflictText = await stalePage.$eval(".conflict", (element) => element.textContent ?? "");
  if (!conflictText.includes("FAIL-CLOSED") || !conflictText.includes("Nothing was submitted")) {
    throw new Error(`Conflict proof copy is incomplete: ${conflictText}`);
  }
  await stalePage.screenshot({ path: `${outputDirectory}/stale-conflict.png`, fullPage: true });
  process.stdout.write("Second session failed closed as stale.\n");

  await stalePage.click(".conflict button");
  await stalePage.waitForSelector(".done");
  const recoveredText = await stalePage.$eval(".flow", (element) => element.textContent ?? "");
  if (!recoveredText.includes("Current record loaded")) {
    throw new Error("The stale session did not visibly recover to the current record.");
  }
  await stalePage.screenshot({ path: `${outputDirectory}/recovered.png`, fullPage: true });
  process.stdout.write("Stale session recovered to the current record.\n");

  process.stdout.write(
    `${JSON.stringify({
      status: "passed",
      baseURL,
      proof: "browser review + competing session: matching submit → stale 409 → current-record recovery",
      webMcp,
      screenshots: ["review.png", "stale-conflict.png", "recovered.png"],
    }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
