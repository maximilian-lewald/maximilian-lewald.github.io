// Öffentliche Demo (news demo): beantwortet die API-Anfragen von App und Karte aus den
// mitgelieferten Dateien unter data/. Geschrieben wird nichts — Gelesen-Vermerke laufen ins
// Leere, Lesezeichen gelten bis zum Neuladen. Läuft vor app.js bzw. dem Kartencode.
(() => {
  const echt = window.fetch.bind(window);
  const API = new URL("api/", location.href).pathname;
  const geladen = {};
  const datei = name => (geladen[name] ??= echt(`data/${name}.json`).then(r => {
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    return r.json();
  }));
  const antwort = daten => daten === undefined
    ? new Response(null, { status: 404 })
    : new Response(JSON.stringify(daten), { headers: { "Content-Type": "application/json" } });
  const gemerkt = new Set();   // Artikel-IDs mit Lesezeichen

  // Wie /api/feed: Fenster ab `since`, Keyset-Cursor `before` (`<pub>|<id>`), Rubriken in
  // `hide`. „Heute" ist der Tag des Stands — sonst bliebe das erste Fenster Monate später leer.
  // Die Stories liegen sortiert wie beim Server vor: jüngster Artikel absteigend, dann ID.
  async function feed(q) {
    const f = await datei("feed");
    const limit = Math.min(+q.get("limit") || 12, 50);
    const nurGemerkt = q.get("only_saved") === "1";
    const nurPositiv = q.get("only_positive") === "1";
    const since = q.get("since") || f.since;
    const aus = new Set((q.get("hide") || "").split(",").filter(Boolean));
    const [cpub, cid] = (q.get("before") || "").split("|");
    const stories = [];
    for (const s of f.stories) {
      if (cpub && (s.published_at > cpub || (s.published_at === cpub && s.id >= +cid))) continue;
      if (!nurGemerkt && s.published_at < since) break;
      const saved = s.articles.some(a => gemerkt.has(a.id));
      if (aus.has(s.topic || "Sonstiges") || (nurPositiv && !s.positive) || (nurGemerkt && !saved)) continue;
      stories.push({ ...s, saved });
      if (stories.length === limit) break;
    }
    const letzte = stories.at(-1);
    return { stories, threshold: f.threshold, days: f.days, since, horizon: nurGemerkt ? null : f.horizon,
             next: letzte ? `${letzte.published_at}|${letzte.id}` : null, limit, read_before: f.stand };
  }

  async function beantworte(pfad, q) {
    if (pfad === "feed") return feed(q);
    if (pfad === "world") return datei("world");
    if (pfad.startsWith("stats/")) return datei(`stats/${pfad.slice(6)}`);
    if (pfad.startsWith("map_teil/")) return datei(`map/${pfad.slice(9)}`);
    if (pfad === "map_artikel") return (await datei("map/artikel"))[+q.get("i")];
    if (pfad === "map_layout") return datei(`map/layout_${+q.get("version")}_${+q.get("rep")}`);
  }

  window.fetch = async (eingabe, init = {}) => {
    const url = new URL(eingabe instanceof Request ? eingabe.url : eingabe, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith(API)) return echt(eingabe, init);
    const pfad = url.pathname.slice(API.length);
    if ((init.method || "GET") !== "GET") {
      if (pfad === "bookmark") {
        const { articles, saved } = JSON.parse(init.body);
        for (const id of articles) saved ? gemerkt.add(id) : gemerkt.delete(id);
      }
      return new Response(null, { status: 204 });
    }
    try {
      return antwort(await beantworte(pfad, url.searchParams));
    } catch {
      return antwort(undefined);
    }
  };
})();
