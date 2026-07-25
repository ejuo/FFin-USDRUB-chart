# USD/RUB: Freedom Bank и USDRUBF

Адаптивный статический сайт, который накладывает на один график:

- покупку и продажу USD/RUB в мобильном приложении Freedom Bank;
- дневное закрытие вечного фьючерса `USDRUBF`, график которого опубликован на РБК Quote.

Доступны диапазоны **2 недели** и **месяц**, интерактивные подсказки, отключение рядов, последние значения и таблица по дням.

## Откуда берутся данные

Банковская страница не публикует открытый исторический API прямой пары USD/RUB, поэтому GitHub Actions раз в три часа сохраняет проверенный снимок в `data/rates.json`. Сборщик сначала читает прямую мобильную пару из публичной таблицы CreditBureau, а при её недоступности рассчитывает кросс из официальных курсов Freedom Bank.

Дневные свечи `USDRUBF` загружаются из MOEX ISS. Браузер дополнительно запрашивает свежую историю напрямую; при ошибке используется последний сохранённый снимок.

У банковских точек есть поле `method`:

- `direct` — точная строка `USD / RUB` из таблицы мобильного приложения;
- `derived-cross` — оценка по опубликованным курсам `USD/KZT` и `RUB/KZT`.

Формула расчётной точки:

```text
Freedom покупает USD/RUB = USD/KZT покупка ÷ RUB/KZT продажа
Freedom продаёт USD/RUB = USD/KZT продажа ÷ RUB/KZT покупка
```

Расчётные участки показаны пунктиром и не выдаются за точные. Пропуски не интерполируются.

## Важно о сравнении

`USDRUBF` — биржевой вечный фьючерс, а не банковский курс обмена. Он используется как рыночный ориентир; банк не обязан проводить обмен по цене фьючерса.

## Источники

- Freedom Bank: <https://bankffin.kz/ru/exchange-rates>
- прямая мобильная пара: <https://creditbureau.kz/currency/freedom-bank/>
- РБК Quote, USDRUBF: <https://www.rbc.ru/quote/ticker/338247>
- MOEX ISS: <https://iss.moex.com/iss/reference/155>
- стартовый архив USD/KZT: <https://themoney.kz/banks/freedom-finance-bank/usd/>
- стартовый архив RUB/KZT: <https://themoney.kz/banks/freedom-finance-bank/rub/>

## Локальный запуск

Требуется Node.js 22+.

```bash
npm run check
npm run build
python3 -m http.server 8000 -d _site
```

Затем открыть `http://localhost:8000`.

Обновление данных вручную:

```bash
npm run update
```

## Публикация

Workflow `Deploy GitHub Pages` публикует сайт после изменения ветки `master`. В настройках репозитория нужно один раз выбрать **Settings → Pages → Source → GitHub Actions**.
