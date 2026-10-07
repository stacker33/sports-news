// Real articles the editors corrected (📣 / "wrong category" during the pilot) — so a triage change never brings them back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, JUNK_TITLE } from '../src/classify.js';
import { decideSport, features } from '../src/triage.js';
import { bigEvent, editorialBoost } from '../src/editorial.js';

const ctx = { matchers: { players: () => [], teams: () => [] }, athleteSport: {} };
function verdict(item) {
  if (JUNK_TITLE.test(item.title)) return 'hide';
  const c = classify(item, {}, ctx);
  const d = decideSport(c.ev, null, null, features(item));
  return d.nonSport ? 'hide' : d.sport;
}

const CASES = [
  // non-sport sections of sports sites → hidden
  ['hide', 'https://as.com/meristation/cine/saltan-las-alarmas-por-el-nuevo-poster-de-vengadores-doomsday-quienes-son-las-tres-brujas-de-latveria-f202610-n/', 'Saltan las alarmas por el nuevo póster de ‘Vengadores: Doomsday’: ¿quiénes son las tres brujas de Latveria?'],
  ['hide', 'https://as.com/actualidad/sociedad/el-idilico-pais-europeo-que-esta-ofreciendo-10000-euros-por-irse-a-vivir-alli-playas-y-pueblos-pintorescos-a-25c-en-octubre-f202610-n/', 'El idílico país europeo que está ofreciendo 10.000 euros por irse a vivir allí: playas y pueblos pintorescos a 25°C en octubre'],
  ['hide', 'https://as.com/tikitakas/television/jorge-javier-vazquez-carga-contra-las-azucar-moreno-tenian-un-plan-para-estafar-a-supervivientes-f202610-n/', 'Jorge Javier Vázquez carga contra las Azúcar Moreno: “Tenían un plan para estafar a ‘Supervivientes’”'],
  ['hide', 'https://www.record.pt/fora-de-campo/detalhe/com-mais-de-60-dos-votos-apurados-flavio-bolsonaro-lidera-contagem-no-brasil', 'Com mais de 60% dos votos apurados, Flávio Bolsonaro lidera contagem no Brasil'],
  ['hide', 'https://as.com/meristation/cine/una-de-las-proximas-peliculas-de-el-senor-de-los-anillos-en-peligro-tras-la-fusion-de-warner-y-paramount-f202610-n/', 'Una de las próximas películas de ‘El Señor de los Anillos’, en peligro tras la fusión de Warner y Paramount'],
  ['hide', 'https://www.nytimes.com/athletic/7664665/2026/10/06/connections-sports-edition-hints-answers-oct-6-2026/', 'Connections: Sports Edition today: Hints and answers for Oct. 6, 2026, puzzle No. 743'],
  ['hide', 'https://www.mundodeportivo.com/elotromundo/television/20261006/1004235185/nayades-novia-nacho-borbon-caido-tentacion-andrea-isla-tentaciones-11-galeria-dct.html', "Nayades, la novia de Nacho de Borbón que ha caído en la tentación con Andrea en 'La isla de las tentaciones 11'"],
  ['hide', 'https://as.com/actualidad/politica/los-miles-de-espanoles-que-no-tendran-derecho-a-voto-en-estas-elecciones-f202610-n/', 'Los miles de españoles que no tendrán derecho a voto en estas elecciones'],
  ['hide', 'https://as.com/meristation/noticias/whatsapp-crea-un-modo-para-las-conversaciones-que-no-quieres-que-salgan-de-tu-movil-f202610-n/', 'WhatsApp crea un modo para las conversaciones que no quieres que salgan de tu móvil'],
  ['hide', 'https://as.com/tikitakas/famosos/preocupacion-por-el-estado-de-salud-de-cristina-pedroche-a-ver-si-por-fin-puedo-respirar-f202610-n/', 'Preocupación por el estado de salud de Cristina Pedroche: “A ver si por fin puedo respirar”'],
  // other sports, by the URL section
  ['other', 'https://www.lequipe.fr/Cyclisme-sur-route/Actualites/Le-francais-ronan-auge-place-en-coma-artificiel-apres-une-chute-sur-le-tour-de-langkawi-sa-vie-n-est-pas-en-danger/1722830', 'Le Français Ronan Augé placé en coma artificiel après une chute sur le Tour de Langkawi'],
  ['other', 'https://www.mundodeportivo.com/ciclismo/20261002/1004233932/joven-frances-ronan-auge-coma-inducido-sufrir-grave-caida.html', 'El joven francés Ronan Augé, en coma inducido tras sufrir una grave caída'],
  // still football
  ['football', 'https://www.nytimes.com/athletic/7584152/2026/10/06/men-in-blazers-co-founder-world-cup/', "Men In Blazers' Roger Bennett on the World Cup's U.S. impact and the 'grief' of leaving Goodison", 'Roger Bennett explains what it meant to him after Everton left Goodison Park'],
  // a sports story in a sports section of the same sites is untouched
  ['football', 'https://as.com/futbol/primera/el-real-madrid-prepara-el-clasico-f202610-n/', 'El Real Madrid prepara el Clásico ante el Barcelona'],
];

for (const [expect, link, title, summary = ''] of CASES) {
  test(`${expect}: ${title.slice(0, 60)}`, () => {
    assert.equal(verdict({ title, link, summary }), expect);
  });
}

test('other sports: big events only', () => {
  const st = (title) => ({ title, sport: 'other', _members: [{ title }] });
  assert.ok(bigEvent(st('Alcaraz beats Sinner in the Wimbledon final')));
  assert.ok(bigEvent(st('Verstappen wins the Japanese Grand Prix')));
  assert.ok(bigEvent(st('Chiefs and Eagles set for Super Bowl rematch')));
  assert.ok(!bigEvent(st('Odell Beckham Jr. agrees Giants used him as publicity stunt')));
  assert.ok(!bigEvent(st('49ers pull away from injured-riddled Broncos to stay perfect')));
});

test('ranking: big competitions and transfers up, how-to-watch down', () => {
  const base = { score: 10, pop: 10, title: 'x', _members: [] };
  assert.equal(editorialBoost({ ...base, title: 'Arsenal win again', tags: [{ id: 'c-epl' }] }).score, 12.5);
  assert.equal(editorialBoost({ ...base, title: 'Here we go! Player signs for Napoli' }).score, 13);
  assert.equal(editorialBoost({ ...base, title: 'How to watch Arsenal vs Chelsea: TV channel and live stream' }).score, 6);
  assert.equal(editorialBoost({ ...base, title: 'מכבי ת"א ניצחה', tags: [{ id: 'c-ligat' }] }).score, 12.5);
  assert.equal(editorialBoost({ ...base, title: 'A quiet story' }).score, 10);
});

test('local leagues: low unless Israeli, big competition, European cup, viral or a star', async () => {
  const { markLocal, memberLocal } = await import('../src/editorial.js');
  const greek = { country: 'Greece' };
  const isLocal = (m) => memberLocal(m, m.src);
  const st = (title, extra = {}, members) => ({ score: 10, pop: 10, title, langs: ['el'], _members: members || [{ title, lang: 'el', src: greek, ents: [] }], ...extra });
  // PAOK's domestic news, only Greek outlets → local
  const paok = markLocal(st('ΠΑΟΚ: ο Μιχαηλίδης στην αποστολή'), isLocal);
  assert.equal(paok.local, true);
  assert.equal(paok.score, 3.5);
  // exceptions
  assert.ok(!markLocal(st('Ολυμπιακός κέρδισε', { comps: ['c-euroleague'], sport: 'basketball' }), isLocal).local); // EuroLeague club
  assert.ok(markLocal(st('Η οψιόν στο συμβόλαιο του Μιχαηλίδη', { comps: ['c-eurocup'], sport: 'football' }), isLocal).local); // PAOK football ≠ EuroCup basketball
  assert.ok(!markLocal(st('PAOK - Lyon', {}, [{ title: 'PAOK - Lyon', lang: 'el', src: greek, ents: ['c-uel'] }]), isLocal).local); // a European cup game
  assert.ok(!markLocal(st('Ο Μουρίνιο θυμωμένος', { _members: [{ title: 'Mourinho furious', lang: 'el', src: greek, ents: [] }] }), isLocal).local); // a star
  assert.ok(!markLocal(st('Ο Λιόρ Ρεφαέλοφ', { abroad: true }), isLocal).local); // Israeli angle
  assert.ok(!markLocal(st('PAOK coach sacked', { langs: ['el', 'en', 'tr'] }), isLocal).local); // spreading
  assert.ok(!markLocal(st('PAOK news', {}, [{ title: 'PAOK news', lang: 'el', src: greek, ents: [] }, { title: 'PAOK news', lang: 'en', src: null, ents: [] }]), isLocal).local); // an English outlet covers it
  // a Spanish story is never local
  assert.ok(!markLocal(st('El Betis gana', { langs: ['es'] }, [{ title: 'El Betis gana', lang: 'es', src: { country: 'Spain' }, ents: [] }]), isLocal).local);
});
