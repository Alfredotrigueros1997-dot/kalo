/* Kalo — módulo de integraciones. Se carga DESPUÉS de kalo.html y amplía la app sin modificarla:
 *  · puente nativo (Swift) para cámara, red, guardado y podómetro
 *  · escáner de código de barras real → USDA FoodData Central + Open Food Facts
 *  · búsqueda de alimentos en línea (productos de EE. UU. primero)
 *  · pasos reales del iPhone
 */
(function () {
  "use strict";
  const NATIVE = !!(window.__KALO_NATIVE__ && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.kalo);
  const pending = {};
  const KaloNative = window.KaloNative = {
    native: NATIVE,
    call(type, extra) {
      return new Promise((res, rej) => {
        if (!NATIVE) { rej(new Error("sin puente nativo")); return; }
      if (type !== "log" && type !== "save") logErr("→ " + type);
        const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        pending[id] = { res, rej };
        try { window.webkit.messageHandlers.kalo.postMessage(Object.assign({ id, type }, extra || {})); }
        catch (e) { delete pending[id]; rej(e); }
      });
    },
    _reply(id, payload) { const p = pending[id]; if (!p) { logErr("← respuesta sin destinatario " + id); return; } delete pending[id]; if (payload && payload.error) logErr("← error: " + payload.error); p.res(payload || {}); },
    async fetchJSON(url, headers) {
      if (NATIVE) {
        const r = await this.call("fetch", { url, headers: headers || {} });
        if (r.error) throw new Error(r.error);
        if (r.status === 429) throw Object.assign(new Error("Límite de consultas alcanzado"), { code: 429 });
        if (r.status === 404) { try { return JSON.parse(r.body); } catch (_) { return { status: 0, notFound: true }; } }
        if (r.status < 200 || r.status >= 300) throw new Error("HTTP " + r.status);
        return JSON.parse(r.body);
      }
      const r = await fetch(url, { headers: headers || {} });
      if (r.status === 429) throw Object.assign(new Error("Límite de consultas alcanzado"), { code: 429 });
      if (r.status === 404) { try { return await r.json(); } catch (_) { return { status: 0, notFound: true }; } }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    },
    haptic(style) { if (NATIVE) this.call("haptic", { style }).catch(() => {}); },
  };

  /* ---------- registro de errores (visible en Diagnóstico y en la consola de Xcode) ---------- */
  const LOG = window.__KALO_LOG__ = window.__KALO_LOG__ || [];
  function logErr(msg) { LOG.push(new Date().toTimeString().slice(0, 8) + " " + msg); if (LOG.length > 60) LOG.shift(); if (NATIVE) { try { window.webkit.messageHandlers.kalo.postMessage({ id: "", type: "log", msg: String(msg) }); } catch (_) {} } }
  window.addEventListener("error", ev => logErr((ev.message || "error") + " @" + (ev.filename || "").split("/").pop() + ":" + ev.lineno));
  window.addEventListener("unhandledrejection", ev => logErr("promise: " + (ev.reason && ev.reason.message || ev.reason)));

  /* ---------- señal de arranque para el vigilante nativo: se envía al FINAL del módulo (ver abajo, #2) ---------- */
  if (NATIVE && typeof BOOT_ERR !== "undefined" && BOOT_ERR) {
    // El estado guardado no se pudo cargar: conservar una copia nativa ANTES de que el primer save() la sobrescriba.
    try { window.webkit.messageHandlers.kalo.postMessage({ id: "", type: "backupState" }); } catch (_) {}
    logErr("estado guardado ilegible: " + (BOOT_ERR.message || BOOT_ERR));
  }

  /* ---------- estado extra ---------- */
  S.onlineFoods = S.onlineFoods || [];
  S.barcodes = S.barcodes || {};
  S.settings.premium = true;               // fase de pruebas: todo desbloqueado

  /* ---------- persistencia nativa (Documents/kalo-state.json) ---------- */
  if (NATIVE) {
    // #27: la barra de estado nativa sigue el tema forzado en Ajustes
    const origTheme = applyTheme;
    applyTheme = function () { origTheme(); try { KaloNative.call("theme", { dark: S.settings.dark ? true : null }).catch(() => {}); } catch (_) {} };
    const origReset = resetAll;
    resetAll = function () { try { window.webkit.messageHandlers.kalo.postMessage({ id: "", type: "backupState" }); } catch (_) {} origReset(); };
    const origSave = save; let t = null;
    save = function () {
      try { localStorage.setItem("kalo-proto-v1", JSON.stringify(S)); } catch (_) { /* #32: sin aviso; el archivo nativo manda */ }
      clearTimeout(t);
      t = setTimeout(() => { KaloNative.call("save", { data: JSON.stringify(S) }).catch(() => {}); }, 250);
    };
    window.addEventListener("pagehide", () => { KaloNative.call("save", { data: JSON.stringify(S) }).catch(() => {}); });
  }

  /* ---------- alimentos en línea resolubles por id ---------- */
  const origFood = food;
  food = function (id) { return origFood(id) || (S.onlineFoods || []).find(f => f.id === id); };
  /* #12: ids de alimentos en línea referenciados por el diario, recetas, comidas guardadas o códigos: nunca se expulsan de la caché */
  function referencedOnlineIds() {
    const ids = new Set();
    for (const k in (S.diary || {})) { const dd = S.diary[k]; if (!dd || !dd.meals) continue; for (const m in dd.meals) (dd.meals[m] || []).forEach(en => { if (en && en.foodId != null) ids.add(en.foodId); }); }
    (S.recipes || []).forEach(r => (r.ingredients || []).forEach(i => { if (i && i.foodId != null) ids.add(i.foodId); }));
    (S.savedMeals || []).forEach(mm => (mm.entries || mm.items || []).forEach(i => { if (i && i.foodId != null) ids.add(i.foodId); }));
    Object.values(S.barcodes || {}).forEach(id => ids.add(id));
    return ids;
  }
  function rememberOnline(f) {
    S.onlineFoods = (S.onlineFoods || []).filter(x => x.id !== f.id);
    S.onlineFoods.unshift(f);
    if (S.onlineFoods.length > 400) {
      const keep = referencedOnlineIds();
      const pinned = S.onlineFoods.filter(x => keep.has(x.id));
      const rest = S.onlineFoods.filter(x => !keep.has(x.id)).slice(0, Math.max(0, 400 - pinned.length));
      S.onlineFoods = S.onlineFoods.filter(x => pinned.includes(x) || rest.includes(x));
    }
    save();
    return f;
  }
  const r1v = n => Math.round((+n || 0) * 10) / 10;
  const normCode = c => String(c || "").replace(/\D/g, "").replace(/^0+/, "");

  /* ---------- USDA FoodData Central ---------- */
  const USDA = "https://api.nal.usda.gov/fdc/v1/";
  let usdaHour = 0, usdaCount = 0;
  function usdaKey() { return (S.settings.usdaKey || "").trim() || (window.__KALO_USDA_KEY__ || "").trim() || "DEMO_KEY"; }
  async function usda(path) {
    const h = Math.floor(Date.now() / 3600000);
    if (h !== usdaHour) { usdaHour = h; usdaCount = 0; }
    if (usdaKey() === "DEMO_KEY" && usdaCount >= 28) throw Object.assign(new Error("Límite DEMO_KEY"), { code: 429 });
    usdaCount++;
    return KaloNative.fetchJSON(USDA + path + (path.includes("?") ? "&" : "?") + "api_key=" + encodeURIComponent(usdaKey()));
  }
  function nutr(x, ids) {
    for (const id of ids) { const n = (x.foodNutrients || []).find(n => n.nutrientId === id || (n.nutrient && n.nutrient.id === id)); if (n && typeof (n.value ?? n.amount) === "number") return n.value ?? n.amount; }
    return 0;
  }
  function usdaToFood(x) {
    const per100 = { k: nutr(x, [1008, 2048, 2047]), c: nutr(x, [1005, 1050]), f: nutr(x, [1004]), p: nutr(x, [1003]), fb: nutr(x, [1079]), sg: nutr(x, [2000, 1063]), na: nutr(x, [1093]) };
    if (!per100.k) per100.k = per100.c * 4 + per100.f * 9 + per100.p * 4;
    const unit = String(x.servingSizeUnit || "").toLowerCase();
    const grams = (unit === "g" || unit === "grm" || unit === "ml" || unit === "mlt") && x.servingSize > 0 ? x.servingSize : 0;
    const factor = grams ? grams / 100 : 1;
    const house = (x.householdServingFullText || "").trim();
    const label = grams ? `${house || "1 porción"} (${r1v(grams)} ${unit.startsWith("m") ? "ml" : "g"})` : "100 g";
    const f = { id: x.fdcId, n: tidy(x.description), b: tidy(x.brandName || x.brandOwner || (x.dataType === "Branded" ? "Marca" : "USDA · genérico")), s: label,
      k: r1v(per100.k * factor), c: r1v(per100.c * factor), f: r1v(per100.f * factor), p: r1v(per100.p * factor), fb: r1v(per100.fb * factor), sg: r1v(per100.sg * factor), na: Math.round(per100.na * factor),
      alt: grams ? [["100 g", 1 / factor], ["1 oz (28 g)", 28.35 / grams]] : [["1 oz (28 g)", 0.2835], ["50 g", 0.5], ["150 g", 1.5], ["1 taza (240 g)", 2.4]],
      src: "usda", code: x.gtinUpc || null };
    return f;
  }
  function tidy(s) {
    s = String(s || "").trim().replace(/\s+/g, " ");
    if (!s) return "";
    if (s === s.toUpperCase() && /[A-Z]/.test(s)) s = s.toLowerCase().replace(/(^|[\s(\-/.'])([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Usda|Gmo|Bbq|Pb|Iu)\b/g, m => m.toUpperCase());
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* ---------- Open Food Facts ---------- */
  const OFF_FIELDS = "code,product_name,product_name_en,product_name_es,brands,serving_size,serving_quantity,nutriments,quantity";
  function offToFood(p, code) {
    const n = p.nutriments || {};
    const name = p.product_name || p.product_name_en || p.product_name_es;
    if (!name) return null;
    let k100 = +n["energy-kcal_100g"]; if (!k100 && n.energy_100g) k100 = +n.energy_100g / 4.184;
    const per100 = { k: k100 || 0, c: +n.carbohydrates_100g || 0, f: +n.fat_100g || 0, p: +n.proteins_100g || 0, fb: +n.fiber_100g || 0, sg: +n.sugars_100g || 0, na: (+n.sodium_100g || 0) * 1000 };
    if (!per100.k) per100.k = per100.c * 4 + per100.f * 9 + per100.p * 4;
    let grams = +p.serving_quantity || 0;
    if (!grams) { const m = /([\d.,]+)\s*(g|ml)/i.exec(p.serving_size || ""); if (m) grams = parseFloat(m[1].replace(",", ".")); }
    const factor = grams ? grams / 100 : 1;
    const serv = typeof n["energy-kcal_serving"] === "number" && grams ? { k: +n["energy-kcal_serving"], c: +n.carbohydrates_serving || per100.c * factor, f: +n.fat_serving || per100.f * factor, p: +n.proteins_serving || per100.p * factor, fb: +n.fiber_serving || per100.fb * factor, sg: +n.sugars_serving || per100.sg * factor, na: (+n.sodium_serving || per100.na / 1000 * factor) * 1000 } : null;
    const v = serv || { k: per100.k * factor, c: per100.c * factor, f: per100.f * factor, p: per100.p * factor, fb: per100.fb * factor, sg: per100.sg * factor, na: per100.na * factor };
    if (!v.k && !v.c && !v.p) return null;
    const label = grams ? `1 porción (${r1v(grams)} g)` + (p.serving_size && !/^\s*[\d.,]+\s*g\s*$/i.test(p.serving_size) ? ` · ${p.serving_size}` : "") : "100 g";
    const id = -Number(String(code || p.code).replace(/\D/g, "") || 0);
    return { id, n: tidy(name), b: tidy((p.brands || "Open Food Facts").split(",")[0]), s: label,
      k: r1v(v.k), c: r1v(v.c), f: r1v(v.f), p: r1v(v.p), fb: r1v(v.fb), sg: r1v(v.sg), na: Math.round(v.na),
      alt: grams ? [["100 g", 1 / factor], ["1 oz (28 g)", 28.35 / grams]] : [["1 oz (28 g)", 0.2835], ["50 g", 0.5], ["150 g", 1.5]],
      src: "off", code: String(p.code || code || "") };
  }
  const offProduct = code => KaloNative.fetchJSON(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
  const offSearch = (q, us) => { const cc = (S.settings.country || "").trim(); const tag = cc ? `en:${cc}` : (us ? "en:united-states" : ""); return KaloNative.fetchJSON(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=12&lc=es&fields=${OFF_FIELDS}` + (tag && us !== false ? `&tagtype_0=countries&tag_contains_0=contains&tag_0=${tag}` : "")); };

  /* ---------- fuentes adicionales (globales / Latinoamérica) ---------- */
  const COUNTRIES = [["","Todos los países"],["mexico","México"],["colombia","Colombia"],["argentina","Argentina"],["chile","Chile"],["peru","Perú"],["ecuador","Ecuador"],["venezuela","Venezuela"],["guatemala","Guatemala"],["honduras","Honduras"],["el-salvador","El Salvador"],["nicaragua","Nicaragua"],["costa-rica","Costa Rica"],["panama","Panamá"],["dominican-republic","República Dominicana"],["cuba","Cuba"],["bolivia","Bolivia"],["paraguay","Paraguay"],["uruguay","Uruguay"],["brazil","Brasil"],["puerto-rico","Puerto Rico"],["united-states","Estados Unidos"],["spain","España"]];
  function apis() { S.settings.apis = S.settings.apis || {}; return S.settings.apis; }
  function fromPer100(name, brand, per100, grams, label, src, code) {
    if (!per100.k) per100.k = per100.c * 4 + per100.f * 9 + per100.p * 4;
    const factor = grams ? grams / 100 : 1;
    return { id: -Number(String(code).replace(/\D/g, "") || Date.now()), n: tidy(name), b: tidy(brand || src), s: grams ? `${label || "1 porción"} (${r1v(grams)} g)` : "100 g",
      k: r1v(per100.k * factor), c: r1v(per100.c * factor), f: r1v(per100.f * factor), p: r1v(per100.p * factor), fb: r1v((per100.fb || 0) * factor), sg: r1v((per100.sg || 0) * factor), na: Math.round((per100.na || 0) * factor),
      alt: grams ? [["100 g", 1 / factor]] : [["50 g", .5], ["150 g", 1.5]], src, code: String(code) };
  }
  async function nutritionixUPC(code) {
    const a = apis(); if (!(a.nxId && a.nxKey)) return null;
    const j = await KaloNative.fetchJSON(`https://trackapi.nutritionix.com/v2/search/item?upc=${encodeURIComponent(code)}`, { "x-app-id": a.nxId.trim(), "x-app-key": a.nxKey.trim() });
    const f = j && j.foods && j.foods[0]; if (!f) return null;
    const g = +f.serving_weight_grams || 0; const per = g ? 100 / g : 1;
    return fromPer100(f.food_name, f.brand_name, { k: (+f.nf_calories || 0) * per, c: (+f.nf_total_carbohydrate || 0) * per, f: (+f.nf_total_fat || 0) * per, p: (+f.nf_protein || 0) * per, fb: (+f.nf_dietary_fiber || 0) * per, sg: (+f.nf_sugars || 0) * per, na: (+f.nf_sodium || 0) * per }, g, `${f.serving_qty || 1} ${f.serving_unit || "porción"}`, "nutritionix", code);
  }
  async function edamamUPC(code) {
    const a = apis(); if (!(a.edId && a.edKey)) return null;
    const j = await KaloNative.fetchJSON(`https://api.edamam.com/api/food-database/v2/parser?upc=${encodeURIComponent(code)}&app_id=${encodeURIComponent(a.edId.trim())}&app_key=${encodeURIComponent(a.edKey.trim())}`);
    const h = j && j.hints && j.hints[0] && j.hints[0].food; if (!h) return null;
    const n = h.nutrients || {}; const serv = (j.hints[0].measures || []).find(m => /Serving/i.test(m.label));
    return fromPer100(h.label, h.brand, { k: +n.ENERC_KCAL || 0, c: +n.CHOCDF || 0, f: +n.FAT || 0, p: +n.PROCNT || 0, fb: +n.FIBTG || 0, sg: 0, na: 0 }, serv ? +serv.weight : 0, "1 porción", "edamam", code);
  }
  async function upcItemDb(code) {   // identifica nombre/marca (sin nutrición); 100 consultas/día sin clave
    const j = await KaloNative.fetchJSON(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`);
    const it = j && j.items && j.items[0]; if (!it) return null;
    return { name: it.title || "", brand: it.brand || "", category: it.category || "" };
  }
  async function nameSearchFirst(name, brand) {
    const q = [brand, name].filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 60);
    const [u, o] = await Promise.allSettled([
      usda(`foods/search?query=${encodeURIComponent(q)}&dataType=Branded&pageSize=3`).then(j => (j.foods || []).map(usdaToFood)),
      offSearch(q, false).then(j => (j.products || []).map(p => offToFood(p)).filter(Boolean)),
    ]);
    const cands = [...(o.status === "fulfilled" ? o.value : []), ...(u.status === "fulfilled" ? u.value : [])];
    const bn = (brand || "").toLowerCase().split(/\s+/)[0];
    return cands.find(f => bn && f.b.toLowerCase().includes(bn)) || cands[0] || null;
  }

  /* ---------- búsqueda por código de barras ---------- */
  async function lookupBarcode(raw) {
    const code = String(raw).replace(/\D/g, "");
    if (!code) return null;
    S.barcodes = S.barcodes || {}; S.onlineFoods = S.onlineFoods || [];
    if (S.barcodes[code] && food(S.barcodes[code])) return food(S.barcodes[code]);
    const known = S.onlineFoods.find(f => f.code && normCode(f.code) === normCode(code));
    if (known) return known;
    const errors = [];
    const ean = code.length === 12 ? "0" + code : code;              // UPC-A → EAN-13 para OFF
    for (const c of [...new Set([ean, code])]) {
      try { const j = await offProduct(c); if (j && j.status === 1 && j.product) { const f = offToFood(j.product, code); if (f) return rememberOnline(f); } }
      catch (e) { errors.push("OFF: " + e.message); }
    }
    try {
      const variants = [...new Set([code.padStart(14, "0"), code.padStart(13, "0"), code])];
      const j = await usda(`foods/search?query=${encodeURIComponent(variants.map(v => "gtinUpc:" + v).join(" OR "))}&dataType=Branded&pageSize=10`);
      const hit = (j.foods || []).find(x => normCode(x.gtinUpc) === normCode(code)) || (j.foods || [])[0];
      if (hit) return rememberOnline(usdaToFood(hit));
    } catch (e) { errors.push("USDA: " + e.message); }
    for (const [name, fn] of [["Nutritionix", nutritionixUPC], ["Edamam", edamamUPC]]) {
      try { const f = await fn(code); if (f) return rememberOnline(f); } catch (e) { errors.push(name + ": " + e.message); }
    }
    // Último recurso: identificar el producto (nombre y marca) y buscar sus valores por nombre
    let ident = null;
    try { ident = await upcItemDb(code); } catch (e) { errors.push("UPCitemdb: " + e.message); }
    if (ident && ident.name) {
      try { const f = await nameSearchFirst(ident.name, ident.brand); if (f) { f.code = f.code || code; f.approx = true; return rememberOnline(Object.assign({}, f, { id: -Number(code) || f.id, b: `${f.b} · valores de producto similar` })); } } catch (e) { errors.push("búsqueda: " + e.message); }
      lastIdent = { code, name: ident.name, brand: ident.brand };
      return null;
    }
    if (errors.length >= 2 && !ident) throw new Error(errors.join(" · "));
    return null;
  }
  let lastIdent = null;

  /* ---------- búsqueda de texto en línea ---------- */
  const onlineCache = {};   // q → {status:'loading'|'done'|'error', items, msg}
  async function searchOnline(q) {
    q = q.trim(); if (q.length < 2) return;
    onlineCache[q] = { status: "loading", items: [] };
    paintOnline(q);
    const [u, o] = await Promise.allSettled([
      usda(`foods/search?query=${encodeURIComponent(q)}&dataType=Branded,Foundation,SR%20Legacy&pageSize=12`).then(j => (j.foods || []).map(usdaToFood)),
      offSearch(q, true).then(j => (j.products || []).map(p => offToFood(p)).filter(Boolean)).then(async list => list.length >= 4 ? list : list.concat((await offSearch(q, false).then(j => (j.products || []).map(p => offToFood(p)).filter(Boolean)).catch(() => [])))),
    ]);
    const items = []; const seen = new Set();
    const push = f => { const k = (f.n + "|" + f.b).toLowerCase(); if (!seen.has(k) && f.k >= 0) { seen.add(k); items.push(f); } };
    (u.status === "fulfilled" ? u.value : []).forEach(push);
    (o.status === "fulfilled" ? o.value : []).forEach(push);
    let msg = "";
    if (u.status === "rejected") msg += (u.reason && u.reason.code === 429 ? "USDA: límite por hora alcanzado (añade tu clave gratuita en Ajustes). " : "USDA no disponible. ");
    if (o.status === "rejected") msg += "Open Food Facts no disponible. ";
    items.forEach(rememberOnline);
    onlineCache[q] = { status: "done", items, msg };
    paintOnline(q);
  }
  function onlineBoxHtml(q) {
    const c = onlineCache[q];
    if (!c) return `<div class="group"><button class="row" style="color:var(--accent);font-weight:600" onclick="KaloOnline.search(${esc(JSON.stringify(q))})">Buscar «${esc(q)}» en USDA y Open Food Facts</button></div>`;
    if (c.status === "loading") return `<div class="group"><div class="empty">Buscando «${esc(q)}» en línea…</div></div>`;
    const rows = c.items.map(f => `<div class="row" role="button" tabindex="0" onkeydown="if(event.key==='Enter')this.click()" onclick="KaloOnline.pick(${f.id})"><div class="body"><div class="n">${esc(f.n)}</div><div class="s">${r0(f.k)} kcal · ${esc(f.b)}, ${esc(f.s)} · ${f.src === "usda" ? "USDA" : "OFF"}</div></div><button class="del" style="color:var(--accent)" onclick="event.stopPropagation();KaloOnline.add(${f.id})" aria-label="Añadir">${I.plusS}</button></div>`).join("");
    return `<div class="group">${rows || `<div class="empty">Sin resultados en línea para «${esc(q)}».</div>`}${c.msg ? `<div class="empty" style="color:var(--warn)">${esc(c.msg)}</div>` : ""}<button class="row" style="color:var(--accent);font-weight:600" onclick="KaloOnline.search(${esc(JSON.stringify(q))})">Volver a buscar</button></div>`;
  }
  function paintOnline(q) {
    const box = document.getElementById("online-box");
    if (box && box.dataset.q === q) box.innerHTML = onlineBoxHtml(q);
  }
  const origResults = resultsHtml;
  resultsHtml = function () {
    const html = origResults();
    const p = cur().p || {}; const q = (p.q || "").trim();
    if ((p.tab || "todos") !== "todos" || q.length < 2) return html;
    return html + `<div class="sec" style="margin-top:14px">En línea · ${(COUNTRIES.find(c => c[0] === (S.settings.country || "")) || COUNTRIES[0])[1]}</div><div id="online-box" data-q="${esc(q)}">${onlineBoxHtml(q)}</div>`;
  };
  document.addEventListener("keydown", ev => {
    if (ev.key === "Enter" && ev.target && ev.target.id === "q") { ev.preventDefault(); const q = ev.target.value.trim(); if (q.length >= 2) { searchOnline(q); ev.target.blur(); } }
  });

  window.KaloOnline = {
    search: q => searchOnline(q),
    pick: id => { const f = food(id); if (!f) return; go("foodDetail", { foodId: id, meal: (cur().p || {}).meal || "desayuno" }); },
    add: id => { const meal = (cur().p || {}).meal || "desayuno"; addEntry(id, meal, 1, null); KaloNative.haptic("success"); render(); },
    lookupBarcode,
  };

  /* ---------- escáner real ---------- */
  views.scanner = function (p) {
    p._state = p._state || "idle";
    const meal = p.meal || "snacks";
    let body = "";
    if (p._state === "lookup") body = `<div class="card" style="text-align:center"><div class="num" style="font-size:22px">${esc(p._code)}</div><div class="muted" style="margin-top:6px">Buscando en Open Food Facts y USDA…</div></div>`;
    else if (p._state === "notfound") { const id = lastIdent && lastIdent.code === p._code ? lastIdent : null;
      body = `<div class="card"><b>${id ? "Producto identificado, sin valores nutricionales" : "No encontrado"}</b><div class="muted" style="font-size:14px;margin-top:4px">${id ? `«${esc(id.name)}»${id.brand ? " de " + esc(id.brand) : ""}. Ninguna base de datos tiene su etiqueta: créalo copiando las calorías y macros del envase (nombre y marca ya van rellenados).` : `El código ${esc(p._code)} no está en Open Food Facts, USDA${apis().nxId ? ", Nutritionix" : ""}${apis().edId ? ", Edamam" : ""} ni UPCitemdb. Puedes crearlo copiando la etiqueta del envase: quedará asociado a este código para la próxima vez.`}</div></div><button class="btn primary" onclick="go('createFood',{meal:'${meal}',code:'${esc(p._code)}',name:${JSON.stringify(id ? id.name : "")},brand:${JSON.stringify(id ? id.brand : "")}})">Crear alimento con este código</button>`; }
    else if (p._state === "error") body = `<div class="card"><b>Sin conexión con las bases de datos</b><div class="muted" style="font-size:14px;margin-top:4px">${esc(p._msg || "")}</div></div>`;
    const webCam = !NATIVE && window.ZXing && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (location.protocol === "https:" || location.hostname === "localhost");
    const cam = NATIVE || webCam
      ? `<button class="btn primary" onclick="KaloScan.start()">${I.scan} Escanear con la cámara</button>${webCam ? '<p class="muted" style="margin:0;font-size:12.5px;text-align:center">Usa la cámara del navegador (Safari pedirá permiso).</p>' : ""}`
      : `<div class="scanner"><div class="box"><div class="scanline"></div></div></div><p class="muted" style="margin:0;font-size:13.5px;text-align:center">${location.protocol === "file:" || location.protocol === "http:" ? "La cámara del navegador necesita que la app se abra desde una dirección https." : "La cámara solo está disponible en la app instalada o en la versión web instalable."} Aquí puedes escribir el código.</p>`;
    return nav("Código de barras") + `<div class="wrap">
      ${cam}
      <div class="group"><div class="field"><label for="bc">Código (UPC/EAN)</label><input id="bc" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="038000138416" value="${esc(p._code || "")}" style="width:170px"></div><button class="row" style="color:var(--accent);font-weight:600" onclick="KaloScan.manual()">Buscar este código</button></div>
      ${body}
      <p class="muted" style="margin:0;font-size:12.5px;text-align:center">Fuentes: Open Food Facts (libre) y USDA FoodData Central (EE. UU.).</p>
    </div>`;
  };
  async function resolveCode(code) {
    const p = cur().p; if (cur().v !== "scanner") return;
    p._code = code; p._state = "lookup"; render();
    try {
      const f = await lookupBarcode(code);
      if (cur().v !== "scanner") return;
      if (f) { KaloNative.haptic("success"); toast(f.n); replace("foodDetail", { foodId: f.id, meal: p.meal || "snacks" }); }
      else { KaloNative.haptic("error"); p._state = "notfound"; render(); }
    } catch (e) { p._state = "error"; p._msg = e.message; render(); }
  }
  /* escáner web (PWA / Safari) con ZXing */
  let webReader = null;
  function webScanStop() { try { if (webReader) { webReader.reset(); } } catch (_) {} webReader = null; }
  async function webScanStart() {
    if (!(window.ZXing && navigator.mediaDevices)) { toast("Este navegador no permite usar la cámara"); return; }
    sheet(`<h2>Escanear código</h2><div style="position:relative;border-radius:14px;overflow:hidden;background:#000"><video id="webcam" playsinline muted autoplay style="width:100%;max-height:52vh;display:block;object-fit:cover"></video><div style="position:absolute;left:10%;right:10%;top:35%;height:30%;border:2px solid rgba(255,255,255,.85);border-radius:10px"></div></div><p class="muted" style="margin:0;font-size:13px;text-align:center">Centra el código de barras dentro del recuadro.</p><button class="btn ghost" onclick="closeSheet()">Cancelar</button>`);
    try {
      const hints = new Map(); const F = ZXing.BarcodeFormat;
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.QR_CODE]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      webReader = new ZXing.BrowserMultiFormatReader(hints, 300);
      const video = document.getElementById("webcam");
      await webReader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video, (result, err) => {
        if (result && result.getText) { let code = String(result.getText()).replace(/\D/g, ""); if (code.length === 13 && code.startsWith("0")) code = code.slice(1); webScanStop(); closeSheet(); if (code) resolveCode(code); }
      });
    } catch (e) { webScanStop(); closeSheet(); toast(/NotAllowed|Permission/i.test(String(e)) ? "Permiso de cámara denegado: actívalo en Ajustes › Safari › Cámara" : "No se pudo abrir la cámara: " + (e.message || e)); }
  }
  const origCloseSheet = closeSheet;
  closeSheet = function () { webScanStop(); origCloseSheet(); };

  window.KaloScan = {
    async start() {
      if (!NATIVE) { await webScanStart(); return; }
      try { const r = await KaloNative.call("scan"); if (r && r.denied) { toast("Sin permiso de cámara: actívalo en Ajustes de iOS"); return; } if (r && r.code) resolveCode(String(r.code)); }
      catch (e) { logErr("scan: " + e.message); toast("No se pudo abrir la cámara: " + e.message); }
    },
    manual() { const v = (document.getElementById("bc") || {}).value || ""; const code = v.replace(/\D/g, ""); if (code.length < 6) { toast("Escribe el código completo"); return; } resolveCode(code); },
  };
  // Abre la cámara automáticamente al entrar en la pantalla desde la app nativa.
  const origGo = go;
  go = function (v, p) { origGo(v, p); if (v === "scanner" && (NATIVE || (window.ZXing && location.protocol === "https:"))) setTimeout(() => KaloScan.start(), 350); };
  // Prefill de nombre/marca al crear desde un código identificado
  const origCreateView = views.createFood;
  views.createFood = function (p) { let h = origCreateView(p); if (p && (p.name || p.brand)) { h = h.replace('id="cfn" type="text"', `id="cfn" type="text" value="${esc(p.name || "")}"`).replace('id="cfb" type="text"', `id="cfb" type="text" value="${esc(p.brand || "")}"`); } return h; };
  // Al crear un alimento desde un código no encontrado, recuerda el código.
  const origCreate = createFood;
  createFood = function (meal) {
    const code = (cur().p || {}).code; const before = S.myFoods.length;
    origCreate(meal);
    if (code && S.myFoods.length > before) { S.barcodes = S.barcodes || {}; S.barcodes[code] = S.myFoods[S.myFoods.length - 1].id; save(); }
  };

  /* ---------- teclado: que no tape campos ni hojas ---------- */
  if (NATIVE && window.visualViewport) {
    const vv = window.visualViewport;
    const upd = () => { const kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)); document.documentElement.style.setProperty("--kb", kb + "px"); };
    vv.addEventListener("resize", upd); vv.addEventListener("scroll", upd); upd();
    document.addEventListener("focusin", ev => { const el = ev.target; if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) setTimeout(() => { try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {} }, 350); });
  }

  /* ---------- pasos reales ---------- */
  if (NATIVE) {
    let last = 0;
    async function refreshSteps() {
      if (Date.now() - last < 15000) return; last = Date.now();
      try {
        const r = await KaloNative.call("steps");
        if (typeof r.steps === "number") {
          const d = day(TODAY);
          // #9: respetar el interruptor «Apple Health · pasos» y el valor escrito a mano; no re-pintar mientras se escribe
          const dv = S.settings.devices || {};
          if (dv.health === false || d.stepsManual) return;
          if (r.steps !== d.steps) {
            d.steps = r.steps; save();
            const ae = document.activeElement; const typing = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");
            if (!typing && (cur().v === "home" || cur().v === "steps")) render();
          }
        }
      } catch (_) {}
    }
    refreshSteps();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshSteps(); });
    setInterval(refreshSteps, 60000);
    const origHome = views.home;
    views.home = function (p) { setTimeout(refreshSteps, 0); return origHome(p); };
  }

  function safeInsets() {
    try { const d = document.createElement("div"); d.style.cssText = "position:absolute;visibility:hidden;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)"; document.body.appendChild(d); const cs = getComputedStyle(d); const r = `${cs.paddingTop}/${cs.paddingBottom}`; d.remove(); const rs = getComputedStyle(document.documentElement); return r + (rs.getPropertyValue("--sab") ? ` (nativo ${rs.getPropertyValue("--sat").trim()}/${rs.getPropertyValue("--sab").trim()})` : ""); } catch (e) { return "?"; }
  }

  /* ---------- diagnóstico ---------- */
  views.diag = function (p) {
    p._out = p._out || [];
    const row = (l, v) => `<div class="field"><label>${l}</label><span class="muted" style="font-size:13px;text-align:right;max-width:55%">${esc(String(v))}</span></div>`;
    return nav("Diagnóstico") + `<div class="wrap">
      <div class="group">${row("Puente nativo", NATIVE ? "sí" : "no")}${row("webkit.messageHandlers", !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.kalo))}${row("__KALO_NATIVE__", !!window.__KALO_NATIVE__)}${row("Estado guardado nativo", window.__KALO_SAVED__ ? Math.round(window.__KALO_SAVED__.length / 1024) + " KB" : "no")}${row("Clave USDA", (S.settings.usdaKey || "").trim() ? "propia (ajustes)" : window.__KALO_USDA_KEY__ ? "integrada" : "DEMO_KEY")}${row("Chef Kalo cargado", typeof window.KaloChef !== "undefined")}${row("Pantalla", innerWidth + "×" + innerHeight + " · safe " + safeInsets())}${row("Navegador", navigator.userAgent.slice(0, 60))}</div>
      <div class="sec">Pruebas</div>
      <div class="grid2">
        <button class="btn soft sm" style="width:100%" onclick="KaloDiag.test('scan')">Cámara</button>
        <button class="btn soft sm" style="width:100%" onclick="KaloDiag.test('fetch')">Red USDA</button>
        <button class="btn soft sm" style="width:100%" onclick="KaloDiag.test('off')">Red OFF</button>
        <button class="btn soft sm" style="width:100%" onclick="KaloDiag.test('steps')">Pasos</button>
        <button class="btn soft sm" style="width:100%" onclick="KaloDiag.test('notify')">Notificación</button>
        <button class="btn soft sm" style="width:100%" onclick="KaloDiag.test('barcode')">Buscar UPC 016000275287</button>
        <button class="btn soft sm" style="width:100%" onclick="KaloDiag.test('backup')">Ver copia de seguridad</button>
        <button class="btn ghost sm" style="width:100%" onclick="KaloDiag.test('restore')">Restaurar copia</button>
      </div>
      <div class="group"><div class="field"><label>Estado guardado</label><span class="muted" style="font-size:13px">${Math.round(JSON.stringify(S).length / 1024)} KB · ${(S.photos || []).length} fotos</span></div><div class="field"><label>Modo seguro</label><span class="muted">${window.__KALO_SAFE_MODE__ ? "sí (datos de ejemplo)" : "no"}</span></div></div>
      <div class="sec">Resultados</div>
      <div class="group">${p._out.length ? p._out.map(x => `<div class="row" style="min-height:40px"><div class="body" style="white-space:normal;font-size:13px">${esc(x)}</div></div>`).join("") : '<div class="empty">Pulsa una prueba.</div>'}</div>
      <div class="sec">Registro de errores (${LOG.length})</div>
      <div class="group">${LOG.length ? LOG.slice().reverse().map(x => `<div class="row" style="min-height:36px"><div class="body" style="white-space:normal;font-size:12.5px;font-family:ui-monospace,Menlo,monospace">${esc(x)}</div></div>`).join("") : '<div class="empty">Sin errores registrados.</div>'}</div>
      <button class="btn ghost" onclick="window.__KALO_LOG__.length=0;render()">Vaciar registro</button>
    </div>`;
  };
  window.KaloDiag = {
    async test(kind) {
      const p = cur().p; const out = s => { p._out.unshift(s); if (cur().v === "diag") render(); };
      try {
        if (kind === "scan") { const r = await KaloNative.call("scan"); out("Cámara: " + JSON.stringify(r)); }
        else if (kind === "fetch") { const t = Date.now(); const j = await usda("foods/search?query=cheerios&dataType=Branded&pageSize=1"); out(`USDA OK (${Date.now() - t} ms): ${j.totalHits} resultados, ej. ${j.foods && j.foods[0] && j.foods[0].description}`); }
        else if (kind === "off") { const t = Date.now(); const j = await offProduct("0049000006346"); out(`OFF OK (${Date.now() - t} ms): ${j.product && j.product.product_name}`); }
        else if (kind === "steps") { const r = await KaloNative.call("steps"); out("Pasos: " + JSON.stringify(r)); }
        else if (kind === "notify") { const r = await KaloNative.call("notify", { nid: "kalo-test", title: "Kalo", body: "Notificación de prueba", hour: new Date().getHours(), minute: (new Date().getMinutes() + 1) % 60 }); out("Notificación (en 1 min): " + JSON.stringify(r)); }
        else if (kind === "barcode") { const t = Date.now(); const f = await lookupBarcode("016000275287"); out(f ? `UPC OK (${Date.now() - t} ms): ${f.n} · ${f.b} · ${f.k} kcal · ${f.src}` : "UPC: no encontrado"); }
        else if (kind === "backup") { const r = await KaloNative.call("backupInfo"); out(r.exists ? `Copia de seguridad: ${Math.round(r.size / 1024)} KB del ${new Date(r.date * 1000).toLocaleString("es")}` : "No hay copia de seguridad"); }
        else if (kind === "restore") { const r = await KaloNative.call("restoreBackup"); if (r.error) { out("Restaurar: " + r.error); return; } const st = JSON.parse(r.data); if (!st || !st.diary) { out("Restaurar: la copia no es válida"); return; } if (typeof cancelAllReminders === "function") cancelAllReminders(); S = migrate(st); applyMealNames(); save(); stack = [{ v: "home", p: {} }]; applyTheme(); render(); if (typeof syncAllReminders === "function") syncAllReminders(); out("Copia restaurada"); toast("Datos restaurados desde la copia"); }
      } catch (e) { out(kind + " ERROR: " + e.message); }
    },
  };

  /* ---------- ajustes: clave USDA ---------- */
  const origSettings = views.settings;
  views.settings = function () {
    const html = origSettings();
    const extra = `<div class="sec">Bases de datos de alimentos</div><div class="group">
      <div class="field" style="flex-direction:column;align-items:stretch;gap:6px"><label for="usdakey">Clave USDA FoodData Central<div class="muted" style="font-size:12.5px;font-weight:400">${window.__KALO_USDA_KEY__ ? "Tu clave ya está integrada en la app (3 600 consultas/hora). Deja el campo vacío para usarla." : "Gratis en fdc.nal.usda.gov/api-key-signup · sin clave se usa DEMO_KEY (30 consultas/hora)"}</div></label><input id="usdakey" type="text" autocapitalize="off" autocorrect="off" placeholder="${window.__KALO_USDA_KEY__ ? "Clave integrada" : "DEMO_KEY"}" value="${esc(S.settings.usdaKey || "")}" style="width:100%;text-align:left" oninput="S.settings.usdaKey=this.value.trim();save()"></div>
      <div class="field"><label for="ctry">País para priorizar resultados</label><select id="ctry" onchange="S.settings.country=this.value;save()">${COUNTRIES.map(([v, n]) => `<option value="${v}" ${(S.settings.country || "") === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="field"><label>Open Food Facts</label><span class="muted">Global · sin clave</span></div>
      <div class="field"><label>UPCitemdb</label><span class="muted">Identifica productos · sin clave</span></div>
      <div class="field"><label for="nxid">Nutritionix ID<div class="muted" style="font-size:12.5px;font-weight:400">Gratis en developer.nutritionix.com</div></label><input id="nxid" type="text" autocapitalize="off" autocorrect="off" placeholder="app id" value="${esc(apis().nxId || "")}" style="width:120px" oninput="S.settings.apis.nxId=this.value.trim();save()"></div>
      <div class="field"><label for="nxkey">Nutritionix clave</label><input id="nxkey" type="text" autocapitalize="off" autocorrect="off" placeholder="app key" value="${esc(apis().nxKey || "")}" style="width:140px" oninput="S.settings.apis.nxKey=this.value.trim();save()"></div>
      <div class="field"><label for="edid">Edamam ID<div class="muted" style="font-size:12.5px;font-weight:400">Gratis en developer.edamam.com (Food Database)</div></label><input id="edid" type="text" autocapitalize="off" autocorrect="off" placeholder="app id" value="${esc(apis().edId || "")}" style="width:120px" oninput="S.settings.apis.edId=this.value.trim();save()"></div>
      <div class="field"><label for="edkey">Edamam clave</label><input id="edkey" type="text" autocapitalize="off" autocorrect="off" placeholder="app key" value="${esc(apis().edKey || "")}" style="width:140px" oninput="S.settings.apis.edKey=this.value.trim();save()"></div>
      <div class="field"><label>Alimentos en línea guardados</label><span class="muted">${(S.onlineFoods||[]).length}</span></div>
      <div class="field"><label>Modo nativo</label><span class="muted" style="font-size:12px">${NATIVE ? "iPhone" : "navegador"}</span></div>
      <button class="row" onclick="go('diag')"><div class="body"><div class="n">Diagnóstico</div><div class="s">Pruebas de cámara, red, pasos y registro de errores</div></div>${I.chev}</button>
    </div>`;
    const marker = '<div class="muted" style="text-align:center;font-size:12px">Versión';
    return html.includes(marker) ? html.replace(marker, extra + marker) : html.replace(/<\/div>\s*$/, extra + "</div>");
  };

  save();
  render();

  /* ---------- #2: señal de arranque, solo tras una primera pintura verificada ---------- */
  if (NATIVE) {
    const booted = typeof S === "object" && S && S.diary && typeof render === "function" && document.getElementById("screen") && document.getElementById("screen").children.length > 0;
    if (booted) {
      KaloNative.call("ready").catch(() => {});
      try { if (typeof syncAllReminders === "function") syncAllReminders(); } catch (e) { logErr("recordatorios: " + e.message); }   // #10
      if (window.__KALO_SAFE_MODE__) setTimeout(() => toast("Modo seguro: se cargaron datos de ejemplo. Tu copia está en Ajustes › Diagnóstico."), 800);
      else if (typeof BOOT_ERR !== "undefined" && BOOT_ERR) setTimeout(() => toast("No se pudieron leer tus datos guardados: se cargaron datos de ejemplo. Copia en Ajustes › Diagnóstico."), 800);
    } else {
      KaloNative.call("bootFailed", { msg: "pantalla vacía tras render()" }).catch(() => {});
    }
  }
})();
