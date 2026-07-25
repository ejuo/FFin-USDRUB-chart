function updateStatus() {
  const latestComparison = state.data.comparisons.at(-1);
  const latestFreedom = state.data.freedom.at(-1);
  const generated = Date.parse(state.data.generatedAt);
  const now = Date.now();
  const stale = Number.isFinite(generated) && now - generated > 3.5 * HOUR;
  const lastText = latestComparison
    ? `последнее синхронное сравнение ${formatDateTime(latestComparison.ms)}`
    : latestFreedom ? `последний курс Freedom ${formatDateTime(latestFreedom.ms)}` : "точек пока нет";
  setStatus(`Сбор каждый час в 17-ю минуту · ${lastText}${stale ? " · сбор задерживается" : ""}`, stale ? "warning" : "ready");
}

function setStatus(text, type) {
  el.status.className = `status ${type || ""}`;
  el.status.innerHTML = `<span class="spinner"></span>${escapeHtml(text)}`;
}

function qualityLabel(point) {
  return point.method === "direct" ? "прямая пара" : "оценка через KZT";
}

function latestDataTimestamp(data) {
  return Math.max(
    data.freedom.at(-1)?.ms ?? 0,
    data.market.at(-1)?.ms ?? 0,
    data.comparisons.at(-1)?.ms ?? 0
  ) || Date.now();
}

function rangeAnchorTimestamp(data) {
  return Math.max(latestDataTimestamp(data), Date.now());
}

function earliestTimestamp(data) {
  const values = [data.freedom[0]?.ms, data.market[0]?.ms, data.comparisons[0]?.ms].filter(Number.isFinite);
  return values.length ? Math.min(...values) : Date.now();
}

function findAtOrBefore(points, ms) {
  let low = 0;
  let high = points.length - 1;
  let result = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].ms <= ms) {
      result = points[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function nearestPoint(points, ms, maxDistance = Infinity) {
  if (!points.length) return null;
  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].ms < ms) low = middle + 1;
    else high = middle - 1;
  }
  const candidates = [points[low], points[low - 1]].filter(Boolean);
  const nearest = candidates.sort((a, b) => Math.abs(a.ms - ms) - Math.abs(b.ms - ms))[0];
  return nearest && Math.abs(nearest.ms - ms) <= maxDistance ? nearest : null;
}

function nearestValue(values, target) {
  let low = 0;
  let high = values.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle - 1;
  }
  const left = values[Math.max(0, low - 1)];
  const right = values[Math.min(values.length - 1, low)];
  return Math.abs(left - target) <= Math.abs(right - target) ? left : right;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);
}

function linePath(points, x, y) {
  return points.map((point, index) => `${index ? "L" : "M"}${x(point).toFixed(2)},${y(point).toFixed(2)}`).join(" ");
}

function diamondPath(cx, cy, radius) {
  return `M${cx},${cy - radius}L${cx + radius},${cy}L${cx},${cy + radius}L${cx - radius},${cy}Z`;
}

function niceScale(rawMin, rawMax, count) {
  if (rawMin === rawMax) { rawMin -= 1; rawMax += 1; }
  const pad = Math.max((rawMax - rawMin) * 0.1, 0.25);
  const min = rawMin - pad;
  const max = rawMax + pad;
  const rough = (max - min) / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10) * magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = niceMin; value <= niceMax + step / 2; value += step) ticks.push(Number(value.toFixed(6)));
  return { min: niceMin, max: niceMax, ticks };
}

function timeTicks(start, end, count) {
  const span = end - start;
  if (span <= 0) return [start];
  const rough = span / Math.max(1, count - 1);
  const candidates = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];
  const step = candidates.find((candidate) => candidate >= rough) || candidates.at(-1);
  const first = Math.ceil((start + ZONE_OFFSET) / step) * step - ZONE_OFFSET;
  const ticks = [];
  for (let value = first; value <= end; value += step) ticks.push(value);
  if (!ticks.length || ticks[0] - start > step * 0.55) ticks.unshift(start);
  if (end - ticks.at(-1) > step * 0.55) ticks.push(end);
  return ticks;
}

function timeTickParts(ms, span) {
  if (span <= 2.5 * DAY) return [clock.format(new Date(ms)), dayMonth.format(new Date(ms)).replace(".", "")];
  if (span <= 14 * DAY) return [dayMonth.format(new Date(ms)).replace(".", ""), clock.format(new Date(ms))];
  return [dayMonth.format(new Date(ms)).replace(".", ""), ""];
}

function zoneHourKey(ms) {
  const parts = zoneParts(ms);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}`;
}

function zoneParts(ms) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(ms)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function toZoneInput(ms) {
  const parts = zoneParts(ms);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function parseZoneInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return NaN;
  return Date.parse(`${value}:00+05:00`);
}

function formatDateTime(ms) {
  return Number.isFinite(ms) ? dateTime.format(new Date(ms)).replace(" г.", "") : "—";
}

function optional(value) {
  return Number.isFinite(value) ? rate.format(value) : "—";
}

function axis(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function byMs(a, b) {
  return a.ms - b.ms;
}
