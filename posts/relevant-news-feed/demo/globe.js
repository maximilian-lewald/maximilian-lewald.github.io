/* 3D-Globus für den World-Tab.
 *
 * Gerendert wird auf Canvas 2D, ohne Bibliothek. Die Kugel ist in gleich große
 * Sechseckzellen zerlegt (Wabenkugel: unterteiltes Ikosaeder, dual genommen); jede Zelle
 * liest Höhe und Landmaske aus web/globe.bin, wird radial überhöht und mit fester
 * Lichtrichtung flach schattiert. Keine WebGL-Abhängigkeit, kein Framework, und die
 * Rechenarbeit je Bild bleibt bei ein paar tausend Pfaden.
 *
 * Warum Waben und nicht das naheliegende Längen-/Breitengitter: dort ist die größte Zelle
 * 57-mal so groß wie die kleinste, die Antarktis wird zum Speichenrad und der Pol braucht
 * drei Sonderregeln (gemeinsame Höhe je Polzeile, radiale Normalen, polfreie Zone fürs
 * Wasser). Die Wabenkugel hat keine ausgezeichnete Achse — alle drei Regeln entfallen,
 * und der Globus sieht aus jeder Richtung gleich aus.
 *
 * Vier Dinge, die nicht offensichtlich sind:
 *  - Die Umlaufrichtung der Ecken ist je nach Zerlegung unterschiedlich. Statt sie zu
 *    erzwingen, wird jede Normale gegen die Mittelpunktsrichtung geprüft und notfalls
 *    umgedreht.
 *  - Überhöhtes Land schwebt über der Meereskugel, wenn man nur die Deckflächen zeichnet.
 *    Jede Küstenkante bekommt darum eine Wand bis auf Meereshöhe ("Schürze"); erst damit
 *    wirkt die Erde massiv statt wie aufgeklebte Schollen.
 *  - Am Horizont wird nicht hart abgeschnitten: das Gelände sinkt in einem Fenster um den
 *    Horizont herum auf Meereshöhe ein, und was dann noch übersteht, wird beschnitten auf
 *    den Bereich AUSSERHALB der Kugelsilhouette gezeichnet — dort und nur dort verdeckt
 *    die Kugel nichts. Ohne das verschwinden Gebirge beim Drehen schlagartig, mit einem
 *    harten Schnitt am Kugelhorizont; ohne den Beschnitt schlägt die Rückseite durch.
 *  - Das Wasser hat ein eigenes, halb so feines Netz. In der Körnung des Landes wären es
 *    viermal so viele Flächen, und das Meer braucht die Auflösung nicht.
 *
 * Drumherum liegen zwei weitere Ebenen auf eigenen Canvas: der Sternhimmel dahinter und
 * die ISS davor. Eigene Ebenen, damit der Globus seine sparsame Teillöschung behält und
 * damit im Ruhezustand nur die Station neu gezeichnet werden muss. Alle drei entstehen
 * aber in EINEM zeichne()-Aufruf — liefe die Station in einem eigenen Takt, hinge sie
 * beim Drehen sichtbar hinter der Erde her.
 */

import { bahnpunkt, gmst, parseTLE } from "./bahn.js";

const RAD = Math.PI / 180;
// Echte Skalierung wäre unsichtbar (Everest = 0,14 % des Erdradius). 0,238 entspricht dem
// 70-fachen und ist der Wert, bei dem Gebirge lesbar sind, ohne dass die Kugel zerfranst.
const UEBERHOEHUNG = 0.238;
const LICHT = [-0.42, 0.52, 0.74];
const STUFEN = 14;
const MARKER_STIEL = 0.11;     // Länge des Markerstiels über dem Gelände (Radius = 1)
// Unterteilung des Ikosaeders: 10n²+2 Zellen. 32 ergibt 10 242 Zellen von je rund 2°
// Kantenlänge — genau die Körnung des Höhenrasters, nur überall gleich. Feiner zu bauen
// verdoppelt nur die Zellen je Rasterwert.
const WABEN_N = 32;
const WASSER_N = 16;
// Fenster, in dem die Überhöhung ausläuft, als Skalarprodukt der Ecke mit der
// Blickrichtung. Beim Übertritt über den Horizont steht das Gelände noch auf halber Höhe.
const SENKEN = [-0.22, 0.18];

/* ---- Sternhimmel ---- */

// Grenzhelligkeit: 5,8 sind rund 3900 Sterne, etwa das, was ein dunkler Landhimmel zeigt.
// web/stars.bin reicht bis 6,0; der Katalog ist nach Helligkeit sortiert, geschnitten wird
// darum am Index.
const STERN_GRENZE = 5.8;
const STERN_PIXEL = 2;         // Kantenlänge eines Sternpunkts in CSS-Pixeln
// Entfernung der virtuellen Kamera in Erdradien. Sie legt fest, wie schnell der Himmel
// beim Drehen mitwandert: für einen Betrachter in dieser Höhe wandert er genau so.
const STERN_KAMERA = 4;
// Sterntemperatur -> Farbton, orangerot bis blauweiß. Kräftig genug, um am 2-Pixel-Punkt
// zu wirken, weit genug von gesättigten Farben entfernt, damit der Himmel nicht bunt wird.
const STERNFARBEN = ["#ffb27a", "#ffc79a", "#ffdcb8", "#fff0d8", "#ffffff",
                     "#e8efff", "#cfe0ff", "#b9d2ff"];

/* ---- ISS ---- */

// Bahnradius und Größe sind bewusst falsch: echte 1,066 Erdradien lägen unter den
// überhöhten Gebirgen, und maßstabsgetreu wäre die Station ein Zehntel Bildpunkt.
const ISS_HOEHE = 1.34;
const ISS_GROESSE = 0.11;      // halbe Spannweite als Anteil des Kugelradius
const ISS_SPUR = [-14, 3, 0.2];   // Spur von/bis in Minuten, Schrittweite
const ISS_SPUR_ALTER = 4000;   // ms Bahnzeit, nach denen die Spur neu gerechnet wird
const ISS_TAKT = 200;          // ms zwischen zwei Bildern, wenn der Globus sonst still steht
const ISS_STUFEN = 14, ISS_FUSS = 0.34;   // Schattierung wie beim Gelände
const ISS_STREUUNG = 0.5;      // Helligkeitsstreuung je Zelle, in Stufen
// Silhouette in Himmelsrichtungen: Zweierpotenz, damit der Index maskiert werden kann.
// 256 sind 1,4° je Fach — feiner als ein Gebirgszug am Rand breit ist.
const SIL_N = 256, SIL_SKALA = SIL_N / (2 * Math.PI);

/* ---- Farbmodell: Breite -> Vegetation, Höhe -> Fels und Schnee ---- */

const klemme = (x, a, b) => (x < a ? a : x > b ? b : x);
const weich = (a, b, x) => { const t = klemme((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const misch = (A, B, t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];

function rampe(stuetzen, x) {
  if (x <= stuetzen[0][0]) return stuetzen[0][1].slice();
  for (let i = 1; i < stuetzen.length; i++) {
    if (x <= stuetzen[i][0]) {
      const [p0, c0] = stuetzen[i - 1], [p1, c1] = stuetzen[i];
      return misch(c0, c1, (x - p0) / (p1 - p0));
    }
  }
  return stuetzen[stuetzen.length - 1][1].slice();
}

function rampe1(stuetzen, x) {
  if (x <= stuetzen[0][0]) return stuetzen[0][1];
  for (let i = 1; i < stuetzen.length; i++) {
    if (x <= stuetzen[i][0]) {
      const [p0, v0] = stuetzen[i - 1], [p1, v1] = stuetzen[i];
      return v0 + (v1 - v0) * (x - p0) / (p1 - p0);
    }
  }
  return stuetzen[stuetzen.length - 1][1];
}

// Feuchte Vegetation nach Breite, an wolkenfreien Satellitenaufnahmen abgelesen.
const HUMID = [
  [0, [38, 76, 38]], [10, [46, 86, 40]], [20, [80, 100, 48]], [30, [98, 110, 56]],
  [40, [84, 106, 53]], [50, [64, 93, 51]], [58, [55, 80, 48]], [66, [74, 85, 60]],
  [72, [104, 104, 88]], [82, [160, 162, 158]],
];
// Trockene Variante derselben Breiten: Sand, Halbwüste, Steppe.
const TROCKEN = [
  [0, [118, 120, 72]], [18, [186, 160, 112]], [26, [206, 180, 130]], [34, [192, 168, 124]],
  [44, [162, 150, 106]], [55, [132, 127, 97]], [70, [120, 118, 100]],
];
const FELS = [124, 114, 100];
const SCHNEE = [244, 247, 250];
// Schneegrenze in Rastereinheiten (Höhenbyte/127) je Breite. Sie läuft NICHT gegen null:
// die Eiskappen der Pole kommen aus einem eigenen Term, sonst würde jede Bodenwelle in
// Kanada und Sibirien weiß, nur weil die Grenze dort bei fast null läge.
const GRENZE = [
  [0, 0.55], [15, 0.54], [25, 0.50], [35, 0.42], [45, 0.32],
  [55, 0.28], [65, 0.25], [80, 0.22],
];
const SCHNEE_SPANNE = 0.14;    // Höhe über der Grenze, ab der die Zelle ganz weiß ist
const FELS_ANTEIL = 0.75;
const KALTER_SCHATTEN = 0.18;  // Blaustich im Halbschatten von Schnee
// Farbrasterung: gröber = weniger Grundfarben = weniger Füllaufrufe. 8 liegt unter einer
// Schattierungsstufe und wird von der Zellstreuung ohnehin verwischt.
const QUANT = 8;
const STREUUNG = 0.06;
const streu = i => ((((i * 73856093) ^ (i * 19349663)) >>> 0) % 1024) / 1024 - 0.5;

/** Grundfarbe einer Landzelle: Vegetation nach Breite, Trockenheit nach Kontinentalität. */
function landfarbe(lat, lon, wasserAbstand) {
  const b = Math.abs(lat);
  const feucht = rampe(HUMID, b);
  // Wüstengürtel: nur wo die Breite passt UND es weit zum Meer ist. Rein zonal bekäme
  // Florida dieselbe Sahara-Farbe wie Libyen.
  const kont = weich(2.0, 6.0, wasserAbstand);
  let guertel = weich(8, 18, b) * (1 - weich(32, 45, b)) * kont;
  // Kontinentale Steppe (Gobi, Kasachstan, Great Plains): weit im Landesinneren,
  // außerhalb der Tropen, bis in die gemäßigten Breiten.
  let steppe = 0.62 * weich(5, 11, wasserAbstand) * weich(12, 20, b) * (1 - weich(45, 58, b));
  // Indien und Südostasien liegen mitten im Wüstengürtel und sind trotzdem die
  // feuchtesten Gebiete der Erde. Das weiß ein zonales Modell nicht — die Ausnahme steht
  // hier, als einzige fest verdrahtete Geografie.
  const monsun = weich(62, 72, lon) * (1 - weich(122, 132, lon))
               * weich(2, 9, lat) * (1 - weich(30, 38, lat));
  guertel *= 1 - 0.8 * monsun; steppe *= 1 - 0.8 * monsun;
  return misch(feucht, rampe(TROCKEN, b), klemme(Math.max(guertel, steppe), 0, 1));
}

/** Fels und Schnee über die Grundfarbe legen. */
function hoehenlage(c, lat, h) {
  const b = Math.abs(lat);
  const grenze = rampe1(GRENZE, b);
  // Fels: oberhalb der halben Schneegrenze dünnt die Vegetation aus. Der feste Sockel
  // hält den kanadischen Schild grün — dort läge die halbe Grenze sonst bei 0,13.
  c = misch(c, FELS, weich(Math.max(0.17, grenze * 0.5), grenze, h) * FELS_ANTEIL);
  // Schnee aus zwei Quellen: orographisch über der Schneegrenze und polar ab 69°.
  const schnee = Math.max(weich(grenze, grenze + SCHNEE_SPANNE, h), weich(69, 77, b));
  return { rgb: misch(c, SCHNEE, schnee), schnee };
}

// Wasser bekommt dieselbe Behandlung wie Land: Kacheln statt glatter Scheibe, sonst hebt
// es sich als einzige spiegelglatte Fläche vom Rest ab. Drei Tiefenstufen — Bathymetrie
// haben wir nicht, die Tiefe kommt aus dem Abstand zur nächsten Landzelle.
const OZEAN = [[16, 48, 82], [20, 58, 94], [26, 72, 112]];
const OZ_STREUUNG = 0.30;      // feste Helligkeitsstreuung je Kachel, in Stufen
const OZ_GLANZ_EXP = 18;       // je größer, desto enger der Glanzpunkt
const OZ_GLANZ = 0.70;

function ozeantabelle() {
  const tab = [];
  for (const rgb of OZEAN) {
    for (let s = 0; s < STUFEN; s++) {
      const f = 0.44 + 0.60 * (s + 0.5) / STUFEN;
      tab.push(`rgb(${rgb.map(v => Math.min(255, Math.round(v * f))).join(",")})`);
    }
  }
  return tab;
}

/* ---- Wabenkugel ---- */

const ECKEN_MAX = 6;           // Sechsecke, bis auf zwölf Fünfecke an den Ikosaederecken

/** Ikosaeder unterteilen, dann den dualen Körper nehmen: 10n²+2 Zellen.
 *
 *  Ergebnis ohne Zwischenobjekte, direkt in typisierten Arrays: die Ecken der Zellen sind
 *  die Mittelpunkte der 20n² Dreiecke (schon von Natur aus eindeutig durchnummeriert, es
 *  braucht also kein Zusammenführen), die Zellmitten sind die Ecken des unterteilten
 *  Ikosaeders. Der Umweg über Objekte pro Zelle kostete kalt das Zehnfache — der Aufbau
 *  läuft genau einmal beim Öffnen des Tabs und wird nie warm. */
function wabenkugel(n) {
  const t = (1 + Math.sqrt(5)) / 2;
  const ecken = Float32Array.from([
    -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0,
    0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t,
    t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1,
  ]);
  for (let i = 0; i < 12; i++) {
    const l = Math.sqrt(ecken[i * 3] ** 2 + ecken[i * 3 + 1] ** 2 + ecken[i * 3 + 2] ** 2);
    ecken[i * 3] /= l; ecken[i * 3 + 1] /= l; ecken[i * 3 + 2] /= l;
  }
  const flaechen = Int32Array.from([
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ]);

  const NP = 10 * n * n + 2, NT = 20 * n * n;
  const mitte = new Float32Array(NP * 3);
  // Zahlenschlüssel statt Zeichenkette: 1e5-Raster, drei Achsen in ein exaktes Ganzzahl-
  // Produkt. Bleibt mit 8,0e15 unter 2^53, also verlustfrei.
  const karte = new Map();
  let np = 0;
  const merke = (x, y, z) => {
    const l = Math.sqrt(x * x + y * y + z * z);
    x /= l; y /= l; z /= l;
    const k = ((Math.round(x * 1e5) + 100001) * 200003 + Math.round(y * 1e5) + 100001) * 200003
            + Math.round(z * 1e5) + 100001;
    let i = karte.get(k);
    if (i === undefined) {
      i = np++;
      karte.set(k, i);
      mitte[i * 3] = x; mitte[i * 3 + 1] = y; mitte[i * 3 + 2] = z;
    }
    return i;
  };

  const dreiecke = new Int32Array(NT * 3);
  const zeile = new Int32Array((n + 1) * (n + 2) / 2);
  const platz = (i, j) => i * (n + 1) - (i * (i - 1)) / 2 + j;
  let nt = 0;
  for (let f = 0; f < 20; f++) {
    const a3 = flaechen[f * 3] * 3, b3 = flaechen[f * 3 + 1] * 3, c3 = flaechen[f * 3 + 2] * 3;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n - i; j++) {
        const a = (n - i - j) / n, b = j / n, c = i / n;
        zeile[platz(i, j)] = merke(ecken[a3] * a + ecken[b3] * b + ecken[c3] * c,
                                   ecken[a3 + 1] * a + ecken[b3 + 1] * b + ecken[c3 + 1] * c,
                                   ecken[a3 + 2] * a + ecken[b3 + 2] * b + ecken[c3 + 2] * c);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        dreiecke[nt * 3] = zeile[platz(i, j)];
        dreiecke[nt * 3 + 1] = zeile[platz(i, j + 1)];
        dreiecke[nt * 3 + 2] = zeile[platz(i + 1, j)];
        nt++;
        if (j < n - i - 1) {
          dreiecke[nt * 3] = zeile[platz(i, j + 1)];
          dreiecke[nt * 3 + 1] = zeile[platz(i + 1, j + 1)];
          dreiecke[nt * 3 + 2] = zeile[platz(i + 1, j)];
          nt++;
        }
      }
    }
  }

  // Ecken der Zellen: die Mittelpunkte der Dreiecke.
  const dir = new Float32Array(NT * 3);
  for (let d = 0; d < NT; d++) {
    const a = dreiecke[d * 3] * 3, b = dreiecke[d * 3 + 1] * 3, c = dreiecke[d * 3 + 2] * 3;
    const x = mitte[a] + mitte[b] + mitte[c];
    const y = mitte[a + 1] + mitte[b + 1] + mitte[c + 1];
    const z = mitte[a + 2] + mitte[b + 2] + mitte[c + 2];
    const l = Math.sqrt(x * x + y * y + z * z);
    dir[d * 3] = x / l; dir[d * 3 + 1] = y / l; dir[d * 3 + 2] = z / l;
  }

  // Zellen: alle Dreiecke um eine Ikosaederecke, im Kreis sortiert — unsortiert entstünde
  // ein Zickzack-Polygon statt eines Sechsecks.
  const zellen = new Int32Array(NP * ECKEN_MAX).fill(-1);
  const anzahl = new Uint8Array(NP);
  for (let d = 0; d < NT; d++) {
    for (let e = 0; e < 3; e++) {
      const v = dreiecke[d * 3 + e];
      zellen[v * ECKEN_MAX + anzahl[v]++] = d;
    }
  }
  const winkel = new Float64Array(ECKEN_MAX);
  for (let v = 0; v < NP; v++) {
    const mx = mitte[v * 3], my = mitte[v * 3 + 1], mz = mitte[v * 3 + 2];
    const hx = Math.abs(my) < 0.9 ? 0 : 1, hy = Math.abs(my) < 0.9 ? 1 : 0;
    let e1x = hy * mz, e1y = -hx * mz, e1z = hx * my - hy * mx;
    const l1 = Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z);
    e1x /= l1; e1y /= l1; e1z /= l1;
    const e2x = my * e1z - mz * e1y, e2y = mz * e1x - mx * e1z, e2z = mx * e1y - my * e1x;
    const k = anzahl[v], basis = v * ECKEN_MAX;
    for (let i = 0; i < k; i++) {
      const d3 = zellen[basis + i] * 3;
      winkel[i] = Math.atan2(dir[d3] * e2x + dir[d3 + 1] * e2y + dir[d3 + 2] * e2z,
                             dir[d3] * e1x + dir[d3 + 1] * e1y + dir[d3 + 2] * e1z);
    }
    for (let i = 1; i < k; i++) {              // Einfügesortieren, k ist 5 oder 6
      const w = winkel[i], d = zellen[basis + i];
      let j = i - 1;
      for (; j >= 0 && winkel[j] > w; j--) { winkel[j + 1] = winkel[j]; zellen[basis + j + 1] = zellen[basis + j]; }
      winkel[j + 1] = w; zellen[basis + j + 1] = d;
    }
  }
  return { dir, zellen, anzahl, mitte };
}

/* ---- Bauteile der Station ----
 * Maße im Dreibein der Station: n = Gitterträger (quer zur Flugrichtung), v = Flugrichtung,
 * r = radial nach außen; 1 entspricht der halben Spannweite. `raster` unterteilt die
 * flächigen Seiten — die Solarzellen bekommen so dieselbe Körnung wie die Waben der Erde.
 */
const ISS_TEILE = [
  { c: [0, 0, 0], h: [0.98, 0.035, 0.035], rgb: [168, 174, 190] },              // Gitterträger
  { c: [0, 0.02, -0.17], h: [0.085, 0.55, 0.085], rgb: [206, 209, 216] },       // Modulstrang
  { c: [0, -0.50, -0.17], h: [0.07, 0.09, 0.07], rgb: [128, 134, 150] },        // Kopplungsknoten
  { c: [0, 0.62, -0.17], h: [0.05, 0.05, 0.05], rgb: [96, 102, 118] },          // Kuppel
  { c: [0.20, 0, 0.13], h: [0.12, 0.20, 0.008], rgb: [232, 236, 244], raster: [2, 2] },
  { c: [-0.20, 0, 0.13], h: [0.12, 0.20, 0.008], rgb: [232, 236, 244], raster: [2, 2] },
];
for (const s of [-1, 1]) {
  for (const n of [0.42, 0.78]) {
    for (const v of [-0.38, 0.38]) {
      ISS_TEILE.push({ c: [s * n, v, 0], h: [0.17, 0.34, 0.008],
                       rgb: [44, 68, 142], raster: [2, 3] });                    // Solarflügel
    }
  }
}

/** Die sechs Seiten jedes Quaders als Flächen im lokalen Dreibein, große Seiten
 *  unterteilt. Einmal gebaut, danach je Bild nur noch gedreht und projiziert. */
function issFlaechen() {
  const flaechen = [];
  let zaehler = 0;
  for (const t of ISS_TEILE) {
    for (let achse = 0; achse < 3; achse++) {
      const j = (achse + 1) % 3, k = (achse + 2) % 3;
      // Nur die flächigen Seiten rastern; die Schmalseiten bleiben ein Stück.
      const [rj, rk] = t.raster && t.h[achse] < t.h[j] && t.h[achse] < t.h[k]
        ? t.raster : [1, 1];
      for (const vz of [-1, 1]) {
        const n = [0, 0, 0];
        n[achse] = vz;
        for (let a = 0; a < rj; a++) {
          for (let b = 0; b < rk; b++) {
            const ecken = [[a, b], [a + 1, b], [a + 1, b + 1], [a, b + 1]].map(([u, w]) => {
              const p = [0, 0, 0];
              p[achse] = t.c[achse] + vz * t.h[achse];
              p[j] = t.c[j] + t.h[j] * (2 * u / rj - 1);
              p[k] = t.c[k] + t.h[k] * (2 * w / rk - 1);
              return p;
            });
            flaechen.push({ ecken, n, rgb: t.rgb, jitter: streu(++zaehler) });
          }
        }
      }
    }
  }
  return flaechen;
}
const ISS_FLAECHEN = issFlaechen();

const ISS_FARBEN = new Map();
function issFarbe(rgb, stufe) {
  const s = stufe * 16777216 + rgb[0] * 65536 + rgb[1] * 256 + rgb[2];
  let f = ISS_FARBEN.get(s);
  if (f === undefined) {
    const g = ISS_FUSS + (1 - ISS_FUSS) * ((stufe + 0.5) / ISS_STUFEN);
    ISS_FARBEN.set(s, f = `rgb(${rgb.map(v => Math.min(255, Math.round(v * g))).join(",")})`);
  }
  return f;
}

const punkt3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export class Globus {
  constructor(canvas, { onMarker, himmel, iss } = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    // Beide Zusatzebenen sind freiwillig: fehlen sie, zeichnet der Globus wie zuvor.
    this.himmelCv = himmel || null;
    this.hctx = himmel ? himmel.getContext("2d") : null;
    this.issCv = iss || null;
    this.ictx = iss ? iss.getContext("2d") : null;
    this.sterne = null;         // aus web/stars.bin, siehe _ladeSterne
    this.iss = null;            // Bahnelemente, siehe setzeIss
    this._spur = null; this._spurZeit = 0;
    this._issTakt = 0;
    this._sil = new Float32Array(SIL_N);   // Silhouettenradius je Himmelsrichtung
    this.onMarker = onMarker || (() => {});
    this.tabOz = ozeantabelle();
    this._kopfOz = new Int32Array(this.tabOz.length);
    // Auflösung: normal die volle Gerätedichte (gedeckelt auf 2). Braucht ein Bild auf dem
    // konkreten Gerät zu lange, geht die Kappe einmalig herunter — auf einer Landschaft aus
    // flachen Facetten fällt das kaum auf, ruckeln würde sofort auffallen.
    this._dprKappe = 2;
    this._zeiten = [];
    this.stories = [];
    this.marker = [];          // Bildschirmposition je Story, für den Treffertest
    this.lam = -10; this.phi = 15;
    this.vl = 0; this.vp = 0;
    this.laeuft = false; this.aktiv = false;
    this.flug = null;
    this.W = 0; this.H = 0; this.RS = 0; this.cx = 0; this.cy = 0;
    this._bindeEingabe();
  }

  async laden(url = "globe.bin") {
    const puffer = await (await fetch(url)).arrayBuffer();
    const kopf = new DataView(puffer);
    if (String.fromCharCode(kopf.getUint8(0), kopf.getUint8(1), kopf.getUint8(2), kopf.getUint8(3)) !== "GLB1") {
      throw new Error("globe.bin: unbekanntes Format");
    }
    const rows = kopf.getUint16(4, true), cols = kopf.getUint16(6, true);
    this._liesRaster(new Uint8Array(puffer, 8), rows, cols);
    this._baueGitter();
    if (this.hctx) await this._ladeSterne();
  }

  /** Sternkatalog (web/stars.bin, 6 Byte je Stern). Scheitert er, bleibt der Himmel leer —
   *  der Globus selbst hängt nicht daran. */
  async _ladeSterne(url = "stars.bin") {
    try {
      const puffer = await (await fetch(url)).arrayBuffer();
      const kopf = new DataView(puffer);
      if (String.fromCharCode(kopf.getUint8(0), kopf.getUint8(1), kopf.getUint8(2),
                              kopf.getUint8(3)) !== "STR1") throw new Error("Format");
      const n = kopf.getUint32(4, true);
      const roh = new Uint8Array(puffer, 8);
      const dv = new DataView(roh.buffer, roh.byteOffset, roh.byteLength);
      const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
      const mag = new Float32Array(n), farbe = new Uint8Array(n);
      let anzahl = 0;
      for (let i = 0; i < n; i++) {
        const m = roh[i * 6 + 4] / 20 - 2;
        if (m > STERN_GRENZE) break;         // nach Helligkeit sortiert
        const ra = dv.getUint16(i * 6, true) / 65535 * 2 * Math.PI;
        const dek = dv.getInt16(i * 6 + 2, true) / 32767 * (Math.PI / 2);
        const cd = Math.cos(dek);
        x[i] = cd * Math.sin(ra); y[i] = Math.sin(dek); z[i] = cd * Math.cos(ra);
        mag[i] = m; farbe[i] = roh[i * 6 + 5];
        anzahl++;
      }
      this.sterne = { n: anzahl, x, y, z, mag, farbe };
    } catch {
      this.sterne = null;
    }
  }

  /** Bahnelemente der Station (zwei TLE-Zeilen). Ohne sie bleibt die Ebene leer. */
  setzeIss(tle) {
    try {
      this.iss = tle ? parseTLE(tle) : null;
    } catch {
      this.iss = null;
    }
    this._spur = null;
  }

  /* ---- Raster (einmalig) ---- */

  /** Höhe, Landmaske und die beiden Abstandsfelder aus globe.bin. Das Raster bleibt die
   *  Datenquelle; die Zellen der Wabenkugel lesen daraus ab. */
  _liesRaster(zellen, rows, cols) {
    this.rows = rows; this.cols = cols; this.grad = 180 / rows;
    const n = rows * cols;
    const h0 = new Float32Array(n), hz = new Float32Array(n), land = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (zellen[i] < 128) continue;
      const h = (zellen[i] & 127) / 127;
      land[i] = 1; h0[i] = h;
      hz[i] = 0.10 + 0.90 * Math.pow(h, 0.85);
    }
    this.h0 = h0; this.hz = hz; this.land = land;

    // Breitensuche in beide Richtungen: vom Meer aus für die Kontinentalität (Wüsten
    // liegen im Landesinneren), vom Land aus für die drei Wassertiefenstufen.
    const suche = (start, grenze) => {
      const feld = new Int32Array(n).fill(-1), q = [];
      for (let i = 0; i < n; i++) if (start[i]) { feld[i] = 0; q.push(i); }
      for (let z = 0; z < q.length; z++) {
        const idx = q[z], r = (idx / cols) | 0, c = idx % cols;
        if (feld[idx] >= grenze) continue;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const rr = r + dr;
          if (rr < 0 || rr >= rows) continue;
          const nb = rr * cols + ((c + dc + cols) % cols);
          if (feld[nb] >= 0) continue;
          feld[nb] = feld[idx] + 1;
          q.push(nb);
        }
      }
      return feld;
    };
    this.zumMeer = suche(land.map(v => (v ? 0 : 1)), 30);
    this.tiefe = suche(land, 6);
  }

  /** Rasterzelle unter einer Richtung. Breite und Länge landen in _lat/_lon, damit der
   *  Aufruf ohne Objekt auskommt — er läuft rund 45 000-mal beim Aufbau. */
  _rasterIndex(x, y, z) {
    const lat = Math.asin(klemme(y, -1, 1)) / RAD;
    const lon = Math.atan2(x, z) / RAD;
    this._lat = lat; this._lon = lon;
    const r = klemme(Math.floor((90 - lat) / this.grad), 0, this.rows - 1);
    const c = ((Math.floor((lon + 180) / this.grad) % this.cols) + this.cols) % this.cols;
    return r * this.cols + c;
  }

  /* ---- Gitteraufbau (einmalig) ---- */

  _baueGitter() {
    // Aufwärmen: der Aufbau läuft genau einmal und bliebe sonst komplett im Interpreter —
    // gemessen 27-mal langsamer als nach dem Tiering. Ein paar Durchläufe auf einem
    // winzigen Gitter kosten unter einer Millisekunde und machen die Funktionen heiß.
    for (let i = 0; i < 12; i++) wabenkugel(3);
    const { dir, zellen, anzahl: eckZahl, mitte } = wabenkugel(WABEN_N);
    const NV = dir.length / 3, NZ = eckZahl.length;

    // Je Zelle: Höhe und Farbe. Gleiche Farben werden zu einer Grundfarbe zusammengefasst,
    // damit das Zeichnen später gebündelt läuft.
    const zh = new Float32Array(NZ), istLand = new Uint8Array(NZ), farbIdx = new Int32Array(NZ);
    const basis = [], schneeAnteil = [], bekannt = new Map();
    for (let z = 0; z < NZ; z++) {
      const i = this._rasterIndex(mitte[z * 3], mitte[z * 3 + 1], mitte[z * 3 + 2]);
      if (!this.land[i]) continue;
      istLand[z] = 1;
      zh[z] = this.hz[i];
      const h = this.h0[i], lat = this._lat;
      const { rgb, schnee } = hoehenlage(landfarbe(lat, this._lon, this.zumMeer[i]), lat, h);
      const s = streu(i * 7 + z) * STREUUNG;
      const q = [rgb[0] * (1 + s), rgb[1] * (1 + s), rgb[2] * (1 + s * 0.5)]
        .map(v => klemme(Math.round(v / QUANT) * QUANT, 0, 255));
      const sq = Math.round(klemme(schnee, 0, 1) * 3);
      const key = (q[0] << 18) | (q[1] << 10) | (q[2] << 2) | sq;
      let k = bekannt.get(key);
      if (k === undefined) { k = basis.length; bekannt.set(key, k); basis.push(q); schneeAnteil.push(sq / 3); }
      farbIdx[z] = k;
    }

    // Schattierung: heller Fuß und leicht kalter Ton für Schnee — sonst sackt Weiß im
    // Halbschatten zu Grau ab und die Schneefelder verschwinden.
    const kalt = [150, 172, 205];
    this.tab = [];
    for (let k = 0; k < basis.length; k++) {
      const rgb = basis[k], sn = schneeAnteil[k], fuss = 0.34 + 0.16 * sn;
      for (let s = 0; s < STUFEN; s++) {
        const t = (s + 0.5) / STUFEN, f = fuss + (1 - fuss) * t;
        let c = [rgb[0] * f, rgb[1] * f, rgb[2] * f];
        if (sn > 0) c = misch(c, [kalt[0] * f, kalt[1] * f, kalt[2] * f], KALTER_SCHATTEN * sn * (1 - t));
        this.tab.push(`rgb(${c.map(v => Math.round(klemme(v, 0, 255))).join(",")})`);
      }
    }
    this._kopf = new Int32Array(this.tab.length);
    this._kopfFern = new Int32Array(this.tab.length);
    this._kopfD = new Int32Array(this.tab.length);
    this._kopfDFern = new Int32Array(this.tab.length);

    // Eckhöhe = Mittel der anliegenden Zellen (Wasser zählt als 0). Das hält die Fläche
    // stetig; an der Küste sackt sie ab, dafür gibt es die Wände.
    const summe = new Float32Array(NV), zahl = new Float32Array(NV);
    for (let z = 0; z < NZ; z++) {
      for (let e = 0; e < eckZahl[z]; e++) { const v = zellen[z * ECKEN_MAX + e]; summe[v] += zh[z]; zahl[v]++; }
    }
    const vh = new Float32Array(NV);
    for (let v = 0; v < NV; v++) vh[v] = zahl[v] ? summe[v] / zahl[v] : 0;

    // Deckflächen und Kanten. Wände entstehen an jeder Kante zwischen Land und Wasser;
    // im Kantenschlüssel steckt das Eckenpaar, der Wert ist die zweite anliegende Zelle.
    const kanten = new Map();
    const DI = [], DO = [0], DF = [], DM = [];
    const WI = [], WF = [], WM = [];
    for (let z = 0; z < NZ; z++) {
      const k = eckZahl[z], basis = z * ECKEN_MAX;
      if (istLand[z]) {
        for (let e = 0; e < k; e++) DI.push(zellen[basis + e]);
        DO.push(DI.length); DF.push(farbIdx[z]); DM.push(z);
      }
      for (let e = 0; e < k; e++) {
        const a = zellen[basis + e], b = zellen[basis + (e + 1) % k];
        const schluessel = a < b ? a * NV + b : b * NV + a;
        const andere = kanten.get(schluessel);
        if (andere === undefined) { kanten.set(schluessel, z); continue; }
        if (istLand[andere] === istLand[z]) continue;
        const land = istLand[z] ? z : andere;
        WI.push(a, b); WF.push(farbIdx[land]); WM.push(land);
      }
    }

    // Wasser: eigenes, gröberes Netz. Kacheln über Land fallen weg — dort liegt ohnehin
    // die Landfläche darüber, und die vorgerenderte Kugel schließt den Saum an der Küste.
    const grob = wabenkugel(WASSER_N);
    const OI = [], OO = [0], OF = [], OM = [];
    for (let z = 0; z < grob.anzahl.length; z++) {
      const mx = grob.mitte[z * 3], my = grob.mitte[z * 3 + 1], mz = grob.mitte[z * 3 + 2];
      const k = grob.anzahl[z], basis = z * ECKEN_MAX;
      let ueberLand = this.land[this._rasterIndex(mx, my, mz)];
      for (let e = 0; e < k && !ueberLand; e++) {
        // Probe zwischen Ecke und Mitte: die Ecke selbst läge schon in der Nachbarzelle.
        const v = grob.dir.subarray(grob.zellen[basis + e] * 3);
        const px = v[0] + mx * 1.6, py = v[1] + my * 1.6, pz = v[2] + mz * 1.6;
        const l = Math.sqrt(px * px + py * py + pz * pz);
        ueberLand = this.land[this._rasterIndex(px / l, py / l, pz / l)];
      }
      if (ueberLand) continue;
      const t = this.tiefe[this._rasterIndex(mx, my, mz)];
      for (let e = 0; e < k; e++) OI.push(grob.zellen[basis + e]);
      OO.push(OI.length);
      OF.push(t >= 0 && t <= 2 ? 2 : t >= 0 && t <= 4 ? 1 : 0);
      OM.push(z);
    }

    this.dir = dir; this.vh = vh;
    this.pos = new Float32Array(NV * 3);
    this.SX = new Float32Array(NV); this.SY = new Float32Array(NV);
    this.BX = new Float32Array(NV); this.BY = new Float32Array(NV);
    this.SR2 = new Float32Array(NV);          // Abstand² vom Kugelmittelpunkt im Bild
    this.wdir = grob.dir;
    this.WX = new Float32Array(grob.dir.length / 3);
    this.WY = new Float32Array(grob.dir.length / 3);
    this.DI = Int32Array.from(DI); this.DO = Int32Array.from(DO); this.DF = Uint16Array.from(DF);
    this.WI = Int32Array.from(WI); this.WF = Uint16Array.from(WF);
    this.OI = Int32Array.from(OI); this.OO = Int32Array.from(OO); this.OF = Uint8Array.from(OF);
    this.NF = DF.length; this.NW = WF.length; this.NO = OF.length;
    this._weiter = new Int32Array(Math.max(this.NW, 1));
    this._weiterD = new Int32Array(Math.max(this.NF, 1));
    this._weiterOz = new Int32Array(Math.max(this.NO, 1));
    // Ohne feste Streuung je Kachel liegt das Wasser als perfekter Verlauf da und wirkt
    // wie Glas. Deterministisch aus dem Index, damit beim Drehen nichts flimmert.
    this.OJ = new Float32Array(this.NO);
    for (let k = 0; k < this.NO; k++) {
      this.OJ[k] = ((((k * 73856093) ^ (k * 19349663)) >>> 0) % 5 / 2 - 1) * OZ_STREUUNG;
    }
    // Mittelpunkt jeder Fläche auf der ungehobenen Kugel: Ausrichtung der Normalen und
    // Entscheidung, ob eine Fläche vor oder hinter dem Horizont liegt.
    const packe = (zellIdx, quelle) => {
      const a = new Float32Array(zellIdx.length * 3);
      zellIdx.forEach((z, i) => {
        a[i * 3] = quelle[z * 3]; a[i * 3 + 1] = quelle[z * 3 + 1]; a[i * 3 + 2] = quelle[z * 3 + 2];
      });
      return a;
    };
    this.dz = packe(DM, mitte); this.wz = packe(WM, mitte); this.oz = packe(OM, grob.mitte);
    this.dn = new Float32Array(this.NF * 3);
    this.wn = new Float32Array(this.NW * 3);
    this._verschiebe();
  }

  _verschiebe() {
    const { dir, vh, pos, DI, DO, WI, dn, wn, dz, wz, NF, NW } = this;
    for (let k = 0; k < vh.length; k++) {
      const r = 1 + UEBERHOEHUNG * vh[k];
      pos[k * 3] = dir[k * 3] * r; pos[k * 3 + 1] = dir[k * 3 + 1] * r; pos[k * 3 + 2] = dir[k * 3 + 2] * r;
    }
    // Newell-Normale: gilt für jede Eckenzahl. Die Ausrichtung wird an der
    // Mittelpunktsrichtung geprüft, die Umlaufrichtung der Ecken ist damit egal.
    for (let f = 0; f < NF; f++) {
      let nx = 0, ny = 0, nz = 0;
      for (let e = DO[f]; e < DO[f + 1]; e++) {
        const a = DI[e] * 3, b = DI[e + 1 < DO[f + 1] ? e + 1 : DO[f]] * 3;
        nx += (pos[a + 1] - pos[b + 1]) * (pos[a + 2] + pos[b + 2]);
        ny += (pos[a + 2] - pos[b + 2]) * (pos[a] + pos[b]);
        nz += (pos[a] - pos[b]) * (pos[a + 1] + pos[b + 1]);
      }
      let L = Math.hypot(nx, ny, nz) || 1;
      if (nx * dz[f * 3] + ny * dz[f * 3 + 1] + nz * dz[f * 3 + 2] < 0) L = -L;
      dn[f * 3] = nx / L; dn[f * 3 + 1] = ny / L; dn[f * 3 + 2] = nz / L;
    }
    // Wandnormale: senkrecht auf Kante und Radius, gedreht bis sie vom Land weg zeigt —
    // sonst bleibt die Wand auch im Licht schwarz.
    for (let w = 0; w < NW; w++) {
      const a = WI[w * 2] * 3, b = WI[w * 2 + 1] * 3;
      const ex = dir[b] - dir[a], ey = dir[b + 1] - dir[a + 1], ez = dir[b + 2] - dir[a + 2];
      const rx = dir[a] + dir[b], ry = dir[a + 1] + dir[b + 1], rz = dir[a + 2] + dir[b + 2];
      const nx = ey * rz - ez * ry, ny = ez * rx - ex * rz, nz = ex * ry - ey * rx;
      let L = Math.hypot(nx, ny, nz) || 1;
      const kx = rx / 2 - wz[w * 3], ky = ry / 2 - wz[w * 3 + 1], kz = rz / 2 - wz[w * 3 + 2];
      if (nx * kx + ny * ky + nz * kz < 0) L = -L;
      wn[w * 3] = nx / L; wn[w * 3 + 1] = ny / L; wn[w * 3 + 2] = nz / L;
    }
  }

  /* ---- Darstellung ---- */

  setzeStories(stories) {
    this.stories = stories || [];
    for (const s of this.stories) {
      s._breite = undefined;
      // Rubrik-Farbe der Pille (kommt fertig aus app.js); einmal zu RGB zerlegt,
      // damit das Mischen je Bild keine Zeichenketten parst.
      const m = /^#([0-9a-f]{6})$/i.exec(s.topicColor || "");
      const v = m ? parseInt(m[1], 16) : null;
      s._rgb = v === null ? null : [v >> 16 & 255, v >> 8 & 255, v & 255];
    }
    this.zeichne();
  }

  themaLesen() {
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    this.cv.parentNode.appendChild(probe);
    const lies = (token, alpha, ersatz) => {
      probe.style.color = "";
      probe.style.color = `var(${token})`;
      const m = (getComputedStyle(probe).color || "").match(/[\d.]+/g);
      return m && m.length >= 3 ? `rgba(${m[0]},${m[1]},${m[2]},${alpha})` : ersatz;
    };
    const liesRgb = (token, ersatz) => {
      probe.style.color = "";
      probe.style.color = `var(${token})`;
      const m = (getComputedStyle(probe).color || "").match(/[\d.]+/g);
      return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : ersatz;
    };
    this.C = {
      text: lies("--text", 1, "#e6e8eb"),
      pille: lies("--surface", 0.94, "rgba(22,27,34,.94)"),
      rand: lies("--border", 1, "#262d37"),
      akzent: lies("--accent", 1, "#6ba3f8"),
      // Als Zahlen fürs Mischen mit der Rubrik-Farbe der Pillen.
      textRgb: liesRgb("--text", [230, 232, 235]),
      randRgb: liesRgb("--border", [38, 45, 55]),
    };
    probe.remove();
  }

  messe() {
    const r = this.cv.getBoundingClientRect();
    this.W = Math.round(r.width) || this.cv.clientWidth || 320;
    this.H = Math.round(r.height) || this.cv.clientHeight || 480;
    const dpr = Math.min(window.devicePixelRatio || 1, this._dprKappe);
    for (const [cv, ctx] of [[this.cv, this.ctx], [this.himmelCv, this.hctx],
                             [this.issCv, this.ictx]]) {
      if (!cv) continue;
      cv.width = Math.max(1, this.W * dpr);
      cv.height = Math.max(1, this.H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    // 0.40 statt 0.5: das überhöhte Gelände ragt bis 1,2 Radien hinaus und braucht Rand.
    // Die 110 px halten die Tab-Pille frei, die über der Kugel schwebt.
    this.RS = Math.min(this.W, this.H - 110) * 0.40;
    this.cx = this.W / 2;
    this.cy = this.H / 2;
  }

  /** Anteil der Überhöhung, der an dieser Stelle noch steht. Am Horizont die Hälfte,
   *  dahinter läuft er aus — so sinkt das Gelände weg, statt zu verschwinden. */
  _senkfaktor(c) {
    const t = klemme((c - SENKEN[0]) / (SENKEN[1] - SENKEN[0]), 0, 1);
    return t * t * (3 - 2 * t);
  }

  zeichne() {
    if (!this.DI) return;
    if (!this.RS) this.messe();
    if (!this.C) this.themaLesen();
    const begonnen = performance.now();
    const { ctx, pos, dir, vh, SX, SY, BX, BY, SR2, DI, DO, DF, WI, WF, dn, wn, dz, wz, tab, RS, cx, cy } = this;
    const sp = Math.sin(this.phi * RAD), cp = Math.cos(this.phi * RAD);
    const sl = Math.sin(this.lam * RAD), cl = Math.cos(this.lam * RAD);
    // Blick- und Lichtrichtung einmal in den Objektraum drehen, statt jede Normale zurück:
    // je Fläche bleiben zwei Skalarprodukte.
    const inObjekt = u => {
      const y1 = u[1] * cp + u[2] * sp, z1 = -u[1] * sp + u[2] * cp;
      return [u[0] * cl - z1 * sl, y1, z1 * cl + u[0] * sl];
    };
    const V = inObjekt([0, 0, 1]), L = inObjekt(LICHT);

    // Nur das Umfeld der Kugel löschen statt der ganzen Fläche — das Gelände reicht bis
    // etwa 1,2 Radien hinaus, der Rest des Canvas bleibt ohnehin leer. Die Schlagwort-
    // Pillen aber nicht: sie werden bis an den Bildrand gesetzt. Ohne ihren Bereich aus
    // dem letzten Bild bleiben beim Drehen Striche ihrer Konturen stehen.
    const rand = RS * 1.3;
    let lx0 = cx - rand, ly0 = cy - rand, lx1 = cx + rand, ly1 = cy + rand;
    const vorher = this._beschriftetBis;
    if (vorher) {
      lx0 = Math.min(lx0, vorher[0]); ly0 = Math.min(ly0, vorher[1]);
      lx1 = Math.max(lx1, vorher[2]); ly1 = Math.max(ly1, vorher[3]);
    }
    ctx.clearRect(lx0, ly0, lx1 - lx0, ly1 - ly0);
    const meer = this._meer();
    ctx.drawImage(meer, cx - RS - 2, cy - RS - 2, this._meerCss, this._meerCss);

    // Wie weit die Erde in jeder Himmelsrichtung reicht — die Meereskugel als Untergrenze,
    // darüber alles, was das überhöhte Gelände hinausschiebt. Nur so weiß die Station, wann
    // sie hinter einem Gebirge steht und nicht bloß hinter dem Meereshorizont.
    const sil = this._sil;
    // Nur wenn wirklich eine Station gezeichnet wird — sonst zahlt der Globus für nichts.
    const silAn = !!(this.ictx && this.iss);
    const rs2 = RS * RS;
    if (silAn) sil.fill(rs2);   // quadriert abgelegt: spart die Wurzel je Saum-Ecke
    for (let k = 0; k < SX.length; k++) {
      const bx = dir[k * 3], by = dir[k * 3 + 1], bz = dir[k * 3 + 2];
      const bx1 = bx * cl + bz * sl, bz1 = bz * cl - bx * sl;
      const c = by * sp + bz1 * cp;
      BX[k] = cx + RS * bx1; BY[k] = cy - RS * (by * cp - bz1 * sp);
      let x, y, z;
      // Nur im Übergangsfenster wird die Höhe neu gerechnet; außerhalb steht sie fertig
      // in pos. Das Fenster deckt rund ein Fünftel der Ecken ab.
      if (c < SENKEN[1]) {
        const r = 1 + UEBERHOEHUNG * vh[k] * this._senkfaktor(c);
        x = bx * r; y = by * r; z = bz * r;
      } else {
        x = pos[k * 3]; y = pos[k * 3 + 1]; z = pos[k * 3 + 2];
      }
      const x1 = x * cl + z * sl, z1 = z * cl - x * sl;
      const sx = cx + RS * x1, sy = cy - RS * (y * cp - z1 * sp);
      SX[k] = sx; SY[k] = sy;
      const r2 = (sx - cx) * (sx - cx) + (sy - cy) * (sy - cy);
      SR2[k] = r2;
      // Der Winkel wird nur für die wenigen Ecken jenseits der Meereskugel gebraucht —
      // ein atan2 je Ecke wäre bei 10 242 Zellen zu teuer, für den schmalen Saum nicht.
      // Vorder- und Rückseite zählen beide: die Station fliegt höher als jeder Gipfel,
      // also verdeckt sie auch Gelände, das selbst schon hinter der Kugelmitte liegt.
      if (silAn && r2 > rs2) {
        const b = (((Math.atan2(sy - cy, sx - cx) + Math.PI) * SIL_SKALA) | 0) & (SIL_N - 1);
        if (r2 > sil[b]) sil[b] = r2;
      }
    }
    const { wdir, WX, WY } = this;
    for (let k = 0; k < WX.length; k++) {
      const x = wdir[k * 3], y = wdir[k * 3 + 1], z = wdir[k * 3 + 2];
      const x1 = x * cl + z * sl, z1 = z * cl - x * sl;
      WX[k] = cx + RS * x1; WY[k] = cy - RS * (y * cp - z1 * sp);
    }

    ctx.lineWidth = 0.7;

    // Wasser: Lambert wie beim Land, dazu ein breiter Glanzpunkt über den Halbvektor aus
    // Blick- und Lichtrichtung. Der wandert beim Drehen über die Kugel, weil er im
    // Objektraum gerechnet wird — das ist die angedeutete Spiegelung.
    {
      const hx = L[0] + V[0], hy = L[1] + V[1], hz2 = L[2] + V[2];
      const hl = Math.hypot(hx, hy, hz2) || 1;
      const Hx = hx / hl, Hy = hy / hl, Hz = hz2 / hl;
      const { OI, OO, OF, oz, _kopfOz: kopfOz, _weiterOz: weiterOz } = this;
      kopfOz.fill(-1);
      for (let o = 0; o < this.NO; o++) {
        const nx = oz[o * 3], ny = oz[o * 3 + 1], nz = oz[o * 3 + 2];
        if (nx * V[0] + ny * V[1] + nz * V[2] <= 0) continue;
        let d = nx * L[0] + ny * L[1] + nz * L[2];
        if (d < 0) d = 0;
        let s = nx * Hx + ny * Hy + nz * Hz;
        s = s > 0 ? Math.pow(s, OZ_GLANZ_EXP) : 0;
        const hell = 0.26 + 0.62 * d + OZ_GLANZ * s + this.OJ[o] / STUFEN;
        const i = OF[o] * STUFEN + klemme((hell * STUFEN) | 0, 0, STUFEN - 1);
        weiterOz[o] = kopfOz[i]; kopfOz[i] = o;
      }
      for (let i = 0; i < kopfOz.length; i++) {
        let o = kopfOz[i];
        if (o < 0) continue;
        ctx.beginPath();
        while (o >= 0) {
          ctx.moveTo(WX[OI[OO[o]]], WY[OI[OO[o]]]);
          for (let e = OO[o] + 1; e < OO[o + 1]; e++) ctx.lineTo(WX[OI[e]], WY[OI[e]]);
          ctx.closePath();
          o = weiterOz[o];
        }
        ctx.fillStyle = ctx.strokeStyle = this.tabOz[i];
        ctx.fill(); ctx.stroke();
      }
    }

    // Gebündelt zeichnen: alle Flächen einer Farbstufe kommen in EINEN Pfad. Je Fläche
    // einzeln zu füllen und zu umranden kostete rund das Doppelte — bei mehreren tausend
    // Kacheln je Bild ist der Aufrufaufwand der eigentliche Posten. Die Zuordnung läuft
    // über eine verkettete Liste in vorbelegten Arrays, damit kein Bild Speicher anfasst.
    // Zwei Listen je Art: alles hinter dem Horizont, das noch über die Kugelsilhouette
    // ragt, kommt in die "ferne" Liste und wird beschnitten gezeichnet.
    const kopf = this._kopf, kopfFern = this._kopfFern, weiter = this._weiter;
    const kopfD = this._kopfD, kopfDFern = this._kopfDFern, weiterD = this._weiterD;
    const RS2 = RS * RS;

    kopf.fill(-1); kopfFern.fill(-1);
    for (let w = 0; w < this.NW; w++) {
      const a = WI[w * 2], b = WI[w * 2 + 1];
      let liste = kopf;
      if (wz[w * 3] * V[0] + wz[w * 3 + 1] * V[1] + wz[w * 3 + 2] * V[2] <= 0) {
        if (SR2[a] < RS2 && SR2[b] < RS2) continue;
        liste = kopfFern;
      }
      const nx = wn[w * 3], ny = wn[w * 3 + 1], nz = wn[w * 3 + 2];
      if (nx * V[0] + ny * V[1] + nz * V[2] <= 0) continue;
      let d = nx * L[0] + ny * L[1] + nz * L[2];
      if (d < 0) d = 0;
      const i = WF[w] * STUFEN + Math.min(STUFEN - 1, (d * STUFEN) | 0);
      weiter[w] = liste[i]; liste[i] = w;
    }

    kopfD.fill(-1); kopfDFern.fill(-1);
    for (let f = 0; f < this.NF; f++) {
      let liste = kopfD;
      if (dz[f * 3] * V[0] + dz[f * 3 + 1] * V[1] + dz[f * 3 + 2] * V[2] <= 0) {
        let draussen = false;
        for (let e = DO[f]; e < DO[f + 1]; e++) if (SR2[DI[e]] >= RS2) { draussen = true; break; }
        if (!draussen) continue;
        liste = kopfDFern;
      }
      const nx = dn[f * 3], ny = dn[f * 3 + 1], nz = dn[f * 3 + 2];
      if (nx * V[0] + ny * V[1] + nz * V[2] <= 0.015) continue;
      let d = nx * L[0] + ny * L[1] + nz * L[2];
      if (d < 0) d = 0;
      const i = DF[f] * STUFEN + Math.min(STUFEN - 1, (d * STUFEN) | 0);
      weiterD[f] = liste[i]; liste[i] = f;
    }

    const zeichneWaende = liste => {
      for (let i = 0; i < liste.length; i++) {
        let w = liste[i];
        if (w < 0) continue;
        ctx.beginPath();
        while (w >= 0) {
          const a = WI[w * 2], b = WI[w * 2 + 1];
          ctx.moveTo(SX[a], SY[a]); ctx.lineTo(SX[b], SY[b]);
          ctx.lineTo(BX[b], BY[b]); ctx.lineTo(BX[a], BY[a]); ctx.closePath();
          w = weiter[w];
        }
        ctx.fillStyle = ctx.strokeStyle = tab[i];
        ctx.fill(); ctx.stroke();
      }
    };
    const zeichneDecken = liste => {
      for (let i = 0; i < liste.length; i++) {
        let f = liste[i];
        if (f < 0) continue;
        ctx.beginPath();
        while (f >= 0) {
          ctx.moveTo(SX[DI[DO[f]]], SY[DI[DO[f]]]);
          for (let e = DO[f] + 1; e < DO[f + 1]; e++) ctx.lineTo(SX[DI[e]], SY[DI[e]]);
          ctx.closePath();
          f = weiterD[f];
        }
        ctx.fillStyle = ctx.strokeStyle = tab[i];
        ctx.fill(); ctx.stroke();
      }
    };

    // Erst die Rückseite, beschnitten auf den Bereich außerhalb der Kugel: nur dort
    // verdeckt die Kugel sie nicht. Dann die Vorderseite, die überall gewinnt.
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - rand, cy - rand, rand * 2, rand * 2);
    ctx.arc(cx, cy, RS, 0, 6.2832);
    ctx.clip("evenodd");
    zeichneWaende(kopfFern);
    zeichneDecken(kopfDFern);
    ctx.restore();
    // Erst die Wände, dann die Deckflächen: an der Küste liegt die Deckfläche oben.
    zeichneWaende(kopf);
    zeichneDecken(kopfD);

    this._zeichneMarker(sp, cp, sl, cl);
    // Himmel und Station im selben Aufruf: eigene Ebenen, aber ein Bild.
    this._zeichneHimmel(sp, cp);
    this._zeichneIss(sp, cp, sl, cl);
    this._regleAufloesung(performance.now() - begonnen);
  }

  /** Sternhimmel auf die hintere Ebene. Die Sternkugel trägt dieselbe Drehung wie der
   *  Globus, nur mit dem Radius der virtuellen Kamera — dadurch wandert sie beim Drehen
   *  so schnell, wie sie es für einen Betrachter in dieser Höhe täte. Dazu dreht die
   *  Sternzeit sie gegen die Erde: hinter der Bildmitte steht wirklich der Himmel, den
   *  der Gegenpunkt des betrachteten Ortes im Zenit hat. */
  _zeichneHimmel(sp, cp) {
    const { hctx, sterne, RS, cx, cy, W, H } = this;
    if (!hctx) return;
    hctx.clearRect(0, 0, W, H);
    if (!sterne) return;
    const lam = this.lam * RAD - gmst(Date.now());
    const sl = Math.sin(lam), cl = Math.cos(lam);
    const F = STERN_KAMERA * RS, P = STERN_PIXEL;
    const eimer = this._sternEimer || (this._sternEimer = new Map());
    for (const arr of eimer.values()) arr.length = 0;
    const { x: SX, y: SY, z: SZ, mag, farbe } = sterne;
    for (let i = 0; i < sterne.n; i++) {
      const x0 = SX[i], y0 = SY[i], z0 = SZ[i];
      const x1 = x0 * cl + z0 * sl, z1 = z0 * cl - x0 * sl;
      if (y0 * sp + z1 * cp > 0) continue;      // nur die Himmelshälfte hinter der Erde
      const x = cx + F * x1, y = cy - F * (y0 * cp - z1 * sp);
      if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
      // 2,5 Größenklassen sind der Faktor 10 — direkt übernommen wäre der Kontrast zu
      // hart; die Wurzel daraus lässt die schwachen Sterne als Körnung stehen.
      const h = Math.min(1, Math.pow(Math.pow(10, (STERN_GRENZE - mag[i]) / 2.5), 0.32) / 5.2);
      const s = farbe[i] * 16 + Math.max(1, Math.round(h * 7)) * 2
              + (mag[i] < STERN_GRENZE - 4.2 ? 1 : 0);   // die hellsten als Doppelpixel
      let arr = eimer.get(s);
      if (!arr) eimer.set(s, arr = []);
      arr.push(Math.round(x / P) * P, Math.round(y / P) * P);
    }
    for (const [s, arr] of eimer) {
      if (!arr.length) continue;
      const d = P * ((s & 1) + 1);
      hctx.globalAlpha = 0.13 + 0.87 * (((s >> 1) & 7) / 7);
      hctx.fillStyle = STERNFARBEN[s >> 4];
      for (let i = 0; i < arr.length; i += 2) hctx.fillRect(arr[i], arr[i + 1], d, d);
    }
    hctx.globalAlpha = 1;
  }

  /** Spur der Station. Ihre Punkte kosten je einen Kepler-Durchlauf, ändern sich aber nur
   *  langsam — projiziert wird trotzdem jedes Bild, sonst bliebe sie beim Drehen hängen. */
  _issSpur(jetzt) {
    if (this._spur && Math.abs(jetzt - this._spurZeit) < ISS_SPUR_ALTER) return this._spur;
    const [von, bis, schritt] = ISS_SPUR, punkte = [];
    for (let m = von; m <= bis; m += schritt) punkte.push(bahnpunkt(this.iss, jetzt + m * 60000));
    this._spur = punkte; this._spurZeit = jetzt;
    return punkte;
  }

  _zeichneIss(sp, cp, sl, cl) {
    const { ictx, RS, cx, cy, W, H } = this;
    if (!ictx) return;
    ictx.clearRect(0, 0, W, H);
    if (!this.iss || !RS) return;
    const jetzt = Date.now();

    // Hinter der Erde verschwindet die Station — gemessen an der *echten* Silhouette aus
    // dem letzten Bild, nicht am Meereshorizont: sonst schwebte sie über Gebirgen, die
    // eigentlich vor ihr stehen. Über drei Fächer gemittelt, weil sie selbst Breite hat,
    // und mit weichem Rand, damit sie nicht springt.
    const sil = this._sil, rs2 = RS * RS;
    const deckung = (x, y, c) => {
      if (c >= 0) return 1;
      const dx = x - cx, dy = y - cy;
      const b = (((Math.atan2(dy, dx) + Math.PI) * SIL_SKALA) | 0) & (SIL_N - 1);
      // rs2 als Untergrenze: die Meereskugel verdeckt immer, auch bevor je ein Bild die
      // Fächer gefüllt hat (erster Takt direkt nach setzeIss).
      const grenze = Math.sqrt(Math.max(rs2, sil[(b - 1) & (SIL_N - 1)], sil[b],
                                        sil[(b + 1) & (SIL_N - 1)]));
      return klemme((Math.hypot(dx, dy) - grenze) / (RS * 0.05), 0, 1);
    };
    const proj = p => this._projiziere(p.lon, p.lat, ISS_HOEHE, sp, cp, sl, cl);

    const spur = this._issSpur(jetzt);
    ictx.fillStyle = "#9fc0ff";
    for (let i = 0; i < spur.length; i++) {
      const [x, y, c] = proj(spur[i]);
      const a = deckung(x, y, c) * (0.18 + 0.62 * (i / spur.length));
      if (a <= 0.02) continue;
      ictx.globalAlpha = a;
      ictx.fillRect(Math.round(x / STERN_PIXEL) * STERN_PIXEL,
                    Math.round(y / STERN_PIXEL) * STERN_PIXEL, STERN_PIXEL, STERN_PIXEL);
    }
    ictx.globalAlpha = 1;

    const p = bahnpunkt(this.iss, jetzt);
    const [x, y, c] = proj(p);
    const a = deckung(x, y, c);
    if (a <= 0.02) return;
    const gr = Math.max(7, RS * ISS_GROESSE);
    ictx.globalAlpha = a;
    // Weicher, dunkler Schein: die Station steht oft vor dem hellen Ozean und ginge sonst
    // darin unter. Erdfarben bleiben unberührt, der Schein liegt nur um sie herum.
    const schein = ictx.createRadialGradient(x, y, gr * 0.3, x, y, gr * 1.6);
    schein.addColorStop(0, "rgba(8,13,26,.45)");
    schein.addColorStop(1, "rgba(8,13,26,0)");
    ictx.fillStyle = schein;
    ictx.beginPath(); ictx.arc(x, y, gr * 1.6, 0, 6.2832); ictx.fill();
    this._zeichneStation(p, bahnpunkt(this.iss, jetzt + 40000), gr / RS, sp, cp, sl, cl);
    ictx.globalAlpha = 1;
  }

  /** Die Station als Körper, im Stil des Geländes: dieselbe Lichtrichtung, dieselbe
   *  Stufung der Helligkeit, Fläche füllen UND umranden gegen die Nähte. Das lokale
   *  Dreibein kommt aus Radius und Flugrichtung — der Gitterträger steht damit quer zur
   *  Flugrichtung, der Modulstrang längs, wie beim Original. */
  _zeichneStation(p, voraus, groesse, sp, cp, sl, cl) {
    const { ictx, RS, cx, cy } = this;
    const richtung = (lon, lat) => {
      const la = lat * RAD, cla = Math.cos(la);
      return [ISS_HOEHE * cla * Math.sin(lon * RAD), ISS_HOEHE * Math.sin(la),
              ISS_HOEHE * cla * Math.cos(lon * RAD)];
    };
    const ort = richtung(p.lon, p.lat), vor = richtung(voraus.lon, voraus.lat);
    const rv = norm3(ort);
    const d = punkt3(vor, rv);
    const vv = norm3([vor[0] - rv[0] * d, vor[1] - rv[1] * d, vor[2] - rv[2] * d]);
    const nv = [rv[1] * vv[2] - rv[2] * vv[1], rv[2] * vv[0] - rv[0] * vv[2],
                rv[0] * vv[1] - rv[1] * vv[0]];

    // Licht und Blick in den Objektraum drehen — dieselbe Rechnung wie für das Gelände,
    // damit die Station aus derselben Richtung beleuchtet wird wie die Erde darunter.
    const inObjekt = u => {
      const y1 = u[1] * cp + u[2] * sp, z1 = -u[1] * sp + u[2] * cp;
      return [u[0] * cl - z1 * sl, y1, z1 * cl + u[0] * sl];
    };
    const L = inObjekt(LICHT), V = inObjekt([0, 0, 1]);

    const sichtbar = [];
    for (const f of ISS_FLAECHEN) {
      const n = [f.n[0] * nv[0] + f.n[1] * vv[0] + f.n[2] * rv[0],
                 f.n[0] * nv[1] + f.n[1] * vv[1] + f.n[2] * rv[1],
                 f.n[0] * nv[2] + f.n[1] * vv[2] + f.n[2] * rv[2]];
      if (punkt3(n, V) <= 0) continue;                  // Rückseite
      const ecken = f.ecken.map(([ln, lv, lr]) => {
        const x0 = ort[0] + groesse * (ln * nv[0] + lv * vv[0] + lr * rv[0]);
        const y0 = ort[1] + groesse * (ln * nv[1] + lv * vv[1] + lr * rv[1]);
        const z0 = ort[2] + groesse * (ln * nv[2] + lv * vv[2] + lr * rv[2]);
        const x1 = x0 * cl + z0 * sl, z1 = z0 * cl - x0 * sl;
        return [cx + RS * x1, cy - RS * (y0 * cp - z1 * sp), y0 * sp + z1 * cp];
      });
      const stufe = klemme(((Math.max(0, punkt3(n, L)) * ISS_STUFEN) | 0)
                           + Math.round(f.jitter * ISS_STREUUNG), 0, ISS_STUFEN - 1);
      sichtbar.push({ ecken, tiefe: (ecken[0][2] + ecken[2][2]) / 2,
                      farbe: issFarbe(f.rgb, stufe) });
    }
    sichtbar.sort((a, b) => a.tiefe - b.tiefe);         // Maleralgorithmus: hinten zuerst
    ictx.lineWidth = 0.6;
    for (const f of sichtbar) {
      ictx.beginPath();
      ictx.moveTo(f.ecken[0][0], f.ecken[0][1]);
      for (let i = 1; i < 4; i++) ictx.lineTo(f.ecken[i][0], f.ecken[i][1]);
      ictx.closePath();
      ictx.fillStyle = ictx.strokeStyle = f.farbe;
      ictx.fill(); ictx.stroke();
    }
  }

  /** Misst die eigene Zeichenzeit und senkt die Auflösung einmalig, wenn das Gerät sie
   *  nicht mitgeht. Die Labels bleiben lesbar, die Drehung bleibt flüssig. */
  _regleAufloesung(dauer) {
    if (this._dprKappe <= 1.4) return;
    const z = this._zeiten;
    z.push(dauer);
    if (z.length < 14) return;
    z.shift();
    const sortiert = [...z].sort((a, b) => a - b);
    if (sortiert[Math.floor(sortiert.length / 2)] > 12) {
      this._dprKappe = 1.4;
      this._zeiten = [];
      this.messe();
    }
  }

  /** Die Meereskugel ändert sich nur mit der Größe — einmal in ein eigenes Canvas malen
   *  und danach kopieren, statt jedes Bild einen Farbverlauf zu rastern. */
  _meer() {
    const d = Math.ceil(this.RS * 2) + 4;
    const dpr = Math.min(window.devicePixelRatio || 1, this._dprKappe);
    if (this._meerBild && this._meerCss === d && this._meerDpr === dpr) return this._meerBild;
    const c = document.createElement("canvas");
    c.width = c.height = Math.ceil(d * dpr);
    const k = c.getContext("2d");
    k.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = this.RS, m = d / 2;
    // Etwas dunkler als die Wasserkacheln: die Kugel schaut nur als Haarlinie an der
    // Küste zwischen ihnen hervor, dort soll sie als Schatten wirken und nicht als heller
    // Saum. Ganz ins Schwarze darf der äußere Stopp trotzdem nicht laufen — gegen den
    // dunklen Hintergrund verschwände sonst der Kugelrand.
    const g = k.createRadialGradient(m - r * 0.4, m - r * 0.45, r * 0.05, m, m, r * 1.05);
    g.addColorStop(0, "#1b4d74"); g.addColorStop(0.55, "#143a58"); g.addColorStop(1, "#102e46");
    k.beginPath(); k.arc(m, m, r, 0, 6.2832);
    k.fillStyle = g; k.fill();
    k.strokeStyle = "rgba(140,190,230,.22)"; k.lineWidth = 1.2; k.stroke();
    this._meerBild = c; this._meerCss = d; this._meerDpr = dpr;
    return c;
  }

  _projiziere(lon, lat, hoehe, sp, cp, sl, cl) {
    const la = lat * RAD, cla = Math.cos(la);
    const x0 = cla * Math.sin(lon * RAD), y0 = Math.sin(la), z0 = cla * Math.cos(lon * RAD);
    const x1 = x0 * cl + z0 * sl, z1 = z0 * cl - x0 * sl;
    return [this.cx + this.RS * hoehe * x1,
            this.cy - this.RS * hoehe * (y0 * cp - z1 * sp),
            y0 * sp + z1 * cp];
  }

  /** Geländehöhe am Ort — der Marker soll auf dem Berg stehen, nicht in ihm. Nahe am
   *  Horizont sinkt das Gelände ein; der Marker muss mitsinken, sonst schwebt er. */
  _boden(lat, lon, c) {
    const r = Math.max(0, Math.min(this.rows - 1, Math.floor((90 - lat) / this.grad)));
    const s = ((Math.floor((lon + 180) / this.grad) % this.cols) + this.cols) % this.cols;
    return 1 + UEBERHOEHUNG * this.hz[r * this.cols + s] * this._senkfaktor(c);
  }

  _zeichneMarker(sp, cp, sl, cl) {
    const { ctx, C } = this;
    ctx.font = "600 12.5px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
    this.marker = [];
    // Größter belegter Bereich dieses Bildes — das nächste löscht ihn mit.
    let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
    const merke = (x0, y0, x1, y1) => {
      if (x0 < gx0) gx0 = x0;
      if (y0 < gy0) gy0 = y0;
      if (x1 > gx1) gx1 = x1;
      if (y1 > gy1) gy1 = y1;
    };
    // Erst alle Punkte, dann die Beschriftung: nur so weiß die Platzvergabe, wo die
    // anderen Marker sitzen — sonst legt sich eine Pille über einen fremden Punkt.
    const belegt = [];
    for (const s of this.stories) {
      const sicht = this._projiziere(s.lon, s.lat, 1, sp, cp, sl, cl)[2];
      const boden = this._boden(s.lat, s.lon, sicht);
      const fuss = this._projiziere(s.lon, s.lat, boden, sp, cp, sl, cl);
      const kopf = this._projiziere(s.lon, s.lat, boden + MARKER_STIEL, sp, cp, sl, cl);
      if (kopf[2] <= 0.04) continue;
      // Punktgröße nach Relevanz: der wichtigste Marker ist auch der größte.
      const r = 3.6 + 3.2 * Math.max(0, Math.min(1, ((s.score ?? 0.8) - 0.7) / 0.3));
      ctx.globalAlpha = Math.min(1, kopf[2] * 3.5);
      ctx.strokeStyle = C.akzent; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(fuss[0], fuss[1]); ctx.lineTo(kopf[0], kopf[1]); ctx.stroke();
      ctx.beginPath(); ctx.arc(kopf[0], kopf[1], r, 0, 6.2832);
      ctx.fillStyle = C.akzent; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = C.pille; ctx.stroke();
      ctx.globalAlpha = 1;
      this.marker.push({ story: s, x: kopf[0], y: kopf[1], z: kopf[2], r, pille: null });
      belegt.push([kopf[0] - r - 4, kopf[1] - r - 4, kopf[0] + r + 4, kopf[1] + r + 4]);
      merke(Math.min(fuss[0], kopf[0]) - r - 3, Math.min(fuss[1], kopf[1]) - r - 3,
            Math.max(fuss[0], kopf[0]) + r + 3, Math.max(fuss[1], kopf[1]) + r + 3);
    }

    for (const m of this.marker) {
      const s = m.story;
      if (s._breite === undefined) s._breite = ctx.measureText(s.label).width;
      const bw = s._breite + 16, bh = 21;
      for (const [dx, dy] of [[16, -bh / 2], [-16 - bw, -bh / 2], [-bw / 2, -bh - 16], [-bw / 2, 16]]) {
        const x = m.x + dx, y = m.y + dy;
        if (x < 3 || x + bw > this.W - 3 || y < 3 || y + bh > this.H - 3) continue;
        if (belegt.some(q => x < q[2] && x + bw > q[0] && y < q[3] && y + bh > q[1])) continue;
        belegt.push([x, y, x + bw, y + bh]);
        m.pille = [x, y, x + bw, y + bh];
        merke(x - 2, y - 2, x + bw + 2, y + bh + 2);
        ctx.globalAlpha = Math.min(1, m.z * 3.5);
        ctx.beginPath();
        this._pille(x, y, bw, bh, 10);
        ctx.fillStyle = C.pille; ctx.fill();
        // Rubrik-Farbe erst nahe der Bildmitte: m.z ist der Kosinus zur Blickrichtung,
        // die Rampe hebt nur die vordersten Pillen aus dem Grau — beim Drehen färbt
        // sich der Tag im Fokus ein, statt dass alle gleichzeitig leuchten.
        const f = s._rgb ? weich(0.55, 0.95, m.z) : 0;
        const rand = f ? misch(C.randRgb, s._rgb, f) : C.randRgb;
        const text = f ? misch(C.textRgb, s._rgb, 0.85 * f) : C.textRgb;
        ctx.strokeStyle = `rgb(${rand[0] | 0},${rand[1] | 0},${rand[2] | 0})`;
        ctx.lineWidth = 1 + 0.6 * f;
        ctx.stroke();
        ctx.fillStyle = `rgb(${text[0] | 0},${text[1] | 0},${text[2] | 0})`;
        ctx.fillText(s.label, x + 8, y + 14.8);
        ctx.globalAlpha = 1;
        break;
      }
    }
    this._beschriftetBis = gx1 > gx0 ? [gx0, gy0, gx1, gy1] : null;
  }

  _pille(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ---- Bewegung ---- */

  _schleife = () => {
    if (this.flug) {
      const t = Math.min(1, (performance.now() - this.flug.start) / this.flug.dauer);
      const q = 1 - Math.pow(1 - t, 3);
      this.lam = this.flug.l0 + this.flug.dl * q;
      this.phi = this.flug.p0 + this.flug.dp * q;
      if (t >= 1) this.flug = null;
    } else if (!this.zieht) {
      this.lam += this.vl;
      this.phi = Math.max(-88, Math.min(88, this.phi + this.vp));
      this.vl *= 0.94; this.vp *= 0.94;
      if (Math.abs(this.vl) < 0.004) this.vl = 0;
      if (Math.abs(this.vp) < 0.004) this.vp = 0;
    }
    this.zeichne();
    this.laeuft = this.aktiv && (this.zieht || this.flug !== null || this.vl !== 0 || this.vp !== 0);
    if (this.laeuft) requestAnimationFrame(this._schleife);
  };

  _anstossen() {
    if (!this.laeuft && this.aktiv) { this.laeuft = true; requestAnimationFrame(this._schleife); }
  }

  /** Dreht den Globus so, dass der Ort mittig vorne steht. */
  flugZu(lat, lon, dauer = 900) {
    const zielLam = -lon, zielPhi = Math.max(-70, Math.min(70, lat));
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || dauer <= 0) {
      this.lam = zielLam; this.phi = zielPhi; this.flug = null;
      this.zeichne();
      return;
    }
    this.vl = 0; this.vp = 0;
    this.flug = {
      start: performance.now(), dauer,
      l0: this.lam, p0: this.phi,
      dl: ((zielLam - this.lam + 540) % 360) - 180,
      dp: zielPhi - this.phi,
    };
    this._anstossen();
  }

  sichtbar(an) {
    this.aktiv = an;
    if (an) { this.messe(); this.zeichne(); this._anstossen(); this._issTaktStarten(); }
    else { clearTimeout(this._issTakt); this._issTakt = 0; }
  }

  /** Steht der Globus still, zeichnet er gar nichts — die Station zieht aber weiter ihre
   *  Bahn. Dann genügt ihre eigene Ebene: Erde und Himmel bleiben stehen, und ein Bild
   *  kostet statt der vollen Kugel nur den Bruchteil für 88 Flächen. Läuft die Simulation,
   *  zeichnet sie ohnehin alle drei Ebenen zusammen. */
  _issTaktStarten() {
    clearTimeout(this._issTakt);
    const takt = () => {
      if (!this.aktiv) { this._issTakt = 0; return; }
      if (!this.laeuft && this.iss && this.RS) {
        this._zeichneIss(Math.sin(this.phi * RAD), Math.cos(this.phi * RAD),
                         Math.sin(this.lam * RAD), Math.cos(this.lam * RAD));
      }
      this._issTakt = setTimeout(takt, ISS_TAKT);
    };
    this._issTakt = setTimeout(takt, ISS_TAKT);
  }

  _bindeEingabe() {
    const cv = this.cv;
    let lx = 0, ly = 0, weg = 0;
    cv.addEventListener("pointerdown", e => {
      this.zieht = true; weg = 0; lx = e.clientX; ly = e.clientY;
      this.flug = null;
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetische Events */ }
      this._anstossen();
    });
    cv.addEventListener("pointermove", e => {
      if (!this.zieht) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      weg += Math.abs(dx) + Math.abs(dy);
      // Bildschirm-y wächst nach unten, die Projektion spiegelt y bereits — dy darf hier
      // deshalb NICHT noch einmal negiert werden, sonst kippt die Kugel verkehrt herum.
      const k = 180 / (this.RS * Math.PI) * 1.5;
      this.vl = dx * k; this.vp = dy * k;
      this.lam += this.vl;
      this.phi = Math.max(-88, Math.min(88, this.phi + this.vp));
    });
    cv.addEventListener("pointerup", e => {
      if (!this.zieht) return;
      this.zieht = false;
      if (weg < 8) this._tippe(e); else this._anstossen();
    });
    cv.addEventListener("pointercancel", () => { this.zieht = false; });
    window.addEventListener("resize", () => { if (this.aktiv) { this.messe(); this.zeichne(); } });
    if (window.ResizeObserver) {
      new ResizeObserver(() => { if (this.aktiv) { this.messe(); this.zeichne(); } }).observe(cv);
    }
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      this.C = null;
      if (this.aktiv) this.zeichne();
    });
  }

  _tippe(e) {
    const r = this.cv.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 28;                       // großzügig: Fingerkuppe, nicht Mauszeiger
    for (const m of this.marker) {
      const d = Math.hypot(m.x - mx, m.y - my);
      if (d < bd) { bd = d; best = m; }
    }
    // Auch die Schlagwort-Pille ist ein Ziel — sie ist größer als der Punkt und wird
    // von den meisten zuerst angetippt.
    if (!best) {
      for (const m of this.marker) {
        const p = m.pille;
        if (p && mx >= p[0] && mx <= p[2] && my >= p[1] && my <= p[3]) { best = m; break; }
      }
    }
    if (best) this.onMarker(best.story);
  }
}
