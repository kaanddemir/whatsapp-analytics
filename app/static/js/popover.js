/* Popovers and the page-wide Escape chain.
   One shared behaviour for the topbar popovers: click to toggle, only one open
   at a time, close on outside click. */
const popovers = [];

export function closeAllPops(except) {
  popovers.forEach(({ trigger, pop }) => {
    if (pop === except || pop.hidden) return;
    pop.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  });
}

export function bindPopover(trigger, pop) {
  popovers.push({ trigger, pop });
  trigger.addEventListener("click", () => {
    const open = pop.hidden;
    closeAllPops(pop);
    pop.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
  });
}

document.addEventListener("click", (e) => {
  // A click inside a trigger or its own popover is handled above.
  const inside = popovers.some(
    ({ trigger, pop }) => trigger.contains(e.target) || pop.contains(e.target)
  );
  if (!inside) closeAllPops();
});

/* Escape is layered rather than handled in one place: each module registers
   what it wants dismissed. Handlers run last-registered first, so the
   innermost layer answers first, and a handler that returns true consumes the
   key and stops the chain. Only the delete dialog does that: it is modal, so
   Escape must not also close the panel it was opened from. The menus return
   nothing, which is what keeps the old behaviour where one Escape closes a
   menu and the popovers underneath it together. */
const escHandlers = [];

export function onEscape(fn) {
  escHandlers.push(fn);
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  for (let i = escHandlers.length - 1; i >= 0; i--) {
    if (escHandlers[i]() === true) return;
  }
});
