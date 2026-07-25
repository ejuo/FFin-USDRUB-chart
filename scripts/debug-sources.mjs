const url = "https://bankffin.kz/build/assets/index-d9e77457.js";
const headers = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  accept: "*/*",
  referer: "https://bankffin.kz/ru/exchange-rates"
};
const response = await fetch(url, { headers });
const body = await response.text();
console.log(`status=${response.status} bytes=${body.length}`);
console.log(`tail ${body.slice(-7000).replace(/\s+/g, " ")}`);

const regexes = [
  /\w+\.create\s*\(/g,
  /create\s*\(\s*\{/g,
  /baseURL\s*:/g,
  /withCredentials\s*:/g,
  /export\s*\{/g,
  /const\s+\w+\s*=\s*[^;]{0,300}create/g
];
const seen = new Set();
for (const regex of regexes) {
  for (const match of body.matchAll(regex)) {
    const start = Math.max(0, match.index - 700);
    const end = Math.min(body.length, match.index + 1800);
    const snippet = body.slice(start, end).replace(/\s+/g, " ");
    if (!seen.has(snippet)) {
      seen.add(snippet);
      console.log(`snippet ${snippet}`);
    }
  }
}
