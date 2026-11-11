// Formatierte Zusammenfassungen: Absätze, Hervorhebung und Formeln.
//
// Escaped wird zuerst, formatiert danach — das Modell liest fremden Text, und was es an
// HTML durchreicht, darf nie als Markup im Feed landen. Deshalb auch kein Link, keine
// Überschrift, keine Tabelle und keine Liste: Die Zusammenfassung ist Fließtext.
//
// Formeln rendert KaTeX als MathML. Safari und Chrome zeichnen das selbst, es braucht also
// weder KaTeX' Schriften noch sein CSS, und die Farbe folgt dem Text. Geladen wird KaTeX
// erst, wenn ein Text wirklich eine Formel enthält; bis dahin (und wenn sie nicht parst)
// steht ihr Quelltext da.

const esc = s => s.replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Platzhalter aus dem Private-Use-Bereich: übersteht das Escapen und kommt in keiner
// Zusammenfassung vor.
const AUF = "", ZU = "";
const PLATZHALTER = new RegExp(`${AUF}(\\d+)${ZU}`, "g");

// Die Dollar-Regel ist die von pandoc: nach dem öffnenden `$` kein Leerraum, vor dem
// schließenden keiner und danach keine Ziffer. Daran scheitern die Preise im Bestand
// („2.899 $ bzw. 3.399 $“, „S$468.000“, „$100 over …“), echte Formeln nicht.
const MATHE = [
  [/\$\$([\s\S]+?)\$\$/g, true],
  [/\\\[([\s\S]+?)\\\]/g, true],
  [/\\\(([\s\S]+?)\\\)/g, false],
  [/(?<![\\$\w])\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<![\s\\])\$(?![\d$])/g, false],
];

function formel(tex, block) {
  const kat = globalThis.katex;
  if (kat) {
    try {
      return kat.renderToString(tex, { output: "mathml", displayMode: block, throwOnError: true });
    } catch {
      return `<span class="tex-roh">${esc(block ? `$$${tex}$$` : `$${tex}$`)}</span>`;
    }
  }
  ladeKatex();
  return `<span class="tex" data-tex="${esc(tex)}"${block ? " data-block" : ""}>${esc(tex)}</span>`;
}

// Code und Formeln vor allem anderen herausnehmen: Weder `*` in einer Formel noch `_` in
// einem Dateinamen darf als Hervorhebung gelesen werden.
function schuetzen(text) {
  const teile = [];
  const merke = html => `${AUF}${teile.push(html) - 1}${ZU}`;
  text = text.replace(/`([^`\n]+)`/g, (_, c) => merke(`<code>${esc(c)}</code>`));
  for (const [muster, block] of MATHE) {
    text = text.replace(muster, (_, tex) => merke(formel(tex.trim(), block)));
  }
  text = text.replace(/\\\$/g, () => merke("$"));
  return [text, teile];
}

function hervorheben(html) {
  return html
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "<strong>$2</strong>")
    .replace(/(?<![*\w])\*(?=\S)([^*]*?\S)\*(?![*\w])/g, "<em>$1</em>")
    .replace(/(?<![\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "<em>$1</em>");
}

const einsetzen = (html, teile) => html.replace(PLATZHALTER, (_, i) => teile[i]);

// Für eine einzelne Zeile (Titel): nur Hervorhebung, Code und Formeln.
export function formatiereZeile(text) {
  const [roh, teile] = schuetzen(text || "");
  return einsetzen(hervorheben(esc(roh)), teile);
}

// Für eine Zusammenfassung: Absätze und alles aus `formatiereZeile`. Einzelne
// Zeilenumbrüche bleiben Umbrüche — so hat die App sie schon immer gezeigt.
export function formatiere(text) {
  const [roh, teile] = schuetzen(text || "");
  const absaetze = roh.split(/\n\s*\n/)
    .map(a => a.split("\n").map(z => z.trim()).filter(Boolean))
    .filter(a => a.length)
    .map(a => `<p>${a.map(z => hervorheben(esc(z))).join("<br>")}</p>`);
  return einsetzen(absaetze.join(""), teile);
}

let katexLaedt = null;

// Erst beim ersten Bedarf, als gewöhnliches Skript aus dem eigenen Ordner (die Demo lässt
// nur das zu). Danach werden die bis dahin als Quelltext gezeigten Formeln ersetzt; neue
// Karten rendern ab dann direkt.
function ladeKatex() {
  if (katexLaedt || typeof document === "undefined") return;
  katexLaedt = new Promise((fertig, fehler) => {
    const s = document.createElement("script");
    s.src = "katex.min.js";
    s.onload = fertig;
    s.onerror = fehler;
    document.head.append(s);
  }).then(() => {
    for (const span of document.querySelectorAll("span.tex[data-tex]")) {
      span.outerHTML = formel(span.dataset.tex, span.hasAttribute("data-block"));
    }
  }).catch(() => {});
}
