const pageUrl = "https://bankffin.kz/ru/exchange-rates";
const apiUrl = "https://bankffin.kz/api/exchange-rates/getRates";
const browserHeaders = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,*/*",
  "accept-language": "ru-RU,ru;q=0.9,en;q=0.7"
};

const pageResponse = await fetch(pageUrl, { headers: browserHeaders });
const page = await pageResponse.text();
const csrf = page.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i)?.[1] || "";
console.log(`page status=${pageResponse.status} csrf=${csrf ? "present" : "missing"}`);

for (const includeCsrf of [false, true]) {
  const headers = {
    ...browserHeaders,
    accept: "application/json,text/plain,*/*",
    referer: pageUrl,
    "x-requested-with": "XMLHttpRequest"
  };
  if (includeCsrf) headers["x-csrf-token"] = csrf;

  const response = await fetch(apiUrl, { headers });
  const text = await response.text();
  console.log(`\n=== API csrf=${includeCsrf} status=${response.status} type=${response.headers.get("content-type")} bytes=${text.length} ===`);
  try {
    const json = JSON.parse(text);
    console.log(JSON.stringify(json, null, 2).slice(0, 16000));
  } catch {
    console.log(text.slice(0, 4000));
  }
}
