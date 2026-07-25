const NS = "http://www.w3.org/2000/svg";
const ZONE = "Asia/Almaty";
const ZONE_LABEL = "Алматы / Екатеринбург, UTC+5";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ZONE_OFFSET = 5 * HOUR;
const MARKET_MAX_AGE = 150 * 60_000;

const state = {
  data: null,
  hidden: new Set(),
  start: null,
  end: null,
  rangeKey: "14d",
  pinned: false,
  selectedMs: null,
  chartContext: null
};

const $ = (selector) => document.querySelector(selector);
const el = {
  chart: $("#chart"),
  wrap: $("#chart-wrap"),
  tooltip: $("#tooltip"),
  empty: $("#empty"),
  status: $("#status"),
  period: $("#period"),
  availability: $("#availability"),
  body: $("#rates-body"),
  stamp: $("#stamp"),
  customForm: $("#custom-range"),
  rangeFrom: $("#range-from"),
  rangeTo: $("#range-to"),
  rangeError: $("#range-error"),
  buy: $("#metric-buy"),
  buyMeta: $("#metric-buy-meta"),
  sell: $("#metric-sell"),
  sellMeta: $("#metric-sell-meta"),
  market: $("#metric-market"),
  marketMeta: $("#metric-market-meta"),
  spread: $("#metric-spread"),
  spreadMeta: $("#metric-spread-meta"),
  buyGap: $("#metric-buy-gap"),
  buyGapMeta: $("#metric-buy-gap-meta"),
  sellGap: $("#metric-sell-gap"),
  sellGapMeta: $("#metric-sell-gap-meta"),
  selectedTime: $("#selected-time"),
  selectedSource: $("#selected-source"),
  inspectBuy: $("#inspect-buy"),
  inspectSell: $("#inspect-sell"),
  inspectMarket: $("#inspect-market"),
  inspectBuyGap: $("#inspect-buy-gap"),
  inspectSellGap: $("#inspect-sell-gap"),
  inspectSpread: $("#inspect-spread"),
  bestBuyGap: $("#best-buy-gap"),
  bestBuyTime: $("#best-buy-time"),
  bestBuyDetail: $("#best-buy-detail"),
  bestBuyList: $("#best-buy-list"),
  bestSellGap: $("#best-sell-gap"),
  bestSellTime: $("#best-sell-time"),
  bestSellDetail: $("#best-sell-detail"),
  bestSellList: $("#best-sell-list")
};

const rate = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" });
const percent = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" });
const dateOnly = new Intl.DateTimeFormat("ru-RU", { timeZone: ZONE, day: "numeric", month: "short", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: ZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
});
const shortDateTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: ZONE, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
});
const clock = new Intl.DateTimeFormat("ru-RU", { timeZone: ZONE, hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("ru-RU", { timeZone: ZONE, day: "numeric", month: "short" });

async function init() {
  bindControls();
  try {
    const response = await fetch("./data/rates.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = normalizeData(await response.json());
    validate(state.data);
    initializeRange();
    render();
    updateStatus();
  } catch (error) {
    console.error(error);
    setStatus(`Не удалось загрузить данные: ${error.message}`, "error");
    el.body.innerHTML = '<tr><td colspan="7" class="placeholder">Данные недоступны</td></tr>';
    el.empty.hidden = false;
  }
}

function bindControls() {
  document.querySelectorAll(".range-button[data-duration-hours]").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button));
  });

  const customButton = $(".range-button[data-custom]");
  customButton?.addEventListener("click", () => {
    state.rangeKey = "custom";
    setActiveRangeButton(customButton);
    el.customForm.hidden = false;
    syncRangeInputs();
    el.rangeFrom.focus();
  });

  el.customForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const start = parseZoneInput(el.rangeFrom.value);
    const end = parseZoneInput(el.rangeTo.value);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return setRangeError("Укажите обе даты и время.");
    if (start >= end) return setRangeError("Начало периода должно быть раньше окончания.");
    setRangeError("");
    state.start = start;
    state.end = end;
    state.rangeKey = "custom";
    state.pinned = false;
    state.selectedMs = null;
    render();
  });

  document.querySelectorAll(".legend button[data-series]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.series;
      state.hidden.has(key) ? state.hidden.delete(key) : state.hidden.add(key);
      button.setAttribute("aria-pressed", String(!state.hidden.has(key)));
      renderChart();
    });
  });

  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => state.data && renderChart());
  }).observe(el.wrap);
}

function applyPreset(button) {
  const duration = Number(button.dataset.durationHours) * HOUR;
  const end = rangeAnchorTimestamp(state.data) + 60_000;
  state.end = end;
  state.start = end - duration;
  state.rangeKey = button.dataset.range || `${button.dataset.durationHours}h`;
  state.pinned = false;
  state.selectedMs = null;
  setActiveRangeButton(button);
  el.customForm.hidden = true;
  setRangeError("");
  render();
}

function setActiveRangeButton(active) {
  document.querySelectorAll(".range-button").forEach((button) => {
    const selected = button === active;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function setRangeError(message) {
  el.rangeError.textContent = message;
  el.rangeError.hidden = !message;
}

function initializeRange() {
  const latest = rangeAnchorTimestamp(state.data) + 60_000;
  state.end = latest;
  state.start = latest - 14 * DAY;
  const active = document.querySelector('.range-button[data-range="14d"]');
  if (active) setActiveRangeButton(active);
  syncRangeInputs();
}

function syncRangeInputs() {
  if (!state.data) return;
  const min = earliestTimestamp(state.data);
  const max = rangeAnchorTimestamp(state.data) + HOUR;
  el.rangeFrom.min = toZoneInput(min);
  el.rangeFrom.max = toZoneInput(max);
  el.rangeTo.min = toZoneInput(min);
  el.rangeTo.max = toZoneInput(max);
  el.rangeFrom.value = toZoneInput(state.start);
  el.rangeTo.value = toZoneInput(state.end);
}

function normalizeData(raw) {
  const freedom = (raw.freedom ?? []).map(normalizeFreedom).filter(Boolean).sort(byMs);
  const market = (raw.market ?? []).map(normalizeMarket).filter(Boolean).sort(byMs);
  let comparisons = (raw.comparisons ?? []).map(normalizeComparison).filter(Boolean).sort(byMs);
  if (!comparisons.length) comparisons = deriveComparisons(freedom, market);
  return {
    schemaVersion: Number(raw.schemaVersion || 1),
    generatedAt: raw.generatedAt || null,
    meta: raw.meta || {},
    freedom,
    market,
    comparisons
  };
}

function normalizeFreedom(point) {
  const raw = point.timestamp || point.observedAt || point.capturedAt || (point.date ? `${point.date}T12:00:00+05:00` : null);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return {
    ...point,
    timestamp: new Date(ms).toISOString(),
    ms,
    sourceUpdatedAt: point.sourceUpdatedAt || point.capturedAt || null,
    resolution: point.resolution || (point.capturedAt ? "intraday" : "daily")
  };
}

function normalizeMarket(point) {
  const raw = point.timestamp || (point.date ? `${point.date}T18:00:00+03:00` : null);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms) || !Number.isFinite(Number(point.close))) return null;
  return {
    ...point,
    timestamp: new Date(ms).toISOString(),
    ms,
    close: Number(point.close),
    resolution: point.resolution || (point.date ? "daily" : "hour")
  };
}

function normalizeComparison(point) {
  const ms = Date.parse(point.timestamp);
  if (!Number.isFinite(ms)) return null;
  const buy = Number(point.buy);
  const sell = Number(point.sell);
  const market = Number(point.market);
  if (![buy, sell, market].every(Number.isFinite)) return null;
  return { ...point, timestamp: new Date(ms).toISOString(), ms, buy, sell, market };
}

function deriveComparisons(freedom, market) {
  const result = [];
  let marketIndex = 0;
  for (const bank of freedom) {
    if (bank.resolution !== "intraday") continue;
    while (marketIndex + 1 < market.length && market[marketIndex + 1].ms <= bank.ms) marketIndex += 1;
    const quote = market[marketIndex];
    if (!quote || quote.ms > bank.ms || bank.ms - quote.ms > MARKET_MAX_AGE || quote.resolution === "daily") continue;
    result.push({
      timestamp: bank.timestamp,
      ms: bank.ms,
      freedomTimestamp: bank.timestamp,
      sourceUpdatedAt: bank.sourceUpdatedAt || null,
      marketTimestamp: quote.timestamp,
      marketAgeMinutes: Math.round((bank.ms - quote.ms) / 60_000),
      buy: bank.buy,
      sell: bank.sell,
      market: quote.close,
      method: bank.method,
      freedomProvider: bank.provider,
      marketProvider: quote.provider
    });
  }
  return result;
}

function validate(data) {
  if (!data || !Array.isArray(data.freedom) || !Array.isArray(data.market) || !Array.isArray(data.comparisons)) {
    throw new Error("неверный формат rates.json");
  }
}
