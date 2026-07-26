function bindChartInteraction() {
  const context = state.chartContext;
  const capture = el.chart.querySelector(".capture");
  if (!capture || !context.events.length) return;

  ensureChartHint();
  setTooltipVisible(false);

  const move = (event) => {
    if (!Number.isFinite(event.clientX)) return;
    const rect = el.chart.getBoundingClientRect();
    if (!rect.width) return;
    const svgX = (event.clientX - rect.left) / rect.width * context.width;
    const ratio = Math.max(0, Math.min(1, (svgX - context.margin.left) / context.plotW));
    const target = context.view.start + ratio * (context.view.end - context.view.start);
    const nearest = nearestValue(context.events, target);
    showSnapshot(nearest, true, false);
    markChartInteracted();
  };

  capture.addEventListener("pointerenter", move);
  capture.addEventListener("pointermove", move);
  capture.addEventListener("pointerdown", (event) => {
    move(event);
    state.pinned = true;
    capture.classList.add("pinned");
    if (Number.isFinite(event.pointerId)) capture.setPointerCapture?.(event.pointerId);
  });
  capture.addEventListener("pointerleave", () => {
    if (!state.pinned) setTooltipVisible(false);
  });
  capture.addEventListener("pointercancel", () => {
    if (!state.pinned) setTooltipVisible(false);
  });
  capture.addEventListener("focus", () => {
    const selected = Number.isFinite(state.selectedMs) ? state.selectedMs : context.events.at(-1);
    if (Number.isFinite(selected)) showSnapshot(selected, true, false);
  });
  capture.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") {
      state.pinned = false;
      capture.classList.remove("pinned");
      setTooltipVisible(false);
      return;
    }
    let index = Math.max(0, context.events.findIndex((value) => value >= (state.selectedMs ?? context.events.at(-1))));
    if (event.key === "ArrowLeft") index = Math.max(0, index - 1);
    if (event.key === "ArrowRight") index = Math.min(context.events.length - 1, index + 1);
    if (event.key === "Home") index = 0;
    if (event.key === "End") index = context.events.length - 1;
    state.pinned = true;
    capture.classList.add("pinned");
    showSnapshot(context.events[index], true, false);
    markChartInteracted();
  });
}

function ensureChartHint() {
  let hint = el.wrap.querySelector("#chart-interaction-hint");
  if (hint) return hint;
  hint = document.createElement("div");
  hint.id = "chart-interaction-hint";
  hint.className = "chart-interaction-hint";
  hint.innerHTML = '<span aria-hidden="true">↔</span><span>Наведите на график — появятся точное время и значения. Нажмите, чтобы закрепить точку.</span><span class="hint-keys"><kbd>←</kbd><kbd>→</kbd></span>';
  el.wrap.append(hint);
  return hint;
}

function markChartInteracted() {
  el.wrap.querySelector("#chart-interaction-hint")?.classList.add("is-muted");
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
  markChartInteracted();
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
  if (!layer || !line) return;

  const xp = context.x(snapshot.ms);
  setSvgVisible(layer, true);
  line.setAttribute("x1", xp);
  line.setAttribute("x2", xp);

  const series = [
    { key: "buy", value: snapshot.buy },
    { key: "sell", value: snapshot.sell },
    { key: "market", value: snapshot.market }
  ];
  const visibleSeries = [];

  for (const entry of series) {
    const group = el.chart.querySelector(`#hover-series-${entry.key}`);
    const point = el.chart.querySelector(`#hover-${entry.key}`);
    const badge = el.chart.querySelector(`#hover-badge-${entry.key}`);
    const badgeText = badge?.querySelector("text");
    const guide = el.chart.querySelector(`#hover-guide-${entry.key}`);
    const visible = Boolean(group && point && badge && badgeText && guide)
      && Number.isFinite(entry.value)
      && !state.hidden.has(entry.key);

    setSvgVisible(group, visible);
    if (!visible) continue;

    const cy = context.y(entry.value);
    point.setAttribute("cx", xp);
    point.setAttribute("cy", cy);
    badgeText.textContent = rate.format(entry.value);
    visibleSeries.push({ ...entry, group, point, badge, guide, cy });
  }

  placeHoverBadges(visibleSeries, xp, context);
  updateHoverTime(snapshot.ms, xp, context);
  updateCaptureAccessibility(snapshot);

  const shouldShowTooltip = showTooltip || state.pinned;
  if (shouldShowTooltip) {
    el.tooltip.innerHTML = tooltipHtml(snapshot);
    setTooltipVisible(true);
    positionTooltip(snapshot, xp, context);
  } else if (persistent) {
    setTooltipVisible(false);
  }
}

function placeHoverBadges(entries, xp, context) {
  if (!entries.length) return;
  const badgeWidth = 76;
  const badgeHeight = 24;
  const preferRight = xp < context.margin.left + context.plotW * 0.67;
  const badgeX = preferRight
    ? clampNumber(xp + 13, context.margin.left + 4, context.width - context.margin.right - badgeWidth - 4)
    : clampNumber(xp - badgeWidth - 13, context.margin.left + 4, context.width - context.margin.right - badgeWidth - 4);
  const laidOut = layoutHoverLabels(entries, context.margin.top + badgeHeight / 2 + 3, context.height - context.margin.bottom - badgeHeight / 2 - 3, badgeHeight + 4);

  for (const entry of laidOut) {
    const tagY = entry.labelY - badgeHeight / 2;
    entry.badge.setAttribute("transform", `translate(${badgeX},${tagY})`);
    entry.guide.setAttribute("x1", xp);
    entry.guide.setAttribute("y1", entry.cy);
    entry.guide.setAttribute("x2", preferRight ? badgeX : badgeX + badgeWidth);
    entry.guide.setAttribute("y2", entry.labelY);
  }
}

function layoutHoverLabels(entries, minY, maxY, gap) {
  const sorted = entries.map((entry) => ({ ...entry, labelY: entry.cy })).sort((a, b) => a.labelY - b.labelY);
  for (let index = 1; index < sorted.length; index += 1) {
    sorted[index].labelY = Math.max(sorted[index].labelY, sorted[index - 1].labelY + gap);
  }
  if (sorted.at(-1)?.labelY > maxY) {
    const shift = sorted.at(-1).labelY - maxY;
    sorted.forEach((entry) => { entry.labelY -= shift; });
  }
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    sorted[index].labelY = Math.min(sorted[index].labelY, sorted[index + 1].labelY - gap);
  }
  if (sorted[0]?.labelY < minY) {
    const shift = minY - sorted[0].labelY;
    sorted.forEach((entry) => { entry.labelY += shift; });
  }
  return sorted;
}

function updateHoverTime(ms, xp, context) {
  const group = el.chart.querySelector("#hover-time");
  const text = el.chart.querySelector("#hover-time-text");
  if (!group || !text) return;
  const width = 148;
  const x = clampNumber(xp - width / 2, context.margin.left, context.width - context.margin.right - width);
  const y = context.height - context.margin.bottom + 12;
  group.setAttribute("transform", `translate(${x},${y})`);
  text.textContent = shortDateTime.format(new Date(ms));
}

function updateCaptureAccessibility(snapshot) {
  const capture = el.chart.querySelector(".capture");
  if (!capture) return;
  capture.setAttribute("aria-valuenow", String(Math.round(snapshot.ms)));
  capture.setAttribute("aria-valuetext", [
    formatDateTime(snapshot.ms),
    Number.isFinite(snapshot.buy) ? `Freedom покупает ${rate.format(snapshot.buy)}` : null,
    Number.isFinite(snapshot.sell) ? `Freedom продаёт ${rate.format(snapshot.sell)}` : null,
    Number.isFinite(snapshot.market) ? `USDRUBF ${rate.format(snapshot.market)}` : null
  ].filter(Boolean).join("; "));
}

function setSvgVisible(node, visible) {
  if (!node) return;
  node.classList.toggle("is-hidden", !visible);
  node.setAttribute("aria-hidden", String(!visible));
}

function setTooltipVisible(visible) {
  if (!el.tooltip) return;
  el.tooltip.removeAttribute("hidden");
  el.tooltip.classList.toggle("is-visible", visible);
  el.tooltip.setAttribute("aria-hidden", String(!visible));
}

function positionTooltip(snapshot, xp, context) {
  const rect = el.chart.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const screenX = xp / context.width * rect.width;
  const visibleY = [snapshot.buy, snapshot.sell, snapshot.market]
    .filter(Number.isFinite)
    .map((value) => context.y(value) / context.height * rect.height);
  const anchorY = visibleY.length ? Math.min(...visibleY) : rect.height / 2;
  const boxWidth = el.tooltip.offsetWidth || Math.min(286, rect.width - 24);
  const boxHeight = el.tooltip.offsetHeight || 190;
  const padding = 12;

  let left = screenX + 18;
  if (left + boxWidth > rect.width - padding) left = screenX - boxWidth - 18;
  left = clampNumber(left, padding, Math.max(padding, rect.width - boxWidth - padding));

  let top = anchorY - boxHeight - 16;
  if (top < padding) top = anchorY + 18;
  top = clampNumber(top, padding, Math.max(padding, rect.height - boxHeight - padding));

  el.tooltip.style.left = `${left}px`;
  el.tooltip.style.top = `${top}px`;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  const marketCandidate = findAtOrBefore(state.data.market, ms);
  const marketPoint = marketCandidate && ms - marketCandidate.ms <= MARKET_MAX_AGE ? marketCandidate : null;
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
    ["buy", "Freedom покупает", snapshot.buy],
    ["sell", "Freedom продаёт", snapshot.sell],
    ["market", "USDRUBF", snapshot.market]
  ].filter(([, , value]) => Number.isFinite(value))
    .map(([key, label, value]) => `<div class="tooltip-row ${key}"><span><i></i>${label}</span><strong>${rate.format(value)} ₽</strong></div>`)
    .join("");
  const gaps = Number.isFinite(snapshot.buy) && Number.isFinite(snapshot.sell) && Number.isFinite(snapshot.market)
    ? `<div class="tooltip-gaps"><span>Купить USD: <b>${signed.format(snapshot.sell - snapshot.market)} ₽</b></span><span>Продать USD: <b>${signed.format(snapshot.market - snapshot.buy)} ₽</b></span><span>Спред банка: <b>${rate.format(snapshot.sell - snapshot.buy)} ₽</b></span></div>`
    : "";
  return `<div class="tooltip-date"><span>${escapeHtml(formatDateTime(snapshot.ms))}</span><small>${state.pinned ? "точка закреплена" : "точные значения"}</small></div>${rows}${gaps}<div class="tooltip-quality">${escapeHtml(snapshotQuality(snapshot))}</div>`;
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
