// Runtime hardening for chart interaction.
// The visual SVG capture rectangle remains the keyboard-accessible slider, while
// pointer movement is also handled at chart-wrapper level. This makes hover work
// even when another positioned child is the immediate event target.

const bindChartInteractionOnCapture = bindChartInteraction;

bindChartInteraction = function bindChartInteractionOnWholeChart() {
  installEmptyOverlayGuard();
  bindChartInteractionOnCapture();

  const context = state.chartContext;
  const capture = el.chart.querySelector(".capture");
  if (!context?.events?.length || !capture) return;

  state.chartSurfaceAbortController?.abort();
  const controller = new AbortController();
  state.chartSurfaceAbortController = controller;
  const listenerOptions = { signal: controller.signal, passive: true };

  const selectAtPointer = (clientX, clientY) => {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
    const rect = el.chart.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const svgX = (clientX - rect.left) / rect.width * context.width;
    const svgY = (clientY - rect.top) / rect.height * context.height;
    const insidePlot = svgX >= context.margin.left
      && svgX <= context.width - context.margin.right
      && svgY >= context.margin.top
      && svgY <= context.height - context.margin.bottom;
    if (!insidePlot) return false;

    const ratio = Math.max(0, Math.min(1, (svgX - context.margin.left) / context.plotW));
    const target = context.view.start + ratio * (context.view.end - context.view.start);
    const nearest = nearestValue(context.events, target);
    if (!Number.isFinite(nearest)) return false;

    showSnapshot(nearest, true, false);
    markChartInteracted();
    return true;
  };

  const move = (event) => {
    selectAtPointer(event.clientX, event.clientY);
  };

  // Listen on the wrapper rather than only on the SVG rectangle. Events from any
  // child (SVG paths, labels, or overlays) bubble here, so the hover cannot be
  // blocked by a positioned element above the SVG.
  if ("PointerEvent" in window) {
    el.wrap.addEventListener("pointerenter", move, listenerOptions);
    el.wrap.addEventListener("pointermove", move, listenerOptions);
    el.wrap.addEventListener("pointerdown", (event) => {
      if (!selectAtPointer(event.clientX, event.clientY)) return;
      state.pinned = true;
      capture.classList.add("pinned");
    }, listenerOptions);
    el.wrap.addEventListener("pointerleave", () => {
      if (!state.pinned) setTooltipVisible(false);
    }, listenerOptions);
  } else {
    el.wrap.addEventListener("mouseenter", move, listenerOptions);
    el.wrap.addEventListener("mousemove", move, listenerOptions);
    el.wrap.addEventListener("mousedown", (event) => {
      if (!selectAtPointer(event.clientX, event.clientY)) return;
      state.pinned = true;
      capture.classList.add("pinned");
    }, listenerOptions);
    el.wrap.addEventListener("mouseleave", () => {
      if (!state.pinned) setTooltipVisible(false);
    }, listenerOptions);
  }
};

function installEmptyOverlayGuard() {
  const empty = el.empty;
  if (!empty) return;

  const sync = () => {
    const visible = !empty.hidden;
    empty.style.display = visible ? "grid" : "none";
    empty.style.pointerEvents = "none";
    empty.setAttribute("aria-hidden", String(!visible));
  };

  if (!state.emptyOverlayObserver) {
    state.emptyOverlayObserver = new MutationObserver(sync);
    state.emptyOverlayObserver.observe(empty, { attributes: true, attributeFilter: ["hidden"] });
  }
  sync();
}
