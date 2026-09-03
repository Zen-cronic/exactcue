import { execFile } from "node:child_process";
import { mkdir, unlink } from "node:fs/promises";
import process from "node:process";
import { promisify } from "node:util";
import puppeteer from "puppeteer-core";

const appURL = process.env.APP_URL ?? "https://exactcue-webmcp.netlify.app";
const outputPath = process.env.DEMO_CAPTURE ?? "../submission/exactcue/video/exactcue-proof.mp4";
const chromePath =
  process.env.CHROME_PATH ??
  "/home/zin-kg/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const execFileAsync = promisify(execFile);
const recorderPath = outputPath.replace(/\.mp4$/i, ".webm");

async function waitUntilReady(page) {
  await page.waitForFunction(() => document.querySelector(".proof-panel")?.textContent?.toLowerCase().includes("ready"));
  await pause(650);
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
    if (!modelContext) throw new Error("WebMCP is not available in the capture browser.");
    const tool = (await modelContext.getTools()).find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`WebMCP tool not found: ${toolName}`);
    return modelContext.executeTool(tool, JSON.stringify(input));
  }, { toolName: name, input: args });
}

async function readCurrent(page) {
  const sessionId = new URL(page.url()).searchParams.get("session");
  if (!sessionId) throw new Error("ExactCue did not create a demo session URL.");
  const orderURL = `${appURL}/api/order?session=${encodeURIComponent(sessionId)}`;
  const response = await fetch(orderURL);
  if (!response.ok) throw new Error(`Could not read the demo order (${response.status}).`);
  return { sessionId, orderURL, current: await response.json() };
}

async function competingCommit(page) {
  const { orderURL, current } = await readCurrent(page);
  const response = await fetch(orderURL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cueId: "cue-competing-capture",
      expectedVersion: current.order.version,
      expectedEtag: current.etag,
      selectedPrescriptionIds: ["rx-1", "rx-2"],
      chosenPharmacyId: "ph-1",
      confirmed: true,
    }),
  });
  if (response.status !== 200) throw new Error(`Competing commit failed (${response.status}).`);
}

async function stageReview(page) {
  await executeTool(page, "set_prescription", { prescription: "atorvastatin", selected: true });
  await executeTool(page, "set_prescription", { prescription: "lisinopril", selected: true });
  await executeTool(page, "go_to_next_step");
  await executeTool(page, "set_pharmacy", { pharmacy: "Marmora" });
  await executeTool(page, "go_to_next_step");
  await executeTool(page, "review_order");
  await page.waitForSelector(".review-scene");
}

await mkdir(outputPath.slice(0, outputPath.lastIndexOf("/")), { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  timeout: 15_000,
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

try {
  const [page] = await browser.pages();
  page.setDefaultTimeout(15_000);
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  await page.goto(appURL, { waitUntil: "networkidle0" });
  await waitUntilReady(page);

  // Pre-stage the real kill shot so it is the recording's first frame.
  await stageReview(page);
  await competingCommit(page);
  await executeTool(page, "submit_refill", { confirmed: true });
  await page.waitForSelector(".conflict-banner");

  const recorder = await page.screencast({
    path: recorderPath,
    format: "webm",
    fps: 30,
    quality: 20,
  });

  await pause(5000);
  await page.click(".conflict-banner .primary");
  await page.waitForSelector(".done-scene");
  await pause(5000);

  await recorder.stop();
  await execFileAsync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    recorderPath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
  await unlink(recorderPath);
  process.stdout.write(`${JSON.stringify({ status: "captured", appURL, outputPath }, null, 2)}\n`);
} finally {
  await browser.close();
}
