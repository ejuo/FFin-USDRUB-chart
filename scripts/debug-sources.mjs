const pageUrl = "https://bankffin.kz/ru/exchange-rates";
const apiUrl = "https://bankffin.kz/api/exchange-rates/getRates";
const headers = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  accept: "application/json,text/plain,*/*",
  "accept-language": "ru-RU,ru;q=0.9,en;q=0.7",
  referer: pageUrl,
  "x-requested-with": "XMLHttpRequest"
};
const response = await fetch(apiUrl, { headers });
const json = await response.json();
const row = json?.data?.mobile?.find((item) => item.buyCode === "USD" && item.sellCode === "RUB");
console.log(`status=${response.status}`);
console.log(`headers date=${response.headers.get("date")} etag=${response.headers.get("etag")} cache=${response.headers.get("cache-control")} last-modified=${response.headers.get("last-modified")}`);
console.log(`top-level keys=${Object.keys(json || {}).join(",")}`);
console.log(`data keys=${Object.keys(json?.data || {}).join(",")}`);
console.log(`USD/RUB row=${JSON.stringify(row)}`);
for (const [key, value] of Object.entries(json || {})) {
  if (key !== "data") console.log(`${key}=${JSON.stringify(value)}`);
}
for (const [key, value] of Object.entries(json?.data || {})) {
  if (!Array.isArray(value)) console.log(`data.${key}=${JSON.stringify(value)}`);
  else console.log(`data.${key}.length=${value.length}`);
}
