/* ===== Kalo · Plan de déficit sostenible =====
 * Encuesta: peso actual · altura · peso deseado · nivel de actividad (+ sexo y edad si faltan, necesarios para la TMB).
 * Análisis (criterio dietético):
 *   · TMB Mifflin-St Jeor × factor de actividad = gasto (TDEE)
 *   · déficit sostenible = 10–25 % del gasto (≈ 300–600 kcal/día); recomendado según IMC; nunca por debajo de la TMB
 *     ni de 1 200 kcal (mujer) / 1 500 kcal (hombre)
 *   · ritmo objetivo 0,5–1 % del peso corporal por semana; se simula semana a semana recalculando el gasto
 *     con el nuevo peso (adaptación) y con una semana de mantenimiento cada 8 semanas ("descanso de dieta")
 *   · proteína 1,8 g/kg (déficit) · grasa 25–30 % · resto carbohidrato · fibra 25–35 g · agua 35 ml/kg · pasos 8–10 k
 *   · revisión cada 4 semanas o si el peso cambia ≥ 3 kg
 */
(function () {
  "use strict";
  const ACT = ["Sedentario", "Ligeramente activo", "Activo", "Muy activo"];
  const ACT_DESC = { "Sedentario": "Trabajo de oficina, casi sin ejercicio", "Ligeramente activo": "Caminas a diario o entrenas 1–3 días", "Activo": "Entrenas 3–5 días por semana", "Muy activo": "Trabajo físico o entrenas 6–7 días" };
  const KCAL_KG = 7700;
  function D() { S.deficit = S.deficit || {}; return S.deficit; }

  /* ---------- análisis ---------- */
  function analyze(inp, pct) {
    const { w, h, goal, act, sex, age } = inp;
    const bmi = w / Math.pow(h / 100, 2);
    const healthy = [18.5 * Math.pow(h / 100, 2), 24.9 * Math.pow(h / 100, 2)];
    const m0 = mifflin(sex, age, h, w, act);
    const mode = goal < w - 0.5 ? "perder" : goal > w + 0.5 ? "ganar" : "mantener";
    const recPct = mode !== "perder" ? 0 : bmi >= 30 ? 20 : bmi >= 25 ? 15 : 12;
    const p = pct == null ? recPct : pct;
    const floor = Math.max(m0.bmr, sex === "M" ? 1500 : 1200);
    let kcal = mode === "perder" ? Math.max(floor, Math.round(m0.tdee * (1 - p / 100) / 10) * 10) : mode === "ganar" ? Math.round(m0.tdee * (1 + p / 100) / 10) * 10 : m0.tdee;
    const deficit = m0.tdee - kcal;
    const weekly = deficit * 7 / KCAL_KG;          // kg/semana (positivo = pérdida)
    const pctBW = weekly / w * 100;
    // simulación semanal con adaptación + descansos de dieta
    const proj = [{ week: 0, kg: w, kcal }]; let cw = w, weeks = 0, breaks = 0, capped = false;
    if (mode !== "mantener") {
      for (let k = 1; k <= 156; k++) {
        const m = mifflin(sex, age, h, cw, act);
        const isBreak = mode === "perder" && k % 9 === 0 && (Math.abs(cw - goal) > 1.5);
        const kk = isBreak ? m.tdee : mode === "perder" ? Math.max(floor, Math.round(m.tdee * (1 - p / 100))) : Math.round(m.tdee * (1 + p / 100));
        const delta = (m.tdee - kk) * 7 / KCAL_KG;
        cw = cw - delta; if (isBreak) breaks++;
        proj.push({ week: k, kg: Math.round(cw * 10) / 10, kcal: kk, brk: isBreak });
        if ((mode === "perder" && cw <= goal) || (mode === "ganar" && cw >= goal)) { weeks = k; break; }
        if (k === 156) { weeks = k; capped = true; }
      }
    }
    const protein = Math.round(Math.min(2.2 * Math.max(goal, w * 0.8), (mode === "perder" ? 1.8 : mode === "ganar" ? 1.7 : 1.5) * w));
    const fat = Math.round(kcal * (mode === "perder" ? 0.27 : 0.30) / 9);
    const carbs = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4));
    const pctP = Math.round(protein * 4 / kcal * 100), pctF = Math.round(fat * 9 / kcal * 100), pctC = 100 - pctP - pctF;
    const goalDate = weeks ? addDays(TODAY, weeks * 7) : null;
    const warnings = [];
    if (mode === "perder" && goal < healthy[0]) warnings.push(`El peso deseado (${wFmt(goal)}) queda por debajo del rango saludable para tu altura (${wFmt(healthy[0])}–${wFmt(healthy[1])}). Te propongo apuntar primero a ${wFmt(Math.ceil(healthy[0]))}.`);
    if (mode === "perder" && kcal === floor && deficit > 0) warnings.push("Las calorías tocan el mínimo seguro: no bajes de ahí; si quieres ir más rápido, añade actividad en lugar de recortar más comida.");
    if (mode === "perder" && pctBW > 1) warnings.push("Más del 1 % del peso por semana: es un ritmo agresivo; reduce el porcentaje para conservar músculo y energía.");
    if (mode === "perder" && Math.abs(pctBW) < 0.25 && deficit > 0) warnings.push("Ritmo muy suave: es sostenible, pero notarás cambios lentos; combínalo con más pasos y fuerza.");
    if (capped) warnings.push("Con este ritmo tardarías más de 3 años: elige un déficit mayor o un objetivo intermedio.");
    return { bmi, healthy, bmr: m0.bmr, tdee: m0.tdee, mode, pct: p, recPct, kcal, deficit, weekly, pctBW, proj, weeks, breaks, goalDate, protein, fat, carbs, pctP, pctF, pctC, floor, water: Math.round(w * 35 / 250) * 250, steps: mode === "perder" ? 9000 : 8000, warnings };
  }
  function bmiLabel(b) { return b < 18.5 ? "bajo peso" : b < 25 ? "peso saludable" : b < 30 ? "sobrepeso" : "obesidad"; }
  function chart(proj, goal) {
    const W = 330, H = 150, pad = { l: 34, r: 10, t: 12, b: 22 }; const n = proj.length; if (n < 2) return "";
    const ys = proj.map(p => p.kg); const mn = Math.floor(Math.min(...ys, goal) - 1), mx = Math.ceil(Math.max(...ys) + 1);
    const X = i => pad.l + i / (n - 1) * (W - pad.l - pad.r), Y = v => pad.t + (1 - (v - mn) / (mx - mn || 1)) * (H - pad.t - pad.b);
    const pts = proj.map((p, i) => `${X(i).toFixed(1)},${Y(p.kg).toFixed(1)}`).join(" ");
    const ticks = []; const step = Math.max(1, Math.ceil((mx - mn) / 4)); for (let v = mn; v <= mx; v += step) ticks.push(v);
    const brk = proj.map((p, i) => p.brk ? `<rect x="${X(i - 1)}" y="${pad.t}" width="${X(i) - X(i - 1)}" height="${H - pad.t - pad.b}" fill="var(--energy)" opacity=".18"/>` : "").join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="font-family:var(--sys)">${brk}${ticks.map(v => `<g><line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${pad.l - 6}" y="${Y(v) + 4}" font-size="10" text-anchor="end" fill="var(--muted)">${r0(wKg2Disp(v))}</text></g>`).join("")}<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(goal)}" y2="${Y(goal)}" stroke="var(--accent)" stroke-dasharray="4 4"/><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/><text x="${pad.l}" y="${H - 6}" font-size="10" fill="var(--muted)">hoy</text><text x="${W - pad.r}" y="${H - 6}" font-size="10" text-anchor="end" fill="var(--muted)">semana ${n - 1}</text></svg>`;
  }

  /* ---------- encuesta ---------- */
  views.deficit = function (p) {
    const d = D(); p.step = p.step || 0;
    const inp = p.inp = p.inp || { w: lastW().kg, h: S.profile.height || 170, goal: S.goals.weight || lastW().kg, act: S.profile.activity || "Ligeramente activo", sex: S.profile.sex || "M", age: S.profile.age || 30 };
    const u = unitW(), hu = unitH();
    const steps = [
      ["¿Cuál es tu peso actual?", `<div class="group"><div class="field"><label for="dw">Peso (${u})</label><input id="dw" type="number" inputmode="decimal" step="0.1" value="${nv(wKg2Disp(inp.w))}" oninput="cur().p.inp.w=wDisp2Kg(+this.value)||cur().p.inp.w"></div></div><div class="muted" style="font-size:13px">Pésate por la mañana, tras ir al baño y antes de desayunar: es la medida más estable.</div>`],
      ["¿Cuánto mides?", `<div class="group"><div class="field"><label for="dh">Altura (${hu})</label><input id="dh" type="number" inputmode="decimal" step="0.5" value="${hDisp(inp.h)}" oninput="cur().p.inp.h=hParse(+this.value)||cur().p.inp.h"></div></div>${u === "lb" ? '<div class="muted" style="font-size:13px">En pulgadas: 5 ft 9 in = 69.</div>' : ""}`],
      ["¿Cuál es tu peso deseado?", `<div class="group"><div class="field"><label for="dg">Peso deseado (${u})</label><input id="dg" type="number" inputmode="decimal" step="0.1" value="${nv(wKg2Disp(inp.goal))}" oninput="cur().p.inp.goal=wDisp2Kg(+this.value)||cur().p.inp.goal"></div></div><div class="muted" style="font-size:13px">Si aún no lo tienes claro, pon un objetivo intermedio: siempre podrás ajustarlo.</div>`],
      ["¿Cuál es tu nivel de actividad?", `<div class="fx-tiles" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${ACT.map(a => `<button class="fx-tile ${inp.act === a ? "on" : ""}" style="background:var(--card);border:2px solid ${inp.act === a ? "var(--accent)" : "transparent"};border-radius:14px;padding:14px 10px;display:flex;flex-direction:column;gap:4px;align-items:center;text-align:center;box-shadow:var(--shadow)${inp.act === a ? ";background:var(--accent-soft)" : ""}" onclick="cur().p.inp.act='${a}';render()"><b style="font-size:15px">${a}</b><span style="font-size:12px;color:var(--muted);line-height:1.25">${ACT_DESC[a]}</span></button>`).join("")}</div>`],
      ["Dos datos más para calcular tu gasto", `<div class="group"><div class="field"><label for="ds">Sexo</label><select id="ds" onchange="cur().p.inp.sex=this.value"><option value="M" ${inp.sex === "M" ? "selected" : ""}>Hombre</option><option value="F" ${inp.sex === "F" ? "selected" : ""}>Mujer</option></select></div><div class="field"><label for="da">Edad</label><input id="da" type="number" inputmode="numeric" value="${inp.age}" oninput="cur().p.inp.age=+this.value||cur().p.inp.age"></div></div><div class="muted" style="font-size:13px">La tasa metabólica basal (fórmula Mifflin-St Jeor) depende de estos dos datos.</div>`],
    ];
    if (p.step >= steps.length) return deficitResult(p);
    const [t, body] = steps[p.step];
    return nav("Tu plan", { left: `<button onclick="${p.step > 0 ? "cur().p.step--;render()" : "back()"}">${I.back}${p.step > 0 ? "Anterior" : "Salir"}</button>` }) + `<div class="wrap">
      <div class="csteps" style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px">${steps.map((s, i) => `<i style="display:block;height:6px;border-radius:3px;background:${i <= p.step ? "var(--accent)" : "var(--ring-track)"};opacity:${i < p.step ? ".45" : "1"}"></i>`).join("")}</div>
      <h2 style="font-size:21px;font-weight:700">${t}</h2>
      ${body}
      <button class="btn primary" onclick="KaloDeficit.next()">${p.step < steps.length - 1 ? "Siguiente" : "Ver mi análisis"}</button>
    </div>`;
  };
  function deficitResult(p) {
    const inp = p.inp; const A = analyze(inp, p.pct); const u = unitW();
    const opts = A.mode === "perder" ? [10, 15, 20, 25] : A.mode === "ganar" ? [5, 10, 15] : [];
    return nav("Tu análisis", { left: `<button onclick="cur().p.step=4;render()">${I.back}Datos</button>` }) + `<div class="wrap">
      <div class="premium-hero" style="background:linear-gradient(135deg,#1F8A5F,#0E4F3C)"><h2>${A.mode === "perder" ? "Déficit sostenible" : A.mode === "ganar" ? "Superávit controlado" : "Mantenimiento"}: ${r0(A.kcal)} kcal/día</h2><p>${A.mode === "mantener" ? "Tu peso deseado coincide con el actual: comer alrededor de tu gasto lo mantiene." : `${A.mode === "perder" ? "Pierdes" : "Ganas"} ≈ ${r1(wKg2Disp(Math.abs(A.weekly)))} ${u}/semana (${Math.abs(A.pctBW).toFixed(1)} % del peso) · objetivo ${wFmt(inp.goal)} en unas ${A.weeks} semanas${A.goalDate ? " (" + longDate(A.goalDate) + ")" : ""}${A.breaks ? `, con ${A.breaks} semana${A.breaks > 1 ? "s" : ""} de mantenimiento intercalada${A.breaks > 1 ? "s" : ""}` : ""}.`}</p></div>
      <div class="card"><h3>Tu punto de partida</h3><table class="table" style="margin-top:6px"><tr><td>IMC</td><td>${A.bmi.toFixed(1)} · ${bmiLabel(A.bmi)}</td></tr><tr><td>Rango saludable para tu altura</td><td>${wFmt(A.healthy[0])} – ${wFmt(A.healthy[1])}</td></tr><tr><td>Tasa metabólica basal</td><td>${r0(A.bmr)} kcal</td></tr><tr><td>Gasto diario estimado (${inp.act.toLowerCase()})</td><td>${r0(A.tdee)} kcal</td></tr><tr><td>Diferencia con tu peso deseado</td><td>${wFmt(Math.abs(inp.w - inp.goal))}</td></tr></table></div>
      ${opts.length ? `<div class="card"><h3>Ajusta el ritmo <small>${A.mode === "perder" ? "déficit" : "superávit"} sobre tu gasto</small></h3><div class="seg" style="margin-top:10px">${opts.map(o => `<button class="${A.pct === o ? "on" : ""}" onclick="cur().p.pct=${o};render()">${o} %${o === A.recPct ? " ★" : ""}</button>`).join("")}</div><div class="muted" style="font-size:12.5px;margin-top:8px">★ recomendado para tu IMC. ${A.mode === "perder" ? "Entre 10 y 20 % es lo que la evidencia asocia a mejor adherencia y conservación de músculo; 25 % solo en periodos cortos." : "5–10 % permite ganar masa con poca grasa."}</div></div>` : ""}
      ${A.warnings.map(w => `<div class="card" style="border-left:4px solid var(--warn)"><div style="font-size:13.5px;line-height:1.4">${esc(w)}</div></div>`).join("")}
      <div class="card"><h3>Proyección de peso <small>semana a semana</small></h3><div style="margin-top:10px">${chart(A.proj, inp.goal)}</div><div class="muted" style="font-size:12px;margin-top:6px">La curva se aplana porque el gasto baja al perder peso (adaptación): por eso el plan se recalcula cada 4 semanas. Las franjas ámbar son semanas de mantenimiento programadas.</div></div>
      <div class="sec">Objetivos diarios propuestos</div>
      <div class="group">
        <div class="field"><label>Calorías</label><b>${r0(A.kcal)} kcal</b></div>
        <div class="field"><label>Proteína <span class="muted">(${A.pctP} %)</span></label><b>${A.protein} g</b></div>
        <div class="field"><label>Carbohidratos <span class="muted">(${A.pctC} %)</span></label><b>${A.carbs} g</b></div>
        <div class="field"><label>Grasa <span class="muted">(${A.pctF} %)</span></label><b>${A.fat} g</b></div>
        <div class="field"><label>Fibra</label><b>25–35 g</b></div>
        <div class="field"><label>Agua</label><b>${(A.water / 1000).toLocaleString("es")} L</b></div>
        <div class="field"><label>Pasos</label><b>${r0(A.steps)}</b></div>
      </div>
      <div class="sec">Cómo sostenerlo</div>
      <div class="card" style="padding:8px 16px">${[
        `Proteína en cada comida (${Math.round(A.protein / 4)}–${Math.round(A.protein / 3)} g): sacia y protege el músculo mientras pierdes grasa.`,
        "Verduras y fruta entera a diario: volumen y fibra con pocas calorías.",
        "Pésate 3–4 veces por semana y mira la media semanal, no el día a día.",
        "Cada 4 semanas la app te propondrá recalcular con tu nuevo peso.",
        A.mode === "perder" ? "Cada 8 semanas, 1 semana comiendo a mantenimiento: baja el estrés, mejora la adherencia y no frena el progreso." : "Entrena fuerza 3–4 días: es lo que convierte el superávit en músculo.",
        "Si una semana no bajas, no recortes más: revisa el registro y los pasos antes de tocar las calorías.",
      ].map(t => `<div class="check"><div class="ck">✓</div><div style="font-size:14px;line-height:1.4">${t}</div></div>`).join("")}</div>
      <button class="btn primary" onclick="KaloDeficit.apply()">Aplicar este plan a mis objetivos</button>
      <div class="muted" style="font-size:11.5px;text-align:center">Orientación general basada en la evidencia (Mifflin-St Jeor; déficit 10–25 %; 0,5–1 % del peso/semana). No sustituye a un profesional si tienes una condición médica, embarazo o menos de 18 años.</div>
    </div>`;
  }
  window.KaloDeficit = {
    next() { const p = cur().p; const i = p.inp;
      if (p.step === 0 && !(i.w > 25 && i.w < 400)) { toast("Peso no válido"); return; }
      if (p.step === 1 && !(i.h > 100 && i.h < 250)) { toast("Altura no válida"); return; }
      if (p.step === 2 && !(i.goal > 25 && i.goal < 400)) { toast("Peso deseado no válido"); return; }
      if (p.step === 4 && !(i.age >= 14 && i.age <= 100)) { toast("Edad no válida"); return; }
      p.step++; render(); },
    apply() { const p = cur().p; const A = analyze(p.inp, p.pct); const i = p.inp;
      S.profile.height = Math.round(i.h); S.profile.sex = i.sex; S.profile.age = i.age; S.profile.activity = i.act; if (!S.profile.start) S.profile.start = i.w;
      S.goals.kcal = A.kcal; S.goals.weight = Math.round(i.goal * 10) / 10; S.goals.rate = Math.round(Math.abs(A.weekly) * 4) / 4 || 0; S.goals.p = A.pctP; S.goals.f = A.pctF; S.goals.c = A.pctC; S.goals.water = A.water; S.goals.steps = A.steps;
      if (!S.weights.some(x => x.date === TODAY)) { S.weights.push({ date: TODAY, kg: Math.round(i.w * 10) / 10 }); S.weights.sort((a, b) => a.date < b.date ? -1 : 1); }
      S.deficit = { created: TODAY, pct: A.pct, mode: A.mode, kcal: A.kcal, startKg: i.w, goal: i.goal, weeks: A.weeks, goalDate: A.goalDate, proj: A.proj.slice(0, 60), reviewed: TODAY };
      if (S.onboarded === false) S.onboarded = true;
      save(); if (window.KaloNative) KaloNative.haptic("success"); tab("home"); toast(`Plan aplicado: ${r0(A.kcal)} kcal/día`); },
  };

  /* ---------- tarjeta en Panel + recordatorio de revisión ---------- */
  function planCard() {
    const d = S.deficit; if (!d || !d.created) return `<button class="card" style="text-align:left;display:flex;gap:12px;align-items:center" onclick="go('deficit',{step:0})"><div class="ic" style="width:40px;height:40px;border-radius:12px;background:var(--energy);display:grid;place-items:center;color:#fff;flex:none">${I.target}</div><div style="flex:1"><div style="font-weight:600">Calcula tu plan de déficit</div><div class="muted" style="font-size:13px">Peso, altura, peso deseado y actividad → calorías sostenibles y fecha estimada</div></div>${I.chev}</button>`;
    const week = Math.floor((new Date(TODAY + "T12:00:00") - new Date(d.created + "T12:00:00")) / 864e5 / 7);
    const exp = (d.proj || [])[Math.min(week, (d.proj || []).length - 1)]; const cur_ = lastW().kg;
    const needReview = week >= 4 && (!d.reviewed || Math.floor((new Date(TODAY + "T12:00:00") - new Date(d.reviewed + "T12:00:00")) / 864e5) >= 28) || Math.abs(cur_ - d.startKg) >= 3;
    const diff = exp ? cur_ - exp.kg : 0;
    return `<button class="card" style="text-align:left" onclick="go('deficit',{step:0})"><h3>Plan de ${d.mode === "perder" ? "déficit" : d.mode === "ganar" ? "superávit" : "mantenimiento"} <small>semana ${week + 1}${d.weeks ? " de " + d.weeks : ""}</small></h3><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px"><div class="stat"><span class="k">Calorías</span><span class="v">${r0(d.kcal)}</span></div><div class="stat"><span class="k">Esperado hoy</span><span class="v">${exp ? wFmt(exp.kg) : "—"}</span></div><div class="stat"><span class="k">Real</span><span class="v" style="color:${d.mode === "perder" ? (diff <= 0.3 ? "var(--good)" : "var(--warn)") : (diff >= -0.3 ? "var(--good)" : "var(--warn)")}">${wFmt(cur_)}</span></div></div>${d.goalDate ? `<div class="bar" style="margin-top:10px"><i style="width:${Math.min(100, Math.max(0, (d.startKg - cur_) / ((d.startKg - d.goal) || 1) * 100))}%;background:var(--energy)"></i></div><div class="muted" style="font-size:12px;margin-top:4px">Objetivo ${wFmt(d.goal)} · estimado para ${fmtDate(d.goalDate)}</div>` : ""}${needReview ? `<div style="margin-top:8px"><span class="pill warn">Toca para recalcular con tu peso actual</span></div>` : ""}</button>`;
  }
  const origHome = views.home;
  views.home = function (p) { const h = origHome(p); const i = h.indexOf('<div class="card">'); return i >= 0 ? h.slice(0, i) + planCard() + h.slice(i) : h; };
  const origGoals = views.goals;
  views.goals = function (p) { const h = origGoals(p); const btn = `<button class="btn soft" onclick="go('deficit',{step:0})">${I.target} Calcular mi plan de déficit sostenible</button>`; const i = h.indexOf('<div class="sec">Peso</div>'); return i >= 0 ? h.slice(0, i) + btn + h.slice(i) : h + btn; };
  // Al terminar la bienvenida, ofrecer el análisis
  const origOb = window.obFinish;
  if (typeof origOb === "function") window.obFinish = function () { origOb(); setTimeout(() => { if (cur().v === "home") go("deficit", { step: 0 }); }, 350); };
})();
