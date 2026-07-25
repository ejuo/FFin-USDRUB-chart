const chromeHeaders = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  accept: "application/json,text/plain,*/*",
  "accept-language": "ru-RU,ru;q=0.9,en;q=0.7",
  referer: "https://bankffin.kz/ru/exchange-rates",
  "x-requested-with": "XMLHttpRequest"
};

async function probe(name, url, headers = chromeHeaders) {
  try {
    const response = await fetch(url, { redirect: "follow", headers });
    const body = await response.text();
    console.log(`\n=== ${name} ===`);
    console.log(`status=${response.status} url=${response.url} bytes=${body.length}`);
    console.log(`content-type=${response.headers.get("content-type")}`);
    console.log(body.slice(0, 4000));
  } catch (error) {
    console.log(`\n=== ${name} ERROR ===`);
    console.log(error.stack || error);
  }
}

await probe("Freedom official getRates", "https://bankffin.kz/exchange-rates/getRates");
await probe("Freedom locale getRates", "https://bankffin.kz/ru/exchange-rates/getRates");

const params = new URLSearchParams({
  "iss.meta": "off",
  "iss.only": "candles,candles.cursor",
  "candles.columns": "begin,end,open,close,high,low,value,volume",
  interval: "60",
  from: "2026-07-20",
  till: "2026-07-25",
  start: "0"
});
await probe(
  "MOEX board candles",
  `https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/USDRUBF/candles.json?${params}`,
  { "user-agent": chromeHeaders["user-agent"], accept: "application/json" }
);
await probe(
  "MOEX default-board candles",
  `https://iss.moex.com/iss/engines/futures/markets/forts/securities/USDRUBF/candles.json?${params}`,
  { "user-agent": chromeHeaders["user-agent"], accept: "application/json" }
);
