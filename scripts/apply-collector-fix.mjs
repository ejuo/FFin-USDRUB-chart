import { readFile, writeFile } from "node:fs/promises";

const target = new URL("./update-rates.mjs", import.meta.url);
let source = await readFile(target, "utf8");
const original = source;

function replaceOnce(from, to, label) {
  if (source.includes(to)) {
    console.log(`${label}: already applied`);
    return;
  }
  const index = source.indexOf(from);
  if (index < 0) throw new Error(`${label}: source marker not found`);
  if (source.indexOf(from, index + from.length) >= 0) throw new Error(`${label}: source marker is not unique`);
  source = source.slice(0, index) + to + source.slice(index + from.length);
  console.log(`${label}: applied`);
}

replaceOnce(
  `const CREDIT_BUREAU = "https://creditbureau.kz/currency/freedom-bank/";\nconst BANKFFIN = "https://bankffin.kz/ru/exchange-rates";`,
  `const BANKFFIN_PAGE = "https://bankffin.kz/ru/exchange-rates";\nconst BANKFFIN_API = "https://bankffin.kz/api/exchange-rates/getRates";`,
  "official Freedom endpoints"
);

replaceOnce(
  `const USER_AGENT = "ffin-usdrub-chart/2.0 (+https://github.com/ejuo/FFin-USDRUB-chart)";`,
  `const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";`,
  "browser-compatible user agent"
);

const parserMarker = `export function parseDirect(html, observedAt = new Date()) {`;
const officialParser = `export function parseOfficialRates(payload, observedAt = new Date()) {\n  const mobile = payload?.data?.mobile;\n  if (payload?.success !== true || !Array.isArray(mobile)) {\n    throw new Error("Freedom API: некорректный ответ");\n  }\n\n  const row = mobile.find((item) => item?.buyCode === "USD" && item?.sellCode === "RUB");\n  if (!row) throw new Error("Freedom API: не найдена мобильная пара USD/RUB");\n\n  const observed = asDate(observedAt);\n  const point = {\n    timestamp: observed.toISOString(),\n    observedAt: observed.toISOString(),\n    sourceUpdatedAt: null,\n    date: almatyDate(observed),\n    buy: number(row.buyRate),\n    sell: number(row.sellRate),\n    method: "direct",\n    provider: "bankffin.kz",\n    source: "official-api",\n    resolution: "intraday"\n  };\n  validateFreedom(point);\n  return point;\n}\n\n${parserMarker}`;
replaceOnce(parserMarker, officialParser, "official Freedom JSON parser");

replaceOnce(
`async function collectFreedom(observedAt) {\n  try {\n    const html = await (await fetchWithTimeout(CREDIT_BUREAU)).text();\n    const point = parseDirect(html, observedAt);\n    console.log(\`Freedom direct \${point.timestamp}: \${point.buy}/\${point.sell}; source \${point.sourceUpdatedAt}\`);\n    return point;\n  } catch (error) {\n    console.warn(\`Прямая пара недоступна: \${error.message}. Пробую официальный кросс.\`);\n    const html = await (await fetchWithTimeout(BANKFFIN)).text();\n    const point = parseBankffin(html, observedAt);\n    console.log(\`Freedom cross \${point.timestamp}: \${point.buy}/\${point.sell}\`);\n    return point;\n  }\n}`,
`async function collectFreedom(observedAt) {\n  const response = await fetchWithTimeout(BANKFFIN_API, {\n    headers: {\n      accept: "application/json,text/plain,*/*",\n      referer: BANKFFIN_PAGE,\n      "x-requested-with": "XMLHttpRequest"\n    }\n  });\n  const point = parseOfficialRates(await response.json(), observedAt);\n  console.log(\`Freedom official API \${point.timestamp}: \${point.buy}/\${point.sell}\`);\n  return point;\n}`,
  "official Freedom collector"
);

replaceOnce(
  `if (cursor?.total !== null && start >= cursor.total) break;`,
  `if (cursor?.total != null && start >= cursor.total) break;`,
  "nullable MOEX cursor guard"
);

const selfTestMarker = `  const cross = parseBankffin(`;
const selfTestInsert = `  const official = parseOfficialRates({\n    success: true,\n    data: { mobile: [{ buyCode: "USD", sellCode: "RUB", buyRate: "75.44", sellRate: "80.85" }] }\n  }, observed);\n  assert.equal(official.buy, 75.44);\n  assert.equal(official.sell, 80.85);\n  assert.equal(official.provider, "bankffin.kz");\n\n${selfTestMarker}`;
replaceOnce(selfTestMarker, selfTestInsert, "official API self-test");

if (source === original) {
  console.log("No patch changes required");
} else {
  await writeFile(target, source, "utf8");
  console.log("scripts/update-rates.mjs patched");
}
