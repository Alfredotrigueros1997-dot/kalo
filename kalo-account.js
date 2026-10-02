/* ===== Kalo cuentas — usuario + contraseña con sincronización =====
 * Servidor: server/kalo_server.py (API /api/*). En la web instalable se usa el mismo origen; en la app nativa
 * la dirección se incrusta en el build (window.__KALO_SERVER__) y se puede cambiar en la pantalla Cuenta.
 * Modelo: la app funciona sin cuenta; con cuenta, los datos (S) se guardan también en el servidor y se recuperan
 * al iniciar sesión en cualquier dispositivo. Último cambio gana (por marca de tiempo).
 */
(function () {
  "use strict";
  const NATIVE = !!(window.__KALO_NATIVE__ && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.kalo);
  function base() {
    const s = (S.settings.server || "").trim();
    if (s) return s.replace(/\/$/, "");
    if (window.__KALO_SERVER__) return String(window.__KALO_SERVER__).replace(/\/$/, "");   // nube (Cloudflare) incrustada en el build
    if (/^https?:$/.test(location.protocol)) return location.origin;                          // web servida por el servidor de la Mac
    return "";
  }
  function acct() { if (S.account === undefined) S.account = null; return S.account; }
  async function req(method, path, data, token) {
    const url = base() + path; if (!base()) throw new Error("Sin servidor configurado");
    const headers = { "Content-Type": "application/json" }; if (token) headers.Authorization = "Bearer " + token;
    let status, text;
    if (NATIVE) {
      const r = await KaloNative.call("fetch", { url, method, headers, body: data ? JSON.stringify(data) : undefined });
      if (r.error) throw new Error("No se pudo conectar: " + r.error); status = r.status; text = r.body;
    } else {
      let r; try { r = await fetch(url, { method, headers, body: data ? JSON.stringify(data) : undefined }); } catch (e) { throw new Error("No se pudo conectar con el servidor"); }
      status = r.status; text = await r.text();
    }
    let j = {}; try { j = JSON.parse(text || "{}"); } catch (_) { throw new Error("Respuesta no válida del servidor (" + status + ")"); }
    if (status >= 400) { const err = new Error(j.error || ("Error " + status)); err.status = status; throw err; }
    return j;
  }

  /* ---------- capacidades del servidor (Google / Apple) ---------- */
  let caps = null;
  async function loadCaps() { if (caps || !base()) return caps; try { caps = await req("GET", "/api/health"); if (!caps || caps.ok === undefined) caps = Object.assign({ ok: true }, caps || {}); } catch (_) { caps = { ok: false }; } if (cur().v === "account" || cur().v === "home") render(); return caps; }
  const noServer = () => !base() || (caps && caps.ok === false);   // sin servidor de cuentas (web publicada sin API)
  setTimeout(() => { if (!acct() || !acct().token) loadCaps(); }, 1500);
  // Vuelta de Google en la web: /#auth=token=…&user=…
  function consumeHashAuth() {
    const m = /[#&]auth=([^&]+)/.exec(location.hash || ""); if (!m) return false;
    const q = new URLSearchParams(decodeURIComponent(m[1])); const token = q.get("token"), user = q.get("user"); if (!token || !user) return false;
    history.replaceState(null, "", location.pathname + location.search);
    finishLogin({ token, user, name: q.get("name") || "", updatedAt: q.get("updatedAt") ? +q.get("updatedAt") : null }, "google");
    return true;
  }
  async function finishLogin(r, how) {
    S.account = { user: r.user, name: r.name, token: r.token, lastSync: null, server: base(), provider: how || "password" };
    if (r.name && !S.profile.name) S.profile.name = r.name;
    if (window.KaloNative) KaloNative.haptic("success");
    if (r.updatedAt) {
      sheet(`<h2>Bienvenido de nuevo</h2><p class="muted" style="margin:0;font-size:14px">Tu cuenta tiene datos guardados el ${new Date(r.updatedAt * 1000).toLocaleString("es")}. ¿Qué hacemos en este dispositivo?</p>
        <button class="btn primary" onclick="closeSheet();KaloAccount.usePull()">Usar los datos de la cuenta (recomendado)</button>
        <button class="btn ghost" onclick="closeSheet();KaloAccount.usePush()">Subir los datos de este dispositivo y reemplazar</button>`, "modal");
    } else { dirty = true; await push(true); save(); tab("home"); toast(`Hola, ${r.name || r.user}`); }
  }

  /* ---------- sincronización ---------- */
  let dirty = false, pushTimer = null, pushing = false;
  function stripForSync(s) { const c = Object.assign({}, s); delete c.account; return c; }
  async function push(force) {
    const a = acct(); if (!a || !a.token || pushing) return;
    if (!dirty && !force) return;
    pushing = true;
    try { const r = await req("PUT", "/api/state", { state: JSON.stringify(stripForSync(S)), clientTime: Date.now() / 1000 }, a.token); a.lastSync = r.updatedAt; a.lastError = null; dirty = false; }
    catch (e) { a.lastError = e.message; if (e.status === 401) { a.token = null; toast("Tu sesión caducó: vuelve a iniciar sesión"); } }
    finally { pushing = false; save(); }
  }
  async function pull() {
    const a = acct(); if (!a || !a.token) return false;
    try {
      const me = await req("GET", "/api/me", null, a.token);
      if (me.updatedAt && (!a.lastSync || me.updatedAt > a.lastSync + 1) && !dirty) {
        const r = await req("GET", "/api/state", null, a.token);
        if (r.state) { const st = JSON.parse(r.state); if (st && st.diary) { st.account = a; S = migrate(st); a.lastSync = r.updatedAt; save(); render(); toast("Datos actualizados desde tu cuenta"); return true; } }
      }
      a.lastError = null;
    } catch (e) { a.lastError = e.message; if (e.status === 401) { a.token = null; save(); } }
    return false;
  }
  const origSave = save;
  save = function () { origSave(); if (acct() && acct().token) { dirty = true; clearTimeout(pushTimer); pushTimer = setTimeout(() => push(), 4000); } };
  window.addEventListener("pagehide", () => { if (dirty) push(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
  setTimeout(() => { if (!consumeHashAuth()) pull(); }, 300);
  window.addEventListener("hashchange", consumeHashAuth);

  /* ---------- pantalla Cuenta ---------- */
  views.account = function (p) {
    const a = acct(); p.mode = p.mode || "login"; if (!caps) loadCaps();
    if (!(a && a.token) && noServer()) {
      return nav("Cuenta") + `<div class="wrap"><div class="card"><b>Esta versión de prueba no tiene cuentas</b><div class="muted" style="font-size:14px;margin-top:6px">Tus datos se guardan solo en este dispositivo. Puedes exportarlos en Más › Ajustes › Copia de seguridad. Las cuentas y la sincronización llegarán con el servidor de Kalo.</div></div></div>`;
    }
    if (a && a.token) {
      return nav("Cuenta") + `<div class="wrap">
        <div class="card" style="display:flex;gap:14px;align-items:center"><div class="avatar">${esc((a.name || a.user)[0].toUpperCase())}</div><div style="flex:1"><div style="font-weight:700;font-size:18px">${esc(a.name || a.user)}</div><div class="muted" style="font-size:13px">${esc(a.user)}${a.provider === "google" ? " · Google" : ""}</div><div class="muted" style="font-size:12.5px">${a.lastSync ? "Sincronizado " + new Date(a.lastSync * 1000).toLocaleString("es") : "Sin sincronizar todavía"}${a.lastError ? ` · <span style="color:var(--bad)">${esc(a.lastError)}</span>` : ""}</div></div></div>
        <div class="group">
          <button class="row" onclick="KaloAccount.syncNow()"><div class="body"><div class="n">Sincronizar ahora</div><div class="s">Sube los datos de este dispositivo y baja los cambios de otros</div></div>${I.chev}</button>
          ${a.provider === "google" ? "" : `<button class="row" onclick="KaloAccount.passwordSheet()"><div class="body"><div class="n">Cambiar contraseña</div></div>${I.chev}</button>`}
          <button class="row" onclick="KaloAccount.logoutSheet()"><div class="body"><div class="n" style="color:var(--bad)">Cerrar sesión</div></div></button>
        </div>
        <div class="muted" style="font-size:12.5px;padding:0 4px">Tus datos viajan cifrados (https) y se guardan cifrados en el servidor de Kalo y en este dispositivo.</div>
      </div>`;
    }
    const g = caps && caps.google, ap = caps && caps.apple, reg = p.mode === "register";
    const G = `<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.6-5.9c-2.1 1.4-4.8 2.3-8 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>`;
    return nav("Cuenta") + `<div class="wrap">
      <div style="text-align:center;padding:6px 0 2px"><div class="avatar" style="margin:0 auto 10px">K</div><h2 style="font-size:21px;font-weight:700">Tus datos, en todos tus dispositivos</h2><div class="muted" style="font-size:13.5px;margin-top:4px">Entra una vez y tus registros te siguen al iPhone, al iPad o al navegador.</div></div>
      ${g ? `<button class="btn ghost" style="gap:10px" onclick="KaloAccount.google()">${G} Continuar con Google</button>` : ""}
      ${ap ? `<button class="btn primary" style="background:#000;color:#fff;gap:10px" onclick="KaloAccount.apple()"> Continuar con Apple</button>` : ""}
      ${(g || ap) ? `<div style="display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12.5px"><span style="flex:1;height:1px;background:var(--line)"></span>o con tu correo<span style="flex:1;height:1px;background:var(--line)"></span></div>` : `<div class="muted" style="font-size:12.5px;text-align:center">${caps && caps.ok === false ? "Sin conexión con el servidor" : "Con tu correo y una contraseña"}</div>`}
      <div class="group">
        ${reg ? `<div class="field"><label for="acn">Nombre</label><input id="acn" type="text" autocapitalize="words" placeholder="¿Cómo te llamas?" value="${esc(S.profile.name || "")}" style="width:170px"></div>` : ""}
        <div class="field"><label for="acu">Correo</label><input id="acu" type="email" inputmode="email" autocapitalize="off" autocorrect="off" autocomplete="username" placeholder="tu@correo.com" value="${esc(p.user || "")}" style="width:190px"></div>
        <div class="field"><label for="acp">Contraseña</label><input id="acp" type="password" autocomplete="${reg ? "new-password" : "current-password"}" placeholder="${reg ? "mínimo 8 caracteres" : "tu contraseña"}" style="width:170px" onkeydown="if(event.key==='Enter')KaloAccount.submit()"></div>
      </div>
      ${p.err ? `<div class="card" style="border-left:4px solid var(--bad)"><div style="font-size:14px">${esc(p.err)}</div></div>` : ""}
      <button class="btn primary" id="acbtn" onclick="KaloAccount.submit()">${reg ? "Crear mi cuenta" : "Entrar"}</button>
      <button class="btn soft" onclick="cur().p.mode='${reg ? "login" : "register"}';cur().p.err='';render()">${reg ? "Ya tengo cuenta" : "Soy nuevo: crear cuenta"}</button>
      <details style="font-size:12.5px;color:var(--muted)"><summary>Opciones avanzadas</summary><div class="group" style="margin-top:8px"><div class="field"><label for="acs">Servidor</label><input id="acs" type="url" autocapitalize="off" autocorrect="off" placeholder="${esc(base() || "https://…")}" value="${esc(S.settings.server || "")}" style="width:190px" oninput="S.settings.server=this.value.trim();caps=null;save()"></div></div></details>
      <div class="muted" style="font-size:12.5px;text-align:center">Sin cuenta la app funciona igual: los datos se quedan solo en este dispositivo.</div>
    </div>`;
  };

  window.KaloAccount = {
    async submit() {
      const p = cur().p; const user = (document.getElementById("acu") || {}).value || ""; const pass = (document.getElementById("acp") || {}).value || "";
      p.user = user; p.err = "";
      if (!user) { p.err = "Escribe tu correo"; render(); return; } if (pass.length < (p.mode === "register" ? 8 : 1)) { p.err = p.mode === "register" ? "La contraseña debe tener al menos 8 caracteres" : "Escribe tu contraseña"; render(); return; }
      const btn = document.getElementById("acbtn"); if (btn) { btn.disabled = true; btn.textContent = "Conectando…"; }
      try {
        const name = (document.getElementById("acn") || {}).value || S.profile.name || "";
        const r = await req("POST", p.mode === "register" ? "/api/register" : "/api/login", p.mode === "register" ? { user, pass, name } : { user, pass });
        await finishLogin(r, "password");
      } catch (e) { p.err = e.status === 401 && p.mode === "login" && /incorrectos/.test(e.message) ? "Correo o contraseña incorrectos. Si eres nuevo, toca «Soy nuevo: crear cuenta»." : e.message; render(); }
    },
    async google() {
      const url = base() + "/auth/google/start?mode=" + (NATIVE ? "app" : "web");
      if (!NATIVE) { location.href = url; return; }
      try { const r = await KaloNative.call("oauth", { url, scheme: "kalo" }); if (r && r.url) { const q = new URLSearchParams(r.url.split("?")[1] || ""); if (q.get("token")) await finishLogin({ token: q.get("token"), user: q.get("user"), name: q.get("name") || "", updatedAt: q.get("updatedAt") ? +q.get("updatedAt") : null }, "google"); else toast("Google no devolvió la sesión"); } else if (r && r.error && !/cancel/i.test(r.error)) toast(r.error); }
      catch (e) { toast("Actualiza la app para entrar con Google"); }
    },
    apple() { toast("Disponible cuando la app esté en el programa de desarrolladores de Apple"); },
    async usePull() { const a = acct(); try { const r = await req("GET", "/api/state", null, a.token); const st = JSON.parse(r.state); st.account = a; S = migrate(st); a.lastSync = r.updatedAt; dirty = false; save(); tab("home"); toast(`Hola, ${a.name || a.user}: tus datos están listos`); } catch (e) { toast("No se pudieron bajar los datos: " + e.message); } },
    async usePush() { dirty = true; await push(true); save(); tab("home"); toast("Datos de este dispositivo subidos a la cuenta"); },
    async syncNow() { toast("Sincronizando…"); dirty = true; await push(true); const pulled = await pull(); if (!pulled) render(); toast(acct().lastError ? "Error: " + acct().lastError : "Sincronizado"); },
    passwordSheet() { sheet(`<h2>Cambiar contraseña</h2><div class="group"><div class="field"><label for="pw0">Actual</label><input id="pw0" type="password" style="width:160px"></div><div class="field"><label for="pw1">Nueva</label><input id="pw1" type="password" style="width:160px"></div><div class="field"><label for="pw2">Repite la nueva</label><input id="pw2" type="password" style="width:160px"></div></div><button class="btn primary" onclick="KaloAccount.changePassword()">Guardar</button>`); },
    async changePassword() { const o = document.getElementById("pw0").value, n = document.getElementById("pw1").value, n2 = document.getElementById("pw2").value; if (n !== n2) { toast("Las contraseñas nuevas no coinciden"); return; } try { await req("POST", "/api/password", { old: o, new: n }, acct().token); closeSheet(); toast("Contraseña cambiada"); } catch (e) { toast(e.message); } },
    logoutSheet() { sheet(`<h2>Cerrar sesión</h2><p class="muted" style="margin:0;font-size:14px">Antes se sincronizan tus últimos cambios.</p><button class="btn primary" onclick="closeSheet();KaloAccount.logout(false)">Cerrar sesión y conservar los datos en este dispositivo</button><button class="btn danger" onclick="closeSheet();KaloAccount.logout(true)">Cerrar sesión y borrar los datos de este dispositivo</button><button class="btn ghost" onclick="closeSheet()">Cancelar</button>`); },
    async logout(wipe) { const a = acct(); if (a && a.token) { dirty = true; await push(true); try { await req("POST", "/api/logout", {}, a.token); } catch (_) {} } S.account = null; if (wipe) { S = migrate(emptyState()); S.onboarded = false; save(); stack = [{ v: "onboarding", p: {} }]; render(); } else { save(); tab("home"); } toast("Sesión cerrada"); },
    base, req,
  };

  /* ---------- acceso: fila en Más y aviso en Panel ---------- */
  const origMore = views.more;
  views.more = function (p) {
    const a = acct(); const row = `<div class="group"><button class="row" onclick="go('account')"><div class="ic" style="background:var(--accent)">${I.user}</div><div class="body"><div class="n">${a && a.token ? "Cuenta · @" + esc(a.user) : "Cuenta"}</div><div class="s">${a && a.token ? (a.lastError ? "Error de sincronización" : "Sincronizada" + (a.lastSync ? " · " + new Date(a.lastSync * 1000).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "")) : "Crea un usuario para usar tus datos en cualquier dispositivo"}</div></div>${I.chev}</button></div>`;
    const h = origMore(p); const i = h.indexOf('<div class="group">'); return i >= 0 ? h.slice(0, i) + row + h.slice(i) : h + row;
  };
  const origHome = views.home;
  views.home = function (p) { const h = origHome(p); const a = acct(); if ((a && a.token) || noServer()) return h; const card = `<button class="card" style="text-align:left;display:flex;gap:12px;align-items:center" onclick="go('account')"><div class="ic" style="width:40px;height:40px;border-radius:12px;background:var(--carb);display:grid;place-items:center;color:#fff;flex:none">${I.user}</div><div style="flex:1"><div style="font-weight:600">Crea tu cuenta</div><div class="muted" style="font-size:13px">Usuario y contraseña para tener tus datos en cualquier dispositivo</div></div>${I.chev}</button>`; const i = h.indexOf('<div class="sec">Descubrir</div>'); return i >= 0 ? h.slice(0, i) + card + h.slice(i) : h; };
})();
