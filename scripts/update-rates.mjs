import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const DATA = new URL("../data/rates.json", import.meta.url);
const CREDIT_BUREAU = "https://creditbureau.kz/currency/freedom-bank/";
const BANKFFIN = "https://bankffin.kz/ru/exchange-rates";
const MOEX = "https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/USDRUBF/candles.json";
const USER_AGENT = "usd-rub-comparison/1.0 (+https://github.com/ejuo/now-github-starter)";

const entityMap = new Map([["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"], ["nbsp", " "], ["#39", "'"]]);

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
  const parsed = Number.parseFloat(String(value).replace(/[\u00a0\u202f\s]/g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`Некорректное число: ${value}`);
  return parsed;
}

function isoFromParts(day, month, year) { return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function round(value, digits = 4) { const factor = 10 ** digits; return Math.round((value + Number.EPSILON) * factor) / factor; }

export function validateFreedom({ buy, sell }) {
  if (!Number.isFinite(buy) || !Number.isFinite(sell)) throw new Error("Курс должен быть числом");
  if (buy < 40 || buy > 150 || sell < 40 || sell > 150) throw new Error("Курс USD/RUB вне допустимого диапазона");
  if (buy >= sell) throw new Error("Курс покупки должен быть ниже курса продажи");
}

export function parseDirect(html) {
  const text = htmlToText(html).replace(/\n+/g, " ");
  const updated = text.match(/Актуально\s+(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2})/i);
  const row = text.match(/USD\s*\/\s*RUB\s*x\s*1\s+([\d.,]+)\s*₽\s+([\d.,]+)\s*₽/i);
  if (!updated) throw new Error("Не найдено время обновления CreditBureau");
  if (!row) throw new Error("Не найдена мобильная строка USD/RUB");
  const [, dd, mm, yyyy, time] = updated;
  const point = { date: isoFromParts(dd, mm, yyyy), buy: number(row[1]), sell: number(row[2]), method: "direct", provider: "creditbureau.kz", capturedAt: `${yyyy}-${mm}-${dd}T${time}:00+05:00` };
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

export function parseBankffin(html, date) {
  const text = htmlToText(html).replace(/\n+/g, " ");
  const marker = text.search(/В мобильном приложении/i);
  const section = marker >= 0 ? text.slice(marker, marker + 1200) : text;
  const usdKzt = findCurrencyRow(section, "USD");
  const rubKzt = findCurrencyRow(section, "RUB");
  return {
    date, ...deriveCross(usdKzt, rubKzt), method: "derived-cross", provider: "bankffin.kz",
    calculation: { usdKztBuy: usdKzt.buy, usdKztSell: usdKzt.sell, rubKztBuy: rubKzt.buy, rubKztSell: rubKzt.sell }
  };
}

export function parseMoex(payload) {
  const columns = payload?.candles?.columns;
  const rows = payload?.candles?.data;
  if (!Array.isArray(columns) || !Array.isArray(rows)) throw new Error("Некорректный ответ MOEX ISS");
  const index = Object.fromEntries(columns.map((name, position) => [name, position]));
  if (!("begin" in index) || !("close" in index)) throw new Error("MOEX ISS: нет begin/close");
  return rows.map((row) => ({
    date: String(row[index.begin]).slice(0, 10), open: finite(row[index.open]), close: finite(row[index.close]),
    high: finite(row[index.high]), low: finite(row[index.low]), provider: "moex-iss"
  })).filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && point.close !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function finite(value) { if (value === null || value === undefined || value === "") return null; const n = Number(value); return Number.isFinite(n) ? n : null; }

export function mergeByDate(existing, incoming, maxDays = 70, reference = new Date()) {
  const map = new Map(existing.map((point) => [point.date, point]));
  incoming.forEach((point) => map.set(point.date, point));
  const threshold = new Date(reference); threshold.setUTCDate(threshold.getUTCDate() - maxDays);
  const minDate = threshold.toISOString().slice(0, 10);
  return [...map.values()].filter((point) => point.date >= minDate).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 25_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { "user-agent": USER_AGENT, accept: "text/html,application/json;q=0.9,*/*;q=0.8", ...options.headers } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response;
  } finally { clearTimeout(timeout); }
}

function almatyDate() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function daysAgo(days) { const d = new Date(); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); }

async function collectFreedom() {
  try {
    const html = await (await fetchWithTimeout(CREDIT_BUREAU)).text();
    const point = parseDirect(html);
    console.log(`Freedom direct ${point.date}: ${point.buy}/${point.sell}`);
    return point;
  } catch (error) {
    console.warn(`Прямая пара недоступна: ${error.message}. Пробую официальный кросс.`);
    const html = await (await fetchWithTimeout(BANKFFIN)).text();
    const point = parseBankffin(html, almatyDate());
    point.capturedAt = new Date().toISOString();
    console.log(`Freedom cross ${point.date}: ${point.buy}/${point.sell}`);
    return point;
  }
}

async function collectMarket() {
  const params = new URLSearchParams({ "iss.meta": "off", "iss.only": "candles", "candles.columns": "begin,open,close,high,low", interval: "24", from: daysAgo(75), till: new Date().toISOString().slice(0, 10) });
  const payload = await (await fetchWithTimeout(`${MOEX}?${params}`, { headers: { accept: "application/json" } })).json();
  const points = parseMoex(payload);
  if (!points.length) throw new Error("MOEX ISS вернул пустую историю");
  console.log(`MOEX USDRUBF: ${points.length} свечей`);
  return points;
}

function selfTest() {
  const direct = parseDirect('<p>Актуально 25.07.2026 06:05</p><tr><td>USD / RUB x 1</td><td>75.44 ₽</td><td>80.85 ₽</td></tr>');
  assert.deepEqual(direct, { date: "2026-07-25", buy: 75.44, sell: 80.85, method: "direct", provider: "creditbureau.kz", capturedAt: "2026-07-25T06:05:00+05:00" });
  const cross = parseBankffin('<div>В отделении USD 460 470 RUB 5.1 5.6</div><section>В мобильном приложении Валюта Покупка Продажа USD 467 474 RUB 5.52 6.02 EUR 535 542</section>', "2026-07-25");
  assert.deepEqual({ buy: cross.buy, sell: cross.sell }, { buy: 77.5748, sell: 85.8696 });
  const candles = parseMoex({ candles: { columns: ["begin", "open", "close", "high", "low"], data: [["2026-07-24 00:00:00", 78.4, 79.05, 79.2, 78.2]] } });
  assert.equal(candles[0].close, 79.05);
  assert.equal(mergeByDate([{ date: "2026-07-24", close: 78 }], [{ date: "2026-07-24", close: 79 }], 70, new Date("2026-07-25T00:00:00Z"))[0].close, 79);
  console.log("Self-test passed");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const originalText = await readFile(DATA, "utf8");
  const data = JSON.parse(originalText);
  const originalComparable = JSON.stringify({ freedom: data.freedom ?? [], market: data.market ?? [] });
  const failures = [];
  try { data.freedom = mergeByDate(data.freedom ?? [], [await collectFreedom()]); } catch (error) { failures.push(`Freedom: ${error.message}`); }
  try { data.market = mergeByDate(data.market ?? [], await collectMarket()); } catch (error) { failures.push(`MOEX: ${error.message}`); }
  if (failures.length === 2) throw new Error(`Оба источника недоступны: ${failures.join("; ")}`);
  if (failures.length) console.warn(`Частичное обновление: ${failures.join("; ")}`);
  const nextComparable = JSON.stringify({ freedom: data.freedom ?? [], market: data.market ?? [] });
  if (nextComparable === originalComparable) console.log("Данные не изменились");
  else {
    data.generatedAt = new Date().toISOString();
    await writeFile(DATA, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log("data/rates.json обновлён");
  }
}
