/* Layout der Keyword-Karte in der Ebene: Ähnlichkeit, Kräfte, Simulation. Dieselbe Datei
   läuft im Browser (der Bau setzt sie in map.html ein) und beim Kartenbau auf dem Mac im
   JavaScript-Runner von macOS (keyword_map._layout_vorrechnen) — so rechnen beide dieselbe
   Karte. Hier stehen nur Definitionen; sie erwarten d3 und die Globalen `G` (Datensatz) und
   `nodes` (Knoten mit i, r, x, y, ux, uy). */

const TAU = Math.PI * 2;
// Zählt hoch, wenn sich Kräfte oder Startlage ändern: Gespeicherte Layouts — im Gerät wie in
// der Datenbank — gelten nur für ihre Version.
const LAYOUT_VERSION = 4;   // 4: Regler rechnet vom Start, ältere Einträge können vom Reglerweg abhängen
const ABSTOSSUNG_VORGABE = 170;   // „Node repulsion“; für diesen Wert rechnet der Mac beim Bau vor
// Feste Werte, eingestellt im Konzept (concepts/karten_layout)
const KNOTEN_FAKTOR = 1.2;   // Zeichen- und Kollisionsradius = (2,2 + 0,55·√Artikel) × dies
const SCHWERKRAFT = 0.055;   // Zug jedes Knotens zur Mitte
// Unähnlichkeit: Knoten im Umkreis stoßen sich zusätzlich ab, je unähnlicher sie sind, und
// halten einen Mindestabstand, der mit der Unähnlichkeit wächst — voll ab Ähnlichkeit
// kosOben − kosSpanne, keiner ab kosOben. Die Abstoßung allein ging bei großer Reichweite in
// der Summe Hunderter Nachbarn unter („Robert Habeck" blieb neben „Mord"); der Abstand ist
// eine Zwangsbedingung je Paar und hält, egal wie viele andere drücken (fremde nächste
// Nachbarn 117 → 19 von 1 000 bei gleicher Kartengröße).
const UNAEHNLICH = { kraft: 6000, reichweite: 1000, abstand: 150, kosOben: 0.7, kosSpanne: 0.3 };

const knotenRadius = d => (2.2 + Math.sqrt(d.m ?? d.n) * 0.55) * KNOTEN_FAKTOR;

let FIT = null;          // Float32Array, Knoten × dim, zeilenweise normiert
let KOOC = new Map();

// Hauptkomponenten je Knoten (int8 aus dem Bau). N zählt die freien Plätze der Suche mit,
// deren Zeilen bleiben leer.
function fitLaden(N) {
  FIT = null;
  const f = G.fit;
  if (!f || !f.b64 || !f.dim) return;   // Karte von vor dieser Fassung
  const bin = atob(f.b64), zeilen = bin.length / f.dim;
  if (zeilen > N || zeilen % 1) return;
  FIT = new Float32Array(N * f.dim);
  for (let i = 0; i < zeilen; i++) {
    let quadrat = 0;
    for (let d = 0; d < f.dim; d++) {
      const v = (bin.charCodeAt(i * f.dim + d) << 24) >> 24;   // int8 aus dem Byte
      FIT[i * f.dim + d] = v;
      quadrat += v * v;
    }
    const norm = Math.sqrt(quadrat) || 1;
    for (let d = 0; d < f.dim; d++) FIT[i * f.dim + d] /= norm;
  }
  FIT.dim = f.dim;
}

// Ähnlichkeit wie im Kartenbau: Kosinus der kompakten Vektoren, zum Anteil G.mix durch die
// Kookkurrenz ersetzt. Die reist ab 0,01 mit (kleinere zählen als 0) — zwei Uint16-Reihen
// mit den Knotenindizes (a < b) und eine Uint8-Reihe mit dem Wert × 255.
function koocLaden(N) {
  KOOC = new Map();
  const k = G.kooc;
  if (!k || !k.n) return;
  const bin = atob(k.b64), n = k.n;
  const u16 = o => bin.charCodeAt(o) | (bin.charCodeAt(o + 1) << 8);
  for (let p = 0; p < n; p++) KOOC.set(u16(2 * p) * N + u16(2 * (n + p)), bin.charCodeAt(4 * n + p) / 255);
}
function kos(a, b) {
  const dim = FIT.dim, oa = a * dim, ob = b * dim;
  let s = 0;
  for (let k = 0; k < dim; k++) s += FIT[oa + k] * FIT[ob + k];
  return s;
}
function aehnlich(a, b) {
  if (!G.mix) return kos(a, b);
  const key = a < b ? a * nodes.length + b : b * nodes.length + a;
  return (1 - G.mix) * kos(a, b) + G.mix * (KOOC.get(key) || 0);
}

// Abstoßung und Mindestabstand nach Unähnlichkeit über eine Nachbarliste: Sie entsteht nur
// neu, wenn sich ein Knoten seit dem letzten Aufbau um mehr als die halbe Reserve bewegt hat
// — dann kann kein Paar von außerhalb in Reichweite gekommen sein —, und trägt die
// Unähnlichkeit je Paar schon mit. Im Konzept suchte jeder Tick im Quadtree und fragte je
// Paar eine Map ab; gemessen in Safaris Engine bei 2 000 Knoten dauerte das Layout dort
// 6,6 s, hier 1,7 s — bei gleichen Kräften (Abweichung je Knoten unter 1e-4).
function kraftUnaehnlich() {
  const RESERVE = 300;
  let knoten = [], A = new Int32Array(0), B = A, U = new Float32Array(0), anzahl = 0;
  let altX = null, altY = null, cache = null;
  function unaehnlich(a, b) {   // über die Aufbauten hinweg gemerkt; bis 3 000 Knoten als Tabelle
    const N = nodes.length, key = a < b ? a * N + b : b * N + a;
    if (cache instanceof Map) {
      let u = cache.get(key);
      if (u === undefined) cache.set(key, u = 1 - aehnlich(a, b));
      return u;
    }
    let u = cache[key];
    if (u !== u) u = cache[key] = 1 - aehnlich(a, b);
    return u;
  }
  // In der kompakten Startlage liegen fast alle Paare in Reichweite (bei 2 000 Knoten zwei
  // Millionen). Einzeln nachgeschlagen kostete der erste Aufbau 895 ms. Die Tabelle in einem
  // Durchgang zu füllen spart den Aufruf je Paar; die Kookkurrenz kommt danach obendrauf. Der
  // Kern läuft genau einmal und damit kalt — darum vorher ein paar Durchläufe auf einem
  // Ausschnitt, wie beim Globus, und vier Summen statt einer.
  function tabelleFuellen(idx) {
    const N = nodes.length, dim = FIT.dim, F = FIT, mix = G.mix || 0, tab = cache;
    for (let x = 0; x < idx.length; x++) {
      const a = idx[x], oa = a * dim;
      for (let y = x + 1; y < idx.length; y++) {
        const b = idx[y], ob = b * dim;
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        for (let k = 0; k < dim; k += 4) {
          s0 += F[oa + k] * F[ob + k]; s1 += F[oa + k + 1] * F[ob + k + 1];
          s2 += F[oa + k + 2] * F[ob + k + 2]; s3 += F[oa + k + 3] * F[ob + k + 3];
        }
        tab[a < b ? a * N + b : b * N + a] = 1 - (1 - mix) * (s0 + s1 + s2 + s3);
      }
    }
    if (mix) for (const [key, v] of KOOC) tab[key] -= mix * v;
  }
  // Alle Paare auf typisierten Arrays durchgehen statt im Quadtree zu suchen: Dessen Rückruf
  // je Knoten kostete gegen Ende des Layouts 40 ms je Aufbau bei 220 000 Paaren.
  function aufbauen() {
    const n = knoten.length, R2 = (UNAEHNLICH.reichweite + RESERVE) ** 2;
    if (!cache && nodes.length <= 3000 && FIT.dim % 4 === 0) {
      cache = new Float32Array(nodes.length ** 2).fill(NaN);
      const idx = knoten.map(d => d.i);
      for (let w = 0; w < 6; w++) tabelleFuellen(idx.slice(0, 40));
      tabelleFuellen(idx);
    } else if (!cache) cache = new Map();
    const X = new Float64Array(n), Y = new Float64Array(n);
    for (let j = 0; j < n; j++) { X[j] = knoten[j].x; Y[j] = knoten[j].y; }
    let platz = Math.max(4096, anzahl + (anzahl >> 2));
    let pa = new Int32Array(platz), pb = new Int32Array(platz), pu = new Float32Array(platz), m = 0;
    for (let a = 0; a < n; a++) {
      const ax = X[a], ay = Y[a], ia = knoten[a].i;
      for (let b = a + 1; b < n; b++) {
        const dx = X[b] - ax, dy = Y[b] - ay;
        if (dx * dx + dy * dy >= R2) continue;
        if (m === platz) {
          platz *= 2;
          const na = new Int32Array(platz), nb = new Int32Array(platz), nu = new Float32Array(platz);
          na.set(pa); nb.set(pb); nu.set(pu); pa = na; pb = nb; pu = nu;
        }
        pa[m] = a; pb[m] = b; pu[m] = unaehnlich(ia, knoten[b].i); m++;
      }
    }
    A = pa; B = pb; U = pu; anzahl = m; altX = X; altY = Y;
  }
  function force(alpha) {
    const n = knoten.length, grenze = (RESERVE / 2) ** 2;
    let neu = !altX || altX.length !== n;
    for (let j = 0; !neu && j < n; j++) neu = (knoten[j].x - altX[j]) ** 2 + (knoten[j].y - altY[j]) ** 2 > grenze;
    if (neu) aufbauen();
    const { kraft, reichweite: Rw, abstand, kosOben, kosSpanne } = UNAEHNLICH;
    // Abstoßung ∝ Unähnlichkeit · (1 − d/R) / d: die nächsten Nachbarn sortieren am stärksten
    for (let p = 0; p < anzahl; p++) {
      const a = knoten[A[p]], b = knoten[B[p]];
      let dx = a.x - b.x, dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= Rw * Rw) continue;
      let d = Math.sqrt(d2);
      if (d < 1) { const w = Math.random() * TAU; dx = Math.cos(w); dy = Math.sin(w); d = 1; }
      const f = kraft * U[p] * alpha * (1 - d / Rw) / (d * d);
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    // Mindestabstand auf der vorhergesagten Lage, wie forceCollide: 70 % des Fehlbetrags je
    // Tick, halb auf jeden
    for (let p = 0; p < anzahl; p++) {
      const u = (kosOben - (1 - U[p])) / kosSpanne;
      if (u <= 0) continue;
      const a = knoten[A[p]], b = knoten[B[p]];
      let dx = a.x + a.vx - b.x - b.vx, dy = a.y + a.vy - b.y - b.vy;
      const soll = a.r + b.r + 6 + abstand * Math.min(1, u), d2 = dx * dx + dy * dy;
      if (d2 >= soll * soll) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-6) { const w = Math.random() * TAU; dx = Math.cos(w); dy = Math.sin(w); d = 1; }
      const k = (soll - d) / d * 0.35;
      a.vx += dx * k; a.vy += dy * k; b.vx -= dx * k; b.vy -= dy * k;
    }
  }
  force.initialize = n => { knoten = n; altX = null; cache = null; };
  return force;
}

// Kantengewicht `z` für Federstärke und -länge. Der Kosinus liegt bei k-NN-Kanten eng
// beieinander (gemessen 0,58–1,0, vier Fünftel zwischen 0,77 und 0,94): roh in die Feder
// gesteckt zogen alle Kanten fast gleich. `z` streckt das Gewicht auf die Spanne dieses Datensatzes — 0 am 5-%-Quantil, 1 am
// Maximum —, und die Federstärke wächst quadratisch darin, damit die stärksten
// Verbindungen spürbar mehr ziehen als die mittleren (Verhältnis 10:1 statt 1,3:1).
// Mit Kookkurrenz im Gewicht taugt die Spanne nicht: Wenige Fast-Dubletten setzen das
// Maximum, und alle übrigen Federn wurden weich (Stärke im Mittel 0,295 → 0,093). Dann
// zählt der Rang unter allen Kanten.
function kantenGewichte(links) {
  if (G.mix) {
    links.slice().sort((a, b) => a.w - b.w).forEach((l, r, s) => { l.z = r / Math.max(1, s.length - 1); });
  } else {
    const sortiert = links.map(l => l.w).sort((a, b) => a - b);
    const wLo = sortiert.length ? sortiert[Math.floor(sortiert.length * 0.05)] : 0;
    const wHi = sortiert.length ? sortiert[sortiert.length - 1] : 1;
    for (const l of links) l.z = wHi > wLo ? Math.min(1, Math.max(0, (l.w - wLo) / (wHi - wLo))) : 1;
  }
}

// Die Simulation der Ebene, angehalten: Der Browser hängt Tick und Ende an und lässt sie
// laufen, der Mac rechnet sie in einem Zug durch.
function layoutSimulation(knoten, kanten, abstossung) {
  return d3.forceSimulation(knoten).stop()
    .force("link", d3.forceLink(kanten).id(d => d.i).distance(l => 30 + 170 * (1 - l.z)).strength(l => 0.08 + 0.72 * l.z * l.z))
    .force("charge", d3.forceManyBody().strength(-abstossung).theta(0.95))
    .force("unlike", kraftUnaehnlich())
    .force("collide", d3.forceCollide(d => d.r + 6))
    .force("x", d3.forceX(0).strength(SCHWERKRAFT))
    .force("y", d3.forceY(0).strength(SCHWERKRAFT))
    // schnelleres Auskühlen (~110 statt ~245 Ticks) bei praktisch gleicher Ausdehnung
    .alphaDecay(0.06);
}
