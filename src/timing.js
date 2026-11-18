// How long each major stage of a collector run takes, measured at the real boundaries of src/collect.js (not estimated).
// mark(name) records the time since the previous mark; line() is one log line with a fixed, small set of keys.
//   setup    state, athletes, teams, rivals, game info, player cards, the list of sources
//   fetch    reading the feeds
//   parse    the new articles: filtering, dates, de-duplication
//   enrich   translating titles, entities and tags, corrections, the sport model, popularity signals
//   cluster  grouping articles into stories and the story filters
//   rank     the cap (CAP_G1), evidence and the editorial rank
//   ai       summaries, their translations, the language model's cards
//   notify   Telegram, trends, the morning brief
//   publish  the data files, feedback, mail, source requests, the saved state
export function stageTimer(now = () => Number(process.hrtime.bigint()) / 1e6) {
  const t0 = now();
  let last = t0;
  const ms = {};
  return {
    mark(name) {
      const t = now();
      ms[name] = Math.round((ms[name] || 0) + (t - last));
      last = t;
    },
    line() {
      const total = Math.round(now() - t0);
      return `[timing] ${JSON.stringify({ ...ms, total })}`;
    },
    ms: () => ({ ...ms }),
  };
}
