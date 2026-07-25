const targets = {
  creditBureau: "https://creditbureau.kz/currency/freedom-bank/",
  bankffin: "https://bankffin.kz/ru/exchange-rates"
};

const chromeHeaders = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache"
};

async function fetchText(url, headers = chromeHeaders) {
  const response = await fetch(url, { redirect: "follow", headers });
  const body = await response.text();
  return { response, body };
}

async function probe(name, url, headers = {}) {
  try {
    const { response, body } = await fetchText(url, headers);
    console.log(`\n=== ${name} ===`);
    console.log(`status=${response.status} url=${response.url} bytes=${body.length}`);
    console.log(`server=${response.headers.get("server")} content-type=${response.headers.get("content-type")}`);
    console.log(`title=${body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || "—"}`);
    return { response, body };
  } catch (error) {
    console.log(`\n=== ${name} ===`);
    console.log(`fetch error: ${error.stack || error}`);
    return { response: null, body: "" };
  }
}

await probe("CreditBureau default", targets.creditBureau, { "user-agent": "ffin-usdrub-chart/2.0" });
const cb = await probe("CreditBureau browser headers", targets.creditBureau, {
  ...chromeHeaders,
  referer: "https://creditbureau.kz/"
});
console.log(`CreditBureau contains USD/RUB: ${/USD\s*\/\s*RUB/i.test(cb.body)}`);

const bank = await probe("Bankffin browser headers", targets.bankffin, chromeHeaders);
console.log(`Bankffin contains mobile marker: ${/В мобильном приложении/i.test(bank.body)}`);
console.log(`Bankffin contains USD: ${/\bUSD\b/i.test(bank.body)}`);

const scriptUrls = [...bank.body.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
  .map((match) => new URL(match[1], targets.bankffin).href)
  .filter((url) => url.startsWith("https://bankffin.kz/build/assets/"));
console.log(`Bankffin local scripts: ${scriptUrls.length}`);

for (const url of scriptUrls) {
  const { response, body } = await fetchText(url, {
    ...chromeHeaders,
    accept: "*/*",
    referer: targets.bankffin
  });
  console.log(`\n--- asset ${url} status=${response.status} bytes=${body.length} ---`);

  const paths = [...body.matchAll(/["'`]((?:https?:\/\/|\/)[^"'`\\\s]{3,220})["'`]/g)]
    .map((match) => match[1])
    .filter((value) => /(?:api|exchange|currency|rate|course|convert)/i.test(value));
  [...new Set(paths)].slice(0, 80).forEach((value) => console.log(`path ${value}`));

  const snippets = [];
  for (const pattern of [/exchange-rates/ig, /exchangeRates/ig, /currency/ig, /api\//ig, /react-app__exchange-rates/ig]) {
    for (const match of body.matchAll(pattern)) {
      const start = Math.max(0, match.index - 180);
      const end = Math.min(body.length, match.index + 300);
      const snippet = body.slice(start, end).replace(/\s+/g, " ");
      if (!snippets.includes(snippet)) snippets.push(snippet);
      if (snippets.length >= 30) break;
    }
    if (snippets.length >= 30) break;
  }
  snippets.slice(0, 30).forEach((snippet) => console.log(`snippet ${snippet}`));
}
