/* Kalo — monitoreo anónimo y comentarios de los probadores. Se carga tras kalo-account.js.
 *  · Latido (POST /api/ping) al arrancar y como máximo cada 6 h: id de instalación aleatorio (no es el usuario),
 *    versión, plataforma, idioma, zona horaria y número/último error de JavaScript. Sin nombres, correos ni datos de salud.
 *  · Interruptor «Estadísticas de uso anónimas» en Más › Ajustes › Privacidad y datos (S.settings.telemetry, por defecto activado).
 *  · «Enviar comentario» en Más › Ayuda (POST /api/feedback) con pantalla y versión.
 * Solo funciona cuando hay servidor de Kalo (nube); sin servidor no envía nada.
 */
(function () {
  "use strict";
  const VERSION = "1.1.0";
  const KEY_ID = "kalo-install-id";
  const NATIVE = !!(window.__KALO_NATIVE__ && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.kalo);
  if (S.settings.telemetry === undefined) S.settings.telemetry = true;

  function base() {
    const s = (S.settings.server || "").trim(); if (s) return s.replace(/\/$/, "");
    if (window.__KALO_SERVER__) return String(window.__KALO_SERVER__).replace(/\/$/, "");
    if (/^https?:$/.test(location.protocol) && !/github\.io$/.test(location.hostname)) return location.origin;
    return "";
  }
  function installId() {
    let id = null; try { id = localStorage.getItem(KEY_ID); } catch (_) {}
    if (!id) { const a = new Uint8Array(16); crypto.getRandomValues(a); id = Array.from(a, b => b.toString(16).padStart(2, "0")).join(""); try { localStorage.setItem(KEY_ID, id); } catch (_) {} }
    return id;
  }
  function platform() {
    const ua = navigator.userAgent;
    if (NATIVE) return "ios-app";
    const standalone = window.navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
    const os = /iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : /Mac/.test(ua) ? "mac" : /Windows/.test(ua) ? "windows" : "otro";
    return os + (standalone ? "-pwa" : "-web");
  }
  async function post(path, data) {
    const b = base(); if (!b) throw new Error("sin servidor");
    const url = b + path, bodyS = JSON.stringify(data);
    if (NATIVE && window.KaloNative) { const r = await KaloNative.call("fetch", { url, method: "POST", headers: { "Content-Type": "application/json" }, body: bodyS }); if (r.error) throw new Error(r.error); if (r.status < 200 || r.status >= 300) throw new Error("HTTP " + r.status); return; }
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: bodyS }); if (!r.ok) throw new Error("HTTP " + r.status);
  }

  /* ---------- latido ---------- */
  let last = 0;
  async function ping() {
    if (!S.settings.telemetry || !base()) return;
    if (Date.now() - last < 6 * 3600 * 1000) return; last = Date.now();
    const log = window.__KALO_LOG__ || []; const errs = log.filter(l => /error|Error|@/.test(l) && !/→|←/.test(l));
    try { await post("/api/ping", { id: installId(), v: VERSION, platform: platform(), lang: S.settings.lang || "es", tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ""), errs: errs.length, lastErr: errs.length ? errs[errs.length - 1].slice(0, 300) : "" }); } catch (_) {}
  }
  setTimeout(ping, 4000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) ping(); });

  /* ---------- Ajustes: interruptor ---------- */
  const origSettings = views.settings;
  views.settings = function (p) {
    const h = origSettings(p);
    const row = `<div class="field"><label>Estadísticas de uso anónimas<div class="muted" style="font-size:12px;font-weight:400">Versión, idioma y errores de la app, sin nombre ni datos de salud. Ayudan a mejorar Kalo.</div></div></label><button class="toggle ${S.settings.telemetry ? "on" : ""}" role="switch" aria-checked="${!!S.settings.telemetry}" aria-label="Estadísticas de uso anónimas" onclick="S.settings.telemetry=!S.settings.telemetry;save();render()"></button></div>`;
    return h.replace('<div class="sec">Privacidad y datos</div>\n  <div class="group">', '<div class="sec">Privacidad y datos</div>\n  <div class="group">' + row);
  };

  /* ---------- Ayuda: enviar comentario ---------- */
  function sheetFeedback() {
    sheet(`<h2>Enviar comentario</h2><p class="muted" style="margin:0;font-size:14px">Cuéntanos qué falló o qué mejorarías. Llega directo al equipo de Kalo${base() ? "" : " (sin servidor configurado: se abrirá el correo)"}.</p>
      <div class="group"><div class="field" style="flex-direction:column;align-items:stretch;gap:6px"><label for="fbt">Comentario</label><textarea id="fbt" rows="4" maxlength="2000" placeholder="Qué pasó, en qué pantalla y qué esperabas" style="width:100%;font-size:16px;border:0;background:var(--card2);border-radius:10px;padding:10px"></textarea></div>
      <div class="field" style="flex-direction:column;align-items:stretch;gap:6px"><label for="fbc">Contacto (opcional)</label><input id="fbc" type="text" maxlength="120" placeholder="Correo o teléfono, si quieres respuesta" style="width:100%;text-align:left"></div></div>
      <button class="btn primary" onclick="KaloTelemetry.sendFeedback()">Enviar</button><button class="btn ghost" onclick="closeSheet()">Cancelar</button>`);
  }
  async function sendFeedback() {
    const t = (document.getElementById("fbt") || {}).value || "", c = (document.getElementById("fbc") || {}).value || "";
    if (t.trim().length < 3) { toast("Escribe un comentario"); return; }
    const scr = (window.__KALO_PREV_VIEW__ || cur().v || "");
    if (!base()) { closeSheet(); if (typeof contactSupport === "function") contactSupport(); return; }
    try { await post("/api/feedback", { id: installId(), text: t.trim(), screen: scr, v: VERSION, contact: c.trim() }); closeSheet(); toast("Comentario enviado. ¡Gracias!"); }
    catch (e) { toast("No se pudo enviar: " + e.message); }
  }
  const origHelp = views.help;
  views.help = function (p) {
    const h = origHelp(p);
    const btn = `<button class="row" onclick="KaloTelemetry.sheet()"><div class="ic" style="background:var(--good)">${I.msg}</div><div class="body"><div class="n">Enviar comentario</div><div class="s">Fallos, ideas o lo que te gustaría cambiar · versión ${VERSION}</div></div>${I.chev}</button>`;
    return h.replace('<div class="sec">Contacto</div>\n  <div class="group">', '<div class="sec">Contacto</div>\n  <div class="group">' + btn);
  };
  const origGo = go;
  go = function (v, p) { try { window.__KALO_PREV_VIEW__ = cur().v; } catch (_) {} return origGo(v, p); };

  window.KaloTelemetry = { VERSION, ping, sheet: sheetFeedback, sendFeedback, installId };
})();
