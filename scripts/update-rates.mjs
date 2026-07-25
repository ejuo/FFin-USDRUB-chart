import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const DATA = new URL("../data/rates.json", import.meta.url);
const CREDIT_BUREAU = "https://creditbureau.kz/currency/freedom-bank/";
const BANKFFIN = "https://bankffin.kz/ru/exchange-rates";
const MOEX = "https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/USDRUBF/candles.json";
const USER_AGENT = "ffin-usdrub-chart/2.0 (+https://github.com/ejuo/FFin-USDRUB-chart)";
const RETENTION_DAYS = 190;
const MARKET_INTERVAL_MINUTES = 60;
const MARKET_MAX_AGE_MINUTES = 150;

const entityMap = new Map([
  ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"], ["nbsp", " "], ["#39", "'"]
]);

export function htmlToText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/tr>|<\/li>|<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&([^;]+);/g, (full, entity) => {
      if (entityMap.has(entity)) return entityMap.get(entity);
      if (/^#\d+$/.test(entity)) return String.fromCodePoint(Number(entity.slice(1)));
      if (/^#x[\da-f]+$/i.test(entity)) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      return full;
    })
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function number(value) {
  const parsed = Number.parseFloat(String(value)
    .replace(/[\u00a0\u202f\s]/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`Некорректное число: ${value}`);
  return parsed;
}

function isoFromParts(day, month, year) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function asDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`Некорректная дата: ${value}`);
  return date;
}

function almatyDate(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(asDate(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function daysAgo(days, reference = new Date()) {
  const date = asDate(reference);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function moscowTimestamp(value) {
  const normalized = String(value).trim().replace(" ", "T");
  return asDate(`${normalized}+03:00`).toISOString();
}

export function validateFreedom({ buy, sell }) {
  if (!Number.isFinite(buy) || !Number.isFinite(sell)) throw new Error("Курс должен быть числом");
  if (buy < 40 || buy > 150 || sell < 40 || sell > 150) throw new Error("Курс USD/RUB вне допустимого диапазона");
  if (buy >= sell) throw new Error("Курс покупки должен быть ниже курса продажи");
}

export function parseDirect(html, observedAt = new Date()) {
  const text = htmlToText(html).replace(/\n+/g, " ");
  const updated = text.match(/Актуально\s+(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2})/i);
  const row = text.match(/USD\s*\/\s*RUB\s*x\s*1\s+([\d.,]+)\s*₽\s+([\d.,]+)\s*₽/i);
  if (!updated) throw new Error("Не найдено время обновления CreditBureau");
  if (!row) throw new Error("Не найдена мобильная строка USD/RUB");

  const observed = asDate(observedAt);
  const [, dd, mm, yyyy, time] = updated;
  const point = {
    timestamp: observed.toISOString(),
    observedAt: observed.toISOString(),
    sourceUpdatedAt: `${yyyy}-${mm}-${dd}T${time}:00+05:00`,
    date: almatyDate(observed),
    buy: number(row[1]),
    sell: number(row[2]),
    method: "direct",
    provider: "creditbureau.kz",
    resolution: "intraday"
  };
  validateFreedom(point);
  return point;
}

function findCurrencyRow(text, currency) {
  const match = text.match(new RegExp(`(?:^|\\s)${currency}\\s+([\\d.,]+)\\s+([\\d.,]+)(?:\\s|$)`, "i"));
  if (!match) throw new Error(`Не найдена строка ${currency}/KZT`);
  return { buy: number(match[1]), sell: number(match[2]) };
}

export function deriveCross(usdKzt, rubKzt) {
  const point = { buy: round(usdKzt.buy / rubKzt.sell), sell: round(usdKzt.sell / rubKzt.buy) };
  validateFreedom(point);
  return point;
}

export function parseBankffin(html, observedAt = new Date()) {
  const text = htmlToText(html).replace(/\n+/g, " ");
  const marker = text.search(/В мобильном приложении/i);
  const section = marker >= 0 ? text.slice(marker, marker + 1400) : text;
  const usdKzt = findCurrencyRow(section, "USD");
  const rubKzt = findCurrencyRow(section, "RUB");
  const observed = asDate(observedAt);
  return {
    timestamp: observed.toISOString(),
    observedAt: observed.toISOString(),
    sourceUpdatedAt: null,
    date: almatyDate(observed),
    ...deriveCross(usdKzt, rubKzt),
    method: "derived-cross",
    provider: "bankffin.kz",
    resolution: "intraday",
    calculation: {
      usdKztBuy: usdKzt.buy,
      usdKztSell: usdKzt.sell,
      rubKztBuy: rubKzt.buy,
      rubKztSell: rubKzt.sell
    }
  };
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseMoex(payload) {
  const columns = payload?.candles?.columns;
  const rows = payload?.candles?.data;
  if (!Array.isArray(columns) || !Array.isArray(rows)) throw new Error("Некорректный ответ MOEX ISS");
  const index = Object.fromEntries(columns.map((name, position) => [name, position]));
  if (!("begin" in index) || !("close" in index)) throw new Error("MOEX ISS: нет begin/close");

  return rows.map((row) => {
    const rawBegin = row[index.begin];
    if (!rawBegin) return null;
    const point = {
      timestamp: moscowTimestamp(rawBegin),
      begin: String(rawBegin),
      endTimestamp: index.end === undefined || !row[index.end] ? null : moscowTimestamp(row[index.end]),
      open: finite(row[index.open]),
      close: finite(row[index.close]),
      high: finite(row[index.high]),
      low: finite(row[index.low]),
      value: finite(row[index.value]),
      volume: finite(row[index.volume]),
      provider: "moex-iss",
      resolution: "hour"
    };
    return point.close === null ? null : point;
  }).filter(Boolean).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function normalizeFreedomPoint(point) {
  const rawTimestamp = point.timestamp || point.observedAt || point.capturedAt || (point.date ? `${point.date}T12:00:00+05:00` : null);
  if (!rawTimestamp) throw new Error("Freedom: у точки нет времени");
  const timestamp = asDate(rawTimestamp).toISOString();
  const { capturedAt: _capturedAt, ...rest } = point;
  const normalized = {
    ...rest,
    timestamp,
    observedAt: point.observedAt ? asDate(point.observedAt).toISOString() : timestamp,
    sourceUpdatedAt: point.sourceUpdatedAt || point.capturedAt || null,
    date: point.date || almatyDate(timestamp),
    resolution: point.resolution || (point.capturedAt ? "intraday" : "daily")
  };
  validateFreedom(normalized);
  return normalized;
}

export function normalizeMarketPoint(point) {
  const rawTimestamp = point.timestamp || (point.date ? `${point.date}T18:00:00+03:00` : null);
  if (!rawTimestamp) throw new Error("MOEX: у точки нет времени");
  return {
    ...point,
    timestamp: asDate(rawTimestamp).toISOString(),
    resolution: point.resolution || (point.date ? "daily" : "hour")
  };
}

export function normalizeComparison(point) {
  if (!point.timestamp) throw new Error("Comparison: у точки нет времени");
  return { ...point, timestamp: asDate(point.timestamp).toISOString() };
}

export function mergeByTimestamp(existing, incoming, maxDays = RETENTION_DAYS, reference = new Date()) {
  const map = new Map();
  for (const point of [...existing, ...incoming]) {
    if (!point?.timestamp) continue;
    map.set(point.timestamp, point);
  }
  const threshold = asDate(reference).valueOf() - maxDays * 86_400_000;
  return [...map.values()]
    .filter((point) => asDate(point.timestamp).valueOf() >= threshold)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function shouldStoreFreedomChange(existing, point) {
  const last = existing.at(-1);
  if (!last) return true;
  if (last.resolution !== "intraday") return true;
  return last.buy !== point.buy
    || last.sell !== point.sell
    || last.method !== point.method
    || (last.sourceUpdatedAt || null) !== (point.sourceUpdatedAt || null);
}

export function findComparableMarket(market, observedAt, maxAgeMinutes = MARKET_MAX_AGE_MINUTES) {
  const observedMs = asDate(observedAt).valueOf();
  for (let index = market.length - 1; index >= 0; index -= 1) {
    const point = market[index];
    if (point.resolution === "daily") continue;
    const pointMs = asDate(point.timestamp).valueOf();
    if (pointMs > observedMs) continue;
    const ageMinutes = (observedMs - pointMs) / 60_000;
    if (ageMinutes <= maxAgeMinutes) return { point, ageMinutes };
    return null;
  }
  return null;
}

export function makeComparison(freedom, marketMatch) {
  const { point: market, ageMinutes } = marketMatch;
  return {
    timestamp: freedom.timestamp,
    freedomTimestamp: freedom.timestamp,
    sourceUpdatedAt: freedom.sourceUpdatedAt || null,
    marketTimestamp: market.timestamp,
    marketAgeMinutes: round(ageMinutes, 1),
    buy: freedom.buy,
    sell: freedom.sell,
    market: market.close,
    method: freedom.method,
    freedomProvider: freedom.provider,
    marketProvider: market.provider
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 25_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        ...options.headers
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function collectFreedom(observedAt) {
  try {
    const html = await (await fetchWithTimeout(CREDIT_BUREAU)).text();
    const point = parseDirect(html, observedAt);
    console.log(`Freedom direct ${point.timestamp}: ${point.buy}/${point.sell}; source ${point.sourceUpdatedAt}`);
    return point;
  } catch (error) {
    console.warn(`Прямая пара недоступна: ${error.message}. Пробую официальный кросс.`);
    const html = await (await fetchWithTimeout(BANKFFIN)).text();
    const point = parseBankffin(html, observedAt);
    console.log(`Freedom cross ${point.timestamp}: ${point.buy}/${point.sell}`);
    return point;
  }
}

function cursorTotal(payload) {
  const cursor = payload?.["candles.cursor"];
  if (!Array.isArray(cursor?.columns) || !Array.isArray(cursor?.data) || !cursor.data.length) return null;
  const index = Object.fromEntries(cursor.columns.map((name, position) => [name, position]));
  const row = cursor.data[0];
  return {
    index: finite(row[index.INDEX ?? index.index]),
    total: finite(row[index.TOTAL ?? index.total]),
    pageSize: finite(row[index.PAGESIZE ?? index.pagesize])
  };
}

async function collectMarket(reference = new Date()) {
  const from = daysAgo(RETENTION_DAYS + 10, reference);
  const till = asDate(reference).toISOString().slice(0, 10);
  const collected = [];
  let start = 0;
  let previousPageKey = null;

  for (let page = 0; page < 50; page += 1) {
    const params = new URLSearchParams({
      "iss.meta": "off",
      "iss.only": "candles,candles.cursor",
      "candles.columns": "begin,end,open,close,high,low,value,volume",
      interval: String(MARKET_INTERVAL_MINUTES),
      from,
      till,
      start: String(start)
    });
    const payload = await (await fetchWithTimeout(`${MOEX}?${params}`, {
      headers: { accept: "application/json" }
    })).json();
    const rows = payload?.candles?.data;
    if (!Array.isArray(rows)) throw new Error("MOEX ISS не вернул candles.data");
    if (!rows.length) break;
    const pageKey = `${rows[0]?.[0] ?? ""}|${rows.at(-1)?.[0] ?? ""}|${rows.length}`;
    if (pageKey === previousPageKey) {
      console.warn("MOEX ISS повторил страницу; прекращаю пагинацию");
      break;
    }
    previousPageKey = pageKey;

    collected.push(...parseMoex(payload));
    const cursor = cursorTotal(payload);
    start += rows.length;
    if (cursor?.total !== null && start >= cursor.total) break;
  }

  const points = mergeByTimestamp([], collected, RETENTION_DAYS, reference);
  if (!points.length) throw new Error("MOEX ISS вернул пустую часовую историю");
  console.log(`MOEX USDRUBF: ${points.length} часовых свечей`);
  return points;
}

function selfTest() {
  const observed = new Date("2026-07-25T02:17:00Z");
  const direct = parseDirect(
    '<p>Актуально 25.07.2026 06:05</p><tr><td>USD / RUB x 1</td><td>75.44 ₽</td><td>80.85 ₽</td></tr>',
    observed
  );
  assert.equal(direct.timestamp, "2026-07-25T02:17:00.000Z");
  assert.equal(direct.sourceUpdatedAt, "2026-07-25T06:05:00+05:00");
  assert.equal(direct.buy, 75.44);
  assert.equal(direct.sell, 80.85);

  const cross = parseBankffin(
    '<div>В отделении USD 460 470 RUB 5.1 5.6</div><section>В мобильном приложении Валюта Покупка Продажа USD 467 474 RUB 5.52 6.02 EUR 535 542</section>',
    observed
  );
  assert.deepEqual({ buy: cross.buy, sell: cross.sell }, { buy: 77.5748, sell: 85.8696 });

  const candles = parseMoex({ candles: {
    columns: ["begin", "end", "open", "close", "high", "low", "value", "volume"],
    data: [["2026-07-24 10:00:00", "2026-07-24 10:59:59", 78.4, 79.05, 79.2, 78.2, 1000, 20]]
  } });
  assert.equal(candles[0].timestamp, "2026-07-24T07:00:00.000Z");
  assert.equal(candles[0].close, 79.05);

  const merged = mergeByTimestamp(
    [{ timestamp: "2026-07-24T07:00:00.000Z", close: 78 }],
    [{ timestamp: "2026-07-24T07:00:00.000Z", close: 79 }],
    190,
    new Date("2026-07-25T00:00:00Z")
  );
  assert.equal(merged[0].close, 79);

  const stored = [{ ...direct, timestamp: "2026-07-25T01:17:00.000Z" }];
  assert.equal(shouldStoreFreedomChange(stored, direct), false);
  assert.equal(shouldStoreFreedomChange(stored, { ...direct, sell: 80.86 }), true);

  const match = findComparableMarket(candles, "2026-07-24T08:17:00.000Z");
  assert.equal(match.point.close, 79.05);
  assert.equal(match.ageMinutes, 77);
  const comparison = makeComparison({ ...direct, timestamp: "2026-07-24T08:17:00.000Z" }, match);
  assert.equal(comparison.market, 79.05);
  assert.equal(round(comparison.sell - comparison.market, 2), 1.8);

  console.log("Self-test passed");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const originalText = await readFile(DATA, "utf8");
  const raw = JSON.parse(originalText);
  const reference = new Date();

  const data = {
    ...raw,
    schemaVersion: 2,
    meta: {
      timezone: "Asia/Almaty",
      timezoneLabel: "Алматы / Екатеринбург (UTC+5)",
      collectionCadenceMinutes: 60,
      retentionDays: RETENTION_DAYS,
      marketIntervalMinutes: MARKET_INTERVAL_MINUTES,
      bankUpdatePolicy: "not-published"
    },
    freedom: mergeByTimestamp((raw.freedom ?? []).map(normalizeFreedomPoint), [], RETENTION_DAYS, reference),
    market: mergeByTimestamp((raw.market ?? []).map(normalizeMarketPoint), [], RETENTION_DAYS, reference),
    comparisons: mergeByTimestamp((raw.comparisons ?? []).map(normalizeComparison), [], RETENTION_DAYS, reference)
  };

  const beforeComparable = JSON.stringify({
    schemaVersion: raw.schemaVersion,
    meta: raw.meta,
    freedom: raw.freedom ?? [],
    market: raw.market ?? [],
    comparisons: raw.comparisons ?? []
  });

  const failures = [];
  let currentFreedom = null;
  let incomingMarket = [];

  try {
    currentFreedom = await collectFreedom(reference);
  } catch (error) {
    failures.push(`Freedom: ${error.message}`);
  }

  try {
    incomingMarket = await collectMarket(reference);
    data.market = mergeByTimestamp(data.market, incomingMarket, RETENTION_DAYS, reference);
  } catch (error) {
    failures.push(`MOEX: ${error.message}`);
  }

  if (currentFreedom) {
    currentFreedom.changed = shouldStoreFreedomChange(data.freedom, currentFreedom);
    data.freedom = mergeByTimestamp(data.freedom, [currentFreedom], RETENTION_DAYS, reference);
    console.log(currentFreedom.changed
      ? "Курс Freedom изменился; сохранено новое ежечасное наблюдение"
      : "Курс Freedom не изменился; ежечасное наблюдение всё равно сохранено");

    const marketMatch = findComparableMarket(data.market, currentFreedom.timestamp);
    if (marketMatch) {
      data.comparisons = mergeByTimestamp(
        data.comparisons,
        [makeComparison(currentFreedom, marketMatch)],
        RETENTION_DAYS,
        reference
      );
      console.log(`Сохранено синхронное сравнение; возраст свечи ${round(marketMatch.ageMinutes, 1)} мин`);
    } else {
      console.log("Рынок закрыт или свежей часовой свечи нет; сравнение не добавлено");
    }
  }

  if (failures.length === 2) throw new Error(`Оба источника недоступны: ${failures.join("; ")}`);
  if (failures.length) console.warn(`Частичное обновление: ${failures.join("; ")}`);

  const afterComparable = JSON.stringify({
    schemaVersion: data.schemaVersion,
    meta: data.meta,
    freedom: data.freedom,
    market: data.market,
    comparisons: data.comparisons
  });

  if (afterComparable === beforeComparable) {
    console.log("Данные не изменились");
  } else {
    data.generatedAt = new Date().toISOString();
    await writeFile(DATA, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log("data/rates.json обновлён");
  }
}
