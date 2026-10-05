import { TZ_PLACES } from './tzPlaces.js';

/**
 * The almanac: where the sun and moon are for a place and an instant, and a
 * guess at the place. Low-precision series (good to a fraction of a degree,
 * which is far finer than a sky needs). Pure maths: no DOM, no three.js.
 *
 * Angles are radians. Azimuth is measured from north, clockwise (east = π/2).
 */

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const OBLIQUITY = RAD * 23.4397;

const daysSinceJ2000 = (date) => date / DAY_MS - 0.5 + 2440588 - 2451545;
const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
const siderealTime = (d, lon) => RAD * (280.16 + 360.9856235 * d) + lon * RAD;

function horizontal(d, lat, lon, body) {
  const phi = lat * RAD;
  const H = siderealTime(d, lon) - body.ra;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(body.dec) + Math.cos(phi) * Math.cos(body.dec) * Math.cos(H));
  const fromSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(body.dec) * Math.cos(phi));
  return { altitude, azimuth: (fromSouth + Math.PI * 3) % (Math.PI * 2) };
}

function sunCoords(d) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

/** Sun as seen from (lat, lon) in degrees at `date`: { altitude, azimuth }. */
export function sunPosition(date, lat, lon) {
  const d = daysSinceJ2000(+date);
  return horizontal(d, lat, lon, sunCoords(d));
}

/** Moon as seen from (lat, lon): { altitude, azimuth, fraction } — fraction is how much of the disc is lit. */
export function moonPosition(date, lat, lon) {
  const d = daysSinceJ2000(+date);
  const s = sunCoords(d), m = moonCoords(d);
  const sunDist = 149598000;
  const sep = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sunDist * Math.sin(sep), m.dist - sunDist * Math.cos(sep));
  return { ...horizontal(d, lat, lon, m), fraction: (1 + Math.cos(inc)) / 2 };
}

/** The instant `hour` hours after local midnight on the day of `date`. */
export function atLocalHour(date, hour) {
  const d = new Date(+date);
  d.setHours(0, 0, 0, 0);
  return new Date(+d + hour * 3600000);
}

/** Local clock time of `date` as fractional hours. */
export function localHour(date) {
  return (date - atLocalHour(date, 0)) / 3600000;
}

/**
 * Today's solar landmarks for a place, as local clock hours:
 * noon/midnight are the sun's high and low points; rise/set are the horizon
 * crossings (null in polar day or night).
 */
export function sunDay(date, lat, lon) {
  const alt = (h) => sunPosition(atLocalHour(date, h), lat, lon).altitude;
  let noon = 0, midnight = 0, hi = -9, lo = 9;
  for (let h = 0; h < 24; h += 1 / 6) {
    const a = alt(h);
    if (a > hi) { hi = a; noon = h; }
    if (a < lo) { lo = a; midnight = h; }
  }
  // The horizon is crossed a touch below zero: refraction plus the sun's own radius
  const crossing = (from, to) => hourOfAltitude(date, lat, lon, -0.83 * RAD, from, to);
  const rise = lo < -0.83 * RAD && hi > -0.83 * RAD ? crossing(noon - 12, noon) : null;
  const set = rise == null ? null : crossing(noon, noon + 12);
  return { noon, midnight, rise, set, high: hi, low: lo };
}

/**
 * The local hour between `from` and `to` (a stretch where the sun only climbs
 * or only falls) at which it stands closest to `altitude`.
 */
export function hourOfAltitude(date, lat, lon, altitude, from, to) {
  const alt = (h) => sunPosition(atLocalHour(date, h), lat, lon).altitude;
  const rising = alt(to) > alt(from);
  let a = from, b = to;
  for (let i = 0; i < 24; i++) {
    const mid = (a + b) / 2;
    if ((alt(mid) < altitude) === rising) a = mid; else b = mid;
  }
  return (a + b) / 2;
}

/**
 * Roughly where the player is, without asking: the reference city of their
 * time zone, or failing that a longitude from the UTC offset and a latitude
 * from which half of the year has daylight saving.
 */
export function guessPlace(zone, januaryOffset = 0, julyOffset = 0) {
  const [region, ...rest] = String(zone || '').split('/');
  const city = rest.join('/');
  const list = TZ_PLACES[region];
  if (list && city) {
    const at = ` ${list}`.indexOf(` ${city}:`);
    if (at >= 0) {
      const [lat, lon] = list.slice(at + city.length + 1).split(' ')[0].split(',').map(Number);
      return { lat, lon, name: city.split('/').pop().replace(/_/g, ' '), source: 'zone' };
    }
  }
  // getTimezoneOffset is minutes *behind* UTC; standard time is the larger of the two
  const lon = -Math.max(januaryOffset, julyOffset) / 4;
  const lat = januaryOffset === julyOffset ? 15 : julyOffset < januaryOffset ? 42 : -35;
  return { lat, lon, name: '', source: 'offset' };
}

/** The player's place as best the browser can tell. */
export function localPlace() {
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* very old browser */ }
  const year = new Date().getFullYear();
  return guessPlace(zone, new Date(year, 0, 1).getTimezoneOffset(), new Date(year, 6, 1).getTimezoneOffset());
}
