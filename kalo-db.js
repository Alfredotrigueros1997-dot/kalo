/* Kalo — base de alimentos local (USDA SR28 en español, 8 789 alimentos genéricos con nutrientes completos).
 * Se carga DESPUÉS de kalo-foods-data.js y ANTES de kalo-online.js. Amplía la app sin modificarla:
 *  · food(id) resuelve los ids de la base (900000 + NDB_No)
 *  · Buscar › Todos: resultados de la base bajo los alimentos propios (búsqueda por palabras, sin acentos)
 *  · Crear receta: los ingredientes también se buscan en la base
 *  · Detalle de alimento: grasa saturada, potasio, colesterol, calcio, hierro y vitamina C
 * No añade campos al estado S.
 */
(function () {
  "use strict";
  const DATA = window.KALO_FOODS_DATA;
  if (!DATA || !Array.isArray(DATA.foods)) { console.warn("Kalo DB: sin datos (kalo-foods-data.js no cargado)"); return; }
  const BASE = 900000;
  const groups = DATA.groups || [];
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ%]+/g, " ").trim();
  const r1 = n => Math.round(n * 10) / 10;

  /* ---------- objetos de alimento en el formato de la app (por porción) ---------- */
  const FOODS_DB = new Array(DATA.foods.length);
  const BYID = new Map();
  const IDX = new Array(DATA.foods.length);           // texto normalizado para buscar (es | en | grupo)
  const MAIN = new Array(DATA.foods.length);          // solo el nombre principal en español
  const ENMAIN = new Array(DATA.foods.length);        // nombre en inglés (para el modo en inglés)
  let LANG = "es";
  const groupsEn = DATA.groupsEn || groups;
  /* Etiquetas (nombre, grupo, porciones) en el idioma activo; los valores nutricionales no cambian */
  function label(f, lang) {
    const r = f._r, ms = r[19], m1 = ms && ms[0], m2 = ms && ms[1], en = lang === "en";
    const lab = m => en ? (m[2] || m[0]) : m[0];
    f.n = en ? r[2] : r[1];
    f.b = (en ? "Generic · " : "Genérico · ") + ((en ? groupsEn : groups)[r[3]] || "USDA");
    f.s = m1 ? `${lab(m1)} (${r1(m1[1])} g)` : "100 g";
    const alt = [];
    if (m2 && m2[1] !== f.grams) alt.push([`${lab(m2)} (${r1(m2[1])} g)`, m2[1] / f.grams]);
    if (m1) alt.push(["100 g", 100 / f.grams]);
    alt.push(["1 g", 1 / f.grams]);
    f.alt = alt;
  }
  DATA.foods.forEach((r, i) => {
    const [ndb, es, en, g, kcal, pr, fat, carb, fb, sg, na, sat, chol, pot, ca, fe, vc, va, vd, ms] = r;
    const m1 = ms && ms[0];
    const grams = m1 ? m1[1] : 100;                   // porción por defecto: la primera medida casera, o 100 g
    const k = grams / 100;
    const f = {
      id: BASE + ndb, en, _r: r, grams,
      k: Math.round(kcal * k), c: r1(carb * k), f: r1(fat * k), p: r1(pr * k), fb: r1(fb * k), sg: r1(sg * k), na: Math.round(na * k),
      sat: r1(sat * k), pot: Math.round(pot * k), chol: Math.round(chol * k), ca: Math.round(ca * k), fe: r1(fe * k), vc: r1(vc * k), va: Math.round(va * k), vd: r1(vd * k),
      src: "usda", db: true
    };
    label(f, "es");
    FOODS_DB[i] = f; BYID.set(f.id, f);
    MAIN[i] = norm(es.replace(/\([^)]*\)/g, " "));   // nombre en español sin paréntesis (nombres alternativos y notas)
    IDX[i] = norm(es) + " | " + norm(en) + " | " + norm(groups[g] || "");
    ENMAIN[i] = norm(en);
    // alimentos poco habituales en un diario: bajan en el orden salvo que se busquen expresamente
    const low = es.toLowerCase();
    f.rare = /\(nativo|\(hopi\)|\(navajo\)|usda commodity|comida para beb|papilla|f[óo]rmula infantil/.test(low) || g === 2 || g === 23 ? 1 : 0;
  });
  function setLang(lang) { lang = lang === "en" ? "en" : "es"; if (lang === LANG) return; LANG = lang; FOODS_DB.forEach(f => label(f, lang)); }

  /* ---------- búsqueda ---------- */
  function search(q, limit) {
    const toks = norm(q).split(" ").filter(t => t.length >= 2 || /^\d/.test(t));
    if (!toks.length) return [];
    const out = [], f = FOODS_DB;
    for (let i = 0; i < IDX.length; i++) {
      let score = 0, ok = true;
      for (const tok of toks) {
        let t = LANG === "en" ? ENMAIN[i] : MAIN[i], at = t.indexOf(tok), main = true;
        if (at < 0) { t = IDX[i]; at = t.indexOf(tok); main = false; }
        if (at < 0) { ok = false; break; }
        const wordStart = at === 0 || t[at - 1] === " " || t[at - 1] === "|";
        const rest = t.slice(at + tok.length, at + tok.length + 3);
        const whole = wordStart && (rest === "" || rest[0] === " " || rest === "s" || rest.startsWith("s ") || rest.startsWith("es ") || rest === "es");
        score += main ? (whole ? 5 : wordStart ? 3 : 1) : (whole || wordStart ? 2 : 1);
        if (main && at === 0) score += 2;             // empieza por el término: "Pollo, ..." antes que "Sopa de pollo"
      }
      if (ok) out.push([score - 3 * f[i].rare, i]);
    }
    out.sort((a, b) => b[0] - a[0] || f[a[1]].n.length - f[b[1]].n.length);
    return out.slice(0, limit || 40).map(x => f[x[1]]);
  }

  /* ---------- food(id): resolver ids de la base ---------- */
  const origFood = food;
  food = function (id) { return origFood(id) || BYID.get(id); };

  /* ---------- Buscar › Todos ---------- */
  const rowHtml = f => `<div class="row" role="button" tabindex="0" onkeydown="if(event.key==='Enter')this.click()" onclick="go('foodDetail',{foodId:${f.id},meal:cur().p.meal})"><div class="body"><div class="n" style="white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:14.5px;line-height:1.25">${esc(f.n)}</div><div class="s">${r0(f.k)} kcal · ${esc(f.b.replace(/^(Genérico|Generic) · /, ""))}, ${esc(f.s)}</div></div><button class="del" style="color:var(--accent)" onclick="event.stopPropagation();addEntry(${f.id},cur().p.meal,1,null);render()" aria-label="Añadir ${esc(f.n)}">${I.plusS}</button></div>`;
  const origResults = resultsHtml;
  resultsHtml = function () {
    let html = origResults();
    const p = cur().p, q = (p.q || "").trim(), tabN = p.tab || "todos";
    if (tabN !== "todos") return html;
    if (!q) return html.replace('<div class="sec">Historial</div>', `<div class="card" style="font-size:13.5px;color:var(--muted)">${LANG === "en" ? `Type to search <b>${FOODS_DB.length.toLocaleString("en")}</b> generic foods (USDA) plus your own foods and online products.` : `Escribe para buscar entre <b>${FOODS_DB.length.toLocaleString("es")}</b> alimentos genéricos (USDA, en español) además de tus alimentos y los productos en línea.`}</div><div class="sec">Historial</div>`);
    if (q.length < 2) return html;
    const list = search(q, 40);
    if (!list.length) return html;
    const block = `<div class="sec">${LANG === "en" ? "Food database" : "Base de alimentos"} · ${list.length}${list.length === 40 ? "+" : ""} ${LANG === "en" ? "results" : "resultados"}</div><div class="group">${list.map(rowHtml).join("")}</div>`;
    const emptyAt = html.indexOf('<div class="group"><div class="empty">Sin resultados para');
    if (emptyAt >= 0) {                              // sin coincidencias propias: la base ocupa su lugar
      const end = html.indexOf("</div></div>", emptyAt) + 12;
      return html.slice(0, emptyAt) + block + html.slice(end);
    }
    return html + block;
  };

  /* ---------- Crear receta: ingredientes desde la base ---------- */
  const origRc = rcResultsHtml;
  rcResultsHtml = function () {
    let html = origRc();
    const r = rcState(cur().p), q = (r.q || "").trim();
    if (q.length < 2) return html;
    const list = search(q, 8);
    if (!list.length) return html;
    const rows = list.map(f => `<button class="row" onclick="rcAddIng(${f.id})"><div class="body"><div class="n" style="white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:14.5px;line-height:1.25">${esc(f.n)}</div><div class="s">${r0(f.k)} kcal · ${esc(f.b.replace(/^(Genérico|Generic) · /, ""))}, ${esc(f.s)}</div></div><span style="color:var(--accent)">${I.plusS}</span></button>`).join("");
    if (html.indexOf('<div class="empty">Sin resultados') >= 0) return `<div class="group">${rows}</div>`;
    return html.replace(/<\/div>\s*$/, rows + "</div>");
  };

  /* ---------- Detalle: nutrientes adicionales ---------- */
  const origDetail = views.foodDetail;
  views.foodDetail = function (p) {
    let html = origDetail(p);
    const f = food(p.foodId);
    if (!f || !f.db) return html;
    const mult = (p._q || 1) * (p._fac || 1);
    const L = LANG === "en" ? ["Cholesterol", "Calcium", "Iron", "Vitamin C"] : ["Colesterol", "Calcio", "Hierro", "Vitamina C"];
    const extra = `<div class="fr sub"><span>${L[0]}</span><span>${r0(f.chol * mult)} mg</span></div><div class="fr sub"><span>${L[1]}</span><span>${r0(f.ca * mult)} mg</span></div><div class="fr sub"><span>${L[2]}</span><span>${r1(f.fe * mult)} mg</span></div><div class="fr sub"><span>${L[3]}</span><span>${r1(f.vc * mult)} mg</span></div>`;
    const anchor = '<div class="fr sub" style="border:0"><span>Fuente</span>';
    html = html.replace(anchor, extra + anchor);
    return html.replace("USDA FoodData Central</span>", `USDA SR28${LANG === "en" ? "" : " · " + esc(f.en)}</span>`);
  };

  window.KaloDB = { search, count: FOODS_DB.length, byId: id => BYID.get(id), BASE, setLang, get lang() { return LANG; } };
})();
