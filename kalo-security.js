/* ===== Kalo seguridad — bloqueo de la app =====
 * PIN de 4–6 dígitos (hash SHA-256 con sal, nunca en claro) y, en la app del iPhone, Face ID / Touch ID vía puente nativo
 * (tipo "authenticate"). Bloqueo al abrir y al volver del segundo plano tras el tiempo elegido. 5 fallos → espera creciente.
 */
(function () {
  "use strict";
  const NATIVE = !!(window.__KALO_NATIVE__ && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.kalo);
  function SEC() { S.security = S.security || { enabled: false, pinHash: null, salt: null, bio: false, after: 60, fails: 0, until: 0 }; return S.security; }
  async function sha(text) {
    if (window.crypto && crypto.subtle) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, "0")).join(""); }
    let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return "fnv:" + h.toString(16);   // solo si no hay WebCrypto
  }
  const rnd = () => Array.from(crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(12)) : [Date.now() % 251], x => x.toString(16).padStart(2, "0")).join("");
  let hiddenAt = 0, locked = false, entry = "";

  /* ---------- pantalla de bloqueo ---------- */
  function lockHtml(msg) {
    const s = SEC(); const wait = Math.max(0, Math.ceil((s.until - Date.now()) / 1000));
    return `<div id="kalolock" style="position:absolute;inset:0;z-index:200;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;padding-top:calc(24px + env(safe-area-inset-top,0px))">
      <div style="width:64px;height:64px;border-radius:18px;background:var(--accent);display:grid;place-items:center;color:var(--accent-ink);font-family:var(--num);font-weight:800;font-size:30px">K</div>
      <div style="font-weight:700;font-size:19px">${wait ? `Espera ${wait} s` : "Introduce tu PIN"}</div>
      <div style="display:flex;gap:12px" aria-label="PIN">${Array.from({ length: Math.max(s.pinLen || 4, entry.length) }, (_, i) => `<span style="width:14px;height:14px;border-radius:50%;background:${i < entry.length ? "var(--accent)" : "var(--ring-track)"}"></span>`).join("")}</div>
      <div style="min-height:20px;color:var(--bad);font-size:13.5px">${esc(msg || "")}</div>
      <div style="display:grid;grid-template-columns:repeat(3,72px);gap:12px">${["1", "2", "3", "4", "5", "6", "7", "8", "9", NATIVE && SEC().bio ? "bio" : "", "0", "del"].map(k => k === "" ? "<span></span>" : `<button class="klk" data-k="${k}" style="height:64px;border-radius:50%;background:var(--card);box-shadow:var(--shadow);font-family:var(--num);font-size:24px;font-weight:600;display:grid;place-items:center" aria-label="${k === "del" ? "Borrar" : k === "bio" ? "Face ID" : k}">${k === "del" ? "⌫" : k === "bio" ? "☺" : k}</button>`).join("")}</div>
      <button class="klk" data-k="ok" style="padding:12px 28px;border-radius:12px;background:var(--accent);color:var(--accent-ink);font-weight:600">Entrar</button>
    </div>`;
  }
  function showLock(msg) {
    locked = true; entry = "";
    let el = document.getElementById("kalolock"); if (el) el.remove();
    document.getElementById("phone").insertAdjacentHTML("beforeend", lockHtml(msg));
    document.getElementById("kalolock").addEventListener("click", ev => { const b = ev.target.closest(".klk"); if (b) keyTap(b.dataset.k); });
    if (NATIVE && SEC().bio && !msg) bioTry();
  }
  function hideLock() { locked = false; const el = document.getElementById("kalolock"); if (el) el.remove(); }
  function refreshLock(msg) { const el = document.getElementById("kalolock"); if (el) { el.outerHTML = lockHtml(msg); document.getElementById("kalolock").addEventListener("click", ev => { const b = ev.target.closest(".klk"); if (b) keyTap(b.dataset.k); }); } }
  async function keyTap(k) {
    const s = SEC(); if (Date.now() < s.until) { refreshLock(`Espera ${Math.ceil((s.until - Date.now()) / 1000)} s`); return; }
    if (k === "bio") { bioTry(); return; }
    if (k === "del") { entry = entry.slice(0, -1); refreshLock(""); return; }
    if (k === "ok") { await checkPin(); return; }
    if (entry.length < 6) { entry += k; refreshLock(""); if (entry.length >= 4 && entry.length === (s.pinLen || 4)) await checkPin(); }
  }
  async function checkPin() {
    const s = SEC(); if (!entry) return;
    const ok = (await sha(s.salt + entry)) === s.pinHash;
    if (ok) { s.fails = 0; s.until = 0; save(); hideLock(); if (window.KaloNative) KaloNative.haptic("success"); return; }
    s.fails = (s.fails || 0) + 1; entry = "";
    if (s.fails >= 5) { s.until = Date.now() + Math.min(300, 30 * Math.pow(2, s.fails - 5)) * 1000; }
    save(); if (window.KaloNative) KaloNative.haptic("error");
    refreshLock(s.fails >= 5 ? `Demasiados intentos: espera ${Math.ceil((s.until - Date.now()) / 1000)} s` : `PIN incorrecto (${s.fails} de 5)`);
  }
  async function bioTry() {
    try { const r = await KaloNative.call("authenticate", { reason: "Desbloquear Kalo" }); if (r && r.ok) { SEC().fails = 0; save(); hideLock(); } else if (r && r.error && !/cancel/i.test(r.error)) refreshLock(r.error); }
    catch (e) { refreshLock(""); }
  }
  function maybeLock() { const s = SEC(); if (!s.enabled || !s.pinHash) return; if (!locked) showLock(""); }
  document.addEventListener("visibilitychange", () => {
    const s = SEC(); if (!s.enabled) return;
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt >= (s.after || 0) * 1000) maybeLock();
  });
  window.addEventListener("pagehide", () => { hiddenAt = Date.now(); });
  setTimeout(maybeLock, 50);

  /* ---------- ajustes ---------- */
  async function setPin(newPin) { const s = SEC(); s.salt = rnd(); s.pinHash = await sha(s.salt + newPin); s.pinLen = newPin.length; s.enabled = true; s.fails = 0; s.until = 0; save(); }
  window.KaloSecurity = {
    setupSheet(change) {
      sheet(`<h2>${change ? "Cambiar PIN" : "Crear PIN"}</h2><p class="muted" style="margin:0;font-size:14px">De 4 a 6 dígitos. Lo pediremos al abrir la app${NATIVE ? " (o Face ID / Touch ID si lo activas)" : ""}.</p>
        <div class="group">${change ? `<div class="field"><label for="pin0">PIN actual</label><input id="pin0" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" style="width:120px"></div>` : ""}<div class="field"><label for="pin1">Nuevo PIN</label><input id="pin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" style="width:120px" autofocus></div><div class="field"><label for="pin2">Repite el PIN</label><input id="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" style="width:120px"></div></div>
        <button class="btn primary" onclick="KaloSecurity.savePin(${!!change})">Guardar</button>`);
    },
    async savePin(change) {
      const s = SEC(); const p1 = (document.getElementById("pin1") || {}).value || "", p2 = (document.getElementById("pin2") || {}).value || "";
      if (!/^\d{4,6}$/.test(p1)) { toast("El PIN debe tener de 4 a 6 dígitos"); return; }
      if (p1 !== p2) { toast("Los PIN no coinciden"); return; }
      if (/^(\d)\1+$/.test(p1) || "0123456789".includes(p1) || "9876543210".includes(p1)) { toast("Elige un PIN menos obvio"); return; }
      if (change) { const p0 = (document.getElementById("pin0") || {}).value || ""; if ((await sha(s.salt + p0)) !== s.pinHash) { toast("PIN actual incorrecto"); return; } }
      await setPin(p1); closeSheet(); render(); toast(change ? "PIN cambiado" : "Bloqueo activado");
    },
    async disable() { const s = SEC(); sheet(`<h2>Desactivar bloqueo</h2><div class="group"><div class="field"><label for="pinx">PIN actual</label><input id="pinx" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" style="width:120px" autofocus></div></div><button class="btn danger" onclick="KaloSecurity.disableNow()">Desactivar</button>`); },
    async disableNow() { const s = SEC(); const p = (document.getElementById("pinx") || {}).value || ""; if ((await sha(s.salt + p)) !== s.pinHash) { toast("PIN incorrecto"); return; } s.enabled = false; s.pinHash = null; s.bio = false; save(); closeSheet(); render(); toast("Bloqueo desactivado"); },
    setAfter(v) { SEC().after = +v; save(); },
    async toggleBio() { const s = SEC(); if (!s.bio) { try { const r = await KaloNative.call("authenticate", { reason: "Activar Face ID para Kalo" }); if (!(r && r.ok)) { toast(r && r.error ? r.error : "No disponible"); return; } } catch (e) { toast("Face ID no disponible"); return; } } s.bio = !s.bio; save(); render(); },
    lockNow() { maybeLock(); },
  };
  const origSettings = views.settings;
  views.settings = function (p) {
    const h = origSettings(p); const s = SEC();
    const extra = `<div class="sec">Seguridad</div><div class="group">
      ${s.enabled ? `<div class="field"><label>Bloqueo con PIN<div class="muted" style="font-size:12.5px;font-weight:400">Activo</div></label><button class="btn sm ghost" onclick="KaloSecurity.disable()">Desactivar</button></div>
      <button class="row" onclick="KaloSecurity.setupSheet(true)"><div class="body"><div class="n">Cambiar PIN</div></div>${I.chev}</button>
      ${NATIVE ? `<div class="field"><label>Face ID / Touch ID</label><button class="toggle ${s.bio ? "on" : ""}" role="switch" aria-checked="${!!s.bio}" aria-label="Face ID" onclick="KaloSecurity.toggleBio()"></button></div>` : ""}
      <div class="field"><label for="lkafter">Bloquear al volver tras</label><select id="lkafter" onchange="KaloSecurity.setAfter(this.value)">${[[0, "Inmediatamente"], [60, "1 minuto"], [300, "5 minutos"], [900, "15 minutos"]].map(([v, l]) => `<option value="${v}" ${(s.after || 0) === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <button class="row" onclick="KaloSecurity.lockNow()"><div class="body"><div class="n">Bloquear ahora</div></div></button>` :
      `<div class="field"><label>Bloqueo con PIN<div class="muted" style="font-size:12.5px;font-weight:400">Pide un PIN${NATIVE ? " o Face ID" : ""} al abrir la app</div></label><button class="btn sm soft" onclick="KaloSecurity.setupSheet(false)">Activar</button></div>`}
      <div class="field"><label>Datos en este dispositivo</label><span class="muted" style="font-size:12.5px;text-align:right;max-width:55%">${NATIVE ? "Cifrados por iOS (Protección de datos)" : "Almacenamiento del navegador"}</span></div>
    </div>`;
    const marker = '<div class="muted" style="text-align:center;font-size:12px">Versión';
    return h.includes(marker) ? h.replace(marker, extra + marker) : h + extra;
  };
})();
