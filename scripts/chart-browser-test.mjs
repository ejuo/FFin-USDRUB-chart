import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.TEST_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const consoleMessages = [];
const pageErrors = [];
let diagnostic = {};

page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));

try {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 10_000 });
      if (response?.ok()) break;
    } catch (error) {
      if (attempt === 29) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  await page.waitForSelector("#chart .capture", { state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => document.querySelectorAll("#chart .series-line").length > 0, null, { timeout: 15_000 });

  const capture = page.locator("#chart .capture");
  await capture.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const box = await capture.boundingBox();
  if (!box) throw new Error("Capture rectangle has no bounding box");

  const targetX = box.x + box.width * 0.52;
  const targetY = box.y + box.height * 0.48;
  const hitBeforeMove = await page.evaluate(({ x, y }) => {
    const node = document.elementFromPoint(x, y);
    return node ? `${node.tagName.toLowerCase()}#${node.id}.${node.getAttribute("class") || ""}` : null;
  }, { x: targetX, y: targetY });

  await page.mouse.move(targetX, targetY, { steps: 6 });
  await page.waitForTimeout(450);

  const hoverState = await page.evaluate(({ x, y }) => {
    const layer = document.querySelector("#hover");
    const tooltip = document.querySelector("#tooltip");
    const inspector = document.querySelector("#selected-time");
    const captureElement = document.querySelector("#chart .capture");
    const empty = document.querySelector("#empty");
    const hit = document.elementFromPoint(x, y);
    return {
      layerClass: layer?.getAttribute("class"),
      layerAriaHidden: layer?.getAttribute("aria-hidden"),
      tooltipClass: tooltip?.getAttribute("class"),
      tooltipAriaHidden: tooltip?.getAttribute("aria-hidden"),
      tooltipText: tooltip?.textContent?.replace(/\s+/g, " ").trim(),
      inspectorText: inspector?.textContent?.trim(),
      capturePointerEvents: captureElement ? getComputedStyle(captureElement).pointerEvents : null,
      emptyHidden: empty?.hidden,
      emptyDisplay: empty ? getComputedStyle(empty).display : null,
      emptyPointerEvents: empty ? getComputedStyle(empty).pointerEvents : null,
      hitAfterMove: hit ? `${hit.tagName.toLowerCase()}#${hit.id}.${hit.getAttribute("class") || ""}` : null
    };
  }, { x: targetX, y: targetY });

  diagnostic = { baseUrl, targetX, targetY, hitBeforeMove, hoverState, pageErrors, consoleMessages };
  console.log("Browser diagnostic:", JSON.stringify(diagnostic, null, 2));
  if (pageErrors.length) throw new Error(`Browser page errors:\n${pageErrors.join("\n\n")}`);
  if (hoverState.layerAriaHidden !== "false" || hoverState.layerClass?.includes("is-hidden")) {
    throw new Error(`Hover SVG layer did not become visible: ${JSON.stringify(hoverState)}`);
  }
  if (hoverState.tooltipAriaHidden !== "false" || !hoverState.tooltipClass?.includes("is-visible")) {
    throw new Error(`Tooltip did not become visible: ${JSON.stringify(hoverState)}`);
  }
  if (!/Freedom|USDRUBF/.test(hoverState.tooltipText || "")) {
    throw new Error(`Tooltip has no rate values: ${JSON.stringify(hoverState)}`);
  }
  if (!hoverState.inspectorText || /Выберите точку/.test(hoverState.inspectorText)) {
    throw new Error(`Inspector was not updated: ${JSON.stringify(hoverState)}`);
  }
  if (hoverState.emptyHidden && hoverState.emptyDisplay !== "none") {
    throw new Error(`Hidden empty-state overlay is still displayed: ${JSON.stringify(hoverState)}`);
  }

  await page.screenshot({ path: "chart-hover-e2e.png", fullPage: true });
  console.log("Real browser hover test passed");
} catch (error) {
  diagnostic.error = error.stack || String(error);
  console.error(error.stack || error);
  console.error("Console messages:\n" + consoleMessages.join("\n"));
  await page.screenshot({ path: "chart-hover-e2e-failure.png", fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile("chart-hover-result.json", `${JSON.stringify(diagnostic, null, 2)}\n`, "utf8").catch(() => {});
  await browser.close();
}
