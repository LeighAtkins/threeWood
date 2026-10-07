/**
 * Is this tab running the latest build?
 *
 * The service worker keeps the game playable offline, which also means a tab
 * (or a home-screen app) left open for days keeps running the code it opened
 * with. Alone that is harmless; in a room, two different builds talk past each
 * other. This asks the server for the page again and compares its game script
 * with the one we are running.
 */

/** The build this tab was made from (set by vite.config.js). */
export const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';

const script = (html) => html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1] || null;

/** Resolves true if the server has a newer game than the one running here. */
export async function isStale() {
  try {
    const mine = document.querySelector('script[type="module"][src]')?.getAttribute('src');
    if (!mine || !/\/assets\//.test(mine)) return false; // dev server: always fresh
    const res = await fetch(`${location.pathname}?fresh=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const theirs = script(await res.text());
    return !!theirs && theirs !== mine;
  } catch {
    return false; // offline: carry on with what we have
  }
}

/** Reload into the latest build, keeping the room code in the address. */
export function reloadFresh(room) {
  const url = new URL(location.href);
  url.searchParams.delete('fresh');
  if (room) url.searchParams.set('room', room);
  location.replace(url.toString());
}
