/**
 * Gesture glyphs — the controls, shown instead of described.
 *
 * Every instruction in the game is one of five touch gestures, so each gets
 * one animated picture of a hand doing it: tap, press-and-hold, let go, drag
 * sideways, and swipe any way. They sit on the button, on the meter where the
 * tap belongs, and over the course when a drag is wanted, so the game can be
 * played without reading a word. All CSS-animated inline SVG: no assets.
 */

// A pointing hand, fingertip at the top centre (24, 6) of a 48x48 box
const HAND = `
  <svg class="g-hand" viewBox="0 0 48 48" aria-hidden="true">
    <path d="M19 8.5a5 5 0 0 1 10 0V22l8.6 2.2A5.2 5.2 0 0 1 41.5 30l-1.4 9.4A6 6 0 0 1 34.2 44H22.6a7 7 0 0 1-5.6-2.8L9.6 31.4a3.6 3.6 0 0 1 5.4-4.7l4 3.6z"
      fill="#fff8ec" stroke="#12261a" stroke-width="2.6" stroke-linejoin="round"/>
  </svg>`;

const ARROW = (dir) => `<svg class="g-arrow g-arrow-${dir}" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 3 L20 13 H15 V21 H9 V13 H4 Z" fill="#fff8ec" stroke="#12261a" stroke-width="2" stroke-linejoin="round"/></svg>`;

const BODY = {
  // One quick touch
  tap: `<i class="g-ripple"></i>${HAND}`,
  // Finger down and kept down while the ring fills
  hold: `<svg class="g-timer" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="19"/></svg>${HAND}`,
  // Finger lifting away
  release: `${ARROW('up')}${HAND}`,
  // Slide left and right
  drag: `${ARROW('left')}${ARROW('right')}${HAND}`,
  // Swipe in any direction (shot shaping)
  shape: `${ARROW('left')}${ARROW('right')}${ARROW('up')}${ARROW('down')}${HAND}`,
  // Hands off: it is happening by itself
  wait: `<svg class="g-spin" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="17"/></svg><i class="g-pause"></i>`,
};

/** HTML for a glyph. kind: tap | hold | release | drag | shape | wait */
export function glyph(kind, extraClass = '') {
  return `<span class="glyph g-${kind} ${extraClass}">${BODY[kind] || ''}</span>`;
}

/**
 * Three steps: how many taps this swing has had, and which is next. A round
 * dot is a tap. auto = a full-power shot: the middle step is not a tap, the
 * bar fills itself, so it is drawn as a MAX tag instead of a dot.
 */
export function pips(done, total = 3, auto = false) {
  let html = '<span class="g-pips">';
  for (let i = 0; i < total; i++) {
    const state = i < done ? 'done' : i === done ? 'now' : '';
    html += auto && i === 1 ? `<b class="${state}">MAX</b>` : `<i class="${state}"></i>`;
  }
  return `${html}</span>`;
}

// Small pictures for the caddie's tips on the intro card
const TIP_ICONS = {
  wind: `<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="#12261a" stroke-width="3.4" stroke-linecap="round">
    <path d="M6 18h22a6 6 0 1 0-6-6"/><path d="M6 27h30a6 6 0 1 1-6 6"/><path d="M6 36h14"/></g></svg>`,
  dots: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M4 12 L44 30" stroke="#12261a" stroke-width="2.4" stroke-dasharray="1 7" stroke-linecap="round" fill="none"/>
    <g fill="#12261a"><circle cx="12" cy="24" r="3.2"/><circle cx="24" cy="30" r="3.2"/><circle cx="36" cy="36" r="3.2"/></g>
    <path d="M30 14 l8 4 -8 4" fill="none" stroke="#1baf7a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  pin: `<svg viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="22" cy="36" rx="19" ry="8" fill="#a9e66f" stroke="#12261a" stroke-width="2.4"/>
    <path d="M34 36V8" stroke="#12261a" stroke-width="3" stroke-linecap="round"/><path d="M34 9l-13 5 13 5z" fill="#ff4d4d" stroke="#12261a" stroke-width="2" stroke-linejoin="round"/></svg>`,
  fast: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="18" width="40" height="12" rx="6" fill="#fff" stroke="#12261a" stroke-width="2.6"/>
    <rect x="26" y="15" width="5" height="18" rx="2.5" fill="#12261a"/><path d="M8 40h10M22 40h6M32 40h3" stroke="#12261a" stroke-width="3" stroke-linecap="round"/></svg>`,
};

/** Icon for a caddie tip: a gesture glyph or one of the small pictures. */
export function tipIcon(name) {
  if (BODY[name]) return glyph(name);
  if (name === 'tap3') return `<span class="tip-pic stack">${glyph('tap')}${pips(0)}</span>`;
  return TIP_ICONS[name] ? `<span class="tip-pic">${TIP_ICONS[name]}</span>` : '';
}
