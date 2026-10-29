import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/classify.js';
import { SOURCES } from '../config/sources.js';

const ctx = { matchers: { players: () => [], teams: () => [] }, athleteSport: {} };
const src = (id) => SOURCES.find((s) => s.id === id);
const run = (title, id) => classify({ title, summary: '', link: 'https://news.example/a' }, src(id), ctx);

test('an "Israeli clubs in the world press" search result that names nothing Israeli is not Israeli (and is dropped)', () => {
  for (const [title, id] of [
    ['Richarlison y Lula vs. Neymar y Bolsonaro: la pelea menos pensada por quedarse con un lugar', 'il-world-es'],
    ['Jogos em Direto - St Patrick\'s U19 vs Zalgiris U19', 'il-world-pt'],
    ['Богдановићевих 16 поена у победи Хјустона, Марковић дебитовао (ВИДЕО)', 'il-world-sr'],
    ['Parravicini sulla Salernitana: "Dopo Cosmi serve un tecnico di grande esperienza"', 'il-world-it'],
    ['RSCA Futsal droomt opnieuw van Final Four in Champions League', 'il-world-nl'],
    ['Fenerbahçe, Galatasaray derbisi öncesi son durum', 'il-world-tr'],
  ]) {
    const t = run(title, id);
    assert.equal(t.israel, false, title);
    assert.equal(t.offTarget, true, title);
  }
});

test('the same searches keep real Israeli stories, in any language and script', () => {
  for (const [title, id] of [
    ['Χάποελ Τ.Α.-Αναντολού Εφές 118-88: Απλά, την «σάπισε» στο τρίποντο', 'il-world-el'],
    ['ΟΡΙΣΤΙΚΑ στο «Σπύρος Κυπριανού» η Μακάμπι – Πότε ο πρώτος της αγώνας', 'il-world-el'],
    ['Kramer zadovoljan Makabijem, pa se okrenuo Bajernu', 'il-world-sr'],
    ['Хапоел Тел Авив победи Анадолу Ефес', 'il-world-sr'],
    ['Anadolu Efes, Basketbol Avrupa Ligi\'nde Hapoel ile Bulgaristan\'da karşılaşacak', 'il-world-tr'],
    ['İsrail milli takımı Norveç maçına hazırlanıyor', 'il-world-tr'],
    ['Hapoel Beer Sheva vs Juventus: previa, probabilidades y alineaciones', 'il-world-es'],
    ['Maccabi Tel Aviv, la sorpresa di Coach Kattash', 'il-world-it'],
    ['Seleção de Israel anuncia convocados', 'il-world-pt'],
  ]) {
    const t = run(title, id);
    assert.equal(t.israel, true, title);
    assert.equal(t.offTarget, false, title);
  }
});

test('an Israeli outlet\'s own feed stays Israeli as before; other sources are unchanged', () => {
  assert.equal(run('Ligat HaAl: round 9 preview', 'jpost-sport').israel, true); // a direct feed, not a search
  assert.equal(run('Barcelona beat Sevilla 3-0', 'bbc-football').israel, false);
  assert.equal(run('Maccabi Tel Aviv beat Real Madrid', 'bbc-sport').israel, true);
});
