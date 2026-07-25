const targets = {
  creditBureau: "https://creditbureau.kz/currency/freedom-bank/",
  bankffin: "https://bankffin.kz/ru/exchange-rates"
};

const chromeHeaders = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "upgrade-insecure-requests": "1"
};

async function probe(name, url, headers = {}) {
  try {
    const response = await fetch(url, { redirect: "follow", headers });
    const body = await response.text();
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
console.log(`CreditBureau prefix: ${cb.body.slice(0, 300).replace(/\s+/g, " ")}`);

const bank = await probe("Bankffin browser headers", targets.bankffin, chromeHeaders);
console.log(`Bankffin contains mobile marker: ${/В мобильном приложении/i.test(bank.body)}`);
console.log(`Bankffin contains USD: ${/\bUSD\b/i.test(bank.body)}`);

const scriptUrls = [...bank.body.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
  .map((match) => new URL(match[1], targets.bankffin).href);
console.log(`Bankffin script count: ${scriptUrls.length}`);
scriptUrls.slice(0, 30).forEach((url) => console.log(`script ${url}`));

const inlineHints = [...bank.body.matchAll(/.{0,100}(?:exchange|currency|rate|курс|api).{0,180}/gi)]
  .slice(0, 20)
  .map((match) => match[0].replace(/\s+/g, " "));
console.log("Bankffin inline hints:");
inlineHints.forEach((hint) => console.log(hint));
