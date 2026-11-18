// The replay of the radar's runs on a saved state (shared by scripts/bench-g1.mjs and scripts/bench-g1-telegram.mjs). OFFLINE.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clusterItems, buildStory } from '../src/cluster.js';
import { mergeSameEvent } from '../src/merge.js';
import { bigEvent, editorialBoost, markLocal, markLow, memberLocal } from '../src/editorial.js';
import { storyEvidence, storyCoverage, storyViews } from '../src/roles.js';
import { editorialRank, loadRankConfig, loadVocabulary } from '../src/rank.js';
import { SOURCES } from '../config/sources.js';
import { israeliOnlyStory } from '../src/capselect.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const H = 3600e3;
export function loadReplay(statePath, entitiesPath = join(dirname(statePath), 'entities.json')) {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const edb = JSON.parse(readFileSync(entitiesPath, 'utf8'));
  const items = state.items.map((it) => ({ ...it, tr: state.tr?.[it.id] ? { en: state.tr[it.id].en } : null, athletes: it.athletes || [], teams: it.teams || [], ents: it.ents || [] }));
  const end = Math.max(...items.map((i) => i.published));
  const rankCfg = loadRankConfig(join(ROOT, 'config', 'editorial-rank.json'));
  loadVocabulary(join(ROOT, 'config', 'vocabulary.json'));

  const entById = new Map();
  for (const [k, t] of Object.entries(edb.teams)) entById.set(`t${k}`, { k: 'team', id: `t${k}`, sport: t.sport });
  for (const [k, p] of Object.entries(edb.players)) entById.set(`p${k}`, { k: 'player', id: `p${k}`, team: `t${p.team}` });
  const COMP_OF_365 = { 42: 'c-ligat', 43: 'c-leumit', 7: 'c-epl', 11: 'c-laliga', 17: 'c-seriea', 25: 'c-bundes', 35: 'c-ligue1', 572: 'c-ucl', 573: 'c-uel', 7685: 'c-uecl', 47: 'c-winner', 569: 'c-euroleague', 329: 'c-eurocup', 103: 'c-nba' };
  const teamComps = (id) => (edb.teams?.[String(id).slice(1)]?.comps || []).map((c) => COMP_OF_365[c]).filter(Boolean);
  const compsOf = (members) => {
    const set = new Set();
    for (const m of members) for (const id of m.ents || []) {
      if (id.startsWith('c-')) set.add(id);
      const e = entById.get(id);
      if (e?.k === 'team') teamComps(id).forEach((c) => set.add(c));
      else if (e?.k === 'player' && e.team) teamComps(e.team).forEach((c) => set.add(c));
    }
    return [...set];
  };
  const tagsOf = (members) => {
    const count = new Map();
    for (const m of members) for (const id of new Set(m.ents || [])) count.set(id, (count.get(id) || 0) + 1);
    const minShare = members.length > 5 ? Math.ceil(members.length * 0.2) : 1;
    return [...count].filter(([id, n]) => n >= minShare && (id.startsWith('c-') || entById.get(id)?.k === 'team')).map(([id]) => ({ k: id.startsWith('c-') ? 'comp' : 'team', id }));
  };

  // the stories as the cap receives them at time T (the stages of src/collect.js before the cap), newest last article first
  function eligibleAt(T) {
    const live = items.filter((i) => (i.seen ?? i.published) <= T && T - i.published <= 48 * H && !i.hidden);
    const merged = mergeSameEvent(clusterItems(live.map((i) => ({ ...i }))), {});
    const out = [];
    for (const members of merged) {
      let s = { ...buildStory(members, T), _members: members, comps: compsOf(members), tags: tagsOf(members) };
      if (T - s.latest > 36 * H) continue;
      s.big = s.sourceCount >= 3 || s.langs.length >= 3 || ((s.top || s.breaking) && s.sourceCount >= 2);
      if (s.sport === 'other' && !(s.israel || s.abroad || (s.sourceCount >= 8 && s.langs.length >= 3) || bigEvent(s))) continue;
      s = markLow(markLocal(editorialBoost(s), (m) => memberLocal(m, undefined)));
      if (s._members.every((m) => m.assist) && !(s.israel || s.abroad || s.teams.length)) continue;
      out.push(s);
    }
    return out.sort((a, b) => b.latest - a.latest);
  }
  // the source configuration gives each article's origin (Israeli / foreign), as in src/collect.js (user-added and per-athlete sources are not in it)
  const srcById = new Map(SOURCES.map((x) => [x.id, x]));
  // -> { score, israeliOnly } as src/collect.js editorialScoreOf: israeliOnly = only Israeli sites carry the story (the page's foreignOnly)
  const scoreOf = (s) => {
    const { roles, ...ev } = storyEvidence(s, (m) => srcById.get(m.sourceId));
    const score = editorialRank({ ...s, ev, cov: storyCoverage(s, { ok: false }, ev) }, { now: s._now, cfg: rankCfg }).score;
    return { score, israeliOnly: israeliOnlyStory(ev, s._members, roles), ilmon: storyViews(s, ev).includes('i') };
  };


  return { items, end, eligibleAt, scoreOf };
}
