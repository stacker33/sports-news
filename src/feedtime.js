// Feeds whose clock loses the PM.
//
// voetbalkrant.com and walfoot.be date their articles on a 12-hour clock whose PM is lost: a morning article is dated right, an afternoon or
// evening one comes out exactly 12 hours early (measured on the saved state of 2026-10-19: lag about 1 minute for articles collected before
// 11:00 UTC, about 721 minutes for those collected after, and no article dated between 11:00 and 22:59 UTC). A constant shift would break the
// morning articles, so the correction is conditional and uses only what is known when the article is first seen:
//
//   an article that is NEW (not seen before, the source already read once) is published a few minutes ago. If its feed date plus 12 hours of
//   wall-clock lands within the last 30 minutes (and at most 5 minutes ahead), the feed lost its PM and that is the time. Otherwise the feed
//   date stands (an article whose date is right can never land there: its date plus 12 hours is in the future).
//
// "12 hours of wall-clock": when a daylight-saving change lies between the two instants the epoch difference is 11 or 13 hours, so the
// candidate is the date plus 12 hours, moved by the change in the zone's UTC offset. The original feed date is kept by the caller
// (`feedPublished` on the article); an article seen before keeps the time it was given when first seen.
const H = 3600e3;
export const WINDOW_BEFORE_MS = 30 * 60e3; // the corrected time must be this recent...
export const WINDOW_AFTER_MS = 5 * 60e3; // ...or at most this far ahead (clock skew)

// the zone's offset from UTC at an instant, in ms (positive east of Greenwich)
const formatters = new Map();
export function zoneOffsetMs(epoch, tz) {
  let f = formatters.get(tz);
  if (!f) formatters.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })));
  const p = Object.fromEntries(f.formatToParts(new Date(epoch)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(epoch / 1000) * 1000;
}

// the two ways of reading "12 hours later": 12 elapsed hours, and 12 hours on the zone's wall clock (they differ by an hour across a DST change)
export function plus12(t, tz) {
  const flat = t + 12 * H;
  if (!tz) return [flat];
  const wall = flat + (zoneOffsetMs(t, tz) - zoneOffsetMs(flat, tz));
  return wall === flat ? [flat] : [flat, wall];
}

// t: the feed's date (epoch ms), now: the collector run's time. -> the corrected epoch, or t unchanged
export function fixClock12(t, now, tz) {
  if (!Number.isFinite(t) || !Number.isFinite(now)) return t;
  if (t > now - 11 * H) return t; // a lost PM puts the date about 12 hours back: anything more recent is a date that was right
  for (const c of plus12(t, tz)) if (c >= now - WINDOW_BEFORE_MS && c <= now + WINDOW_AFTER_MS) return c;
  return t;
}

// What src/collect.js does with one article of a clock12 source: -> { published, feedPublished }.
//   the first read of a source (everything in the feed is old): the feed's date stands;
//   an article seen before: keeps the time it was given when it was first seen (the feed gives the same wrong date again on every run, and the
//     correction only fits while the article is a few minutes old);
//   a new article: fixClock12.
// feedPublished is the feed's own date, set only when `published` is a correction.
export function settleClock12({ published, now, tz, prev = null, firstRead = false }) {
  if (!Number.isFinite(published) || firstRead) return { published, feedPublished: null };
  if (prev?.published != null && !prev.dateUnknown) return { published: prev.published, feedPublished: prev.feedPublished ?? null };
  const fixed = fixClock12(published, now, tz);
  return fixed !== published ? { published: fixed, feedPublished: published } : { published, feedPublished: null };
}
