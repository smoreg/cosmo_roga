/* Pan and zoom for the drawing pages.
 *
 * Both pages put a scaled stage inside a scrolling box, so panning is the box's
 * own scroll and zooming is the stage's scale — with one thing to get right:
 * the point under the pointer must not move. Read where it is in the drawing
 * before the scale changes, then put the scroll back so it is still there.
 *
 * A classic script, shared by geomorphs.html and hexmap.html, because both have
 * to work from file:// where modules are refused.
 */
function panZoom(box, opts){
  const {get, set, min = 0.02, max = 12} = opts;
  let dragging = null;

  box.addEventListener("wheel", e=>{
    if (e.ctrlKey) return;                 // leave the browser's own zoom alone
    e.preventDefault();
    const r = box.getBoundingClientRect();
    const px = e.clientX - r.left + box.scrollLeft;
    const py = e.clientY - r.top + box.scrollTop;
    const before = get();
    // A wheel notch is a fixed ratio, so zooming feels the same at every scale.
    const after = Math.min(max, Math.max(min, before * Math.pow(0.9987, e.deltaY)));
    if (after === before) return;
    set(after);
    const k = after / before;
    box.scrollLeft = px * k - (e.clientX - r.left);
    box.scrollTop  = py * k - (e.clientY - r.top);
  }, {passive:false});

  /* Drag anywhere, including over the drawing — the map *is* the drawing, so
     excluding it leaves nothing to grab. A click still selects: the gesture only
     counts as a pan once the pointer has actually moved, and `panned` says so
     for the click handler that fires afterwards. Things with a drag of their
     own, like a placed symbol, keep it. */
  const SLOP = 4;                        // px before a click becomes a drag
  box.addEventListener("pointerdown", e=>{
    if (e.button !== 0 || e.target.closest(".stamp, button, select, input, textarea")) return;
    dragging = {x:e.clientX, y:e.clientY, left:box.scrollLeft, top:box.scrollTop};
    box.panned = false;
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener("pointermove", e=>{
    if (!dragging) return;
    const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
    if (!box.panned && Math.hypot(dx, dy) < SLOP) return;
    box.panned = true;
    box.style.cursor = "grabbing";
    box.scrollLeft = dragging.left - dx;
    box.scrollTop  = dragging.top  - dy;
  });
  const stop = ()=>{ dragging = null; box.style.cursor = ""; };
  box.addEventListener("pointerup", stop);
  box.addEventListener("pointercancel", stop);
}
