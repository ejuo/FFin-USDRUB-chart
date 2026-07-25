function bindChartInteraction() {
  const context = state.chartContext;
  const capture = el.chart.querySelector(".capture");
  if (!capture || !context.events.length) return;

  const move = (event) => {
    if (state.pinned && event.pointerType !== "mouse") return;
    const rect = el.chart.getBoundingClientRect();
    const svgX = (event.clientX - rect.left) / rect.width * context.width;
    const ratio = Math.max(0, Math.min(1, (svgX - context.margin.left) / context.plotW));
    const target = context.view.start + ratio * (context.view.end - context.view.start);
    const nearest = nearestValue(context.events, target);
    showSnapshot(nearest, true, false);
  };

  capture.addEventListener("pointermove", move);
  capture.addEventListener("pointerdown", (event) => {
    move(event);
    state.pinned = true;
    capture.classList.add("pinned");
  });
  capture.addEventListener("pointerleave", () => {
    if (!state.pinned) el.tooltip.hidden = true;
  });
  capture.addEventListener("pointercancel", () => {
    if (!state.pinned) el.tooltip.hidden = true;
  });
  capture.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") {
      state.pinned = false;
      capture.classList.remove("pinned");
      el.tooltip.hidden = true;
      return;
    }
    let index = Math.max(0, context.events.findIndex((value) => value >= (state.selectedMs ?? context.events.at(-1))));
    if (event.key === "ArrowLeft") index = Math.max(0, index - 1);
    if (event.key === "ArrowRight") index = Math.min(context.events.length - 1, index + 1);
    if (event.key === "Home") index = 0;
    if (event.key === "End") index = context.events.length - 1;
    state.pinned = true;
    showSnapshot(context.events[index], true, false);
  });
}

function selectTimestamp(ms, pin = true) {
  if (!Number.isFinite(ms)) return;
  state.selectedMs = ms;
  state.pinned = pin;
  if (ms < state.start || ms > state.end) {
    const span = Math.min(24 * HOUR, state.end - state.start);
    state.start = ms - span / 2;
    state.end = ms + span / 2;
    state.rangeKey = "custom";
    el.customForm.hidden = false;
    const customButton = $(".range-button[data-custom]");
    if (customButton) setActiveRangeButton(customButton);
    render();
    return;
  }
  showSnapshot(ms, true, false);
  el.wrap.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showSnapshot(ms, showTooltip, persistent) {
  const context = state.chartContext;
  if (!context) return;
  const snapshot = snapshotAt(ms, context.view);
  if (!snapshot) return;
  state.selectedMs = snapshot.ms;
  renderInspector(snapshot);

  const layer = el.chart.querySelector("#hover");
  const line = el.chart.querySelector("#hover-line");
  const points = {
    buy: el.chart.querySelector("#hover-buy"),
    sell: el.chart.querySelector("#hover-sell"),
    market: el.chart.querySelector("#hover-market")
  };
  if (!layer || !line) return;

  const xp = context.x(snapshot.ms);
  layer.hidden = false;
  line.setAttribute("x1", xp);
  line.setAttribute("x2", xp);

  for (const [key, point] of Object.entries(points)) {
    const value = snapshot[key];
    point.hidden = !Number.isFinite(value) || state.hidden.has(key);
    if (!point.hidden) {
      point.setAttribute("cx", xp);
      point.setAttribute("cy", context.y(value));
    }
  }

  if (!showTooltip && !state.pinned && !persistent) return;
  el.tooltip.innerHTML = tooltipHtml(snapshot);
  el.tooltip.hidden = false;
  const rect = el.chart.getBoundingClientRect();
  const screenX = xp / context.width * rect.width;
  const visibleY = [snapshot.buy, snapshot.sell, snapshot.market].filter(Number.isFinite).map(context.y);
  const top = visibleY.length ? Math.min(...visibleY) / context.height * rect.height : rect.height / 2;
  el.tooltip.style.left = `${Math.max(115, Math.min(rect.width - 115, screenX))}px`;
  el.tooltip.style.top = `${Math.max(105, top)}px`;
}

function snapshotAt(ms, view) {
  const comparison = nearestPoint(view.comparisons, ms, 46 * 60_000);
  if (comparison) {
    return {
      ms: comparison.ms,
      buy: comparison.buy,
      sell: comparison.sell,
      market: comparison.market,
      comparison,
      bank: findAtOrBefore(state.data.freedom, comparison.ms),
      marketPoint: nearestPoint(state.data.market, Date.parse(comparison.marketTimestamp || comparison.timestamp), MARKET_MAX_AGE)
    };
  }

  const bank = findAtOrBefore(state.data.freedom, ms);
  const marketPoint = nearestPoint(state.data.market, ms, MARKET_MAX_AGE);
  if (!bank && !marketPoint) return null;
  return {
    ms,
    buy: bank?.buy,
    sell: bank?.sell,
    market: marketPoint?.close,
    bank,
    marketPoint,
    comparison: null
  };
}

function tooltipHtml(snapshot) {
  const rows = [
    ["Freedom покупает", snapshot.buy],
    ["Freedom продаёт", snapshot.sell],
    ["USDRUBF", snapshot.market]
  ].filter(([, value]) => Number.isFinite(value))
    .map(([label, value]) => `<div class="tooltip-row"><span>${label}</span><strong>${rate.format(value)}</strong></div>`)
    .join("");
  const gaps = Number.isFinite(snapshot.buy) && Number.isFinite(snapshot.sell) && Number.isFinite(snapshot.market)
    ? `<div class="tooltip-gaps"><span>Купить USD: <b>${signed.format(snapshot.sell - snapshot.market)} ₽</b></span><span>Продать USD: <b>${signed.format(snapshot.market - snapshot.buy)} ₽</b></span></div>`
    : "";
  return `<div class="tooltip-date">${escapeHtml(formatDateTime(snapshot.ms))}</div>${rows}${gaps}<div class="tooltip-quality">${escapeHtml(snapshotQuality(snapshot))}</div>`;
}

function renderInspector(snapshot) {
  if (!snapshot) {
    el.selectedTime.textContent = "Выберите точку на графике";
    el.selectedSource.textContent = "Наведите курсор или коснитесь графика";
    [el.inspectBuy, el.inspectSell, el.inspectMarket, el.inspectBuyGap, el.inspectSellGap, el.inspectSpread].forEach((node) => { node.textContent = "—"; });
    return;
  }
  el.selectedTime.textContent = formatDateTime(snapshot.ms);
  el.selectedSource.textContent = snapshotQuality(snapshot);
  el.inspectBuy.textContent = optional(snapshot.buy);
  el.inspectSell.textContent = optional(snapshot.sell);
  el.inspectMarket.textContent = optional(snapshot.market);
  el.inspectSpread.textContent = Number.isFinite(snapshot.buy) && Number.isFinite(snapshot.sell)
    ? `${rate.format(snapshot.sell - snapshot.buy)} ₽`
    : "—";
  el.inspectBuyGap.textContent = Number.isFinite(snapshot.sell) && Number.isFinite(snapshot.market)
    ? `${signed.format(snapshot.sell - snapshot.market)} ₽`
    : "—";
  el.inspectSellGap.textContent = Number.isFinite(snapshot.buy) && Number.isFinite(snapshot.market)
    ? `${signed.format(snapshot.market - snapshot.buy)} ₽`
    : "—";
}

function snapshotQuality(snapshot) {
  const bank = snapshot.bank || snapshot.comparison;
  const bankText = bank
    ? bank.method === "direct" ? "Freedom: прямая пара приложения" : "Freedom: оценка через KZT"
    : "Freedom: нет точки";
  const sourceTime = bank?.sourceUpdatedAt ? `; источник ${formatDateTime(Date.parse(bank.sourceUpdatedAt))}` : "";
  const marketText = Number.isFinite(snapshot.market) ? "MOEX: часовая свеча" : "MOEX: нет точки";
  return `${bankText}${sourceTime} · ${marketText}`;
}
