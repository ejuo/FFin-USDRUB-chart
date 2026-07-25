const pageUrl = "https://bankffin.kz/ru/exchange-rates";
const headers = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,*/*",
  "accept-language": "ru-RU,ru;q=0.9,en;q=0.7"
};

const page = await (await fetch(pageUrl, { headers })).text();
const scriptUrls = [...page.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
  .map((match) => new URL(match[1], pageUrl).href)
  .filter((url) => url.startsWith("https://bankffin.kz/build/assets/"));

for (const url of scriptUrls) {
  const body = await (await fetch(url, { headers: { ...headers, accept: "*/*", referer: pageUrl } })).text();
  console.log(`\n=== ${url} bytes=${body.length} ===`);
  console.log(`prefix ${body.slice(0, 1400).replace(/\s+/g, " ")}`);

  const patterns = [/baseURL/ig, /axios/ig, /getRates/ig, /\/api\//ig, /api\./ig, /exchange-rates/ig];
  const seen = new Set();
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const start = Math.max(0, match.index - 260);
      const end = Math.min(body.length, match.index + 520);
      const snippet = body.slice(start, end).replace(/\s+/g, " ");
      if (!seen.has(snippet)) {
        seen.add(snippet);
        console.log(`snippet ${snippet}`);
      }
      if (seen.size >= 25) break;
    }
    if (seen.size >= 25) break;
  }

  const urls = [...body.matchAll(/["'`]((?:https?:\/\/|\/)[^"'`\\\s]{2,220})["'`]/g)]
    .map((match) => match[1])
    .filter((value) => /(?:api|exchange|rate|currency)/i.test(value));
  [...new Set(urls)].slice(0, 50).forEach((value) => console.log(`url ${value}`));
}
