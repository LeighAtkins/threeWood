/**
 * A button press that does not wait on the browser's synthesised click.
 *
 * On phones a tap's click can be delayed or dropped (a touch that came just
 * after a swipe on the canvas, say). This fires on the finger lifting from the
 * same element it went down on, with click kept as a fallback for mice and
 * keyboards, and never fires twice for one press.
 *
 * on(root, selector, fn): fn(matchedElement, event) for presses inside root.
 */
export function onPress(root, selector, fn) {
  let down = null, fired = 0;
  const hit = (e) => e.target.closest?.(selector);
  root.addEventListener('pointerdown', (e) => { down = hit(e); });
  root.addEventListener('pointerup', (e) => {
    const el = hit(e);
    if (el && el === down && !el.disabled) { fired = performance.now(); e.stopPropagation(); fn(el, e); }
    down = null;
  });
  root.addEventListener('click', (e) => {
    const el = hit(e);
    if (!el || el.disabled) return;
    e.stopPropagation();
    if (performance.now() - fired < 600) return; // already handled on pointerup
    fn(el, e);
  });
}
