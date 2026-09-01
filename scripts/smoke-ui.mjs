import { mkdir } from "node:fs/promises";
import process from "node:process";
import { AxePuppeteer } from "@axe-core/puppeteer";
import puppeteer from "puppeteer-core";

const baseURL = process.env.APP_URL ?? "http://127.0.0.1:5820";
const outputDirectory = process.env.EVIDENCE_DIR ?? ".artifacts/visual-proof";
const chromePath =
  process.env.CHROME_PATH ??
  "/home/zin-kg/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

async function waitUntilReady(page) {
  await page.waitForFunction(() => document.querySelector(".proofbar")?.textContent?.includes("ready"));
}

async function auditAccessibility(page, state) {
  const results = await new AxePuppeteer(page)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  if (results.violations.length) {
    const details = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.flatMap((node) => node.target),
    }));
    throw new Error(`${state} accessibility violations: ${JSON.stringify(details)}`);
  }
  return { state, violations: 0, passes: results.passes.length };
}

async function waitForTool(page, name) {
  await page.waitForFunction(async (toolName) => {
    const tools = await document.modelContext?.getTools();
    return tools?.some((tool) => tool.name === toolName);
  }, {}, name);
}

async function executeTool(page, name, args = {}) {
  await waitForTool(page, name);
  return page.evaluate(async ({ toolName, input }) => {
    const modelContext = document.modelContext;
    if (!modelContext) throw new Error("WebMCP is not available in the proof browser.");
    const tool = (await modelContext.getTools()).find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`WebMCP tool not found: ${toolName}`);
    return modelContext.executeTool(tool, JSON.stringify(input));
  }, { toolName: name, input: args });
}

async function driveAgentToReview(page) {
  await waitUntilReady(page);
  await executeTool(page, "set_prescription", { prescription: "atorvastatin", selected: true });
  await executeTool(page, "set_prescription", { prescription: "lisinopril", selected: true });
  await executeTool(page, "go_to_next_step");
  await executeTool(page, "set_pharmacy", { pharmacy: "Marmora" });
  await executeTool(page, "go_to_next_step");
  const readBack = await executeTool(page, "review_order");
  if (!readBack.includes("Atorvastatin") || !readBack.includes("Marmora")) {
    throw new Error(`Agent read-back was incomplete: ${readBack}`);
  }
  await page.waitForSelector(".submit");

  const reviewToolNames = await page.evaluate(async () =>
    (await document.modelContext?.getTools())?.map((tool) => tool.name) ?? [],
  );
  if (reviewToolNames.includes("go_to_next_step")) {
    throw new Error("go_to_next_step remained registered at the authoritative review boundary.");
  }
  const bypassState = await page.$eval(".flow", (element) => element.textContent ?? "");
  if (!bypassState.includes("Hear it. Confirm it. Then commit.") || bypassState.includes("Refill complete")) {
    throw new Error("The review state incorrectly displayed authoritative completion.");
  }
  process.stdout.write("Review navigation capability retired before authoritative completion.\n");

  const unconfirmedResult = await executeTool(page, "submit_refill", { confirmed: false });
  if (!unconfirmedResult.includes("confirmation is required") || !unconfirmedResult.includes("Nothing was submitted")) {
    throw new Error(`Unconfirmed agent submit did not fail closed: ${unconfirmedResult}`);
  }
  process.stdout.write("Unconfirmed agent submission failed closed with no write.\n");
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
  const accessibility = [];
  const [stalePage] = await browser.pages();
  stalePage.setDefaultTimeout(10_000);
  stalePage.on("pageerror", (error) => process.stderr.write(`Browser error: ${error.message}\n`));
  await stalePage.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await stalePage.goto(baseURL, { waitUntil: "domcontentloaded" });
  await waitUntilReady(stalePage);
  accessibility.push(await auditAccessibility(stalePage, "initial"));
  await driveAgentToReview(stalePage);
  await waitForTool(stalePage, "submit_refill");
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
  accessibility.push(await auditAccessibility(stalePage, "review"));
  await stalePage.screenshot({ path: `${outputDirectory}/review.png`, fullPage: true });
  process.stdout.write("WebMCP agent staged and read back the current review.\n");

  const sessionId = new URL(stalePage.url()).searchParams.get("session");
  if (!sessionId) throw new Error("The app did not create a shareable synthetic session URL.");
  const orderURL = `${baseURL}/api/order?session=${encodeURIComponent(sessionId)}`;
  const current = await fetch(orderURL).then((response) => response.json());
  const competingResponse = await fetch(orderURL, {
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

  const staleResult = await executeTool(stalePage, "submit_refill", { confirmed: true });
  if (!staleResult.includes("stale") || !staleResult.includes("No write")) {
    throw new Error(`Agent did not receive the stale no-write result: ${staleResult}`);
  }
  await stalePage.waitForSelector(".conflict");
  const conflictText = await stalePage.$eval(".conflict", (element) => element.textContent ?? "");
  if (!conflictText.includes("FAIL-CLOSED") || !conflictText.includes("Nothing was submitted")) {
    throw new Error(`Conflict proof copy is incomplete: ${conflictText}`);
  }
  accessibility.push(await auditAccessibility(stalePage, "stale-conflict"));
  await stalePage.screenshot({ path: `${outputDirectory}/stale-conflict.png`, fullPage: true });
  process.stdout.write("Second session failed closed as stale.\n");

  await executeTool(stalePage, "reload_current_record");
  await stalePage.waitForSelector(".done");
  const recoveredText = await stalePage.$eval(".flow", (element) => element.textContent ?? "");
  if (!recoveredText.includes("Current record loaded")) {
    throw new Error("The stale session did not visibly recover to the current record.");
  }
  accessibility.push(await auditAccessibility(stalePage, "recovered"));
  await stalePage.screenshot({ path: `${outputDirectory}/recovered.png`, fullPage: true });
  process.stdout.write("Stale session recovered to the current record.\n");

  await stalePage.click(".done button");
  await stalePage.waitForFunction(
    (previousSession) => new URL(window.location.href).searchParams.get("session") !== previousSession,
    {},
    sessionId,
  );
  await waitUntilReady(stalePage);
  const freshSessionId = new URL(stalePage.url()).searchParams.get("session");
  const freshText = await stalePage.$eval(".flow", (element) => element.textContent ?? "");
  if (!freshSessionId || !freshText.includes("Which prescriptions should we refill?")) {
    throw new Error("Fresh synthetic demo did not open an isolated initial record.");
  }
  accessibility.push(await auditAccessibility(stalePage, "fresh-session"));
  await stalePage.screenshot({ path: `${outputDirectory}/fresh-session.png`, fullPage: true });
  process.stdout.write("Fresh synthetic session opened without deleting the prior receipt.\n");

  const eligibleCheckboxes = await stalePage.$$("input[type=checkbox]:not(:disabled)");
  if (eligibleCheckboxes.length < 2) throw new Error("Manual fallback did not expose eligible prescriptions.");
  await eligibleCheckboxes[0].click();
  await eligibleCheckboxes[1].click();
  await stalePage.click(".nav .primary");
  await stalePage.waitForSelector("input[type=radio]");
  await stalePage.click("input[type=radio]");
  await stalePage.click(".nav .primary");
  await stalePage.waitForSelector(".submit");
  await stalePage.click(".submit");
  await stalePage.waitForSelector(".done");
  const manualConfirmation = await stalePage.$eval(".done", (element) => element.textContent ?? "");
  if (!manualConfirmation.includes("Confirmation RX-")) {
    throw new Error(`Manual fallback did not receive an authoritative receipt: ${manualConfirmation}`);
  }
  process.stdout.write("Manual confirmation path committed with an authoritative receipt.\n");

  process.stdout.write(
    `${JSON.stringify({
      status: "passed",
      baseURL,
      sessionId,
      freshSessionId,
      proof: "WebMCP-executed refill → competing commit → agent stale 409 → WebMCP recovery",
      webMcp,
      accessibility,
      screenshots: ["review.png", "stale-conflict.png", "recovered.png", "fresh-session.png"],
    }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
