const url = "https://bankffin.kz/build/assets/index-d9e77457.js";
const headers = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  accept: "*/*",
  referer: "https://bankffin.kz/ru/exchange-rates"
};
const response = await fetch(url, { headers });
const body = await response.text();
console.log(`status=${response.status} bytes=${body.length}`);
console.log(`prefix ${body.slice(0, 2400).replace(/\s+/g, " ")}`);

const patterns = [/baseURL/ig, /axios/ig, /create\(/ig, /\/api\//ig, /api\./ig, /export\{/ig, /xsrf/ig];
const seen = new Set();
for (const pattern of patterns) {
  for (const match of body.matchAll(pattern)) {
    const start = Math.max(0, match.index - 380);
    const end = Math.min(body.length, match.index + 900);
    const snippet = body.slice(start, end).replace(/\s+/g, " ");
    if (!seen.has(snippet)) {
      seen.add(snippet);
      console.log(`snippet ${snippet}`);
    }
    if (seen.size >= 35) break;
  }
  if (seen.size >= 35) break;
}

const values = [...body.matchAll(/["'`]((?:https?:\/\/|\/)[^"'`\\\s]{2,220})["'`]/g)]
  .map((match) => match[1])
  .filter((value) => /(?:api|exchange|rate|currency)/i.test(value));
[...new Set(values)].slice(0, 80).forEach((value) => console.log(`url ${value}`));
