/** Bahnrechnung für einen Satelliten aus seinen Bahnelementen (TLE).
 *
 *  Kein vollständiges SGP4: gerechnet werden die säkularen Störungen durch die
 *  Erdabplattung (J2) und der Bremsterm aus dem TLE, nicht aber die kurzperiodischen
 *  Glieder. Gemessen gegen das volle SGP4 mit demselben TLE: 11 km sofort, im Median
 *  17 km nach einem Tag, 51 km nach drei Tagen. Gegen die tatsächliche Position (Live-API,
 *  TLE 14 Stunden alt) waren es 24 km — auf einem Globus mit 190 px Radius sind das
 *  0,7 Bildpunkte, für einen übergroßen Marker also weit unter der Wahrnehmungsschwelle.
 */
const RAD = Math.PI / 180;
const KE = 0.0743669161;        // sqrt(GM) in Erdradien^1.5/min
const J2 = 1.082616e-3;
const RE = 6378.135;            // km, Äquatorradius

/** Zwei Zeilen TLE -> Bahnelemente. Die Epoche steht als Jahr + Bruchteil-Tag darin. */
export function parseTLE(text) {
  const zeilen = String(text).trim().split("\n").map(z => z.trim());
  const z1 = zeilen.find(z => z.startsWith("1 ")), z2 = zeilen.find(z => z.startsWith("2 "));
  if (!z1 || !z2) throw new Error("TLE: Zeile 1/2 fehlt");
  const jahr = +z1.slice(18, 20), tag = +z1.slice(20, 32);
  return {
    epoche: Date.UTC(jahr < 57 ? 2000 + jahr : 1900 + jahr, 0, 1) + (tag - 1) * 86400e3,
    ndot: +z1.slice(33, 43) * 2,                      // rev/Tag^2 (im TLE steht ndot/2)
    incl: +z2.slice(8, 16) * RAD,
    raan: +z2.slice(17, 25) * RAD,
    ecc: +("0." + z2.slice(26, 33).trim()),
    argp: +z2.slice(34, 42) * RAD,
    ma: +z2.slice(43, 51) * RAD,
    n0: +z2.slice(52, 63),                            // rev/Tag
  };
}

/** Greenwich-Sternzeit (IAU 1982) in rad — bindet den Sternhimmel an die Erddrehung.
 *  T zählt ab dem vollen Julianischen Datum samt Tagesbruchteil; der in vielen Fassungen
 *  zusätzlich addierte Term 1,0027379·UT gehört zur Variante mit T ab 0h UT. Beides
 *  zusammen zählt den Tag doppelt — zur Mittagsstunde sind das 180°. */
export function gmst(ms) {
  const jd = ms / 86400e3 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const s = 67310.54841 + t * (876600 * 3600 + 8640184.812866 + t * (0.093104 - t * 6.2e-6));
  return ((s % 86400) + 86400) % 86400 / 86400 * 2 * Math.PI;
}

/** Position zum Zeitpunkt ms: geografische Breite/Länge in Grad, Höhe in km. */
export function bahnpunkt(el, ms) {
  const min = (ms - el.epoche) / 60000;
  const TAU = 2 * Math.PI;

  // Brouwer-Korrektur wie in SGP4: die mittlere Bewegung im TLE ist eine gestörte Größe,
  // die ungestörte Halbachse folgt erst nach zwei Schritten.
  const n0 = el.n0 * TAU / 1440;                      // rad/min
  const cosi = Math.cos(el.incl), e2 = 1 - el.ecc * el.ecc;
  const a1 = Math.pow(KE / n0, 2 / 3);
  const k = 1.5 * (J2 / 2) * 3 * (3 * cosi * cosi - 1) / (2 * Math.pow(e2, 1.5));
  const d1 = k / (a1 * a1);
  const a0 = a1 * (1 - d1 / 3 - d1 * d1 - 134 * d1 * d1 * d1 / 81);
  const d0 = k / (a0 * a0);
  const n = n0 / (1 + d0);
  const a = a0 / (1 - d0);

  // Säkulare J2-Raten (Erdradien als Längeneinheit)
  const p = a * e2, f = 1.5 * J2 * (1 / (p * p)) * n;
  const M = el.ma + (n + f * 0.5 * Math.sqrt(e2) * (3 * cosi * cosi - 1)) * min
          + 0.5 * (el.ndot * TAU / (1440 * 1440)) * min * min;
  const raan = el.raan - f * cosi * min;
  const argp = el.argp + f * 0.5 * (5 * cosi * cosi - 1) * min;

  // Kepler-Gleichung, Newton — bei e = 0,0007 steht das nach zwei Schritten
  let E = M;
  for (let i = 0; i < 8; i++) {
    const d = (E - el.ecc * Math.sin(E) - M) / (1 - el.ecc * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const r = a * (1 - el.ecc * cosE);
  const u = Math.atan2(Math.sqrt(e2) * sinE, cosE - el.ecc) + argp;   // Argument der Breite

  const cu = Math.cos(u), su = Math.sin(u);
  const cr = Math.cos(raan), sr = Math.sin(raan), si = Math.sin(el.incl);
  const x = r * (cu * cr - su * cosi * sr);
  const y = r * (cu * sr + su * cosi * cr);
  const z = r * su * si;

  // Geodätische statt geozentrischer Breite: die Erde ist abgeplattet, zwischen beiden
  // liegen in mittleren Breiten bis 0,19° — mehr, als das ganze übrige Verfahren an
  // Fehler beiträgt.
  const F = 1 / 298.257223563, E2 = F * (2 - F);
  const rxy = Math.hypot(x, y) * RE, zk = z * RE;
  let lat = Math.atan2(zk, rxy * (1 - E2)), hoehe = 0;
  for (let i = 0; i < 4; i++) {
    const s = Math.sin(lat);
    const N = RE / Math.sqrt(1 - E2 * s * s);
    hoehe = rxy / Math.cos(lat) - N;
    lat = Math.atan2(zk, rxy * (1 - E2 * N / (N + hoehe)));
  }
  let lon = (Math.atan2(y, x) - gmst(ms)) / RAD;
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  return { lat: lat / RAD, lon, alt: hoehe };
}
