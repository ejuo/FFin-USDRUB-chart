function renderChart() {
  const view = currentView();
  const compact = matchMedia("(max-width: 720px)").matches;
  const width = Math.max(320, Math.round(el.wrap.clientWidth || 1000));
  const height = compact ? 430 : 520;
  const margin = { top: 54, right: compact ? 16 : 28, bottom: 58, left: compact ? 48 : 60 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const values = [];
  for (const point of view.freedom) {
    if (!state.hidden.has("buy") && Number.isFinite(point.buy)) values.push(point.buy);
    if (!state.hidden.has("sell") && Number.isFinite(point.sell)) values.push(point.sell);
  }
  for (const point of view.market) {
    if (!state.hidden.has("market") && Number.isFinite(point.close)) values.push(point.close);
  }

  el.chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  el.chart.setAttribute("height", String(height));
  el.empty.hidden = values.length > 0;

  if (!values.length) {
    el.chart.innerHTML = '<title id="svg-title">График USD/RUB</title><desc id="svg-desc">Нет данных за выбранный период.</desc>';
    el.tooltip.hidden = true;
    renderInspector(null);
    return;
  }

  const scale = niceScale(Math.min(...values), Math.max(...values), compact ? 5 : 7);
  const x = (ms) => margin.left + (ms - view.start) / Math.max(1, view.end - view.start) * plotW;
  const y = (value) => margin.top + (scale.max - value) / (scale.max - scale.min) * plotH;
  const out = [
    '<title id="svg-title">Внутридневной график USD/RUB</title>',
    '<desc id="svg-desc">Курсы покупки и продажи Freedom Bank, часовые свечи USDRUBF и лучшие часы по разрыву с рынком.</desc>'
  ];

  for (const tick of scale.ticks) {
    const yp = y(tick);
    out.push(`<line class="grid-line" x1="${margin.left}" y1="${yp}" x2="${width - margin.right}" y2="${yp}"/>`);
    out.push(`<text class="axis-label" x="${margin.left - 10}" y="${yp + 4}" text-anchor="end">${axis(tick)}</text>`);
  }

  for (const tick of timeTicks(view.start, view.end, compact ? 5 : 7)) {
    const xp = x(tick);
    const parts = timeTickParts(tick, view.end - view.start);
    out.push(`<line class="grid-line vertical" x1="${xp}" y1="${margin.top}" x2="${xp}" y2="${height - margin.bottom}"/>`);
    out.push(`<text class="axis-label axis-x" x="${xp}" y="${height - 28}"><tspan x="${xp}">${escapeHtml(parts[0])}</tspan>${parts[1] ? `<tspan x="${xp}" dy="13">${escapeHtml(parts[1])}</tspan>` : ""}</text>`);
  }

  if (!state.hidden.has("buy") && !state.hidden.has("sell") && view.freedom.length) {
    out.push(`<path class="area" d="${bankAreaPath(view.freedom, x, y)}"/>`);
  }

  drawBank("buy", out, view.freedom, x, y);
  drawBank("sell", out, view.freedom, x, y);
  drawMarket(out, view.market, x, y);

  const opportunities = computeOpportunities(view.comparisons);
  drawOpportunities(out, opportunities, x, y, view, margin, height, width);

  out.push(`<g id="hover" hidden>
    <line class="hover-line" id="hover-line" y1="${margin.top}" y2="${height - margin.bottom}"/>
    <circle class="hover-point buy" id="hover-buy" r="5" hidden/>
    <circle class="hover-point sell" id="hover-sell" r="5" hidden/>
    <circle class="hover-point market" id="hover-market" r="5" hidden/>
  </g>`);
  out.push(`<rect class="capture" tabindex="0" role="slider" aria-label="Выбор времени на графике" x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}"/>`);

  el.chart.innerHTML = out.join("");
  const events = uniqueSorted([
    ...view.freedom.filter((point) => !point.carried).map((point) => point.ms),
    ...view.market.map((point) => point.ms),
    ...view.comparisons.map((point) => point.ms)
  ]);

  state.chartContext = { view, width, height, margin, plotW, plotH, x, y, events, opportunities };
  bindChartInteraction();

  if (!Number.isFinite(state.selectedMs) || state.selectedMs < view.start || state.selectedMs > view.end) {
    state.selectedMs = view.comparisons.at(-1)?.ms || events.at(-1) || null;
  }
  if (Number.isFinite(state.selectedMs)) showSnapshot(state.selectedMs, false, true);
}

function drawBank(key, out, points, x, y) {
  if (state.hidden.has(key) || !points.length) return;
  const actual = points.filter((point) => !point.carried);

  let runStart = 0;
  for (let index = 1; index <= points.length; index += 1) {
    const reachedEnd = index === points.length;
    const changedQuality = !reachedEnd && lineQualityClass(points[index]) !== lineQualityClass(points[index - 1]);
    if (!reachedEnd && !changedQuality) continue;

    const runEnd = index - 1;
    const quality = lineQualityClass(points[runStart]);
    let d = `M${x(points[runStart].plotMs ?? points[runStart].ms).toFixed(2)},${y(points[runStart][key]).toFixed(2)}`;
    for (let cursor = runStart + 1; cursor <= runEnd; cursor += 1) {
      const point = points[cursor];
      d += `H${x(point.plotMs ?? point.ms).toFixed(2)}V${y(point[key]).toFixed(2)}`;
    }
    if (changedQuality) {
      const boundary = points[index];
      d += `H${x(boundary.plotMs ?? boundary.ms).toFixed(2)}`;
    }
    out.push(`<path class="series-line ${key} ${quality}" d="${d}"/>`);

    if (changedQuality) {
      const previous = points[index - 1];
      const boundary = points[index];
      const xp = x(boundary.plotMs ?? boundary.ms).toFixed(2);
      const fromY = y(previous[key]).toFixed(2);
      const toY = y(boundary[key]).toFixed(2);
      if (fromY !== toY) out.push(`<path class="series-line ${key} ${lineQualityClass(boundary)}" d="M${xp},${fromY}V${toY}"/>`);
      runStart = index;
    }
  }

  const every = Math.max(1, Math.ceil(actual.length / 110));
  actual.forEach((point, index) => {
    if (index % every !== 0 && index !== actual.length - 1) return;
    out.push(`<circle class="series-point ${key} ${lineQualityClass(point)}" cx="${x(point.ms)}" cy="${y(point[key])}" r="${point.resolution === "intraday" ? 3.2 : 2.5}"><title>${formatDateTime(point.ms)} — ${rate.format(point[key])}</title></circle>`);
  });
}

function lineQualityClass(point) {
  return point.method === "derived-cross" || point.resolution === "daily" ? "derived" : "direct";
}

function bankAreaPath(points, x, y) {
  if (!points.length) return "";
  const first = points[0];
  const last = points.at(-1);
  let path = `M${x(first.plotMs ?? first.ms).toFixed(2)},${y(first.sell).toFixed(2)}`;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const xp = x(point.plotMs ?? point.ms).toFixed(2);
    path += `H${xp}V${y(point.sell).toFixed(2)}`;
  }
  path += `L${x(last.plotMs ?? last.ms).toFixed(2)},${y(last.buy).toFixed(2)}`;
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const point = points[index];
    const xp = x(point.plotMs ?? point.ms).toFixed(2);
    path += `H${xp}V${y(point.buy).toFixed(2)}`;
  }
  return `${path}Z`;
}

function drawMarket(out, points, x, y) {
  if (state.hidden.has("market") || !points.length) return;
  const segments = [];
  let current = [points[0]];
  const connectors = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const threshold = previous.resolution === "daily" || point.resolution === "daily" ? 3 * DAY : 4.5 * HOUR;
    if (point.ms - previous.ms <= threshold) {
      current.push(point);
    } else {
      segments.push(current);
      connectors.push([previous, point]);
      current = [point];
    }
  }
  segments.push(current);

  for (const segment of segments) {
    if (segment.length >= 2) out.push(`<path class="series-line market" d="${linePath(segment, (point) => x(point.ms), (point) => y(point.close))}"/>`);
  }
  for (const [from, to] of connectors) {
    out.push(`<path class="series-line market market-gap" d="M${x(from.ms).toFixed(2)},${y(from.close).toFixed(2)}L${x(to.ms).toFixed(2)},${y(to.close).toFixed(2)}"><title>Перерыв в торгах</title></path>`);
  }

  const every = Math.max(1, Math.ceil(points.length / 110));
  points.forEach((point, index) => {
    if (index % every !== 0 && index !== points.length - 1) return;
    out.push(`<circle class="series-point market" cx="${x(point.ms)}" cy="${y(point.close)}" r="2.5"><title>${formatDateTime(point.ms)} — ${rate.format(point.close)}</title></circle>`);
  });
}

function drawOpportunities(out, opportunities, x, y, view, margin, height, width) {
  drawOpportunityDirection(out, opportunities.buy, "buy-op", "лучше купить", "sell", x, y, view, margin, height, width);
  drawOpportunityDirection(out, opportunities.sell, "sell-op", "лучше продать", "buy", x, y, view, margin, height, width);
}

function drawOpportunityDirection(out, ranked, className, label, bankKey, x, y, view, margin, height, width) {
  ranked.forEach((point, index) => {
    if (point.ms < view.start || point.ms > view.end) return;
    const xp = x(point.ms);
    const bankY = y(point[bankKey]);
    const marketY = y(point.market);
    const rank = index + 1;
    if (index === 0) {
      const anchor = xp < width * 0.25 ? "start" : xp > width * 0.75 ? "end" : "middle";
      const labelX = anchor === "start" ? xp + 6 : anchor === "end" ? xp - 6 : xp;
      const gap = bankKey === "sell" ? point.sell - point.market : point.market - point.buy;
      out.push(`<line class="opportunity-line ${className}" x1="${xp}" y1="${margin.top}" x2="${xp}" y2="${height - margin.bottom}"/>`);
      out.push(`<text class="opportunity-label ${className}" x="${labelX}" y="${margin.top - 20}" text-anchor="${anchor}">${label} · ${escapeHtml(signed.format(gap))} ₽</text>`);
      out.push(`<text class="opportunity-time ${className}" x="${labelX}" y="${margin.top - 7}" text-anchor="${anchor}">${escapeHtml(shortDateTime.format(new Date(point.ms)))}</text>`);
    }
    out.push(`<path class="opportunity-marker ${className}" d="${diamondPath(xp, bankY, index === 0 ? 6.5 : 5)}"><title>${label} №${rank}: ${formatDateTime(point.ms)}</title></path>`);
    out.push(`<circle class="opportunity-market ${className}" cx="${xp}" cy="${marketY}" r="${index === 0 ? 5 : 3.5}"><title>USDRUBF ${rate.format(point.market)}</title></circle>`);
    if (index > 0) out.push(`<text class="opportunity-rank ${className}" x="${xp}" y="${bankY + 3}">${rank}</text>`);
  });
}
