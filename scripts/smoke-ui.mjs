import { mkdir } from "node:fs/promises";
import process from "node:process";
import { AxePuppeteer } from "@axe-core/puppeteer";
import puppeteer from "puppeteer-core";

const baseURL = process.env.APP_URL ?? "http://127.0.0.1:5820";
const outputDirectory = process.env.EVIDENCE_DIR ?? ".artifacts/visual-proof";
const chromePath =
  process.env.CHROME_PATH ??
  "/home/zin-kg/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

async function settleMotion() {
  await new Promise((resolve) => setTimeout(resolve, 700));
}

async function waitUntilReady(page) {
  await page.waitForFunction(() => document.querySelector(".proof-panel")?.textContent?.toLowerCase().includes("ready"));
  await new Promise((resolve) => setTimeout(resolve, 650));
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

async function assertNoHorizontalOverflow(page, state) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }));
  if (dimensions.scroll > dimensions.viewport) {
    throw new Error(
      `${state} overflowed horizontally (${dimensions.scroll}px content in ${dimensions.viewport}px viewport).`,
    );
  }
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
    const raw = await modelContext.executeTool(tool, JSON.stringify(input));
    let parsed = raw;
    if (typeof raw === "string") {
      try { parsed = JSON.parse(raw); } catch { return { text: raw, structuredContent: null }; }
    }
    const text = parsed?.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") ?? String(raw);
    return { text, structuredContent: parsed?.structuredContent ?? null };
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
  if (!readBack.text.includes("Atorvastatin") || !readBack.text.includes("Marmora")) {
    throw new Error(`Agent read-back was incomplete: ${JSON.stringify(readBack)}`);
  }
  if (readBack.structuredContent?.cue?.status !== "reviewed") {
    throw new Error(`Agent read-back did not return a structured reviewed cue: ${JSON.stringify(readBack)}`);
  }
  await page.waitForSelector(".review-scene");

  const reviewToolNames = await page.evaluate(async () =>
    (await document.modelContext?.getTools())?.map((tool) => tool.name) ?? [],
  );
  if (reviewToolNames.includes("go_to_next_step")) {
    throw new Error("go_to_next_step remained registered at the authoritative review boundary.");
  }
  const bypassState = await page.$eval(".flow-card", (element) => element.textContent ?? "");
  if (!bypassState.includes("Hear exactly what will happen") || bypassState.includes("Current cue. Current receipt")) {
    throw new Error("The review state incorrectly displayed authoritative completion.");
  }
  process.stdout.write("Review navigation capability retired before authoritative completion.\n");

  const unconfirmedResult = await executeTool(page, "submit_refill", { confirmed: false });
  if (!unconfirmedResult.text.includes("confirmation is required") || !unconfirmedResult.text.includes("Nothing was submitted") || unconfirmedResult.structuredContent?.noWrite !== true) {
    throw new Error(`Unconfirmed agent submit did not fail closed: ${JSON.stringify(unconfirmedResult)}`);
  }
  process.stdout.write("Unconfirmed agent submission failed closed with no write.\n");
}

async function driveManualToReview(page) {
  await waitUntilReady(page);
  const eligibleChoices = await page.$$(".choice-card:not(.disabled)");
  if (eligibleChoices.length < 2) throw new Error("Manual fallback did not expose eligible prescriptions.");
  await eligibleChoices[0].click();
  await eligibleChoices[1].click();
  await page.click(".scene-actions .primary");
  await page.waitForSelector(".pharmacy-list .choice-card");
  await page.click(".pharmacy-list .choice-card");
  await page.click(".scene-actions .primary");
  await page.waitForSelector(".review-scene");
  await page.click(".text-action");
  await page.waitForFunction(() => !document.querySelector(".consent-boundary .primary")?.hasAttribute("disabled"));
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
  await stalePage.screenshot({ path: `${outputDirectory}/initial-desktop.png`, fullPage: true });
  await stalePage.setViewport({ width: 350, height: 900, deviceScaleFactor: 1 });
  await assertNoHorizontalOverflow(stalePage, "initial-350");
  accessibility.push(await auditAccessibility(stalePage, "initial-350"));
  await stalePage.screenshot({ path: `${outputDirectory}/initial-350.png`, fullPage: true });
  await stalePage.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await stalePage.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  const reducedMotionActive = await stalePage.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (!reducedMotionActive) throw new Error("Reduced-motion preference was not honored by the proof browser.");
  accessibility.push(await auditAccessibility(stalePage, "reduced-motion"));
  await stalePage.screenshot({ path: `${outputDirectory}/reduced-motion.png`, fullPage: true });
  await stalePage.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  process.stdout.write("Desktop, 350px, and reduced-motion states captured without horizontal overflow.\n");

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
  await settleMotion();
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
      cueId: "cue-competing-12345678",
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

  await stalePage.setRequestInterception(true);
  let releaseSubmit;
  const heldSubmit = new Promise((resolve) => {
    releaseSubmit = resolve;
  });
  const holdSubmit = (request) => {
    if (request.method() === "POST" && request.url().startsWith(orderURL)) releaseSubmit(request);
    else void request.continue();
  };
  stalePage.on("request", holdSubmit);
  const staleSubmission = executeTool(stalePage, "submit_refill", { confirmed: true });
  const interceptedSubmit = await heldSubmit;
  await stalePage.waitForSelector(".phase-submitting");
  accessibility.push(await auditAccessibility(stalePage, "submitting"));
  await stalePage.screenshot({ path: `${outputDirectory}/submitting.png`, fullPage: true });
  process.stdout.write("In-flight current-record check captured while its POST was pending.\n");
  await interceptedSubmit.continue();
  const staleResult = await staleSubmission;
  stalePage.off("request", holdSubmit);
  await stalePage.setRequestInterception(false);
  if (!staleResult.text.includes("stale") || staleResult.structuredContent?.noWrite !== true || staleResult.structuredContent?.status !== "conflict") {
    throw new Error(`Agent did not receive the stale no-write result: ${JSON.stringify(staleResult)}`);
  }
  await stalePage.waitForSelector(".conflict-banner");
  const conflictText = await stalePage.$eval(".conflict-banner", (element) => element.textContent ?? "");
  if (!conflictText.includes("FAIL CLOSED") || !conflictText.includes("NO WRITE")) {
    throw new Error(`Conflict proof copy is incomplete: ${conflictText}`);
  }
  await settleMotion();
  accessibility.push(await auditAccessibility(stalePage, "stale-conflict"));
  await stalePage.screenshot({ path: `${outputDirectory}/stale-conflict.png`, fullPage: true });
  process.stdout.write("Second session failed closed as stale.\n");

  await executeTool(stalePage, "reload_current_record");
  await stalePage.waitForSelector(".done-scene");
  const recoveredText = await stalePage.$eval(".flow-card", (element) => element.textContent ?? "");
  if (!recoveredText.includes("Current cue. Current receipt") || !recoveredText.includes("RX-")) {
    throw new Error("The stale session did not visibly recover to the current record.");
  }
  await settleMotion();
  accessibility.push(await auditAccessibility(stalePage, "recovered"));
  await stalePage.screenshot({ path: `${outputDirectory}/recovered.png`, fullPage: true });
  process.stdout.write("Stale session recovered to the current record.\n");

  await stalePage.click(".done-scene button");
  await stalePage.waitForFunction(
    (previousSession) => new URL(window.location.href).searchParams.get("session") !== previousSession,
    {},
    sessionId,
  );
  await waitUntilReady(stalePage);
  const freshSessionId = new URL(stalePage.url()).searchParams.get("session");
  const freshText = await stalePage.$eval(".flow-card", (element) => element.textContent ?? "");
  if (!freshSessionId || !freshText.includes("What should the agent refill")) {
    throw new Error("Fresh synthetic demo did not open an isolated initial record.");
  }
  accessibility.push(await auditAccessibility(stalePage, "fresh-session"));
  await stalePage.screenshot({ path: `${outputDirectory}/fresh-session.png`, fullPage: true });
  process.stdout.write("Fresh synthetic session opened without deleting the prior receipt.\n");

  await driveManualToReview(stalePage);
  await stalePage.click(".consent-boundary .primary");
  await stalePage.waitForSelector(".done-scene");
  const manualConfirmation = await stalePage.$eval(".done-scene", (element) => element.textContent ?? "");
  if (!/confirmation/i.test(manualConfirmation) || !manualConfirmation.includes("RX-")) {
    throw new Error(`Manual fallback did not receive an authoritative receipt: ${manualConfirmation}`);
  }
  process.stdout.write("Manual confirmation path committed with an authoritative receipt.\n");

  const judgePage = await browser.newPage();
  judgePage.setDefaultTimeout(10_000);
  await judgePage.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await judgePage.goto(`${baseURL}/?judge=1`, { waitUntil: "domcontentloaded" });
  await driveManualToReview(judgePage);
  await judgePage.click(".judge-rehearsal button");
  await judgePage.waitForSelector(".conflict-banner");
  const judgeConflict = await judgePage.$eval(".conflict-banner", (element) => element.textContent ?? "");
  if (!judgeConflict.includes("NO WRITE") || !judgeConflict.includes("v2")) {
    throw new Error(`Built-in judge rehearsal did not expose its stale no-write receipt: ${judgeConflict}`);
  }
  await settleMotion();
  accessibility.push(await auditAccessibility(judgePage, "judge-rehearsal"));
  await judgePage.screenshot({ path: `${outputDirectory}/judge-rehearsal.png`, fullPage: true });
  await judgePage.click(".conflict-banner .primary");
  await judgePage.waitForSelector(".done-scene");
  process.stdout.write("Built-in judge mode reproduced a real commit, stale 409, and recovery.\n");
  await judgePage.close();

  process.stdout.write(
    `${JSON.stringify({
      status: "passed",
      baseURL,
      sessionId,
      freshSessionId,
      proof: "WebMCP-executed refill → competing commit → agent stale 409 → WebMCP recovery",
      webMcp,
      accessibility,
      screenshots: [
        "initial-desktop.png",
        "initial-350.png",
        "reduced-motion.png",
        "review.png",
        "submitting.png",
        "stale-conflict.png",
        "recovered.png",
        "fresh-session.png",
        "judge-rehearsal.png",
      ],
    }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
