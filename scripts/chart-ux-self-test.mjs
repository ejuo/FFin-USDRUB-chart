import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const interaction = await readFile(new URL("../app-interaction.js", import.meta.url), "utf8");
const chart = await readFile(new URL("../app-chart.js", import.meta.url), "utf8");
const css = await readFile(new URL("../chart.css", import.meta.url), "utf8");

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    if (force === undefined ? !this.values.has(name) : force) this.values.add(name);
    else this.values.delete(name);
    return this.values.has(name);
  }
  contains(name) { return this.values.has(name); }
}

function fakeNode() {
  return {
    classList: new FakeClassList(),
    attributes: new Map([["hidden", ""]]),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); }
  };
}

const tooltip = fakeNode();
const context = vm.createContext({ el: { tooltip }, console });
vm.runInContext(interaction, context, { filename: "app-interaction.js" });

const svg = fakeNode();
context.setSvgVisible(svg, false);
assert.equal(svg.classList.contains("is-hidden"), true);
assert.equal(svg.attributes.get("aria-hidden"), "true");
context.setSvgVisible(svg, true);
assert.equal(svg.classList.contains("is-hidden"), false);
assert.equal(svg.attributes.get("aria-hidden"), "false");

context.setTooltipVisible(true);
assert.equal(tooltip.attributes.has("hidden"), false);
assert.equal(tooltip.classList.contains("is-visible"), true);
assert.equal(tooltip.attributes.get("aria-hidden"), "false");
context.setTooltipVisible(false);
assert.equal(tooltip.classList.contains("is-visible"), false);
assert.equal(tooltip.attributes.get("aria-hidden"), "true");

const laidOut = context.layoutHoverLabels([
  { key: "buy", cy: 100 },
  { key: "sell", cy: 105 },
  { key: "market", cy: 108 }
], 60, 180, 28);
const positions = [...laidOut].sort((a, b) => a.labelY - b.labelY).map((entry) => entry.labelY);
assert.ok(positions[1] - positions[0] >= 28);
assert.ok(positions[2] - positions[1] >= 28);
assert.ok(positions[0] >= 60 && positions[2] <= 180);

assert.doesNotMatch(chart, /id="hover"\s+hidden/);
assert.match(chart, /pointer-events="all"/);
assert.match(interaction, /pointerenter/);
assert.match(css, /\.tooltip\.is-visible/);
assert.match(css, /\.capture\s*\{[^}]*pointer-events:\s*all/s);

console.log("Chart interaction self-test passed");
