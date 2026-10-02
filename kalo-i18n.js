/* Kalo — idioma de la interfaz (español por defecto, inglés opcional). Se carga tras kalo-i18n-en.js y kalo-db.js,
 * antes de kalo-online.js. Amplía la app sin modificarla:
 *  · traduce el DOM (textos, placeholders, aria-label, title) con el diccionario KALO_I18N.<lang> a medida que se pinta
 *    (MutationObserver): las vistas siguen escritas en español en kalo.html
 *  · fechas y números: Date/Number.toLocaleString("es") pasan al idioma activo
 *  · nombres de la base de alimentos en inglés (KaloDB.setLang)
 *  · selector de idioma en Más › Ajustes (S.settings.lang: "es" | "en")
 */
(function () {
  "use strict";
  const DICTS = window.KALO_I18N || {};
  const NUM = /\d+(?:[.,]\d+)*/g;
  let LANG = "es";
  const cache = new Map();

  /* ---------- traducción de una cadena ---------- */
  const RULES = [                                     // patrones con partes variables (nombres, etc.)
    [/^Hola, (.+)$/, "Hi, $1"],
    [/^Añadir (.+)$/, "Add $1"], [/^Editar (.+)$/, "Edit $1"], [/^Quitar (.+)$/, "Remove $1"],
    [/^Registrar (desayuno|almuerzo|cena|snacks)$/i, (m, x) => "Log " + ({ desayuno: "breakfast", almuerzo: "lunch", cena: "dinner", snacks: "snacks" })[x.toLowerCase()]],
    [/^(Pierdes|Ganas) ≈ (.+?) (kg|lb)\/semana \((.+?) % del peso\) · objetivo (.+?) (kg|lb) en unas (.+?) semanas \((.+)\)\.$/, (m, v, a, u1, pct, g, u2, w, d) => `You ${v === "Ganas" ? "gain" : "lose"} ≈ ${a} ${u1}/week (${pct} % of body weight) · goal ${g} ${u2} in about ${w} weeks (${d}).`],
    [/^Estoy usando Kalo para registrar mis comidas y llegar a mi objetivo \(soy (.+?)\)\. Únete y hacemos el reto de la semana juntos: (\S+)$/, "I'm using Kalo to log my meals and reach my goal (it's $1). Join me and let's do this week's challenge together: $2"],
  ];
  function tr(text) {
    if (LANG === "es") return text;
    const d = DICTS[LANG]; if (!d) return text;
    const s = text.replace(/\s+/g, " ").trim(); if (!s) return text;
    if (cache.has(s)) return cache.get(s);
    let out = d[s];
    if (out === undefined) {
      const tpl = s.replace(NUM, "#");
      const t = d[tpl];
      if (t !== undefined) { const nums = s.match(NUM) || []; let i = 0; out = t.replace(/#/g, () => nums[i++] ?? "#"); }
    }
    if (out === undefined) { for (const [re, rep] of RULES) { if (re.test(s)) { out = s.replace(re, rep); break; } } }
    if (out === undefined) out = text;
    else out = text.replace(s, out);                  // conserva los espacios exteriores del nodo
    cache.set(s, out);
    return out;
  }

  /* ---------- traducción del DOM ---------- */
  const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SVG", "svg", "PRE", "CODE"]);
  const ATTRS = ["placeholder", "aria-label", "title", "alt"];
  const seen = new WeakMap();                         // nodo → texto traducido ya aplicado
  function trNode(n) {
    if (n.nodeType === 3) {
      const p = n.parentNode; if (!p || SKIP.has(p.tagName) || p.closest("[contenteditable]")) return;
      const v = n.nodeValue; if (!v || !/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(v)) return;
      if (seen.get(n) === v) return;
      if (p.tagName === "OPTION" && !p.hasAttribute("value")) p.setAttribute("value", v.trim());   // el valor sigue siendo el español
      const t = tr(v); if (t !== v) { n.nodeValue = t; } seen.set(n, t);
    } else if (n.nodeType === 1) {
      if (SKIP.has(n.tagName) && n.tagName !== "INPUT") return;
      for (const a of ATTRS) { if (n.hasAttribute(a)) { const v = n.getAttribute(a); const t = tr(v); if (t !== v) n.setAttribute(a, t); } }
      if (n.tagName === "INPUT") return;
      const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let c; while ((c = w.nextNode())) { if (c.nodeType === 3) trNode(c); else for (const a of ATTRS) { if (c.hasAttribute(a)) { const v = c.getAttribute(a); const t = tr(v); if (t !== v) c.setAttribute(a, t); } } }
    }
  }
  let observing = false;
  const mo = new MutationObserver(muts => {
    if (LANG === "es") return;
    for (const m of muts) {
      if (m.type === "characterData") trNode(m.target);
      else m.addedNodes.forEach(trNode);
    }
  });
  function observe() { if (observing) return; observing = true; mo.observe(document.body, { childList: true, subtree: true, characterData: true }); }
  function translateAll() { trNode(document.body); }

  /* ---------- fechas y números ---------- */
  const dLoc = Date.prototype.toLocaleDateString, dStr = Date.prototype.toLocaleString, nLoc = Number.prototype.toLocaleString;
  const loc = l => (LANG !== "es" && (l === "es" || l === undefined)) ? (LANG === "en" ? "en-US" : LANG) : l;
  Date.prototype.toLocaleDateString = function (l, o) { return dLoc.call(this, loc(l), o); };
  Date.prototype.toLocaleString = function (l, o) { return dStr.call(this, loc(l), o); };
  Number.prototype.toLocaleString = function (l, o) { return nLoc.call(this, loc(l), o); };

  /* ---------- idioma activo ---------- */
  function apply(lang, repaint) {
    LANG = lang === "en" ? "en" : "es";
    S.settings.lang = LANG;
    document.documentElement.lang = LANG;
    cache.clear();
    if (window.KaloDB && KaloDB.setLang) KaloDB.setLang(LANG);
    if (LANG !== "es") observe();
    if (repaint) { render(); if (LANG !== "es") translateAll(); }
  }
  function set(lang) { apply(lang, false); save(); render(); if (typeof tabbar === "function") { try { document.getElementById("tabbar").innerHTML = tabbar(); } catch (_) {} } if (LANG !== "es") translateAll(); }

  // estado: S.settings.lang guardaba "Español"; ahora "es" | "en"
  if (S.settings.lang !== "en" && S.settings.lang !== "es") S.settings.lang = "es";

  /* ---------- Ajustes › Idioma ---------- */
  const origSettings = views.settings;
  views.settings = function (p) {
    const h = origSettings(p);
    const sel = `<select aria-label="Idioma" onchange="KaloI18n.set(this.value)"><option value="es" ${LANG === "es" ? "selected" : ""}>Español</option><option value="en" ${LANG === "en" ? "selected" : ""}>English</option></select>`;
    return h.replace('<span class="muted">Español (único idioma disponible)</span>', sel);
  };

  window.KaloI18n = { set, tr, get lang() { return LANG; } };
  apply(S.settings.lang, false);
  if (LANG !== "es") { translateAll(); }
})();
