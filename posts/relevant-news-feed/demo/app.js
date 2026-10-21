const main = document.getElementById("main");
// Die öffentliche Demo (`news demo`) setzt data-demo: dieselbe App aus mitgelieferten
// Dateien, ohne Bewerten, Uplift und Merge und ohne die Kacheln, die Vorlieben zeigen.
const DEMO = document.documentElement.hasAttribute("data-demo");
const views = {
  feed: renderFeed, rate: renderRate, uplift: renderUplift, merge: renderMerge,
  world: renderWorld, map: renderMap, stats: renderStats,
};
if (DEMO) for (const v of ["rate", "uplift", "merge"]) delete views[v];

const ICON_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`;
const ICON_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>`;
const ICON_LEAF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 18C5 9 12 5 20 5c0 8-6 14-15 13z"/><path d="M5 18c2-4 5-7 10-9"/></svg>`;
const ICON_FLAME = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c-3.9 0-6.5-2.5-6.5-6 0-2.6 1.6-4.6 3-6.3C9.8 7.2 11 5.6 11 3c3.5 1.6 4.6 4.2 4.3 6.5.9-.3 1.7-1 2.2-2 1 1.5 1.9 3.3 1.9 5.5 0 3.5-3.5 8-7.4 8z"/></svg>`;
const ICON_BOOKMARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-4.2L5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;

function route() {
  const view = location.hash.replace("#", "") || "feed";
  if (view !== "feed") pauseFeedLoading();
  if (view !== "world" && globus) globus.sichtbar(false);
  document.querySelectorAll("#tabbar a").forEach(a =>
    a.classList.toggle("active", a.dataset.view === view));
  document.body.dataset.view = view;
  (views[view] || renderFeed)();
}

async function api(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`${path}: ${resp.status}`);
  return resp.json();
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

const esc = s => (s || "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const dez = v => (v == null ? "–" : String(v).replace(".", ","));
const dez2 = v => (v == null ? "–" : v.toFixed(2).replace(".", ","));

const fmtDate = iso => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
};

// Tages-Überschrift für die Feed-Gruppierung, z. B. "Donnerstag, 17. Juli 2026"
const dayLabel = iso => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};

// Gruppierungsschlüssel zur Überschrift: der **lokale** Tag, nicht das UTC-Präfix.
// Zeitstempel liegen in UTC, ein deutscher Artikel von 00:30 Uhr steht dort als Vortag —
// nach dem Präfix gruppiert bekäme er eine eigene Überschrift mit demselben Datum.
const dayKey = iso => {
  if (!iso) return "";
  if (iso.length === 10) return iso;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function skeletons(n) {
  main.innerHTML = `<div class="grid">${'<div class="skeleton"></div>'.repeat(n)}</div>`;
}

/* ---------- Rubriken ---------- */
// Farben folgen der Karten-Palette (map_template.html, Reihenfolge = config.RUBRIKEN),
// damit „Wirtschaft" überall denselben Ton trägt. Neue Rubriken brauchen hier einen
// Eintrag — wie bei SOURCE_COLORS, sonst erscheinen sie im Grau von „Sonstiges".
const RUBRIK_FARBEN = {
  "IT": "#7aa2f7", "Wirtschaft": "#9ece6a", "Wissenschaft": "#e0af68",
  "Umwelt & Klima": "#3fb27f", "Entertainment": "#f7768e", "Sport": "#bb9af7", "Politik & Gesellschaft": "#73daca",
  "Kultur": "#ff9e64", "Gesundheit": "#7dcfff",
};
const RUBRIK_SONST = "Sonstiges";
const rubrikFarbe = r => RUBRIK_FARBEN[r] || "#8a91a8";

// Ausgeblendete Rubriken; der Server filtert (Pagination), der Client merkt sich nur.
function rubrikenAus() {
  try { return JSON.parse(localStorage.feed_rubriken_aus || "[]"); }
  catch { return []; }
}
function rubrikUmschalten(name) {
  const aus = new Set(rubrikenAus());
  aus.has(name) ? aus.delete(name) : aus.add(name);
  localStorage.feed_rubriken_aus = JSON.stringify([...aus]);
  feedState = null;              // Filter ändert die Seitenzuschnitte: sauber neu laden
  renderFeed();
}

const ICON_FILTER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>`;

// Kopfzeile des Feeds: Filter-Symbol, dahinter das aufklappbare Rubriken-Panel.
// Zustand `offen` lebt nur im DOM — beim Neuaufbau des Feeds ist das Panel wieder zu.
const rubrikParam = () => {
  const aus = rubrikenAus();
  return (aus.length ? `&hide=${encodeURIComponent(aus.join(","))}` : "")
    + (geleseneZeigen() ? "" : "&hide_read=1")
    + (nurPositive() ? "&only_positive=1" : "")
    + (nurGespeicherte() ? "&only_saved=1" : "");
};

// Gelesene Stories sind standardmäßig ausgeblendet; der Schalter im Filter-Panel holt
// sie zurück — grau, wie gehabt, in erster Linie zum Nochmal-Lesen. Serverseitig
// gefiltert (Pagination), der Client merkt sich nur den Schalter.
function geleseneZeigen() { return localStorage.feed_gelesen_zeigen === "1"; }

// "Uplifting only": nur positive Stories (Positiv-Modell über der kalibrierten
// Schwelle). Serverseitig gefiltert wie `hide`, sonst rissen die Seiten Lücken.
function nurPositive() { return localStorage.feed_nur_positiv === "1"; }

// "Saved only": nur Stories mit Lesezeichen — der Server lässt dann Zeitfenster und
// Score-Schwelle fallen, damit auch herausgealterte gespeicherte Stories auffindbar
// bleiben. Alle anderen Filter (Rubriken, gelesen) wirken unverändert.
function nurGespeicherte() { return localStorage.feed_nur_gespeichert === "1"; }

function rubrikFilterLeiste() {
  const aus = new Set(rubrikenAus());
  const aktiv = aus.size > 0 || nurPositive() || nurGespeicherte();
  const leiste = el(`<div class="feed-filter"></div>`);
  const knopf = el(`<button class="filter-btn${aktiv ? " aktiv" : ""}"
    title="Filter topics" aria-label="Filter topics">${ICON_FILTER}${
    aus.size ? `<span class="filter-badge">${aus.size}</span>` : ""}</button>`);
  const panel = el(`<div class="filter-panel" hidden></div>`);
  for (const name of [...Object.keys(RUBRIK_FARBEN), RUBRIK_SONST]) {
    const an = !aus.has(name);
    const chip = el(`<button class="topic-chip${an ? "" : " aus"}"
      style="--tc:${rubrikFarbe(name)}">${esc(name)}</button>`);
    chip.onclick = () => rubrikUmschalten(name);
    panel.append(chip);
  }
  const gelesen = el(`<button class="topic-chip lesen${geleseneZeigen() ? "" : " aus"}"
    style="--tc:var(--text-dim)">Show read</button>`);
  gelesen.onclick = () => {
    localStorage.feed_gelesen_zeigen = geleseneZeigen() ? "0" : "1";
    feedState = null;
    renderFeed();
  };
  // Wie der Gelesen-Schalter keine Rubrik, deshalb gestrichelt; aus = Normalzustand.
  const uplift = el(`<button class="topic-chip lesen${nurPositive() ? "" : " aus"}"
    style="--tc:var(--like)">Uplifting only</button>`);
  uplift.onclick = () => {
    localStorage.feed_nur_positiv = nurPositive() ? "0" : "1";
    feedState = null;
    renderFeed();
  };
  const gespeichert = el(`<button class="topic-chip lesen${nurGespeicherte() ? "" : " aus"}"
    style="--tc:var(--accent)">Saved only</button>`);
  gespeichert.onclick = () => {
    localStorage.feed_nur_gespeichert = nurGespeicherte() ? "0" : "1";
    feedState = null;
    renderFeed();
  };
  panel.append(gelesen, uplift, gespeichert);
  knopf.onclick = () => { panel.hidden = !panel.hidden; };
  leiste.append(knopf, panel);
  return leiste;
}

/* ---------- Feed ---------- */
// Erste Seite sofort, dann so viele, bis der Bildschirm gefüllt ist; alles Weitere lädt
// erst, wenn der Nutzer bis auf NACHLADE_ABSTAND Bildschirmhöhen an das Ende scrollt —
// vorher lud die App beim Öffnen alle rund 20 Seiten des Fensters nacheinander nach, ob
// man scrollte oder nicht. Der Server liefert je Zeitfenster (`since`, Vorgabe feed_days)
// Seiten über einen Keyset-Cursor (`before`); ist ein Fenster erschöpft, schiebt der
// Client es um `schritt` Tage in die Vergangenheit — ohne Obergrenze bis `horizon`, dem
// Anfang des Backfills. Ein leeres Fenster verdoppelt den Schritt (gedeckelt), damit eine
// dünne Strecke nicht Dutzende Anfragen kostet. Beim Zurückwechseln bleibt der aufgebaute
// Feed + Scrollposition erhalten.

const FEED_BATCH = 12;
const NACHLADE_ABSTAND = 1.5;   // Bildschirmhöhen vor dem Ende, ab denen nachgeladen wird
const FEED_SCHRITT_MAX = 90;    // Tage je Fenster nach mehreren leeren Fenstern
let feedState = null;   // { container, grid, since, cursor, schritt, done, loading, scrollY, … }
let feedGen = 0;        // bricht das Nachladen ab, sobald die Ansicht wechselt

function pauseFeedLoading() { feedGen++; }

// container hält je Tag eine Überschrift + ein Grid; grid = aktuelles Tages-Grid.
// readBefore friert den Gelesen-Stand für die ganze Sitzung ein (siehe feedBatchEinfuegen).
// sentinel steht immer am Ende des Containers; seine Nähe zum Sichtfenster löst das
// Nachladen aus.
const leererFeed = () => ({ container: el(`<div class="feed"></div>`), grid: null, lastDay: null,
                            readBefore: null, since: null, cursor: null, schritt: null,
                            sentinel: el(`<div class="feed-sentinel"></div>`),
                            done: false, loading: false, scrollY: 0, seen: new Set() });

const FEED_LEER = `<div class="empty">
  Nothing relevant in range — or the pipeline hasn't run yet.<br>
  <code>news update</code> fetches new items.</div>`;

// In der Demo steht über der Filterleiste der Hinweis auf den eingefrorenen Stand; den
// Text bringt deren index.html als <template> mit.
const feedKopf = () => [
  ...(DEMO ? [document.getElementById("demo-hinweis").content.cloneNode(true)] : []),
  rubrikFilterLeiste(),
];

// Feuert nur beim Betreten und Verlassen der Zone; ob nach einem Batch weiter nachgeladen
// werden muss, prüft loadFeedBatch deshalb selbst (nachladenPruefen).
const feedBeobachter = new IntersectionObserver(() => nachladenPruefen(feedGen),
                                                { rootMargin: `0px 0px ${NACHLADE_ABSTAND * 100}% 0px` });

function feedBeobachten(state) {
  feedBeobachter.disconnect();
  feedBeobachter.observe(state.sentinel);
}

function renderFeed() {
  const gen = ++feedGen;
  if (feedState) {                       // Zustand + Scrollposition wiederherstellen
    main.innerHTML = "";
    main.append(feedState.container);
    feedBeobachten(feedState);
    requestAnimationFrame(() => { window.scrollTo(0, feedState.scrollY || 0); nachladenPruefen(gen); });
    return;
  }
  skeletons(6);
  feedState = leererFeed();
  feedState.container.append(...feedKopf(), feedState.sentinel);
  feedBeobachten(feedState);
  loadFeedBatch(gen, true);
}

// Hängt eine Story unter die passende Tages-Überschrift; bei neuem Tag beginnt ein neues Grid.
// Gelesene Stories stehen chronologisch zwischen den ungelesenen (grau) — der frühere
// Read-Block am Ende lag hinter allen ungelesenen und war praktisch unerreichbar.
function appendFeedStory(story) {
  const day = dayKey(story.published_at);
  if (day !== feedState.lastDay) {
    feedState.lastDay = day;
    feedState.container.append(el(`<h2 class="day-header">${esc(dayLabel(story.published_at))}</h2>`));
    feedState.grid = el(`<div class="grid"></div>`);
    feedState.container.append(feedState.grid);
  }
  feedState.grid.append(storyCard(story, false));
}

const tageZurueck = (isoTag, n) => {
  const d = new Date(`${isoTag}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

// Dedupe über Batch-Grenzen: schützt, falls sich die Daten zwischen zwei
// Abfragen ändern (stündlicher Crawl) und eine Story die Seite wechselt.
function feedBatchEinfuegen(data) {
  const st = feedState;
  // Den Stand des Servers übernehmen (nicht selbst stempeln): die Uhr des Telefons kann
  // abweichen, verglichen wird aber gegen die Lesezeitpunkte aus derselben Datenbank.
  if (!st.readBefore) st.readBefore = data.read_before;
  if (!st.since) st.since = data.since;          // erstes Fenster kommt vom Server (feed_days)
  if (st.schritt === null) st.schritt = data.days;
  for (const story of data.stories) {
    if (st.seen.has(story.id)) continue;
    st.seen.add(story.id);
    appendFeedStory(story);
  }
  st.container.append(st.sentinel);              // bleibt das letzte Element
  if (data.next) st.cursor = data.next;
  if (data.stories.length >= FEED_BATCH) return;
  // Fenster erschöpft: das nächste liegt davor. Der Cursor bleibt — er zeigt auf die
  // letzte gelieferte Story, alles Ältere kommt danach.
  if (!data.horizon || st.since <= data.horizon) {
    st.done = true;
    if (!st.seen.size) st.container.append(el(FEED_LEER));
    return;
  }
  st.schritt = data.stories.length ? data.days : Math.min(FEED_SCHRITT_MAX, st.schritt * 2);
  st.since = tageZurueck(st.since, st.schritt);
}

async function loadFeedBatch(gen, first = false) {
  const st = feedState;
  if (st.loading || st.done) return;
  st.loading = true;
  const params = [`limit=${FEED_BATCH}`];
  if (st.since) params.push(`since=${st.since}`);
  if (st.cursor) params.push(`before=${encodeURIComponent(st.cursor)}`);
  if (st.readBefore) params.push(`read_before=${encodeURIComponent(st.readBefore)}`);
  let data;
  try {
    data = await api(`api/feed?${params.join("&")}${rubrikParam()}`);
  } catch { st.loading = false; return; }
  if (gen !== feedGen) { st.loading = false; return; }   // Ansicht gewechselt
  if (first) {
    main.innerHTML = "";
    // Auch der leere Feed behält die Filterleiste — sonst käme man aus einem Filter,
    // der alles ausblendet, nie wieder heraus.
    main.append(st.container);
  }
  feedBatchEinfuegen(data);
  st.loading = false;
  nachladenPruefen(gen);
}

// Lädt weiter, solange das Ende des Feeds näher als NACHLADE_ABSTAND Bildschirmhöhen
// liegt — füllt so auch den ersten Bildschirm, ohne eine feste Seitenzahl zu raten.
function nachladenPruefen(gen) {
  if (gen !== feedGen || !feedState || feedState.done || feedState.loading) return;
  if (document.body.dataset.view !== "feed") return;
  const rest = feedState.sentinel.getBoundingClientRect().top - window.innerHeight;
  if (rest < window.innerHeight * NACHLADE_ABSTAND) loadFeedBatch(gen);
}

// Pull-to-Refresh: erst laden, dann tauschen. Der alte Feed bleibt stehen, bis die neuen
// Stories da sind (kein Skelett-Blitzen) und bleibt bei einem Netzfehler unberührt —
// deshalb hier ein eigener Abruf statt loadFeedBatch(…, first).
async function refreshFeed() {
  let data;
  try {
    data = await api(`api/feed?limit=${FEED_BATCH}${rubrikParam()}`);   // ohne Stand und Fenster: neu von vorn
  } catch { return; }
  if (document.body.dataset.view !== "feed") return;
  const gen = ++feedGen;                 // laufendes Nachladen des alten Stands verwerfen
  feedState = leererFeed();
  feedState.container.append(...feedKopf(), feedState.sentinel);
  main.innerHTML = "";
  main.append(feedState.container);
  feedBeobachten(feedState);
  feedBatchEinfuegen(data);
  window.scrollTo(0, 0);
  nachladenPruefen(gen);
}

window.addEventListener("scroll", () => {
  // dataset.view statt location.hash: beim ersten Aufruf ist der Hash noch leer.
  if (document.body.dataset.view !== "feed" || !feedState) return;
  feedState.scrollY = window.scrollY;
  nachladenPruefen(feedGen);   // Rückfall, falls der Observer gedrosselt ist (ein Rect je Ereignis)
}, { passive: true });

/* ---------- Pull-to-Refresh ---------- */
// Nur im Feed und nur am oberen Rand. Der Zug wird gedämpft (asymptotisch gegen PTR_MAX),
// ab PTR_AUSLOESER färbt sich der Indikator und ein Loslassen lädt neu.
const PTR_MAX = 140;
const PTR_AUSLOESER = 84;    // Zieh-Weg bis dahin: 128 px (gedämpft), vorher 96
const PTR_MIN_MS = 550;      // Mindeststandzeit des Spinners, sonst blitzt er nur auf
const PTR_UMFANG = 88;       // 2πr des Rings, r = 14 — muss zu style.css passen

const ptr = document.getElementById("ptr");
const ptrBogen = ptr.querySelector(".ptr-bogen");
const ptrPfeil = ptr.querySelector(".ptr-pfeil");
let ptrStartY = null, ptrWeg = 0, ptrLaeuft = false;

function ptrZeichnen(glatt) {
  ptr.classList.toggle("glatt", glatt);
  main.classList.toggle("glatt", glatt);
  const anteil = Math.min(1, ptrWeg / PTR_AUSLOESER);
  ptr.classList.toggle("bereit", !ptrLaeuft && anteil >= 1);
  ptr.style.opacity = Math.min(1, ptrWeg / 30).toFixed(2);
  // Der Indikator wächst mit dem Zug — das macht den längeren Weg spürbar, statt ihn
  // nur länger zu machen.
  ptr.style.transform =
    `translateY(${(ptrWeg - 60).toFixed(1)}px) scale(${(0.72 + 0.28 * anteil).toFixed(3)})`;
  if (!ptrLaeuft) {
    // Der Ring füllt sich mit dem Weg, der Pfeil dreht sich dabei nach oben und
    // verblasst zum Schluss — voller Ring heißt „jetzt loslassen".
    ptrBogen.style.strokeDashoffset = (PTR_UMFANG * (1 - anteil)).toFixed(1);
    ptrPfeil.style.transform = `rotate(${(anteil * 180).toFixed(0)}deg)`;
    ptrPfeil.style.opacity = (1 - 0.7 * Math.max(0, anteil - 0.7) / 0.3).toFixed(2);
  }
  // Der Inhalt folgt dem Finger und gibt den Indikator frei (wie in nativen Apps).
  main.style.transform = ptrWeg ? `translateY(${ptrWeg.toFixed(1)}px)` : "";
}

const warte = ms => new Promise(r => setTimeout(r, ms));

async function ptrAusloesen() {
  ptrLaeuft = true;
  ptr.classList.add("laedt");
  // Der inline gesetzte Offset muss weg, sonst schlägt er die dasharray der Laufanimation.
  // Die Deckkraft des Pfeils dagegen bleibt inline — dieselbe Zeile setzt sie beim Ziehen,
  // und zwei Stellen für einen Wert wären genau die Art Konflikt, die man nicht sieht.
  ptrBogen.style.strokeDashoffset = "";
  ptrPfeil.style.opacity = "0";
  ptrWeg = PTR_AUSLOESER;                // auf Auslösehöhe stehen bleiben
  ptrZeichnen(true);
  await Promise.all([refreshFeed(), warte(PTR_MIN_MS)]);
  ptrLaeuft = false;
  ptrWeg = 0;
  ptrZeichnen(true);
  setTimeout(() => ptr.classList.remove("laedt"), 300);
}

window.addEventListener("touchstart", e => {
  if (ptrLaeuft || e.touches.length !== 1) return;
  if (document.body.dataset.view !== "feed" || window.scrollY > 0) return;
  ptrStartY = e.touches[0].clientY;
  ptrWeg = 0;
}, { passive: true });

window.addEventListener("touchmove", e => {
  if (ptrStartY === null) return;
  const dy = e.touches[0].clientY - ptrStartY;
  if (dy <= 0) {                               // nach oben gewischt: normal scrollen lassen
    ptrStartY = null;
    if (ptrWeg > 0) { ptrWeg = 0; ptrZeichnen(true); }
    return;
  }
  // Ab der ersten Bewegung abfangen — iOS gibt eine einmal begonnene Scroll-Geste
  // nicht mehr her, ein späteres preventDefault bliebe wirkungslos.
  e.preventDefault();
  ptrWeg = PTR_MAX * (1 - Math.exp(-dy / PTR_MAX));
  ptrZeichnen(false);
}, { passive: false });

window.addEventListener("touchend", () => {
  if (ptrStartY === null) return;
  const ausloesen = ptrWeg >= PTR_AUSLOESER;
  ptrStartY = null;
  if (ausloesen) { ptrAusloesen(); return; }
  ptrWeg = 0;
  ptrZeichnen(true);
}, { passive: true });

window.addEventListener("touchcancel", () => {
  if (ptrStartY === null) return;
  ptrStartY = null; ptrWeg = 0;
  ptrZeichnen(true);
}, { passive: true });

// Es soll immer nur eine Story offen sein — beim Aufklappen fällt die vorige zu.
let offeneKarte = null;

// Aufklappen heißt gelesen, ausgegraut wird aber erst beim Zuklappen: Während des Lesens
// soll nichts am Text gedämpft sein. Der Vermerk geht trotzdem sofort raus — wer eine
// Story offen stehen lässt und die App wechselt, hat sie ebenso gelesen. `dataset.gelesen`
// merkt sich das, damit ein zweites Aufklappen keinen zweiten Request auslöst.
// Die Sortierung folgt erst beim nächsten Laden, sonst spränge die Story unter dem Finger weg.
function klappeZu(card) {
  if (!card) return;
  card.querySelector(".summary")?.classList.add("clamp");
  const merker = card.querySelector(".bookmark-btn");
  if (merker) merker.hidden = true;
  if (card.dataset.gelesen) card.classList.add("read");
  if (offeneKarte === card) offeneKarte = null;
}

function klappeAuf(card, story) {
  klappeZu(offeneKarte);
  card.querySelector(".summary").classList.remove("clamp");
  // Das Lesezeichen zeigt nur die aufgeklappte Karte — zugeklappt wäre es ein
  // Bedienelement für eine Story, die man noch gar nicht gelesen hat.
  const merker = card.querySelector(".bookmark-btn");
  if (merker) merker.hidden = false;
  card.classList.remove("read");
  offeneKarte = card;
  if (card.dataset.gelesen) return;
  card.dataset.gelesen = "1";
  fetch("api/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ articles: story.articles.map(a => a.id) }),
  })
    .then(r => { if (!r.ok) throw new Error(r.status); })
    .catch(() => {
      // Nicht gespeichert — offline, oder der Server kennt den Endpunkt noch nicht (altes
      // Image). Dann darf die Karte auch nicht grau werden: Grau heißt "steht in der DB",
      // sonst sieht man beim nächsten Laden alles wieder frisch und sucht den Fehler dort.
      delete card.dataset.gelesen;
      card.classList.remove("read");
    });
}

/* ---------- Quellen-Chips ---------- */
// Eine Story kann Dutzende Artikel bündeln (gemessen bis 45), und je Artikel ein Chip
// füllte die halbe Karte — ausgerechnet bei den Stories, die am meisten hergeben.
// Deshalb steht je **Quelle** ein Chip; hat sie mehr als einen Artikel, trägt er deren
// Anzahl, und die einzelnen erscheinen erst auf Antippen.

function quellChip(artikel, beschriftung) {
  return el(`<a class="source-chip" href="${esc(artikel.url)}" target="_blank" rel="noopener"
    title="${esc(artikel.title || "")}">${esc(beschriftung)}${artikel.is_premium ? " ✦" : ""}</a>`);
}

function quellenChips(artikel) {
  const chips = el(`<div class="source-chips"></div>`);
  const jeQuelle = new Map();          // Map hält die Reihenfolge des ersten Auftretens
  for (const a of artikel || []) {
    if (!jeQuelle.has(a.source)) jeQuelle.set(a.source, []);
    jeQuelle.get(a.source).push(a);
  }
  for (const [quelle, liste] of jeQuelle) {
    if (liste.length === 1) {
      chips.append(quellChip(liste[0], quelle));
      continue;
    }
    const knopf = el(`<button type="button" class="source-chip sammel" aria-expanded="false"
      title="${liste.length} articles from ${esc(quelle)}">${esc(quelle)}<span class="chip-zahl">${liste.length}</span></button>`);
    const zahl = knopf.querySelector(".chip-zahl");
    // Erst der Knopf, dann seine Einzelchips: so stehen sie direkt hinter ihrer Quelle,
    // auch wenn danach noch weitere Quellen folgen.
    chips.append(knopf);
    const einzelne = liste.map((a, i) => quellChip(a, `${quelle} ${i + 1}`));
    for (const chip of einzelne) {
      chip.hidden = true;
      chips.append(chip);
    }
    knopf.onclick = () => {
      const auf = knopf.getAttribute("aria-expanded") === "true";
      knopf.setAttribute("aria-expanded", String(!auf));
      // Zugeklappt sagt die Zahl, wie viel dahintersteckt; aufgeklappt steht sie neben
      // jedem Einzelchip, und der Knopf wird zum Weg zurück.
      zahl.textContent = auf ? String(liste.length) : "×";
      for (const chip of einzelne) chip.hidden = auf;
    };
  }
  return chips;
}

/* ---------- Keywords zusammenlegen (#merge) ---------- */
// Zwei Keywords, ein Urteil: dasselbe (→) oder verschieden (←). Die Kandidaten rechnet der
// Mac (news keyword-paare), die Urteile landen in keyword_urteile, die Gruppen daraus
// wirken beim nächsten Kartenbau.
//
// Die Sitzung führt selbst Buch, was schon beantwortet ist: Das Urteil geht ohne Warten
// ans NAS, der Nachschub kommt 160 ms später — und das Speichern samt Gruppenneubildung
// dauert dort länger. Der Server lieferte das gerade beurteilte Paar dann noch einmal,
// die Warteschlange kannte es nicht mehr, und es stand ein zweites Mal auf dem Schirm.
// Ebenso Paare, die über Dritte schon zusammenhängen (A~B ja, B~C ja → A~C fragt niemand)
// oder die ein Nein zwischen zwei Verbünden trennt: Der Server weiß das erst nach dem
// Speichern, die Warteschlange hier hält sie bis dahin. Übersprungene Paare gelten nur in
// dieser Sitzung.
let mergeQueue = [], mergeLaedt = false, mergeGen = 0, mergeTiefe = 0;
let mergeStand = {};             // Zählung vom Server: open, judged, groups
let mergeLetztes = null;         // letztes Urteil, für Undo
const mergeErledigt = new Set(), mergeUebersprungen = new Set();
let mergeJaPaare = [], mergeNeinPaare = [];   // Urteile dieser Sitzung, als [a, b]
let mergeEltern = new Map();                  // Union-Find über die Ja-Paare
const mergeSchluessel = p => p.a.key + "|" + p.b.key;
const mergeZahl = n => Number(n || 0).toLocaleString("de-DE");
const ZEICHEN_LABEL = { gleich: "same spelling", akronym: "acronym", enthalten: "contains" };
// Reihenfolge: „impact" = Score × log(Artikel des kleineren Partners), „signal" = nur Score.
const mergeOrder = () => (localStorage.merge_order === "signal" ? "signal" : "impact");
function mergeWurzel(k) {
  while (mergeEltern.has(k)) k = mergeEltern.get(k);
  return k;
}
function mergeVerbundNeu() {
  mergeEltern = new Map();
  for (const [a, b] of mergeJaPaare) {
    const ra = mergeWurzel(a), rb = mergeWurzel(b);
    if (ra !== rb) mergeEltern.set(ra, rb);
  }
}
function mergeSchonBeantwortet(p) {
  const key = mergeSchluessel(p);
  if (mergeErledigt.has(key) || mergeUebersprungen.has(key)) return true;
  const ra = mergeWurzel(p.a.key), rb = mergeWurzel(p.b.key);
  if (ra === rb) return true;
  return mergeNeinPaare.some(([x, y]) => {
    const rx = mergeWurzel(x), ry = mergeWurzel(y);
    return (rx === ra && ry === rb) || (rx === rb && ry === ra);
  });
}

async function renderMerge() {
  main.innerHTML = `<div class="rate-wrap merge-wrap">
    <div class="segmented rate-seg" id="mergeSeg">
      <button data-o="impact" class="${mergeOrder() === "impact" ? "active" : ""}"
        title="Score × articles of the smaller keyword">By impact</button>
      <button data-o="signal" class="${mergeOrder() === "signal" ? "active" : ""}"
        title="Score only">By signal</button>
    </div>
    <div class="rate-count hint" id="mergeCount"></div>
    <div class="rate-stage merge-stage" id="mergeStage"></div>
    <div class="rate-actions">
      <button class="rate-btn down" id="mergeDown" title="Different (←)">${ICON_DOWN}</button>
      <button class="rate-skip" id="mergeSkip" title="Skip (↓)">Skip</button>
      <button class="rate-skip" id="mergeUndo" title="Undo last verdict (Backspace)" hidden>Undo</button>
      <button class="rate-btn up" id="mergeUp" title="Same thing (→)">${ICON_UP}</button>
    </div>
    <details class="panel merge-gruppen" id="mergeGruppen">
      <summary>Merged groups <span class="hint" id="mergeGruppenZahl"></span></summary>
      <div class="merge-gruppen-liste hint">Loading…</div>
    </details>
  </div>`;
  main.querySelectorAll("#mergeSeg button").forEach(b => b.onclick = () => {
    if (mergeOrder() === b.dataset.o) return;
    localStorage.merge_order = b.dataset.o;
    renderMerge();
  });
  main.querySelector("#mergeUp").onclick = () => mergeUrteil(1);
  main.querySelector("#mergeDown").onclick = () => mergeUrteil(-1);
  main.querySelector("#mergeSkip").onclick = () => mergeWeiter(true);
  main.querySelector("#mergeUndo").onclick = mergeUndo;
  mergeQueue.length = 0; mergeGen++; mergeLetztes = null; mergeTiefe = 0;
  mergeErledigt.clear(); mergeUebersprungen.clear();
  mergeJaPaare = []; mergeNeinPaare = []; mergeVerbundNeu();
  mergeGruppenLaden();
  await mergeNachschub();
  mergeZeigen();
}

document.addEventListener("keydown", e => {
  if (location.hash !== "#merge" || e.target.tagName === "INPUT") return;
  if (e.key === "ArrowRight") mergeUrteil(1);
  else if (e.key === "ArrowLeft") mergeUrteil(-1);
  else if (e.key === "ArrowDown") mergeWeiter(true);
  else if (e.key === "Backspace") { e.preventDefault(); mergeUndo(); }
});

async function mergeNachschub(versuch = 0) {
  if (mergeQueue.length >= 4 || mergeLaedt) return;
  mergeLaedt = true;
  const gen = mergeGen, leer = mergeQueue.length === 0;
  // Übersprungene stehen serverseitig weiter vorn: mehr anfordern und lokal aussieben;
  // ab 40 Zurückgestellten zusätzlich per Offset dahinter greifen.
  const count = Math.min(50, 10 + mergeUebersprungen.size);
  const offset = Math.max(0, mergeUebersprungen.size - 40) + mergeTiefe;
  let voll = false, neu = 0;
  try {
    const data = await api(`api/merge/next?count=${count}&offset=${offset}&order=${mergeOrder()}`);
    if (gen !== mergeGen) return;
    mergeStand = data;
    voll = data.pairs.length === count;
    const bekannt = new Set(mergeQueue.map(mergeSchluessel));
    for (const p of data.pairs) {
      if (bekannt.has(mergeSchluessel(p)) || mergeSchonBeantwortet(p)) continue;
      mergeQueue.push(p);
      neu++;
    }
  } catch {
    mergeStand = { fehler: true };
  } finally {
    mergeLaedt = false;
  }
  if (leer) mergeZeigen();          // die Bühne stand auf „Loading…"
  // Alles ausgesiebt, aber der Server hat noch mehr: tiefer greifen, ein paar Mal.
  if (!neu && voll && versuch < 5) {
    mergeTiefe += count;
    mergeNachschub(versuch + 1);
  }
}

function mergeKarte(k) {
  const quellen = Object.entries(k.sources || {}).map(([q, n]) =>
    `<span class="merge-quelle"><i style="background:${SOURCE_COLORS[q] || "#888"}"></i>${esc(q)} ${mergeZahl(n)}</span>`).join("");
  const beispiele = (k.examples || []).map(a =>
    `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>
     <span class="hint">· ${esc(a.source)} ${fmtDate(a.published_at)}</span></li>`).join("");
  return `<article class="card merge-kw"><div class="card-body">
    <h2>${esc(k.name)}</h2>
    <div class="hint">${mergeZahl(k.n)} articles</div>
    <div class="merge-quellen">${quellen}</div>
    <ul class="merge-beispiele">${beispiele}</ul>
  </div></article>`;
}

function mergeZeigen() {
  const stage = main.querySelector("#mergeStage");
  if (!stage) return;
  const count = main.querySelector("#mergeCount");
  if (count) count.textContent = mergeStand.open == null ? ""
    : `${mergeZahl(mergeStand.open)} open · ${mergeZahl(mergeStand.judged)} judged · ${mergeZahl(mergeStand.groups)} groups`;
  stage.innerHTML = "";
  // Ein Urteil kann Paare in der Warteschlange beantwortet haben (über Dritte zusammen
  // oder getrennt) — die fallen jetzt weg statt noch einmal zu fragen.
  while (mergeQueue.length && mergeSchonBeantwortet(mergeQueue[0])) mergeQueue.shift();
  const p = mergeQueue[0];
  if (!p) {
    stage.append(el(`<div class="empty">${mergeLaedt ? "Loading pairs…"
      : mergeStand.fehler ? "Couldn't load candidates — is the server up to date?"
      : "No open pairs left. Run <code>news keyword-paare</code> on the Mac for fresh candidates."}</div>`));
    return;
  }
  const sig = p.signals || {};
  const badges = [
    sig.artikel != null ? `articles ${dez2(sig.artikel)}` : null,
    sig.name != null ? `name ${dez2(sig.name)}` : null,
    sig.zeichen ? (ZEICHEN_LABEL[sig.zeichen] || sig.zeichen) : null,
    sig.overlap > 0.1 ? `co-tagged ${Math.round(sig.overlap * 100)} %` : null,
  ].filter(Boolean);
  stage.append(el(`<div class="merge-paar">
    ${mergeKarte(p.a)}
    <div class="merge-mitte"><div class="merge-score" title="noisy-OR of the calibrated signals">${dez2(p.score)}</div>
      ${badges.map(b => `<span class="merge-badge">${esc(b)}</span>`).join("")}</div>
    ${mergeKarte(p.b)}
  </div>`));
}

function mergeUrteil(wert) {
  const p = mergeQueue[0];
  if (!p) return;
  main.querySelector("#mergeStage").firstChild?.classList.add(wert === 1 ? "fly-right" : "fly-left");
  mergeLetztes = { a: p.a.key, b: p.b.key };
  mergeErledigt.add(mergeSchluessel(p));
  if (wert === 1) { mergeJaPaare.push([p.a.key, p.b.key]); mergeVerbundNeu(); }
  else mergeNeinPaare.push([p.a.key, p.b.key]);
  main.querySelector("#mergeUndo").hidden = false;
  // Zähler sofort fortschreiben — der Server liefert die genaue Zählung erst mit dem
  // nächsten Nachschub, und bis dahin sähe der Daumen wirkungslos aus.
  if (mergeStand.open != null) { mergeStand.open -= 1; mergeStand.judged += 1; }
  fetch("api/merge/verdict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ a: p.a.key, b: p.b.key, verdict: wert }),
  }).then(() => { if (wert === 1) mergeGruppenLaden(); }).catch(() => {});
  setTimeout(() => mergeWeiter(false), 160);
}

function mergeWeiter(uebersprungen) {
  const p = mergeQueue.shift();
  if (uebersprungen && p) mergeUebersprungen.add(mergeSchluessel(p));
  mergeTiefe = 0;                   // beurteilte Paare verlassen die Server-Liste, der Offset rutscht
  mergeZeigen();
  mergeNachschub();
}

// Nach Undo, Namenswahl oder Herauslösen stimmt die Warteschlange nicht mehr: Paare
// kommen zurück oder fallen als impliziert weg — also verwerfen und neu holen.
async function mergeNeuHolen() {
  mergeGen++;
  mergeQueue.length = 0;
  mergeTiefe = 0;
  await mergeNachschub();
  mergeZeigen();
  mergeGruppenLaden();
}

async function mergeUndo() {
  if (!mergeLetztes) return;
  const { a, b } = mergeLetztes;
  mergeLetztes = null;
  main.querySelector("#mergeUndo").hidden = true;
  mergeErledigt.delete(a + "|" + b);
  const nicht = ([x, y]) => !(x === a && y === b);
  mergeJaPaare = mergeJaPaare.filter(nicht);
  mergeNeinPaare = mergeNeinPaare.filter(nicht);
  mergeVerbundNeu();
  await fetch(`api/merge/verdict?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
              { method: "DELETE" }).catch(() => {});
  await mergeNeuHolen();
}

async function mergeAktion(url, method, body) {
  await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {});
  await mergeNeuHolen();
}

async function mergeGruppenLaden() {
  const box = main.querySelector("#mergeGruppen");
  if (!box) return;
  const liste = box.querySelector(".merge-gruppen-liste");
  const zahl = box.querySelector("#mergeGruppenZahl");
  try {
    const data = await api("api/merge/groups");
    zahl.textContent = data.groups.length ? `(${data.groups.length})` : "";
    liste.classList.remove("hint");
    liste.innerHTML = data.groups.length ? ""
      : `<span class="hint">No groups yet — every thumbs-up creates or extends one.</span>`;
    for (const g of data.groups) {
      const zeile = el(`<div class="merge-gruppe"><b>${esc(g.name)}</b>
        <span class="hint">${mergeZahl(g.n)} articles · ${g.members.length} keywords</span>
        <div class="merge-mitglieder"></div></div>`);
      const mitglieder = zeile.querySelector(".merge-mitglieder");
      for (const m of g.members) {
        const kanon = m.key === g.canon;
        const chip = el(`<span class="merge-mitglied${kanon ? " kanon" : ""}">
          <button type="button" class="merge-name" title="${kanon ? "Group name on the map" : "Use as group name"}">${esc(m.name)}
            <span class="chip-zahl">${mergeZahl(m.n)}</span></button>
          <button type="button" class="merge-raus" title="Remove from group">×</button></span>`);
        chip.querySelector(".merge-name").onclick = () => {
          if (!kanon) mergeAktion("api/merge/canon", "POST", { keyword: m.key });
        };
        chip.querySelector(".merge-raus").onclick = () =>
          mergeAktion(`api/merge/member?keyword=${encodeURIComponent(m.key)}`, "DELETE");
        mitglieder.append(chip);
      }
      liste.append(zeile);
    }
  } catch {
    liste.textContent = "Couldn't load groups.";
  }
}

/* ---------- „Warum sehe ich das?" ---------- */
// Tipp auf die Score-Pille: die ähnlichsten selbst bewerteten Artikel, mit Daumen und
// Ähnlichkeit. Das Modell ist eine logistische Regression auf Embeddings — die nächsten
// bewerteten Nachbarn *sind* die ehrlichste Erklärung, kein LLM nötig. Einmal geladen,
// danach nur noch auf-/zugeklappt (das Panel hängt an der Karte).

function whyToggle(card, meta, storyId) {
  const offen = card.querySelector(".why-panel");
  if (offen) { offen.hidden = !offen.hidden; return; }
  const panel = el(`<div class="why-panel">
    <div class="why-kopf">Similar articles you rated</div>
    <div class="why-laedt">Loading…</div>
  </div>`);
  meta.after(panel);
  fetch(`api/why?story_id=${storyId}`)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => {
      panel.querySelector(".why-laedt").remove();
      if (!d.similar.length) {
        panel.append(el(`<div class="why-laedt">No rated articles yet.</div>`));
        return;
      }
      for (const a of d.similar) {
        panel.append(el(`<a class="why-zeile ${a.rating === 1 ? "like" : "dislike"}"
          href="${esc(a.url)}" target="_blank" rel="noopener">
          <span class="why-daumen">${a.rating === 1 ? ICON_UP : ICON_DOWN}</span>
          <span class="why-text">${esc(a.title)}
            <span class="why-quelle">${esc(a.source)} · ${Math.round(a.similarity * 100)} % similar</span>
          </span></a>`));
      }
    })
    .catch(() => {
      // Offline oder altes Server-Image ohne den Endpunkt — Panel sagt es, statt leer
      // zu bleiben.
      panel.querySelector(".why-laedt").textContent = "Not available.";
    });
}

function storyCard(story, showDate = true) {
  const card = el(`<article class="card"></article>`);
  if (story.read) {
    card.classList.add("read");
    card.dataset.gelesen = "1";
  }
  // Bedeutende Story (stories.heat über heat_mark): warmer Rand + Flammen-Marke.
  if (story.hot) card.classList.add("hot");
  if (story.image_url) {
    card.append(el(`<img class="hero" loading="lazy" src="${esc(story.image_url)}" alt="">`));
  }
  const body = el(`<div class="card-body"></div>`);
  // Reihenfolge fest: Score immer vorn links, Rubrik (falls vorhanden) direkt daneben,
  // das Datum dahinter — so steht der Score auf jeder Karte an derselben Stelle.
  const meta = el(`<div class="card-meta">
    <button type="button" class="score-pill why-knopf" title="Predicted relevance — tap to see why">${Math.round(story.score * 100)} %</button>
    ${story.hot ? `<span class="hot-badge" title="Big story — many sources, fresh momentum">${ICON_FLAME}Hot</span>` : ""}
    ${story.topic ? `<span class="topic-tag" style="--tc:${rubrikFarbe(story.topic)}">${esc(story.topic)}</span>` : ""}
    ${showDate ? `<span>${fmtDate(story.published_at)}</span>` : ""}
  </div>`);
  meta.querySelector(".why-knopf").onclick = () => whyToggle(card, meta, story.id);
  if (story.positive) {
    meta.append(el(`<span class="positive-badge" title="Uplifting — positive development">${ICON_LEAF}</span>`));
  }
  body.append(meta);
  body.append(el(`<h2>${esc(story.title)}</h2>`));
  if (story.summary) {
    const summary = el(`<p class="summary clamp">${esc(story.summary)}</p>`);
    body.append(summary);
    // Tippen auf die Kachel klappt den vollen Text aus (Quellen-Links bleiben klickbar)
    body.onclick = e => {
      // `.source-chips` deckt Links **und** Sammelknöpfe ab; der Knopf ist kein <a>,
      // und ohne ihn klappte jedes Aufklappen einer Quelle die ganze Kachel um.
      // Score-Pille und Warum-Panel gehören ebenso dazu — beide sind eigene Ziele.
      if (e.target.closest("a, .source-chips, .why-knopf, .why-panel, .bookmark-btn")) return;
      if (summary.classList.contains("clamp")) klappeAuf(card, story);
      else klappeZu(card);
    };
    body.style.cursor = "pointer";
  } else {
    body.append(el(`<p class="teaser">${esc(story.articles[0].teaser)}…</p>`));
  }
  // Fußzeile: Quellen-Chips links, Lesezeichen unten rechts. Das Lesezeichen hängt wie
  // der Gelesen-Vermerk an den Artikel-IDs (Story-IDs überleben keinen Rechenlauf) und
  // wird optimistisch umgeschaltet — schlägt der Request fehl, springt es zurück, sonst
  // sähe es gespeichert aus, ohne in der DB zu stehen.
  const fuss = el(`<div class="card-fuss"></div>`);
  fuss.append(quellenChips(story.articles));
  const merker = el(`<button type="button" class="bookmark-btn${story.saved ? " an" : ""}" hidden
    title="Save for later" aria-label="Save for later">${ICON_BOOKMARK}</button>`);
  merker.onclick = () => {
    const an = merker.classList.toggle("an");
    fetch("api/bookmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articles: story.articles.map(a => a.id), saved: an }),
    })
      .then(r => { if (!r.ok) throw new Error(r.status); })
      .catch(() => merker.classList.toggle("an"));
  };
  fuss.append(merker);
  body.append(fuss);
  card.append(body);
  return card;
}

/* ---------- Uplift (positive news) ---------- */
// Zwei Modi: "Current" = alle positiven Stories im Feed-Fenster, "Past year" =
// die stärksten positiven Stories je Monat über das letzte Jahr (Monats-Timeline).

let upliftWindow = "recent";

const monthLabel = iso => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

async function renderUplift() {
  main.innerHTML = `<div class="segmented" id="upliftSeg">
      <button data-w="recent" class="${upliftWindow === "recent" ? "active" : ""}">Current</button>
      <button data-w="year" class="${upliftWindow === "year" ? "active" : ""}">Past year</button>
    </div>
    <div id="upliftBody"></div>`;
  main.querySelectorAll("#upliftSeg button").forEach(b => {
    b.onclick = () => {
      if (upliftWindow === b.dataset.w) return;
      upliftWindow = b.dataset.w;
      renderUplift();
    };
  });
  const body = main.querySelector("#upliftBody");
  body.innerHTML = `<div class="grid">${'<div class="skeleton"></div>'.repeat(4)}</div>`;

  let data;
  try {
    data = await api(`api/positive?window=${upliftWindow}`);
  } catch {
    body.innerHTML = `<div class="empty">Couldn't load uplifting stories.</div>`;
    return;
  }
  if (location.hash !== "#uplift") return;          // Ansicht während des Ladens gewechselt

  if (!data.stories.length) {
    body.innerHTML = `<div class="empty">Nothing uplifting in range yet.<br>
      Positive stories appear once the model has scored recent articles.</div>`;
    return;
  }

  body.innerHTML = "";
  if (upliftWindow === "recent") {
    const grid = el(`<div class="grid"></div>`);
    for (const story of data.stories) grid.append(storyCard(story));
    body.append(grid);
    return;
  }
  // Past year: nach Monat gruppieren, Überschrift je Monatswechsel
  body.append(el(`<div class="hint uplift-count">${data.total.toLocaleString("en-US")}
    uplifting ${data.total === 1 ? "story" : "stories"} over the past year</div>`));
  let currentMonth = null, grid = null;
  for (const story of data.stories) {
    const month = monthLabel(story.published_at);
    if (month !== currentMonth) {
      currentMonth = month;
      body.append(el(`<h2 class="month-header">${esc(month)}</h2>`));
      grid = el(`<div class="grid"></div>`);
      body.append(grid);
    }
    grid.append(storyCard(story));
  }
}

/* ---------- Rate ---------- */
// Zwei Modi über einen Umschalter: "like" bewertet Gefällt mir/nicht (Tabelle ratings),
// "positive" bewertet positiv/nicht positiv (Tabelle positivity). → gefällt/positiv,
// ← nicht, ↓ überspringen.

const rateQueue = [];
let rateTotal = 0;
let rateMode = "like";

// Gewichte der vier Ziehungskanäle (Zelle/Wasserstand, Unsicherheit, ohne Beleg,
// Wiederholung) — je Artikel entscheidet der Server per Zufall nach diesen Gewichten.
// Vorgabe 1:1:1:1. Die Wiederholung bekommt keine Marke auf der Karte: Wer weiß,
// dass er schon einmal bewertet hat, bewertet nicht mehr blind.
const MIX_KANAELE = [
  ["Balanced", "thinnest (month × source) cell — the classic waterfall"],
  ["Uncertain", "closest to score 0.5 — where the feed decision actually tips"],
  ["Uncovered", "no rated article nearby — the model is extrapolating there"],
  ["Repeat", "already rated ≥ 30 days ago — second rating kept separately, measures drift"],
];
function rateMix() {
  try {
    const m = JSON.parse(localStorage.rate_mix || "");
    if (Array.isArray(m) && m.length === MIX_KANAELE.length - 1) m.push(1);   // Stand vor dem vierten Kanal
    if (Array.isArray(m) && m.length === MIX_KANAELE.length
        && m.every(v => Number.isInteger(v) && v >= 0 && v <= 9) && m.some(v => v > 0)) return m;
  } catch { /* Vorgabe */ }
  return [1, 1, 1, 1];
}
const CHANNEL_LABEL = { unsicher: "uncertain", beleg: "uncovered" };

function rateModeMeta() {
  return rateMode === "positive"
    ? { up: ICON_LEAF, down: ICON_DOWN, upT: "Positiv (→)", downT: "Nicht positiv (←)",
        count: n => `${n.toLocaleString("de-DE")} auf Positivität bewertet` }
    : { up: ICON_UP, down: ICON_DOWN, upT: "Like (→)", downT: "Dislike (←)",
        count: n => `${n.toLocaleString("de-DE")} articles rated` };
}

async function renderRate() {
  const m = rateModeMeta();
  const mix = rateMix();
  main.innerHTML = `<div class="rate-kopf">
    <div class="segmented rate-seg" id="rateSeg">
      <button data-m="like" class="${rateMode === "like" ? "active" : ""}">Gefällt mir</button>
      <button data-m="positive" class="${rateMode === "positive" ? "active" : ""}">Positiv</button>
    </div>
    ${rateMode === "like" ? `<button class="mix-knopf" id="mixToggle"
      title="Draw mix">⚖ ${mix.join(":")}</button>` : ""}
    </div>
    ${rateMode === "like" ? `<div class="mix-panel" id="mixPanel" hidden>
      ${MIX_KANAELE.map(([name, hilfe], i) => `<label title="${hilfe}">${name}
        <input type="number" min="0" max="9" step="1" value="${mix[i]}" data-i="${i}"></label>`).join("")}
      <span class="hint">relative draw weights per article</span>
    </div>` : ""}
    <div class="rate-wrap">
    <div class="rate-stage" id="rateStage"></div>
    <div class="rate-actions">
      <button class="rate-btn down" id="rateDown" title="${m.downT}">${m.down}</button>
      <button class="rate-skip" id="rateSkip" title="Skip (↓)">Skip</button>
      <button class="rate-btn up" id="rateUp" title="${m.upT}">${m.up}</button>
    </div>
    <div class="rate-count hint" id="rateCount"></div>
  </div>`;
  main.querySelectorAll("#rateSeg button").forEach(b => b.onclick = () => {
    if (rateMode === b.dataset.m) return;
    rateMode = b.dataset.m;
    rateGen++;                     // laufende Nachschub-Antworten des alten Modus verwerfen
    rateQueue.length = 0;
    renderRate();
  });
  main.querySelector("#rateUp").onclick = () => voteCurrent(1);
  main.querySelector("#rateDown").onclick = () => voteCurrent(-1);
  main.querySelector("#rateSkip").onclick = () => advance();
  const toggle = main.querySelector("#mixToggle");
  if (toggle) {
    const panel = main.querySelector("#mixPanel");
    toggle.onclick = () => { panel.hidden = !panel.hidden; };
    panel.querySelectorAll("input").forEach(inp => inp.onchange = () => {
      const m = rateMix();
      m[Number(inp.dataset.i)] = Math.max(0, Math.min(9, Number(inp.value) || 0));
      if (!m.some(v => v > 0)) { inp.value = rateMix()[Number(inp.dataset.i)]; return; }
      localStorage.rate_mix = JSON.stringify(m);
      inp.value = m[Number(inp.dataset.i)];
      toggle.textContent = `⚖ ${m.join(":")}`;
      rateGen++;                   // laufende Antworten aus dem alten Mix verwerfen
      rateQueue.length = 0;
      fillQueue();
      showCurrent();
    });
  }
  await fillQueue();
  showCurrent();
}

document.addEventListener("keydown", e => {
  if (location.hash !== "#rate" || e.target.tagName === "INPUT") return;
  if (e.key === "ArrowRight") voteCurrent(1);
  else if (e.key === "ArrowLeft") voteCurrent(-1);
  else if (e.key === "ArrowDown") advance();
});

// Nachschub läuft im Hintergrund; die Kanal-Ziehungen brauchen 2–4 s je Zehnerblock,
// mit den Pfeiltasten überholt man das. `rateLaedt` unterscheidet deshalb „leer, aber
// Nachschub unterwegs" von „wirklich nichts mehr übrig", und `rateGen` verwirft
// Antworten, die noch zum alten Modus oder Mix gehören.
let rateLaedt = false;
let rateGen = 0;

async function fillQueue() {
  // Schwelle 6 statt 3: Bei 2–4 s Antwortzeit und einer Bewertung pro Sekunde
  // (Pfeiltasten) liefe die Warteschlange sonst regelmäßig leer.
  if (rateQueue.length >= 6 || rateLaedt) return;
  rateLaedt = true;
  const gen = rateGen;
  try {
    const mode = rateMode;
    const mixParam = mode === "like" ? `&mix=${rateMix().join(",")}` : "";
    const data = await api(`api/rate/next?count=10&mode=${mode}${mixParam}`);
    if (gen === rateGen) {
      rateTotal = data.total_rated;
      const known = new Set(rateQueue.map(a => a.id));
      for (const a of data.articles) if (!known.has(a.id)) rateQueue.push(a);
    }
  } finally {
    rateLaedt = false;
  }
  if (gen !== rateGen) {                   // Modus/Mix gewechselt → verwerfen, neu holen
    fillQueue();
    return;
  }
  // Stand die Bühne leer („Loading…"), jetzt die angekommene Karte zeigen.
  if (!main.querySelector("#rateStage article")) showCurrent();
}

function showCurrent() {
  const stage = main.querySelector("#rateStage");
  const counter = main.querySelector("#rateCount");
  if (!stage) return;
  if (counter) counter.textContent = rateModeMeta().count(rateTotal);
  stage.innerHTML = "";
  const article = rateQueue[0];
  if (!article) {
    stage.append(el(`<div class="empty">${rateLaedt
      ? "Loading more articles…"
      : "No unrated articles left — impressive."}</div>`));
    return;
  }
  const card = el(`<article class="card rate-card">
    ${article.image_url ? `<img class="hero" src="${esc(article.image_url)}" alt="">` : ""}
    <div class="card-body">
      <div class="card-meta">
        <span class="source-name">${esc(article.source)}${article.is_premium ? " ✦" : ""}</span>
        <span>${fmtDate(article.published_at)}</span>
        ${CHANNEL_LABEL[article.channel] ? `<span class="mix-marke">${CHANNEL_LABEL[article.channel]}</span>` : ""}
      </div>
      <h2><a href="${esc(article.url)}" target="_blank" rel="noopener">${esc(article.title)}</a></h2>
      <p class="rate-intro">${esc(article.intro)}</p>
    </div>
  </article>`);
  stage.append(card);
}

async function voteCurrent(value) {
  const article = rateQueue[0];
  if (!article) return;
  const stage = main.querySelector("#rateStage");
  stage.firstChild?.classList.add(value === 1 ? "fly-right" : "fly-left");
  rateTotal += 1;
  const [url, payload] = rateMode === "positive"
    ? ["api/positive_label", { article_id: article.id, label: value === 1 ? 1 : 0 }]
    : ["api/rate", { article_id: article.id, rating: value, channel: article.channel }];
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
  setTimeout(advance, 160);
}

function advance() {
  rateQueue.shift();
  // Nachschub zuerst: dann steht `rateLaedt` schon, wenn showCurrent eine leere
  // Warteschlange vorfindet, und die Bühne zeigt „Loading…" statt „nichts übrig".
  fillQueue();
  showCurrent();
}

/* ---------- World (Globus) ---------- */
// Canvas und Gitter überleben den Tab-Wechsel — das Höhenraster einmal zu Vierecken zu
// verarbeiten kostet spürbar Zeit, das Ein-/Ausblenden übernimmt CSS. Die Marker werden
// bei jedem Öffnen frisch geholt (kleines JSON mit ETag), danach fährt die Kugel zum
// wichtigsten Artikel.

let globeHost = null, globus = null, globusLaedt = null;

async function renderWorld() {
  main.innerHTML = "";
  if (!globeHost) {
    // Drei Ebenen: Sterne dahinter, Globus, ISS davor. Die beiden Zusatzebenen sind rein
    // dekorativ — für Screenreader unsichtbar, für Tipper durchlässig.
    globeHost = el(`<div id="globe-host">
      <canvas id="globe-sky" aria-hidden="true"></canvas>
      <canvas id="globe" role="img" aria-label="Interactive globe with current stories"></canvas>
      <canvas id="globe-iss" aria-hidden="true"></canvas>
      <div class="globe-status">Loading globe…</div>
      <ul id="globe-liste" class="sr-only"></ul></div>`);
    document.body.append(globeHost);
    globusLaedt = (async () => {
      const { Globus } = await import("./globe.js");
      const g = new Globus(globeHost.querySelector("#globe"), {
        onMarker: oeffneStory,
        himmel: globeHost.querySelector("#globe-sky"),
        iss: globeHost.querySelector("#globe-iss"),
      });
      await g.laden();
      globus = g;
    })().catch(err => {
      globeHost.querySelector(".globe-status").textContent = "Couldn't load the globe.";
      throw err;
    });
  }
  try {
    await globusLaedt;
  } catch {
    return;
  }
  if (document.body.dataset.view !== "world") return;
  globus.sichtbar(true);

  // Der Hinweis blendet sich über :empty selbst aus, sobald er nichts zu sagen hat.
  const status = globeHost.querySelector(".globe-status");
  let daten;
  try {
    daten = await api("api/world");
  } catch {
    status.textContent = "Couldn't load stories.";
    return;
  }
  if (document.body.dataset.view !== "world") return;

  const stories = daten.stories || [];
  status.textContent = stories.length ? "" : "No located stories yet — run a compute pass.";
  // Rubrik-Farbe je Marker: der Globus kennt die Rubriken nicht, er bekommt nur die
  // fertige Farbe — dieselbe Tabelle wie im Feed, damit „Wirtschaft" überall gleich aussieht.
  for (const s of stories) s.topicColor = (s.topic && RUBRIK_FARBEN[s.topic]) || null;
  // Bahnelemente der ISS reisen mit den Markern mit (news world holt sie beim Rechenlauf).
  // Der letzte Stand bleibt lokal liegen: ohne Netz zeigt der Globus die Station weiter,
  // nur mit älteren Elementen — ein Tag Alter kostet rund 17 km, kaum einen Bildpunkt.
  globus.setzeIss(merkeTle(daten.iss));
  globus.setzeStories(stories);
  globusListe(stories);
  if (stories.length) globus.flugZu(stories[0].lat, stories[0].lon);
}

// Frische Elemente merken, alte weiterverwenden. localStorage kann werfen (Safari im
// privaten Modus), und ohne gespeicherten Stand fehlt eben die Station.
function merkeTle(neu) {
  try {
    if (neu) localStorage.setItem("iss_tle", neu);
    return neu || localStorage.getItem("iss_tle");
  } catch {
    return neu || null;
  }
}

// Für VoiceOver: dieselben Stories als Liste, unsichtbar aber bedienbar. Ein Canvas
// allein wäre für Screenreader eine leere Fläche.
function globusListe(stories) {
  const ul = globeHost.querySelector("#globe-liste");
  ul.innerHTML = "";
  for (const s of stories) {
    const li = el(`<li><button type="button">${esc(s.label)} – ${esc(s.title)}</button></li>`);
    li.querySelector("button").onclick = () => oeffneStory(s);
    ul.append(li);
  }
}

/* ---------- Story-Overlay ---------- */
// Vollflächig auf dem Handy, zentrierte Kachel ab Tablet. Schließt über das Kreuz, die
// Fläche daneben, Esc, Wischen nach unten und die Zurück-Geste: dafür kommt beim Öffnen
// ein History-Eintrag dazu (gleiche URL, also ohne hashchange und ohne Neu-Routing).

let sheet = null;

function oeffneStory(story) {
  if (sheet) return;
  history.pushState({ sheet: true }, "");
  sheet = el(`<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(story.title)}">
    <div class="sheet-hinter"></div>
    <article class="sheet-karte" tabindex="-1">
      <button class="sheet-zu" type="button" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
      </button>
      <div class="sheet-inhalt"></div>
    </article></div>`);
  const inhalt = sheet.querySelector(".sheet-inhalt");
  if (story.image_url) {
    inhalt.append(el(`<img class="hero" src="${esc(story.image_url)}" alt="">`));
  }
  const kopf = el(`<div class="sheet-kopf"></div>`);
  if (story.place) kopf.append(el(`<span class="ort">${esc(story.place)}</span>`));
  kopf.append(el(`<span>${fmtDate(story.published_at)}</span>`));
  kopf.append(el(`<span class="score-pill" title="Predicted relevance">${Math.round(story.score * 100)} %</span>`));
  if (story.hot) kopf.append(el(`<span class="hot-badge" title="Big story — many sources, fresh momentum">${ICON_FLAME}Hot</span>`));
  inhalt.append(kopf);
  inhalt.append(el(`<h2>${esc(story.title)}</h2>`));
  inhalt.append(el(`<p class="summary">${esc(story.summary || "")}</p>`));
  inhalt.append(quellenChips(story.articles));

  sheet.querySelector(".sheet-zu").onclick = () => schliesseStory();
  sheet.querySelector(".sheet-hinter").onclick = () => schliesseStory();
  document.body.append(sheet);
  document.body.classList.add("sheet-offen");
  requestAnimationFrame(() => sheet.classList.add("auf"));
  // Fokus in den Dialog holen, damit Tastatur und VoiceOver dort landen — auf die Kachel
  // statt auf das Kreuz, sonst blitzt bei jedem Öffnen ein Fokusring auf.
  sheet.querySelector(".sheet-karte").focus({ preventScroll: true });
  wischenZumSchliessen(sheet.querySelector(".sheet-karte"));
}

function schliesseStory(vomZurueck = false) {
  if (!sheet) return;
  const weg = sheet;
  sheet = null;
  weg.classList.remove("auf");
  document.body.classList.remove("sheet-offen");
  setTimeout(() => weg.remove(), 260);
  if (!vomZurueck) history.back();
}

// Nach unten wischen schließt. Erst ab dem obersten Scrollpunkt, sonst kollidiert die
// Geste mit dem Scrollen der Zusammenfassung.
function wischenZumSchliessen(karte) {
  let startY = null, weg = 0;
  karte.addEventListener("touchstart", e => {
    startY = karte.scrollTop <= 0 ? e.touches[0].clientY : null;
    weg = 0;
  }, { passive: true });
  karte.addEventListener("touchmove", e => {
    if (startY === null) return;
    weg = e.touches[0].clientY - startY;
    if (weg <= 0) return;
    karte.style.transition = "none";
    karte.style.transform = `translateY(${weg}px)`;
  }, { passive: true });
  karte.addEventListener("touchend", () => {
    if (startY === null) return;
    karte.style.transition = "";
    karte.style.transform = "";
    if (weg > 90) schliesseStory();
    startY = null;
  });
}

window.addEventListener("popstate", () => { if (sheet) schliesseStory(true); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && sheet) schliesseStory();
});

/* ---------- Map ---------- */

// Der Karten-iframe überlebt den Tab-Wechsel: neu einhängen würde ihn neu laden (gut ein
// Megabyte) und das Kraft-Layout komplett neu rechnen. Er hängt deshalb außerhalb von
// #main am body und wird nur per CSS ein- und ausgeblendet.
let mapHost = null;

function renderMap() {
  main.innerHTML = "";
  if (mapHost) { richteKarteEin(); return; }
  mapHost = el(`<div id="map-host"><iframe class="map-frame" src="map.html" title="Keyword map"></iframe></div>`);
  document.body.append(mapHost);
  mapHost.querySelector("iframe").addEventListener("load", richteKarteEin);
}

// Safe-Area-Insets an die Karte durchreichen (env() ist in iOS-iframes unzuverlässig)
// + "embedded" kennzeichnen, damit die Karten-Bedienelemente der Tab-Pille ausweichen.
// Die Nachricht stößt das Neumessen an — ausgeblendet war der iframe 0 px breit.
function richteKarteEin() {
  const frame = mapHost?.querySelector("iframe");
  const doc = frame?.contentDocument;
  if (!doc) return;
  const cs = getComputedStyle(document.documentElement);
  for (const p of ["--sat", "--sab"]) {
    const v = cs.getPropertyValue(p).trim();
    if (v) doc.documentElement.style.setProperty(p, v);
  }
  doc.documentElement.classList.add("embedded");
  frame.contentWindow.postMessage("karte:sichtbar", location.origin);
}

/* ---------- Stats ---------- */
// Jede Kachel lädt für sich über /api/stats/<teil>: die schnellen stehen sofort, die
// teuren Aggregationen füllen ihre Kachel nach — vorher wartete die ganze Seite auf die
// langsamste Abfrage. Plätze und Reihenfolge stehen von Anfang an fest, damit beim
// Eintreffen nichts springt. Die Diagramme werden auf die **gemessene** Kachelbreite
// gezeichnet (viewBox in CSS-Pixeln): mit der früheren festen 720er-Breite schrumpfte
// 9-px-Text auf dem iPhone auf unlesbare 4 px.

function statsKachel(grid, titel, breit) {
  const p = el(`<div class="panel${breit ? " wide" : ""}"><h3>${titel}</h3>
    <div class="panel-body"><div class="panel-laedt"></div></div></div>`);
  grid.append(p);
  return p;
}

// `bauen(daten, breite)` liefert die Knoten der Kachel — oder nichts, dann verschwindet
// sie (Artefakt noch nie gerechnet). Fehler beim Laden zeigen eine kurze Meldung statt
// die übrigen Kacheln mitzureißen.
function fuelleKachel(panel, daten, bauen) {
  let inhalt;
  try {
    inhalt = bauen(daten, Math.max(260, panel.clientWidth - 36));
  } catch (e) {
    console.warn("Stats-Kachel:", e);
    inhalt = null;
  }
  if (!inhalt || !inhalt.length) { panel.remove(); return; }
  panel.querySelector(".panel-body").replaceChildren(...inhalt.filter(Boolean));
}

function legende(eintraege) {
  const l = el(`<div class="legend" style="margin-top:10px"></div>`);
  for (const [farbe, text, stil] of eintraege) {
    l.append(el(`<span class="legend-item"><i style="background:${farbe};${stil || ""}"></i>${text}</span>`));
  }
  return l;
}

const LADEFEHLER = () => [el(`<div class="hint">Couldn't load.</div>`)];

/* ---------- Kachel: Weltkarte der Berichterstattung ---------- */
// Landraster aus globe.bin (2°-Zellen, gleiche Datei wie der Globus) als Punktgitter;
// Zellen mit verorteten Schauplätzen der letzten 90 Tage färben sich blau, heller je
// mehr Artikel dort spielen. Canvas statt SVG: rund 4000 Landzellen. Die Helligkeit
// skaliert logarithmisch — linear skaliert wäre neben Berlin alles gleich dunkel.

function cssFarbe(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function bauOrte(d, w) {
  const p = d.places;
  if (!p || !p.points || !p.points.length) return null;
  const canvas = el(`<canvas style="width:100%;display:block"></canvas>`);

  // Gezeichnet wird auf die **gerade gemessene** Breite, und ein ResizeObserver
  // zeichnet nach, sobald sich die Kachel umlegt: die Breite aus fuelleKachel stammt
  // von vor dem Einfügen und war zu schmal gemessen — ein Canvas skaliert dann unscharf
  // hoch, wo ein SVG verlustfrei mitwächst.
  fetch("globe.bin").then(r => r.arrayBuffer()).then(puffer => {
    const kopf = new DataView(puffer);
    if (String.fromCharCode(kopf.getUint8(0), kopf.getUint8(1), kopf.getUint8(2),
                            kopf.getUint8(3)) !== "GLB1") return;
    const rows = kopf.getUint16(4, true), cols = kopf.getUint16(6, true);
    const raster = new Uint8Array(puffer, 8);
    const zeichne = () => {
      const w = canvas.clientWidth || 300;
      const h = Math.round(w / 2);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      const zx = w / cols, zy = h / rows;

      // Artikelzahl je Rasterzelle. Liegt ein Zentroid im Wasser (Küstenstädte,
      // Inselstaaten), wandert er auf die nächste Landzelle der Umgebung — eine
      // blaue Kachel allein im Ozean sähe nach einem Fehler aus; ohne Land in
      // Reichweite behält er seine Zelle.
      const zaehler = new Map();
      for (const pt of p.points) {
        let i = Math.min(rows - 1, Math.max(0, Math.floor((90 - pt.lat) / 180 * rows)));
        let j = ((Math.floor((pt.lon + 180) / 360 * cols) % cols) + cols) % cols;
        if (!(raster[i * cols + j] & 0x80)) {
          suche: for (let d = 1; d <= 2; d++) {
            for (let di = -d; di <= d; di++) {
              for (let dj = -d; dj <= d; dj++) {
                const ni = i + di, nj = (((j + dj) % cols) + cols) % cols;
                if (ni < 0 || ni >= rows || !(raster[ni * cols + nj] & 0x80)) continue;
                i = ni; j = nj; break suche;
              }
            }
          }
        }
        const k = i * cols + j;
        zaehler.set(k, (zaehler.get(k) || 0) + pt.n);
      }

      ctx.fillStyle = cssFarbe("--border");
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          if (raster[i * cols + j] & 0x80) ctx.fillRect(j * zx, i * zy, zx * 0.72, zy * 0.72);
        }
      }
      const nMax = Math.max(...zaehler.values());
      ctx.fillStyle = cssFarbe("--accent");
      for (const [k, n] of zaehler) {
        ctx.globalAlpha = 0.25 + 0.75 * Math.log1p(n) / Math.log1p(nMax);
        ctx.fillRect((k % cols) * zx, Math.floor(k / cols) * zy, zx * 0.72, zy * 0.72);
      }
      ctx.globalAlpha = 1;
      // Namen nur für die größten Schauplätze, mit Halo gegen das Punktgitter.
      ctx.font = "600 10.5px -apple-system, sans-serif";
      ctx.textAlign = "center";
      for (const pt of p.points.slice(0, 8)) {
        const x = (pt.lon + 180) / 360 * w;
        const y = (90 - pt.lat) / 180 * h;
        ctx.lineWidth = 3;
        ctx.strokeStyle = cssFarbe("--surface");
        ctx.strokeText(pt.name, x, y - zy);
        ctx.fillStyle = cssFarbe("--text");
        ctx.fillText(pt.name, x, y - zy);
      }
    };
    let breite = 0;
    new ResizeObserver(() => {
      if (Math.abs(canvas.clientWidth - breite) < 5) return;
      breite = canvas.clientWidth;
      zeichne();
    }).observe(canvas);
    requestAnimationFrame(zeichne);
  }).catch(e => console.warn("Weltkarte:", e));

  const anteil = Math.round(100 * p.located / Math.max(1, p.total));
  const hinweis = el(`<div class="hint" style="margin-top:8px">
    ${p.located.toLocaleString("de-DE")} of ${p.total.toLocaleString("de-DE")} articles
    located (${anteil} %) · last ${p.days} days · tile brightness = article count</div>`);
  return [canvas, hinweis];
}

function renderStats() {
  main.innerHTML = "";
  const grid = el(`<div class="stats-grid"></div>`);
  main.append(grid);

  const lade = (titel, breit, teil, bauen) => {
    const p = statsKachel(grid, titel, breit);
    api(`api/stats/${teil}`)
      .then(d => fuelleKachel(p, d, bauen))
      .catch(() => fuelleKachel(p, null, LADEFEHLER));
  };

  // Library und Quellenliste teilen sich einen Endpunkt — ein Abruf, zwei Kacheln. Die
  // Like-Rate je Quelle und die Keyword-Vorlieben verraten Geschmack und fehlen in der Demo.
  const quellenKacheln = [[statsKachel(grid, "Library", false), bauLibrary],
    ...(DEMO ? [] : [[statsKachel(grid, "Sources · Like rate", false), bauQuellen]])];
  api("api/stats/sources")
    .then(d => quellenKacheln.forEach(([p, bauen]) => fuelleKachel(p, d, bauen)))
    .catch(() => quellenKacheln.forEach(([p]) => fuelleKachel(p, null, LADEFEHLER)));

  lade("Model metrics", false, "model", bauModell);
  if (!DEMO) lade("Keyword preferences", false, "keywords", bauKeywords);
  lade("Reading volume per weekday", false, "weekday", bauWochentage);
  lade("Prediction scores · rated articles", true, "scores", bauScores);
  lade("Model quality & topic novelty", true, "temporal", bauTemporal);
  lade("Model quality vs. training data", true, "learning", bauLearning);
  lade("Articles per month and source", true, "volume",
       (d, w) => [stackedChart(d.volume_all, w), sourceLegend(d.volume_all)]);
  lade("Ratings per month and source", true, "ratings",
       (d, w) => [stackedChart(d.ratings_time, w), sourceLegend(d.ratings_time)]);
  lade("Article length per source (characters)", true, "length",
       (d, w) => [lengthChart(d.length_dist, w)]);
  lade("Where the news happens", true, "places", bauOrte);
  if (DEMO) return;

  // Das Settings-Panel bringt sein eigenes Markup mit (details/summary) und ersetzt
  // seinen Platzhalter, sobald der Stand geladen ist.
  const slot = statsKachel(grid, "Settings", true);
  settingsPanel().then(p => slot.replaceWith(p));
}

function bauLibrary(d) {
  return [el(`<div>
    <div class="stat-big">${d.total_articles.toLocaleString("de-DE")}</div>
    <div class="stat-label">Articles in database</div>
    <div style="height:12px"></div>
    <div class="stat-big">${d.total_rated.toLocaleString("de-DE")}</div>
    <div class="stat-label">of those rated</div>
    ${d.db_size_bytes == null ? "" : `<div style="height:12px"></div>
    <div class="stat-big">${dez((d.db_size_bytes / 1e9).toFixed(1))} GB</div>
    <div class="stat-label">Database size</div>`}
    <a class="rate-link" href="#rate">Rate articles &rarr;</a>
    <a class="rate-link" href="#merge">Merge keywords &rarr;</a>
  </div>`)];
}

function bauQuellen(d) {
  const wrap = el(`<div></div>`);
  let sumLikes = 0, sumRated = 0, sumN = 0;
  for (const src of d.sources) {
    const rated = (src.likes || 0) + (src.dislikes || 0);
    const q = rated ? Math.round((src.likes / rated) * 100) : null;
    sumLikes += src.likes || 0; sumRated += rated; sumN += src.n;
    wrap.append(el(`<div class="kv"><span>${esc(src.source)}</span>
      <b>${src.n.toLocaleString("de-DE")} · ${q === null ? "–" : q + " %"}</b></div>`));
  }
  const qGesamt = sumRated ? Math.round((sumLikes / sumRated) * 100) : null;
  wrap.append(el(`<div class="kv total"><span>Total</span>
    <b>${sumN.toLocaleString("de-DE")} · ${qGesamt === null ? "–" : qGesamt + " %"}</b></div>`));
  return [wrap];
}

function bauModell(d, w) {
  const m = d.model;
  if (!m || !m.holdout_auc) return null;
  const teile = [];
  for (const [k, label] of [["holdout_auc", "ROC-AUC"], ["holdout_precision", "Precision"],
                            ["holdout_recall", "Recall"], ["holdout_accuracy", "Accuracy"]]) {
    teile.push(el(`<div class="kv"><span>${label}</span><b>${dez(m[k])}</b></div>`));
  }
  if (m.positive_share != null) {
    teile.push(el(`<div class="kv"><span>Above threshold (&ge; ${dez2(d.feed_threshold)})</span>
      <b>${Math.round(m.positive_share * 100)} %</b></div>`));
  }
  if (m.roc && m.roc.fpr.length > 1) {
    teile.push(rocChart(m.roc, m.holdout_auc, w));
    teile.push(legende([["var(--accent)", "ROC (time-based holdout)"],
                        ["#e8a54b", `Feed threshold ${dez2(m.threshold)}`, "border-radius:50%"]]));
  }
  // Der Server rechnet Precision, Recall, Accuracy und den Punkt gegen die aktuelle
  // Schwelle neu — nur ein Modell von vor diesem Mechanismus zeigt noch die des Trainings.
  if (m.threshold !== undefined && Math.abs(m.threshold - d.feed_threshold) > 1e-9) {
    teile.push(el(`<div class="hint">Precision, recall and accuracy refer to the training
      threshold ${dez2(m.threshold)}; the feed currently uses ${dez2(d.feed_threshold)}.
      Retrain the model to update them.</div>`));
  }
  if (m.trained_at) teile.push(updatedLine(m.trained_at));
  return teile;
}

// Keywords, deren Artikel das Modell besonders hoch oder niedrig einstuft (geschrumpfte
// mittlere Wahrscheinlichkeit, gerechnet in classify.keyword_praeferenzen). Kompakt je 5,
// ein Tipp auf die Liste klappt auf die vollen 20 je Richtung auf.
function bauKeywords(d) {
  const kp = d.keyword_praeferenzen;
  if (!kp || !(kp.liked || []).length) return null;
  const KOMPAKT = 5;
  const wrap = el(`<div class="kw-pref"></div>`);
  const spalte = (titel, eintraege, klasse) => {
    const c = el(`<div class="kw-col"><h4>${titel}</h4></div>`);
    eintraege.forEach((e, i) => {
      const zeile = el(`<div class="kw-row"${i >= KOMPAKT ? " hidden" : ""}>
        <span class="kw-name">${esc(e.keyword)}</span>
        <b class="${klasse}">${Math.round(e.score * 100)} %</b></div>`);
      zeile.title = `${e.keyword} · ${e.n.toLocaleString("de-DE")} articles`;
      if (i >= KOMPAKT) zeile.classList.add("kw-extra");
      c.append(zeile);
    });
    return c;
  };
  wrap.append(spalte("Likes", kp.liked, "pos"), spalte("Dislikes", kp.disliked, "neg"));
  const max = Math.max(kp.liked.length, (kp.disliked || []).length);
  const mehr = el(`<div class="kw-more">Show top ${max} ▾</div>`);
  let offen = false;
  const toggle = () => {
    offen = !offen;
    for (const z of wrap.querySelectorAll(".kw-extra")) z.hidden = !offen;
    mehr.textContent = offen ? "Show less ▴" : `Show top ${max} ▾`;
  };
  wrap.addEventListener("click", toggle);
  mehr.addEventListener("click", toggle);
  return [wrap, mehr, kp.generated_at ? updatedLine(kp.generated_at) : null];
}

function bauScores(d, w) {
  if (!d.probs || !d.probs.length) return null;
  let richtig = 0;
  for (let i = 0; i < d.probs.length; i++) {
    if ((d.probs[i] >= d.feed_threshold) === (d.ratings[i] === 1)) richtig++;
  }
  const falsch = d.probs.length - richtig;
  return [
    scoresChart(d.probs, d.ratings, d.feed_threshold, w),
    legende([["var(--like)", `correct at current threshold (${richtig.toLocaleString("de-DE")})`],
             ["var(--dislike)", `misclassified (${falsch.toLocaleString("de-DE")})`],
             ["#e8a54b", `threshold ${dez2(d.feed_threshold)}`, "width:14px;height:2px;border-radius:0"]]),
  ];
}

function bauTemporal(d, w) {
  const tc = d.temporal_curve;
  if (!tc || !tc.points.length) return null;
  return [
    temporalChart(tc, w),
    legende([["var(--accent)", "ROC-AUC (right axis)"], ["#e8a54b", "Topic novelty (left axis)"]]),
    tc.generated_at ? updatedLine(tc.generated_at) : null,
  ];
}

function bauLearning(d, w) {
  const lc = d.learning_curve;
  if (!lc || !lc.points.length) return null;
  return [
    learningChart(lc, w),
    legende([["var(--accent)", "Mean AUC"],
             ["color-mix(in srgb, var(--accent) 25%, transparent)", "±1 std", "width:14px;height:8px"]]),
    lc.generated_at ? updatedLine(lc.generated_at) : null,
  ];
}

function bauWochentage(d, w) {
  const wv = d.weekday_volume;
  if (!wv || !wv.points.length) return null;
  const schnitt = t =>
    (wv.points.reduce((a, p) => a + p[t], 0) / wv.points.length).toFixed(1).replace(".", ",");
  return [
    weekdayChart(wv, w),
    legende([["var(--accent)", "Feed stories (left)"],
             ["var(--text-dim)", "Articles published (right)", "opacity:.35"]]),
    el(`<div class="hint" style="margin-top:8px">Ø per day: ${schnitt("stories")} stories
      from ${schnitt("articles")} articles (last ${wv.days} days,
      ${fmtDate(wv.from)} – ${fmtDate(wv.to)}).</div>`),
  ];
}

// Beschriftung je Parameter; Grenzen, Schrittweite und Wirkung kommen vom Server
// (config.EINSTELLBAR), damit hier nichts doppelt gepflegt werden muss.
const EINSTELL_TEXT = {
  feed_threshold: ["Feed threshold",
    "Minimum score a story needs. Lower shows more, but less relevant.", 0.01],
  feed_days: ["Feed window",
    "Days the feed loads first; scrolling down keeps loading older stories without limit. "
    + "Also how far back summaries are written.", 1],
  heat_mark: ["Hot-story threshold",
    "Stories whose heat (source coverage × momentum × novelty) clears this get the amber "
    + "highlight. Lower marks more.", 0.01],
  story_cut: ["Story cut",
    "How far apart two articles may be and still share a story. Every pair inside a story "
    + "has to clear this — not just neighbouring ones. Lower bundles less, but tighter.", 0.01],
  story_time_weight: ["Weight of the time gap",
    "How much each day between two articles counts against them. 0 ignores time entirely; "
    + "at 0,005 a ten-day gap costs as much as 0,05 of similarity.", 0.001],
  story_source_penalty: ["Same-source surcharge",
    "Extra distance for two texts from one newsroom. Two papers on one event is a signal, "
    + "three texts from one paper on one topic is everyday business.", 0.01],
  world_marker: ["Markers on the globe", "How many stories are pinned.", 1],
  world_marker_je_region: ["Markers per world region",
    "The cap per round — keeps Europe and North America from filling the globe.", 1],
  world_min_abstand_km: ["Minimum distance between markers",
    "Below roughly 1.500 km two markers overlap and the weaker one can no longer be tapped.", 100],
  world_deckung_gewicht: ["Weight of multi-source coverage",
    "How strongly stories covered by several sources are preferred. 0 turns it off.", 0.05],
  world_heat_gewicht: ["Weight of hot stories",
    "How strongly stories marked hot in the feed are preferred on the globe. 0 turns it off.", 0.05],
  world_reserve_score: ["Fill-in score for empty regions",
    "World regions without a feed-worthy story get their best story from this score up, "
    + "so South America, Africa and the poles are not left blank.", 0.05],
};

const EINSTELL_GRUPPE = {
  feed: ["Feed", "Filters on query, so the selection changes right away — the summaries "
    + "for stories that newly qualify need a <code>news summarize</code> run on the Mac."],
  sofort: ["Highlights", "Applies at query time — no compute run needed."],
  stories: ["Stories", "Needs a <code>news stories</code> run on the Mac."],
  world: ["Globe", "Needs a <code>news world</code> run on the Mac."],
};

async function settingsPanel() {
  // Zugeklappt, weil die Statistik sonst unter neun Reglern verschwindet. Der Stand wird
  // trotzdem sofort geholt — er ist klein und trägt die „pending"-Marke, die auch im
  // zugeklappten Zustand sichtbar sein soll.
  const panel = el(`<details class="panel wide settings">
    <summary><h3>Settings</h3><span class="pending" hidden>pending</span></summary></details>`);
  const kopfmarke = panel.querySelector(".pending");
  let stand;
  try {
    stand = await api("api/settings");
  } catch {
    panel.append(el(`<div class="hint">Settings need a newer server version.</div>`));
    return panel;
  }

  const schreiben = entwurf(async werte => {
    const resp = await fetch("api/settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: werte }),
    });
    if (!resp.ok) throw new Error(String(resp.status));
    stand = await resp.json();
    offenAnzeigen();
    if (werte.feed_threshold !== undefined) feedState = null;   // Feed neu holen
  });

  const marken = {};
  function offenAnzeigen() {
    for (const [bereich, mark] of Object.entries(marken)) {
      const offen = stand.pending.includes(bereich);
      mark.hidden = !offen;
    }
    kopfmarke.hidden = !stand.pending.length;
  }

  for (const [wirkung, [titel, erklaerung]] of Object.entries(EINSTELL_GRUPPE)) {
    const namen = Object.keys(stand.spec).filter(n => stand.spec[n].effect === wirkung);
    if (!namen.length) continue;
    const kopf = el(`<div class="settings-gruppe"><h4>${titel}</h4>
      <div class="hint">${erklaerung}</div></div>`);
    const mark = el(`<span class="pending" hidden>pending</span>`);
    kopf.querySelector("h4").append(mark);
    marken[wirkung] = mark;
    panel.append(kopf);
    for (const name of namen) panel.append(regler(name, stand, schreiben, vorschau));
    // Die Feed-Auswahl wirkt sofort — dann kann man auch sofort zeigen, was sie bewirkt.
    if (wirkung === "feed") panel.append(vorschauZeile);
  }
  offenAnzeigen();
  // Die Vorschau zählt Stories über das NAS; zugeklappt sieht sie ohnehin niemand.
  panel.addEventListener("toggle", () => { if (panel.open) vorschau(); }, { once: true });
  return panel;
}

// Live-Vorschau: wie viele Stories der Feed bei der eingestellten Schwelle und Fensterweite
// zeigen würde. Gefragt wird mit den Reglerwerten, nicht mit dem gespeicherten Stand —
// die Zahl soll dem Daumen folgen, nicht dem Speichern hinterherlaufen.
const vorschauZeile = el(`<div class="vorschau">…</div>`);

let vorschauLauf = 0;

const vorschau = entwurf(async () => {
  const wert = n => vorschauZeile.parentElement?.querySelector(`input[data-name="${n}"]`)?.value;
  const [t, d] = [wert("feed_threshold"), wert("feed_days")];
  if (t === undefined || d === undefined) return;
  // Über das NAS dauert die Abfrage ein paar hundert Millisekunden, und die Antworten
  // kommen nicht zwingend in der Reihenfolge zurück, in der sie gestellt wurden: ohne
  // diesen Zähler überschreibt eine langsame ältere Antwort die neuere, und am Regler
  // steht dauerhaft die Zahl von vorhin.
  const lauf = ++vorschauLauf;
  const r = await api(`api/feed_preview?threshold=${t}&days=${d}`);
  if (lauf !== vorschauLauf) return;
  vorschauZeile.innerHTML =
    `<b>${r.stories.toLocaleString("de-DE")}</b> stories in the feed`
    + ` · ${r.articles.toLocaleString("de-DE")} articles · last ${r.days} days`;
}, 250);

function regler(name, stand, schreiben, vorschau) {
  const spec = stand.spec[name];
  const [titel, erklaerung, schritt] = EINSTELL_TEXT[name] || [name, "", 0.01];
  // Schwellen immer zweistellig: „0,7" neben „0,66" liest sich wie ein anderer Maßstab.
  const zeige = v => spec.integer ? Number(v).toLocaleString("de-DE") : dez2(Number(v));
  const zeile = el(`<div class="regler">
    <label><span>${titel}</span><b>${zeige(stand.settings[name])}</b></label>
    <input type="range" min="${spec.min}" max="${spec.max}" step="${schritt}"
           value="${stand.settings[name]}" aria-label="${titel}">
    <div class="hint">${erklaerung}</div></div>`);
  const wert = zeile.querySelector("b");
  const schieber = zeile.querySelector("input");
  schieber.dataset.name = name;
  schieber.addEventListener("input", () => {
    wert.textContent = zeige(schieber.value);
    schreiben({ [name]: Number(schieber.value) });
    if (spec.effect === "feed") vorschau();
  });
  return zeile;
}

// Sammelt Änderungen und schickt sie gebündelt: am Regler feuert `input` je Pixel, und
// jede Anfrage öffnet auf dem NAS eine eigene DB-Verbindung.
function entwurf(senden, ms = 400) {
  let offen = {}, timer = null;
  return werte => {
    Object.assign(offen, werte);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const jetzt = offen;
      offen = {};
      senden(jetzt).catch(e => console.warn("Einstellungen:", e));
    }, ms);
  };
}

// Zeitstempel für vorberechnete Grafiken: zeigt, wann sie zuletzt berechnet wurden
// (die übrigen Panels werden live aus der DB berechnet und sind immer aktuell).
function updatedLine(iso) {
  return el(`<div class="hint updated">Last updated: ${fmtDate(iso)}</div>`);
}

// Wer hier fehlt, fällt aus den Diagrammen heraus (siehe Object.keys(SOURCE_COLORS)
// weiter unten) — neue Quellen brauchen also zwingend einen Eintrag. Gleiche Tabelle
// in news/pipeline/keyword_map.py für den Quellen-Farbmodus der Karte.
const SOURCE_COLORS = {
  heise: "#6ba3f8", taz: "#e5787d",
  arstechnica: "#e8a54b", netzpolitik: "#a78bfa",
  restofworld: "#4ec98d", dialogueearth: "#45c2c8", sixthtone: "#d977c9",
  bbc: "#9dd14f", sciencenews: "#57c96a", tagesschau: "#e0d155",
  youtube: "#f2645a", zeit: "#c08552",
};

function sourceLegend(data) {
  const present = new Set((data || []).map(d => d.source));
  const legend = el(`<div class="legend"></div>`);
  for (const [source, color] of Object.entries(SOURCE_COLORS)) {
    if (present.size && !present.has(source)) continue;
    legend.append(el(`<span class="legend-item">
      <i style="background:${color}"></i>${source}</span>`));
  }
  return legend;
}

function stackedChart(volumeAll, w) {
  const byMonth = {};
  for (const v of volumeAll) {
    (byMonth[v.month] ??= {})[v.source] = v.n;
  }
  const months = Object.keys(byMonth).sort();
  const totals = months.map(m => Object.values(byMonth[m]).reduce((a, b) => a + b, 0));
  const h = 170, max = Math.max(1, ...totals);
  const bw = w / Math.max(months.length, 1);
  let bars = "";
  months.forEach((month, i) => {
    let y = h;
    const parts = Object.entries(byMonth[month])
      .map(([src, n]) => `${src}: ${n}`).join(", ");
    for (const [source, color] of Object.entries(SOURCE_COLORS)) {
      const n = byMonth[month][source];
      if (!n) continue;
      const bh = (n / max) * (h - 12);
      // Überlappung nach unten ins schon gezeichnete Segment: unabhängig gerundete
      // Kanten ließen sonst den Hintergrund als dunkle Naht durchscheinen. Die
      // Deckkraft liegt deshalb auf der Gruppe, nicht am Rechteck — dort würde
      // die Überlappung selbst zur Naht.
      const lappe = y < h ? 0.7 : 0;
      y -= bh;
      bars += `<rect x="${(i * bw).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(bw - 1.5, 1).toFixed(1)}" height="${(bh + lappe).toFixed(1)}" fill="${color}"><title>${month} — ${parts}</title></rect>`;
    }
  });
  const labels = months
    .filter(m => m.endsWith("-01"))
    .map(m => `<text x="${(months.indexOf(m) * bw).toFixed(1)}" y="${h + 15}" font-size="11" fill="var(--text-dim)">${m.slice(0, 4)}</text>`)
    .join("");
  return el(`<svg viewBox="0 0 ${w} ${h + 20}"><g opacity="0.85">${bars}</g>${labels}</svg>`);
}

// Achsenbeschriftung = Obergrenze des Buckets (Zeichen); letzter Bucket ist offen
const LENGTH_TICKS = ["0,5k", "1k", "2k", "4k", "8k", "16k", "+"];

/* Kleine Vielfache statt einer endlosen Zeile: die alte Fassung reihte elf Quellen auf
   3000 viewBox-Pixel — auf dem iPhone auf ein Zehntel geschrumpft war davon nichts mehr
   zu erkennen. Jetzt bricht das Raster mit der Kachelbreite um, jede Zelle trägt ihren
   Quellennamen selbst (keine Legende nötig). */
function lengthChart(dist, w) {
  const nb = LENGTH_TICKS.length;
  const bySource = {};
  for (const d of dist) (bySource[d.source] ??= Array(nb).fill(0))[d.bucket] = d.n;
  const sources = Object.keys(SOURCE_COLORS).filter(s => bySource[s]);
  const cols = Math.max(2, Math.floor(w / 190));
  const cw = w / cols, ch = 112;
  const rows = Math.ceil(sources.length / cols);
  let parts = "";
  sources.forEach((source, i) => {
    const x0 = (i % cols) * cw + 5, y0 = Math.floor(i / cols) * ch;
    const values = bySource[source], max = Math.max(1, ...values);
    const bwUnit = (cw - 14) / nb;
    parts += `<text x="${x0.toFixed(1)}" y="${y0 + 13}" font-size="11.5" font-weight="600"
      fill="${SOURCE_COLORS[source]}">${source}</text>`;
    values.forEach((n, b) => {
      const bh = (n / max) * (ch - 52);
      const x = x0 + b * bwUnit, y = y0 + ch - 26 - bh;
      parts += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bwUnit - 3).toFixed(1)}"
        height="${bh.toFixed(1)}" rx="2" fill="${SOURCE_COLORS[source]}" opacity="0.85">
        <title>${source} ${LENGTH_TICKS[b]} chars: ${n}</title></rect>`;
      parts += `<text x="${(x + (bwUnit - 3) / 2).toFixed(1)}" y="${y0 + ch - 12}"
        font-size="9" text-anchor="middle" fill="var(--text-dim)">${LENGTH_TICKS[b]}</text>`;
    });
  });
  return el(`<svg viewBox="0 0 ${w} ${rows * ch}" style="max-width:100%">${parts}</svg>`);
}

function learningChart(lc, w) {
  const pts = lc.points;
  const h = 220, padL = 34, padR = 14, padB = 24, padT = 10;
  const lx = n => Math.log2(n);   // log-Achse: Größen verdoppeln sich je Punkt
  const x0 = lx(pts[0].n), x1 = lx(pts[pts.length - 1].n);
  const unten = Math.max(0.3,
    Math.floor(Math.min(0.5, ...pts.map(p => p.auc - p.std)) * 20) / 20);
  const X = n => padL + (lx(n) - x0) / (x1 - x0 || 1) * (w - padL - padR);
  const Y = v => padT + (1 - (v - unten) / (1 - unten || 1)) * (h - padT - padB);

  let g = "";
  for (let v = Math.ceil(unten * 10) / 10; v <= 1.001; v = Math.round((v + 0.1) * 10) / 10) {
    g += `<line x1="${padL}" y1="${Y(v).toFixed(1)}" x2="${w - padR}" y2="${Y(v).toFixed(1)}" stroke="var(--border)"/>
      <text x="2" y="${(Y(v) + 3).toFixed(1)}" font-size="10.5" fill="var(--text-dim)">${v.toFixed(1).replace(".", ",")}</text>`;
  }
  const oben = pts.map(p => `${X(p.n).toFixed(1)},${Y(Math.min(1, p.auc + p.std)).toFixed(1)}`);
  const untenPfad = [...pts].reverse()
    .map(p => `${X(p.n).toFixed(1)},${Y(Math.max(unten, p.auc - p.std)).toFixed(1)}`);
  g += `<polygon points="${oben.join(" ")} ${untenPfad.join(" ")}" fill="var(--accent)" opacity="0.14"/>`;
  g += `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${X(p.n).toFixed(1)},${Y(p.auc).toFixed(1)}`).join("")}"
    fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  for (const p of pts) {
    g += `<circle cx="${X(p.n).toFixed(1)}" cy="${Y(p.auc).toFixed(1)}" r="3" fill="var(--accent)">
      <title>${p.n} training articles: AUC ${p.auc} ± ${p.std} (${p.reps} model${p.reps > 1 ? "s" : ""})</title></circle>`;
    g += `<text x="${X(p.n).toFixed(1)}" y="${h - 8}" font-size="10.5" fill="var(--text-dim)"
      text-anchor="middle">${p.n}</text>`;
  }
  return el(`<svg viewBox="0 0 ${w} ${h}" style="max-width:100%">${g}</svg>`);
}

/* ROC-Kurve des zeitlichen Holdouts. Quadratisch gezeichnet, weil die Diagonale nur so
   die 45-Grad-Linie ist, gegen die man die Kurve liest — auf einer gestreckten Fläche
   sieht ein mittelmäßiges Modell steiler aus, als es ist. Beide Achsen laufen fest von
   0 bis 1: Ein Zoom auf die tatsächliche Spannweite wie in temporalChart wäre hier
   irreführend, die Fläche unter der Kurve *ist* die berichtete AUC. */
function rocChart(roc, auc, breite) {
  const padL = 32, padR = 12, padT = 10, padB = 34;
  const seite = Math.min(300, breite - padL - padR);
  const w = padL + seite + padR, h = padT + seite + padB;
  const X = f => padL + f * seite;
  const Y = t => padT + (1 - t) * seite;

  let g = "";
  for (let i = 0; i <= 4; i++) {
    const v = i / 4;
    g += `<line x1="${padL}" y1="${Y(v).toFixed(1)}" x2="${X(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--border)"/>
      <line x1="${X(v).toFixed(1)}" y1="${padT}" x2="${X(v).toFixed(1)}" y2="${Y(0)}" stroke="var(--border)"/>
      <text x="${padL - 4}" y="${(Y(v) + 3).toFixed(1)}" font-size="10" text-anchor="end"
        fill="var(--text-dim)">${dez(v.toFixed(2))}</text>
      <text x="${X(v).toFixed(1)}" y="${Y(0) + 13}" font-size="10" text-anchor="middle"
        fill="var(--text-dim)">${dez(v.toFixed(2))}</text>`;
  }
  g += `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="var(--text-dim)"
    stroke-width="1" stroke-dasharray="4 3" opacity="0.45"/>`;

  const punkte = roc.fpr.map((f, i) => `${X(f).toFixed(1)},${Y(roc.tpr[i]).toFixed(1)}`);
  g += `<polygon points="${punkte.join(" ")} ${X(1)},${Y(0)} ${X(0)},${Y(0)}"
    fill="var(--accent)" opacity="0.14"/>`;
  g += `<path d="M${punkte.join("L")}" fill="none" stroke="var(--accent)" stroke-width="2"
    stroke-linejoin="round"/>`;

  if (roc.operating) {
    const [f, t] = roc.operating;
    g += `<circle cx="${X(f).toFixed(1)}" cy="${Y(t).toFixed(1)}" r="4" fill="#e8a54b"
      stroke="var(--surface)" stroke-width="1.5">
      <title>At the feed threshold: ${Math.round(t * 100)} % of liked articles kept, ${Math.round(f * 100)} % of disliked ones let through</title></circle>`;
  }
  if (Number.isFinite(auc)) {
    g += `<text x="${X(1) - 6}" y="${Y(0) - 8}" font-size="12" text-anchor="end"
      fill="var(--text-dim)">AUC ${dez(auc)}</text>`;
  }
  g += `<text x="${X(0.5).toFixed(1)}" y="${h - 4}" font-size="11" text-anchor="middle"
    fill="var(--text-dim)">False positive rate</text>
    <text x="10" y="${(padT + seite / 2).toFixed(1)}" font-size="11" text-anchor="middle"
      fill="var(--text-dim)" transform="rotate(-90 10 ${(padT + seite / 2).toFixed(1)})">True positive rate</text>`;
  return el(`<svg viewBox="0 0 ${w} ${h}" style="max-width:100%">${g}</svg>`);
}

/* Gitter-Achse mit runden Schritten: der kleinste Schritt aus 1/2/2,5/5 · 10^k, mit dem
   `teile` Stufen ab der abgerundeten Untergrenze noch über das Maximum reichen. Feste
   Stufenzahl, damit zwei Achsen im selben Bild dieselben Gitterlinien teilen. */
function achsenSkala(min, max, teile) {
  const roh = ((max - min) || Math.abs(min) || 1) / teile;
  let groesse = 10 ** Math.floor(Math.log10(roh));
  for (let i = 0; i < 24; i++, groesse *= 10) {
    for (const f of [1, 2, 2.5, 5]) {
      const schritt = f * groesse;
      const lo = Math.floor(min / schritt) * schritt;
      if (lo + teile * schritt >= max - 1e-9) return { lo, schritt, teile };
    }
  }
}

function temporalChart(tc, w) {
  const pts = tc.points.map(p => ({ t: Date.parse(p.date), auc: p.auc, nov: p.novelty }));
  const h = 220, padL = 38, padR = 42, padB = 24, padT = 10;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  // Zwei Größen, zwei Achsen: auf 0,5–1,0 gestreckt wäre die AUC-Kurve fast eine Gerade.
  // Jede Achse zoomt auf ihre eigene Spannweite — Neuheit links, AUC rechts.
  const STUFEN = 5;
  const aucs = pts.map(p => p.auc).concat(Number.isFinite(tc.holdout_auc) ? [tc.holdout_auc] : []);
  const sAuc = achsenSkala(Math.min(...aucs), Math.max(...aucs), STUFEN);
  const sNov = achsenSkala(Math.min(...pts.map(p => p.nov)), Math.max(...pts.map(p => p.nov)), STUFEN);
  const X = t => padL + (t - t0) / (t1 - t0 || 1) * (w - padL - padR);
  const achsenY = s => v => padT + (1 - (v - s.lo) / (s.schritt * s.teile)) * (h - padT - padB);
  const Yauc = achsenY(sAuc), Ynov = achsenY(sNov);
  const beschriftung = (s, i) => {
    const dez = (String(Math.round(s.schritt * 1e9) / 1e9).split(".")[1] || "").length;
    return (s.lo + i * s.schritt).toFixed(dez).replace(".", ",");
  };
  const path = (sel, Y) => pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(sel(p)).toFixed(1)}`).join("");

  let g = "";
  // Gemeinsames Gitter, je Linie beide Achsen beschriftet — in der Farbe ihrer Kurve
  for (let i = 0; i <= STUFEN; i++) {
    const y = padT + (1 - i / STUFEN) * (h - padT - padB);
    g += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}"
      stroke="var(--border)" stroke-width="1"/>
      <text x="${padL - 4}" y="${(y + 3).toFixed(1)}" font-size="10.5" text-anchor="end"
        fill="#e8a54b">${beschriftung(sNov, i)}</text>
      <text x="${w - padR + 4}" y="${(y + 3).toFixed(1)}" font-size="10.5"
        fill="var(--accent)">${beschriftung(sAuc, i)}</text>`;
  }
  if (Number.isFinite(tc.holdout_auc)) {
    g += `<line x1="${padL}" y1="${Yauc(tc.holdout_auc).toFixed(1)}" x2="${w - padR}" y2="${Yauc(tc.holdout_auc).toFixed(1)}"
      stroke="var(--accent)" stroke-dasharray="4 3" stroke-width="1" opacity="0.5"/>`;
  }
  // Jahres-Ticks auf der Zeitachse
  const y0 = new Date(t0).getFullYear(), y1 = new Date(t1).getFullYear();
  for (let yr = y0; yr <= y1; yr++) {
    const tx = X(Date.parse(`${yr}-01-01`));
    if (tx >= padL && tx <= w - padR)
      g += `<text x="${tx.toFixed(1)}" y="${h - 8}" font-size="11" fill="var(--text-dim)" text-anchor="middle">${yr}</text>`;
  }
  g += `<path d="${path(p => p.nov, Ynov)}" fill="none" stroke="#e8a54b" stroke-width="1.6" opacity="0.85"/>`;
  g += `<path d="${path(p => p.auc, Yauc)}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  for (const p of pts)
    g += `<circle cx="${X(p.t).toFixed(1)}" cy="${Yauc(p.auc).toFixed(1)}" r="2" fill="var(--accent)"><title>${new Date(p.t).toLocaleDateString("de-DE")}: AUC ${p.auc}, novelty ${p.nov}</title></circle>`;
  return el(`<svg viewBox="0 0 ${w} ${h}" style="max-width:100%">${g}</svg>`);
}

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* Stories im Vordergrund, erschienene Artikel als Hintergrundbalken. Zwei Achsen wie in
   temporalChart: auf gemeinsamer Skala wären die Stories ein Fünftel der Balkenhöhe und
   der Wochenverlauf — der eigentliche Punkt — nicht mehr ablesbar. */
function weekdayChart(wv, w) {
  const pts = wv.points;
  const h = 175, padL = 26, padR = 30, padT = 10, padB = 20;
  const STUFEN = 4;
  const sSto = achsenSkala(0, Math.max(...pts.map(p => p.stories)), STUFEN);
  const sArt = achsenSkala(0, Math.max(...pts.map(p => p.articles)), STUFEN);
  const Y = s => v => padT + (1 - (v - s.lo) / (s.schritt * s.teile)) * (h - padT - padB);
  const Ysto = Y(sSto), Yart = Y(sArt);
  const bw = (w - padL - padR) / pts.length;
  const unten = h - padB;

  // Gleitkomma-Reste aus lo + i·schritt abschneiden, sonst steht da „22,500000000000004"
  const tick = (s, i) => dez(Math.round((s.lo + i * s.schritt) * 100) / 100);
  let g = "";
  for (let i = 0; i <= STUFEN; i++) {
    const y = padT + (1 - i / STUFEN) * (h - padT - padB);
    g += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${(w - padR).toFixed(1)}" y2="${y.toFixed(1)}"
      stroke="var(--border)" stroke-width="1"/>
      <text x="${padL - 4}" y="${(y + 3).toFixed(1)}" font-size="10" text-anchor="end"
        fill="var(--accent)">${tick(sSto, i)}</text>
      <text x="${(w - padR + 4).toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="10"
        fill="var(--text-dim)">${tick(sArt, i)}</text>`;
  }
  pts.forEach((p, i) => {
    const x = padL + i * bw, name = WEEKDAY_NAMES[p.weekday];
    const hArt = unten - Yart(p.articles), hSto = unten - Ysto(p.stories);
    g += `<rect x="${(x + 2).toFixed(1)}" y="${Yart(p.articles).toFixed(1)}"
      width="${(bw - 4).toFixed(1)}" height="${hArt.toFixed(1)}" rx="2"
      fill="var(--text-dim)" opacity="0.22">
      <title>${name}: ${dez(p.articles)} articles per day</title></rect>`;
    g += `<rect x="${(x + bw * 0.28).toFixed(1)}" y="${Ysto(p.stories).toFixed(1)}"
      width="${(bw * 0.44).toFixed(1)}" height="${hSto.toFixed(1)}" rx="2"
      fill="var(--accent)" opacity="0.9">
      <title>${name}: ${dez(p.stories)} feed stories per day</title></rect>`;
    g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(h - 6).toFixed(1)}" font-size="10.5"
      text-anchor="middle" fill="var(--text-dim)">${name}</text>`;
  });
  return el(`<svg viewBox="0 0 ${w} ${h}" style="max-width:100%">${g}</svg>`);
}

/* Trennschärfe-Plot: jeder bewertete Artikel ein Punkt, x = Rang nach Score, y = Score.
   Grün, wenn die aktuelle Schwelle ihn richtig einordnet, Rot sonst.

   Die Deckkraft eines Pixels ist proportional zur Punktdichte dort — jeder Punkt
   trägt denselben winzigen Anteil bei, sichtbar wird erst die Überlagerung vieler.
   Dadurch liest man aus der Intensität, **wo** die Punkte sich häufen (flache Stellen
   der Kurve = viele Artikel mit fast gleichem Score = kräftig; steile = dünn besetzt =
   dunkel), und aus dem Farbton, wo die Fehlgriffe sitzen. Bewusst **keine**
   Sättigungsformel gestapelter Kreise: die läuft auf dieser Kurve fast überall gegen
   voll deckend, und die Dichteunterschiede — der eigentliche Punkt — verschwinden.
   Gerechnet als Dichtefeld je Kanal statt echter Kreise: gleiche Optik, aber die
   Kanäle mischen im Farbton, statt dass der obere den unteren zudeckt. Canvas statt
   SVG: bei Tausenden Punkten wäre der DOM der Engpass. */
const DICHTE_KONTRAST = 1.25; // Gamma auf der Dichteskala: drückt dünn besetzte
                              // Stellen zusätzlich ins Dunkle, dichte bleiben voll
function scoresChart(probs, ratings, threshold, w) {
  const h = 210, padL = 32, padR = 8, padT = 8, padB = 8;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const gw = Math.round(w * dpr), gh = Math.round(h * dpr);
  const cv = el(`<canvas style="width:100%;height:auto;display:block" width="${gw}" height="${gh}"></canvas>`);
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr);
  // CSS-Variablen sind im Canvas nicht auflösbar — einmal vom Dokument ablesen.
  const stil = getComputedStyle(document.body);
  const farbe = (t, ersatz) => stil.getPropertyValue(t).trim() || ersatz;
  const rgb = s => {
    const m = /^#([0-9a-f]{6})$/i.exec(s);
    if (!m) return [128, 128, 128];
    const v = parseInt(m[1], 16);
    return [v >> 16 & 255, v >> 8 & 255, v & 255];
  };
  // Kräftiger als die UI-Farben: die Deckkraft-Stapelung dämpft ohnehin, und auf der
  // dünnen Kurve müssen die Töne auch halbtransparent noch klar Grün/Rot sagen.
  const saettige = ([r, g, b], f) => {
    const grau = 0.299 * r + 0.587 * g + 0.114 * b;
    const k = x => Math.max(0, Math.min(255, grau + (x - grau) * f));
    return [k(r), k(g), k(b)];
  };
  const cLike = saettige(rgb(farbe("--like", "#4cc38a")), 1.5);
  const cDislike = saettige(rgb(farbe("--dislike", "#e5787d")), 1.5);
  const cDim = farbe("--text-dim", "#8b949e"), cBorder = farbe("--border", "#262d37");
  const n = probs.length;
  const X = i => padL + (n > 1 ? i / (n - 1) : 0) * (w - padL - padR);
  const Y = p => padT + (1 - p) * (h - padT - padB);

  ctx.font = "10.5px -apple-system, system-ui, sans-serif";
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    ctx.strokeStyle = cBorder; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(w - padR, Y(v)); ctx.stroke();
    ctx.fillStyle = cDim; ctx.textAlign = "right";
    ctx.fillText(dez(v.toFixed(2)), padL - 5, Y(v) + 3.5);
  }

  // Dichte je Kanal aufsummieren: jeder Punkt stempelt eine weiche Scheibe.
  const dG = new Float32Array(gw * gh), dR = new Float32Array(gw * gh);
  const radius = 2 * dpr, reich = Math.ceil(radius);
  const stempel = [];
  for (let dy = -reich; dy <= reich; dy++) {
    for (let dx = -reich; dx <= reich; dx++) {
      const q = (dx * dx + dy * dy) / (radius * radius);
      if (q <= 1) stempel.push([dx, dy, (1 - q) * (1 - q)]);
    }
  }
  for (let i = 0; i < n; i++) {
    const falsch = (probs[i] >= threshold) !== (ratings[i] === 1);
    const zx = Math.round(X(i) * dpr), zy = Math.round(Y(probs[i]) * dpr);
    const ziel = falsch ? dR : dG;
    for (const [dx, dy, gewicht] of stempel) {
      const x = zx + dx, y = zy + dy;
      if (x >= 0 && x < gw && y >= 0 && y < gh) ziel[y * gw + x] += gewicht;
    }
  }
  // Referenz = 99. Perzentil der besetzten Pixel: dort liegt "volle" Deckkraft. Das
  // absolute Maximum wäre die falsche Skala — ein einzelner Hotspot diktierte sie,
  // und der Rest der Kurve versänke gleichmäßig im Dunkeln.
  const besetzte = [];
  for (let i = 0; i < dG.length; i++) {
    const d = dG[i] + dR[i];
    if (d > 0) besetzte.push(d);
  }
  besetzte.sort((a, b) => a - b);
  const dRef = besetzte[Math.floor(besetzte.length * 0.99)] || 1;
  const bild = ctx.createImageData(gw, gh);
  const px = bild.data;
  const misch = (a, b, t) => a + (b - a) * t;
  for (let i = 0; i < dG.length; i++) {
    const g = dG[i], r = dR[i];
    if (!g && !r) continue;
    // Farbton nach den rohen Dichten; Rot doppelt gewichtet: die Fehlgriffe sind die
    // seltene Klasse, um die es geht — ungewichtet ersäuft sie im Grün der Mischzonen.
    const anteilR = 2 * r / (g + 2 * r);
    const j = i * 4;
    px[j] = misch(cLike[0], cDislike[0], anteilR);
    px[j + 1] = misch(cLike[1], cDislike[1], anteilR);
    px[j + 2] = misch(cLike[2], cDislike[2], anteilR);
    px[j + 3] = 255 * Math.pow(Math.min(1, (g + r) / dRef), DICHTE_KONTRAST);
  }
  // putImageData ignoriert Compositing — über einen Zwischen-Canvas zeichnen, damit
  // Gitter und Achsen darunter stehen bleiben.
  const ebene = document.createElement("canvas");
  ebene.width = gw; ebene.height = gh;
  ebene.getContext("2d").putImageData(bild, 0, 0);
  ctx.drawImage(ebene, 0, 0, w, h);

  // Die Schwelle obenauf, sonst verschwindet sie unter dem dichten Band daneben.
  ctx.strokeStyle = "#e8a54b"; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(padL, Y(threshold)); ctx.lineTo(w - padR, Y(threshold)); ctx.stroke();
  ctx.setLineDash([]);
  return cv;
}

/* Start: erst hier, damit alle (auch let-)Deklarationen initialisiert sind */
window.addEventListener("hashchange", route);
route();
