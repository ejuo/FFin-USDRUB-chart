function render() {
  syncRangeInputs();
  renderMetrics();
  renderMeta();
  renderOpportunities();
  renderTable();
  renderChart();
}

function currentView() {
  const start = state.start;
  const end = state.end;
  const freedom = withCarry(state.data.freedom, start, end);
  const market = state.data.market.filter((point) => point.ms >= start && point.ms <= end);
  const comparisons = state.data.comparisons.filter((point) => point.ms >= start && point.ms <= end);
  return { start, end, freedom, market, comparisons };
}

function withCarry(points, start, end) {
  const inside = points.filter((point) => point.ms >= start && point.ms <= end).map((point) => ({ ...point, plotMs: point.ms }));
  const previous = findAtOrBefore(points, start);
  if (previous && (!inside.length || inside[0].ms > start)) {
    inside.unshift({ ...previous, plotMs: start, carried: true, carrySide: "start" });
  }
  const lastAtEnd = findAtOrBefore(points, end);
  const plottedLast = inside.at(-1);
  if (lastAtEnd && (!plottedLast || (plottedLast.plotMs ?? plottedLast.ms) < end)) {
    inside.push({ ...lastAtEnd, plotMs: end, carried: true, carrySide: "end" });
  }
  return inside;
}

function renderMetrics() {
  const freedom = state.data.freedom.at(-1);
  const market = state.data.market.at(-1);
  const comparison = state.data.comparisons.at(-1);

  if (freedom) {
    el.buy.textContent = rate.format(freedom.buy);
    el.sell.textContent = rate.format(freedom.sell);
    el.buyMeta.textContent = `проверено ${formatDateTime(freedom.ms)} · ${qualityLabel(freedom)}`;
    el.sellMeta.textContent = freedom.sourceUpdatedAt
      ? `источник «Актуально»: ${formatDateTime(Date.parse(freedom.sourceUpdatedAt))}`
      : "время изменения источником не опубликовано";
    el.spread.textContent = `${rate.format(freedom.sell - freedom.buy)} ₽`;
    el.spreadMeta.textContent = `${rate.format((freedom.sell - freedom.buy) / ((freedom.sell + freedom.buy) / 2) * 100)}% от середины`;
  } else {
    el.buy.textContent = el.sell.textContent = el.spread.textContent = "—";
  }

  if (market) {
    el.market.textContent = rate.format(market.close);
    el.marketMeta.textContent = `${formatDateTime(market.ms)} · часовая свеча MOEX`;
  } else {
    el.market.textContent = "—";
    el.marketMeta.textContent = "ожидается первый сбор";
  }

  if (comparison) {
    const buyGap = comparison.sell - comparison.market;
    const sellGap = comparison.market - comparison.buy;
    el.buyGap.textContent = `${signed.format(buyGap)} ₽`;
    el.buyGapMeta.textContent = `${percent.format(buyGap / comparison.market * 100)}% · банк продаёт выше рынка`;
    el.sellGap.textContent = `${signed.format(sellGap)} ₽`;
    el.sellGapMeta.textContent = `${percent.format(sellGap / comparison.market * 100)}% · банк покупает ниже рынка`;
  } else {
    el.buyGap.textContent = el.sellGap.textContent = "—";
    el.buyGapMeta.textContent = el.sellGapMeta.textContent = "нужна синхронная часовая точка";
  }
}

function renderMeta() {
  el.period.textContent = `${formatDateTime(state.start)} — ${formatDateTime(state.end)} · ${ZONE_LABEL}`;
  const earliest = earliestTimestamp(state.data);
  const latest = latestDataTimestamp(state.data);
  el.availability.textContent = `Доступные данные: ${formatDateTime(earliest)} — ${formatDateTime(latest)}`;

  const generated = Date.parse(state.data.generatedAt);
  el.stamp.textContent = Number.isFinite(generated)
    ? `файл обновлён ${formatDateTime(generated)}`
    : "время обновления неизвестно";
}

function renderOpportunities() {
  const opportunities = computeOpportunities(currentView().comparisons);
  renderOpportunityCard("buy", opportunities.buy, opportunities.basis);
  renderOpportunityCard("sell", opportunities.sell, opportunities.basis);
}

function renderOpportunityCard(direction, ranked, basis) {
  const isBuy = direction === "buy";
  const gapEl = isBuy ? el.bestBuyGap : el.bestSellGap;
  const timeEl = isBuy ? el.bestBuyTime : el.bestSellTime;
  const detailEl = isBuy ? el.bestBuyDetail : el.bestSellDetail;
  const listEl = isBuy ? el.bestBuyList : el.bestSellList;

  if (!ranked.length) {
    gapEl.textContent = "—";
    timeEl.textContent = "Пока нет синхронных точек";
    detailEl.textContent = "После нескольких ежечасных сборов здесь появятся лучшие часы.";
    listEl.innerHTML = "";
    return;
  }

  const best = ranked[0];
  const gap = opportunityGap(best, direction);
  gapEl.textContent = `${signed.format(gap)} ₽`;
  timeEl.textContent = formatDateTime(best.ms);
  detailEl.textContent = isBuy
    ? `Freedom продаёт ${rate.format(best.sell)} ₽, USDRUBF ${rate.format(best.market)} ₽ · ${basis}`
    : `Freedom покупает ${rate.format(best.buy)} ₽, USDRUBF ${rate.format(best.market)} ₽ · ${basis}`;
  listEl.innerHTML = ranked.map((point, index) => {
    const pointGap = opportunityGap(point, direction);
    return `<li><button type="button" data-select-time="${point.ms}"><span>${index + 1}. ${formatDateTime(point.ms)}</span><strong>${signed.format(pointGap)} ₽</strong></button></li>`;
  }).join("");
  listEl.querySelectorAll("button[data-select-time]").forEach((button) => {
    button.addEventListener("click", () => selectTimestamp(Number(button.dataset.selectTime), true));
  });
}

function computeOpportunities(comparisons) {
  const direct = comparisons.filter((point) => point.method === "direct");
  const basisPoints = direct.length ? direct : comparisons;
  const basis = direct.length ? "прямая пара приложения" : "расчётная оценка через KZT";
  return {
    basis,
    buy: topDistinctHours(basisPoints, (point) => point.sell - point.market),
    sell: topDistinctHours(basisPoints, (point) => point.market - point.buy)
  };
}

function topDistinctHours(points, score, limit = 3) {
  const sorted = [...points].sort((a, b) => score(a) - score(b) || a.ms - b.ms);
  const result = [];
  const used = new Set();
  for (const point of sorted) {
    const key = zoneHourKey(point.ms);
    if (used.has(key)) continue;
    used.add(key);
    result.push(point);
    if (result.length === limit) break;
  }
  return result;
}

function opportunityGap(point, direction) {
  return direction === "buy" ? point.sell - point.market : point.market - point.buy;
}

function renderTable() {
  const view = currentView();
  const opportunities = computeOpportunities(view.comparisons);
  const bestBuyMs = opportunities.buy[0]?.ms;
  const bestSellMs = opportunities.sell[0]?.ms;
  const rows = [...view.comparisons].reverse().slice(0, 30);
  if (!rows.length) {
    el.body.innerHTML = '<tr><td colspan="7" class="placeholder">Синхронные часовые точки ещё не накоплены</td></tr>';
    return;
  }

  el.body.innerHTML = rows.map((point) => {
    const buyGap = point.sell - point.market;
    const sellGap = point.market - point.buy;
    const flags = [point.ms === bestBuyMs ? "лучше купить" : "", point.ms === bestSellMs ? "лучше продать" : ""].filter(Boolean);
    const quality = point.method === "direct" ? "точный" : "расчётный";
    return `<tr class="${flags.length ? "best-row" : ""}" data-time="${point.ms}">
      <td><button class="table-time" type="button" data-select-time="${point.ms}">${formatDateTime(point.ms)}</button>${flags.map((flag) => `<span class="mini-flag">${flag}</span>`).join("")}</td>
      <td>${rate.format(point.buy)}</td>
      <td>${rate.format(point.sell)}</td>
      <td>${rate.format(point.market)}</td>
      <td class="gap-value">${signed.format(buyGap)}</td>
      <td class="gap-value">${signed.format(sellGap)}</td>
      <td><span class="badge ${point.method === "direct" ? "direct" : "derived"}">${quality}</span></td>
    </tr>`;
  }).join("");

  el.body.querySelectorAll("button[data-select-time]").forEach((button) => {
    button.addEventListener("click", () => selectTimestamp(Number(button.dataset.selectTime), true));
  });
}
