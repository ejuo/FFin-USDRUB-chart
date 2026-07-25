const NS = "http://www.w3.org/2000/svg";
const state = { range: 14, hidden: new Set(), data: null, marketLive: false };
const $ = (selector) => document.querySelector(selector);
const el = {
  chart: $("#chart"), wrap: $("#chart-wrap"), tooltip: $("#tooltip"), empty: $("#empty"), status: $("#status"),
  period: $("#period"), body: $("#rates-body"), stamp: $("#stamp"),
  buy: $("#metric-buy"), buyMeta: $("#metric-buy-meta"), sell: $("#metric-sell"), sellMeta: $("#metric-sell-meta"),
  market: $("#metric-market"), marketMeta: $("#metric-market-meta"), delta: $("#metric-delta"), deltaMeta: $("#metric-delta-meta")
};
const rate = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" });
const shortDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

init();

async function init() {
  bindControls();
  try {
    const response = await fetch("./data/rates.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    validate(state.data);
    render();
    setStatus("Снимок загружен. Проверяю свежие свечи Мосбиржи…", "loading");
    await refreshMarket();
  } catch (error) {
    console.error(error);
    setStatus(`Не удалось загрузить данные: ${error.message}`, "error");
    el.body.innerHTML = '<tr><td colspan="5" class="placeholder">Данные недоступны</td></tr>';
    el.empty.hidden = false;
  }
}

function bindControls() {
  document.querySelectorAll(".range-button").forEach((button) => button.addEventListener("click", () => {
    state.range = Number(button.dataset.days);
    document.querySelectorAll(".range-button").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    render();
  }));
  document.querySelectorAll(".legend button").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.series;
    state.hidden.has(key) ? state.hidden.delete(key) : state.hidden.add(key);
    button.setAttribute("aria-pressed", String(!state.hidden.has(key)));
    renderChart();
  }));
  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => state.data && renderChart());
  }).observe(el.wrap);
}

async function refreshMarket() {
  const till = iso(new Date());
  const from = addDays(till, -70);
  const params = new URLSearchParams({
    "iss.meta": "off", "iss.only": "candles", "candles.columns": "begin,open,close,high,low",
    interval: "24", from, till
  });
  const url = `https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/USDRUBF/candles.json?${params}`;
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const points = parseMoex(await response.json());
    if (!points.length) throw new Error("пустой ответ");
    state.data.market = merge(state.data.market, points);
    state.marketLive = true;
    render();
    const latest = last(state.data.market);
    setStatus(`Freedom: накопленная история · USDRUBF: MOEX ISS, последняя свеча ${fmtDate(latest.date)}`, "ready");
  } catch (error) {
    console.warn("MOEX ISS live request failed", error);
    setStatus(state.data.market.length
      ? "Показан последний сохранённый снимок; live-запрос Мосбиржи временно недоступен"
      : "Freedom загружен; USDRUBF появится после первого запуска сборщика GitHub Actions", "ready");
  }
}

function parseMoex(payload) {
  const columns = payload?.candles?.columns;
  const rows = payload?.candles?.data;
  if (!Array.isArray(columns) || !Array.isArray(rows)) return [];
  const ix = Object.fromEntries(columns.map((name, index) => [name, index]));
  if (!("begin" in ix) || !("close" in ix)) return [];
  return rows.map((row) => ({
    date: String(row[ix.begin]).slice(0, 10), open: finite(row[ix.open]), close: finite(row[ix.close]),
    high: finite(row[ix.high]), low: finite(row[ix.low]), provider: "moex-iss"
  })).filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && point.close !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function validate(data) {
  if (!data || !Array.isArray(data.freedom) || !Array.isArray(data.market)) throw new Error("неверный формат rates.json");
}

function render() { renderMetrics(); renderMeta(); renderTable(); renderChart(); }

function view() {
  const allDates = [...state.data.freedom.map((p) => p.date), ...state.data.market.map((p) => p.date)].sort();
  const end = allDates.at(-1) || iso(new Date());
  const start = addDays(end, -(state.range - 1));
  const f = new Map(state.data.freedom.map((p) => [p.date, p]));
  const m = new Map(state.data.market.map((p) => [p.date, p]));
  return { start, end, days: Array.from({ length: state.range }, (_, index) => {
    const date = addDays(start, index);
    return { date, index, freedom: f.get(date), market: m.get(date) };
  }) };
}

function renderMetrics() {
  const f = last(state.data.freedom);
  const m = last(state.data.market);
  if (f) {
    el.buy.textContent = rate.format(f.buy); el.sell.textContent = rate.format(f.sell);
    el.buyMeta.textContent = `${fmtDate(f.date)} · ${f.method === "direct" ? "точный курс" : "оценка"}`;
    el.sellMeta.textContent = `спред ${rate.format(f.sell - f.buy)} ₽`;
  }
  if (m) {
    el.market.textContent = rate.format(m.close);
    el.marketMeta.textContent = `${fmtDate(m.date)} · ${state.marketLive ? "live MOEX" : "снимок"}`;
  } else { el.market.textContent = "—"; el.marketMeta.textContent = "ожидается первый сбор"; }
  if (f && m) {
    const midpoint = (f.buy + f.sell) / 2;
    const delta = m.close - midpoint;
    el.delta.textContent = `${signed.format(delta)} ₽`;
    el.deltaMeta.textContent = `${signed.format(delta / midpoint * 100)}% к середине спреда`;
  } else { el.delta.textContent = "—"; el.deltaMeta.textContent = "нужны оба ряда"; }
}

function renderMeta() {
  const v = view();
  el.period.textContent = `${longDate.format(date(v.start))} — ${longDate.format(date(v.end))}`;
  const generated = new Date(state.data.generatedAt);
  el.stamp.textContent = Number.isNaN(generated.valueOf()) ? "время снимка неизвестно" :
    `снимок ${generated.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}`;
}

function renderTable() {
  const rows = view().days.filter((d) => d.freedom || d.market).reverse().slice(0, 10);
  if (!rows.length) { el.body.innerHTML = '<tr><td colspan="5" class="placeholder">Нет точек за период</td></tr>'; return; }
  el.body.innerHTML = rows.map((d) => {
    const badge = d.freedom ? d.freedom.method === "direct"
      ? '<span class="badge direct">точный</span>' : '<span class="badge derived">расчётный</span>' : '<span class="badge">—</span>';
    return `<tr><td>${fmtDate(d.date)}</td><td>${optional(d.freedom?.buy)}</td><td>${optional(d.freedom?.sell)}</td><td>${optional(d.market?.close)}</td><td>${badge}</td></tr>`;
  }).join("");
}

function renderChart() {
  const v = view();
  const compact = matchMedia("(max-width: 680px)").matches;
  const width = Math.max(320, Math.round(el.wrap.clientWidth || 900));
  const height = compact ? 360 : 420;
  const margin = { top: 24, right: 16, bottom: 42, left: compact ? 43 : 52 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const values = [];
  for (const d of v.days) {
    if (!state.hidden.has("buy") && Number.isFinite(d.freedom?.buy)) values.push(d.freedom.buy);
    if (!state.hidden.has("sell") && Number.isFinite(d.freedom?.sell)) values.push(d.freedom.sell);
    if (!state.hidden.has("market") && Number.isFinite(d.market?.close)) values.push(d.market.close);
  }
  el.chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  el.chart.setAttribute("height", String(height));
  el.empty.hidden = values.length > 0;
  if (!values.length) {
    el.chart.innerHTML = '<title id="svg-title">График USD/RUB</title><desc id="svg-desc">Нет данных за выбранный период.</desc>';
    el.tooltip.hidden = true; return;
  }
  const scale = niceScale(Math.min(...values), Math.max(...values), 5);
  const x = (index) => margin.left + (v.days.length === 1 ? 0 : index / (v.days.length - 1)) * plotW;
  const y = (value) => margin.top + (scale.max - value) / (scale.max - scale.min) * plotH;
  const out = [
    '<title id="svg-title">График курса USD/RUB</title>',
    `<desc id="svg-desc">Покупка и продажа Freedom Bank и закрытие USDRUBF за ${state.range} дней.</desc>`
  ];
  for (const tick of scale.ticks) {
    const yp = y(tick);
    out.push(`<line class="grid-line" x1="${margin.left}" y1="${yp}" x2="${width - margin.right}" y2="${yp}"/>`);
    out.push(`<text class="axis-label" x="${margin.left - 9}" y="${yp + 4}" text-anchor="end">${axis(tick)}</text>`);
  }
  const every = state.range === 14 ? (compact ? 3 : 2) : (compact ? 7 : 5);
  v.days.forEach((d, index) => {
    if (index % every !== 0 && index !== v.days.length - 1) return;
    out.push(`<text class="axis-label axis-x" x="${x(index)}" y="${height - 13}">${fmtDate(d.date)}</text>`);
  });
  if (!state.hidden.has("buy") && !state.hidden.has("sell")) {
    for (const segment of contiguous(v.days, (d) => d.freedom && Number.isFinite(d.freedom.buy) && Number.isFinite(d.freedom.sell))) {
      if (segment.length < 2) continue;
      const top = segment.map((d) => `${x(d.index)},${y(d.freedom.sell)}`);
      const bottom = segment.slice().reverse().map((d) => `${x(d.index)},${y(d.freedom.buy)}`);
      out.push(`<polygon class="area" points="${[...top, ...bottom].join(" ")}"/>`);
    }
  }
  drawBank("buy", out, v.days, x, y);
  drawBank("sell", out, v.days, x, y);
  drawMarket(out, v.days, x, y);
  out.push(`<g id="hover" hidden><line class="hover-line" id="hover-line" y1="${margin.top}" y2="${height - margin.bottom}"/><circle class="hover-point buy" id="hover-buy" r="4" hidden/><circle class="hover-point sell" id="hover-sell" r="4" hidden/><circle class="hover-point market" id="hover-market" r="4" hidden/></g>`);
  out.push(`<rect class="capture" x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}"/>`);
  el.chart.innerHTML = out.join("");
  bindHover({ v, width, height, margin, plotW, x, y });
}

function drawBank(key, out, days, x, y) {
  if (state.hidden.has(key)) return;
  for (const method of ["derived-cross", "direct"]) {
    for (const segment of contiguous(days, (d) => d.freedom?.method === method && Number.isFinite(d.freedom[key]))) {
      if (segment.length >= 2) out.push(`<path class="series-line ${key}${method === "derived-cross" ? " derived" : ""}" d="${path(segment, (d) => x(d.index), (d) => y(d.freedom[key]))}"/>`);
      segment.forEach((d) => out.push(`<circle class="series-point ${key}" cx="${x(d.index)}" cy="${y(d.freedom[key])}" r="${method === "direct" ? 3.2 : 2.4}"/>`));
    }
  }
}

function drawMarket(out, days, x, y) {
  if (state.hidden.has("market")) return;
  for (const segment of contiguous(days, (d) => Number.isFinite(d.market?.close))) {
    if (segment.length >= 2) out.push(`<path class="series-line market" d="${path(segment, (d) => x(d.index), (d) => y(d.market.close))}"/>`);
    segment.forEach((d) => out.push(`<circle class="series-point market" cx="${x(d.index)}" cy="${y(d.market.close)}" r="2.7"/>`));
  }
}

function bindHover({ v, width, height, margin, plotW, x, y }) {
  const capture = el.chart.querySelector(".capture");
  const layer = el.chart.querySelector("#hover");
  const line = el.chart.querySelector("#hover-line");
  const points = { buy: el.chart.querySelector("#hover-buy"), sell: el.chart.querySelector("#hover-sell"), market: el.chart.querySelector("#hover-market") };
  const hide = () => { layer.hidden = true; el.tooltip.hidden = true; };
  capture.addEventListener("pointermove", (event) => {
    const rect = el.chart.getBoundingClientRect();
    const svgX = (event.clientX - rect.left) / rect.width * width;
    const index = Math.round(Math.max(0, Math.min(1, (svgX - margin.left) / plotW)) * (v.days.length - 1));
    const d = v.days[index];
    const values = {
      buy: state.hidden.has("buy") ? null : d.freedom?.buy,
      sell: state.hidden.has("sell") ? null : d.freedom?.sell,
      market: state.hidden.has("market") ? null : d.market?.close
    };
    if (!Object.values(values).some(Number.isFinite)) return hide();
    const xp = x(index); layer.hidden = false; line.setAttribute("x1", xp); line.setAttribute("x2", xp);
    for (const [key, point] of Object.entries(points)) {
      const value = values[key]; point.hidden = !Number.isFinite(value);
      if (Number.isFinite(value)) { point.setAttribute("cx", xp); point.setAttribute("cy", y(value)); }
    }
    const labels = { buy: "Freedom покупает", sell: "Freedom продаёт", market: "USDRUBF" };
    const rows = Object.entries(values).filter(([, value]) => Number.isFinite(value)).map(([key, value]) => `<div class="tooltip-row"><span>${labels[key]}</span><strong>${rate.format(value)}</strong></div>`).join("");
    const quality = d.freedom ? d.freedom.method === "direct" ? "Freedom: прямая мобильная пара" : "Freedom: оценка через KZT" : "Freedom: точки нет";
    el.tooltip.innerHTML = `<div class="tooltip-date">${longDate.format(date(d.date))}</div>${rows}<div class="tooltip-quality">${quality}</div>`;
    el.tooltip.hidden = false;
    const screenX = xp / width * rect.width;
    const visibleY = Object.values(values).filter(Number.isFinite).map(y);
    el.tooltip.style.left = `${Math.max(102, Math.min(rect.width - 102, screenX))}px`;
    el.tooltip.style.top = `${Math.max(95, Math.min(...visibleY) / height * rect.height)}px`;
  });
  capture.addEventListener("pointerleave", hide);
  capture.addEventListener("pointercancel", hide);
}

function contiguous(days, predicate) {
  const result = []; let current = [];
  for (const d of days) {
    if (predicate(d)) current.push(d); else if (current.length) { result.push(current); current = []; }
  }
  if (current.length) result.push(current);
  return result;
}
function path(points, x, y) { return points.map((p, i) => `${i ? "L" : "M"}${x(p).toFixed(2)},${y(p).toFixed(2)}`).join(" "); }
function niceScale(rawMin, rawMax, count) {
  if (rawMin === rawMax) { rawMin -= 1; rawMax += 1; }
  const pad = Math.max((rawMax - rawMin) * .11, .35), min = rawMin - pad, max = rawMax + pad;
  const rough = (max - min) / Math.max(1, count - 1), magnitude = 10 ** Math.floor(Math.log10(rough)), residual = rough / magnitude;
  const step = (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10) * magnitude;
  const niceMin = Math.floor(min / step) * step, niceMax = Math.ceil(max / step) * step, ticks = [];
  for (let value = niceMin; value <= niceMax + step / 2; value += step) ticks.push(Number(value.toFixed(6)));
  return { min: niceMin, max: niceMax, ticks };
}
function setStatus(text, type) { el.status.className = `status ${type === "ready" ? "ready" : type === "error" ? "error" : ""}`; el.status.innerHTML = `<span class="spinner"></span>${text}`; }
function merge(existing = [], incoming = []) { const map = new Map(existing.map((p) => [p.date, p])); incoming.forEach((p) => map.set(p.date, p)); return [...map.values()].sort((a, b) => a.date.localeCompare(b.date)); }
function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function optional(value) { return Number.isFinite(value) ? rate.format(value) : "—"; }
function axis(value) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value); }
function date(value) { return new Date(`${value}T00:00:00Z`); }
function iso(value) { return value.toISOString().slice(0, 10); }
function addDays(value, amount) { const d = date(value); d.setUTCDate(d.getUTCDate() + amount); return iso(d); }
function fmtDate(value) { return shortDate.format(date(value)).replace(".", ""); }
function last(array) { return array?.length ? array[array.length - 1] : null; }
