// Edge Function convocatorias-chihuahua: Contrataciones Chihuahua (US-840, US-850).
//
// Dos modos:
// A) BÚSQUEDA DE USUARIO (US-850, D12: la búsqueda es manual, a petición, desde la pestaña «Convocatorias»).
//    Cabecera x-obra-token (sesión de la app, nivel >= 80, validada con validar_sesion como subir-logo).
//    POST {texto?, tipo_contratacion? ('obra_publica'|'servicios_obra'|'' = las dos), tipo_procedimiento?
//    ('licitacion_publica'|'invitacion'|'adjudicacion_directa'|''), estatus? ('vigente' por omisión |'en_seguimiento'|
//    'terminado'|'cancelado'|'' = todos), desde?, hasta? (AAAA-MM-DD), max_resultados? (1-200, def. 50),
//    max_detalles? (0-15, def. 8)}.
//    Los filtros viajan en el POST /busqueda/ del portal (desc_procedimiento, TipoProc, Tipo_de_Licitaci_n, Estatus,
//    fechainicio/fechafin, rdFechas): una consulta por tipo de contratación pedido (máx. 2), más las páginas de detalle
//    estrictamente necesarias (sólo de lo encontrado que nunca se leyó o se leyó hace > 72 h, tope 8 por omisión).
//    Límite en el servidor (convocatoria_busqueda_iniciar, migración 105b): una búsqueda a la vez por usuario y 30 s
//    entre búsquedas a esta fuente. La corrida guarda usuario, empresa y filtros. Responde {ok, corrida_id,
//    encontradas, nuevas, actualizadas, detalles, truncado, errores, ms}; 429 con el mensaje si el límite no deja buscar.
// B) BARRIDO COMPLETO por llave de servidor (x-internal-key o x-convocatorias-secret): el recorrido de US-840
//    (obra y servicios × vigente y en seguimiento, con detalles priorizados por convocatorias_por_revisar). Ya NO lo
//    llama ningún cron (D12); queda para una carga o reparación manual. POST {max_detalles?, pausa_ms?, detalle?}.
// Sólo lectura sobre el portal: nunca envía nada distinto de la búsqueda pública.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { BASE, ESTATUS, MATERIA, conDetalle, filtrosManual, formBusqueda, normalizarFila, parseDetalle, tokenCsrf } from "./parse.mjs";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-obra-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 ControlDeObra-Convocatorias/1.0";
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function secret(key: string): Promise<string> {
  const { data } = await admin.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value ?? "";
}

// Dos llaves de servidor para el barrido completo (modo B):
//   x-internal-key          = app_secrets.internal_key
//   x-convocatorias-secret  = CONVOCATORIAS_INGESTA_SECRET del .env del recolector; en la BD sólo vive su SHA-256
//                             (app_secrets.convocatorias_ingesta_sha256), así que ni la BD ni el repo tienen el valor.
async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function igual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
async function autorizado(req: Request) {
  const ik = req.headers.get("x-internal-key") ?? "";
  if (ik) { const v = await secret("internal_key"); if (v && igual(ik, v)) return true; }
  const cs = req.headers.get("x-convocatorias-secret") ?? "";
  if (cs.length >= 32) { const h = await secret("convocatorias_ingesta_sha256"); if (h && igual(await sha256Hex(cs), h)) return true; }
  return false;
}

// Cookies mínimas (csrftoken, sessionid) entre peticiones.
class Tarro {
  c = new Map<string, string>();
  tomar(r: Response) {
    const all = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const sc of all) { const [kv] = sc.split(";"); const i = kv.indexOf("="); if (i > 0) this.c.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
  }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
}

async function pedir(url: string, tarro: Tarro, init: RequestInit = {}, ms = 30000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, redirect: "follow",
      headers: { "User-Agent": UA, "Accept-Language": "es-MX,es;q=0.9", Cookie: tarro.header(), ...(init.headers || {}) } });
    tarro.tomar(r);
    return r;
  } finally { clearTimeout(t); }
}

type Sesion = { user_id: string; empresa_id: number; nivel_acceso: number };
async function sesion(t: string): Promise<Sesion | null> {
  const { data } = await admin.rpc("validar_sesion", { p_token: t });
  return data && data.length ? data[0] : null;
}

async function abrirPortal(tarro: Tarro) {
  const home = await pedir(BASE + "/", tarro);
  if (!home.ok) throw new Error(`El portal respondió ${home.status} al abrir la portada`);
  const token = tokenCsrf(await home.text());
  if (!token) throw new Error("No se encontró el token CSRF en la portada (¿cambió el portal?)");
  return token;
}
async function consultar(tarro: Tarro, token: string, form: URLSearchParams) {
  const r = await pedir(BASE + "/busqueda/", tarro, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest",
               "X-CSRFToken": token, Referer: BASE + "/", Origin: BASE, Accept: "application/json, text/javascript, */*; q=0.01" },
    body: form.toString(),
  }, 60000);
  if (!r.ok) throw new Error(`La búsqueda del portal respondió HTTP ${r.status}`);
  const filas = await r.json().catch(() => null);
  if (!Array.isArray(filas)) throw new Error("La búsqueda del portal no devolvió una lista");
  return filas as Record<string, unknown>[];
}

// A) Búsqueda de un usuario, a petición, con sus filtros (US-850).
async function busquedaUsuario(req: Request, s: Sesion) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const f = filtrosManual(body) as { error?: string; filtros?: Record<string, unknown>; consultas?: Array<Record<string, string>> };
  if (f.error) return json({ ok: false, error: f.error }, 400);
  const filtros = f.filtros!; const consultas = f.consultas!;
  const maxRes = Number(filtros.max_resultados);
  const maxDet = Math.max(0, Math.min(15, Math.trunc(Number(body.max_detalles ?? 8)) || 0));
  const t0 = Date.now();
  const { data: corridaId, error: eIni } = await admin.rpc("convocatoria_busqueda_iniciar",
    { p_fuente: "chihuahua", p_origen: "app", p_usuario: s.user_id, p_empresa: s.empresa_id, p_filtros: filtros });
  if (eIni) return json({ ok: false, error: eIni.message }, 429);
  const errores: string[] = [];
  let res = { encontradas: 0, nuevas: 0, actualizadas: 0 };
  let detalles = 0; let truncado = false;
  const porConsulta: number[] = [];
  try {
    const tarro = new Tarro();
    const token = await abrirPortal(tarro);
    const porId = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < consultas.length; i++) {
      if (i > 0) await dormir(1500);
      const filas = await consultar(tarro, token, formBusqueda(token, consultas[i] as never));
      porConsulta.push(filas.length);
      for (const x of filas) { const c = normalizarFila(x); if (c) porId.set(c.id_externo as string, c); }
    }
    let items = [...porId.values()];
    if (items.length > maxRes) { items = items.slice(0, maxRes); truncado = true; }
    if (items.length) {
      const { data, error } = await admin.rpc("convocatorias_upsert", { p_items: items });
      if (error) throw new Error("No se pudo guardar lo encontrado: " + error.message);
      res = { encontradas: data.encontradas, nuevas: data.nuevas, actualizadas: data.actualizadas };
    }
    if (items.length && maxDet > 0) {
      const { data: pend, error } = await admin.rpc("convocatorias_sin_detalle",
        { p_fuente: "chihuahua", p_ids: items.map((c) => c.id_externo), p_horas: 72, p_limite: maxDet });
      if (error) errores.push("detalles: " + error.message);
      const lote: Record<string, unknown>[] = [];
      const porIdItems = new Map(items.map((c) => [c.id_externo as string, c]));
      for (const p of (pend ?? []) as Array<{ id_externo: string; url_detalle: string }>) {
        if (Date.now() - t0 > 60000) { errores.push("Se acabó el tiempo: algunas fechas se completarán en la siguiente búsqueda"); break; }
        await dormir(1500);
        try {
          const r = await pedir(p.url_detalle, tarro, { headers: { Referer: BASE + "/" } });
          if (!r.ok) { errores.push(`detalle ${p.id_externo}: HTTP ${r.status}`); continue; }
          const base = porIdItems.get(p.id_externo) ?? { fuente: "chihuahua", id_externo: p.id_externo, url_detalle: p.url_detalle, datos: {} };
          lote.push(conDetalle(base, parseDetalle(await r.text()), new Date().toISOString()));
          detalles++;
        } catch (e) { errores.push(`detalle ${p.id_externo}: ${(e as Error).message}`); }
      }
      if (lote.length) {
        const { error: e2 } = await admin.rpc("convocatorias_upsert", { p_items: lote });
        if (e2) errores.push("detalle: " + e2.message);
      }
    }
    await admin.rpc("convocatoria_corrida_cerrar", { p_id: corridaId, p_encontradas: res.encontradas, p_nuevas: res.nuevas,
      p_actualizadas: res.actualizadas, p_error: null,
      p_detalle: { modo: "usuario", por_consulta: porConsulta, detalles, truncado, avisos: errores, ms: Date.now() - t0 } });
    return json({ ok: true, corrida_id: corridaId, ...res, detalles, truncado, errores, ms: Date.now() - t0 });
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "El portal tardó demasiado en responder" : ((e as Error).message || String(e));
    await admin.rpc("convocatoria_corrida_cerrar", { p_id: corridaId, p_encontradas: res.encontradas, p_nuevas: res.nuevas,
      p_actualizadas: res.actualizadas, p_error: msg,
      p_detalle: { modo: "usuario", por_consulta: porConsulta, detalles, avisos: errores, ms: Date.now() - t0 } });
    return json({ ok: false, corrida_id: corridaId, error: msg, ...res, detalles, errores }, 502);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const tokUsuario = req.headers.get("x-obra-token") ?? "";
  if (tokUsuario) {
    const s = await sesion(tokUsuario);
    if (!s) return json({ ok: false, error: "Tu sesión expiró. Entra otra vez." }, 401);
    if (Number(s.nivel_acceso) < 80) return json({ ok: false, error: "Sólo un administrador o un gerente de obra puede buscar convocatorias." }, 403);
    return busquedaUsuario(req, s);
  }
  // B) Barrido completo por llave de servidor (US-840).
  if (!(await autorizado(req))) return json({ error: "No autorizado" }, 401);
  let body: { max_detalles?: number; pausa_ms?: number; detalle?: boolean } = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const maxDet = Math.max(0, Math.min(60, Number(body.max_detalles ?? 30)));
  const pausa = Math.max(1500, Math.min(5000, Number(body.pausa_ms ?? 2000)));
  const t0 = Date.now();

  const { data: corridaId } = await admin.rpc("convocatoria_corrida_iniciar", { p_fuente: "chihuahua", p_origen: "edge" });
  const errores: string[] = [];
  const consultas: Record<string, number> = {};
  let res = { encontradas: 0, nuevas: 0, actualizadas: 0 };
  let detalles = 0;
  try {
    const tarro = new Tarro();
    const home = await pedir(BASE + "/", tarro);
    if (!home.ok) throw new Error(`Portada respondió ${home.status}`);
    const token = tokenCsrf(await home.text());
    if (!token) throw new Error("No se encontró el token CSRF en la portada (¿cambió el portal?)");

    const porId = new Map<string, Record<string, unknown>>();
    for (const [mk, materia] of Object.entries(MATERIA)) {
      for (const [ek, est] of Object.entries(ESTATUS)) {
        await dormir(pausa);
        const r = await pedir(BASE + "/busqueda/", tarro, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest",
                     "X-CSRFToken": token, Referer: BASE + "/", Origin: BASE, Accept: "application/json, text/javascript, */*; q=0.01" },
          body: formBusqueda(token, { materia, estatus: est }).toString(),
        }, 60000);
        if (!r.ok) { errores.push(`busqueda ${mk}/${ek}: HTTP ${r.status}`); continue; }
        const filas = await r.json().catch(() => null);
        if (!Array.isArray(filas)) { errores.push(`busqueda ${mk}/${ek}: respuesta no es lista`); continue; }
        consultas[`${mk}/${ek}`] = filas.length;
        for (const f of filas) { const c = normalizarFila(f); if (c) porId.set(c.id_externo as string, c); }
      }
    }
    if (porId.size === 0 && errores.length) throw new Error(errores.join("; "));

    const items = [...porId.values()];
    for (let i = 0; i < items.length; i += 500) {
      const { data, error } = await admin.rpc("convocatorias_upsert", { p_items: items.slice(i, i + 500) });
      if (error) throw new Error("upsert: " + error.message);
      res = { encontradas: res.encontradas + data.encontradas, nuevas: res.nuevas + data.nuevas, actualizadas: res.actualizadas + data.actualizadas };
    }

    if (body.detalle !== false && maxDet > 0) {
      const { data: pend, error } = await admin.rpc("convocatorias_por_revisar",
        { p_fuente: "chihuahua", p_vistos: [...porId.keys()], p_limite: maxDet, p_horas: 72 });
      if (error) errores.push("por_revisar: " + error.message);
      const lote: Record<string, unknown>[] = [];
      for (const p of (pend ?? []) as Array<{ id_externo: string; url_detalle: string; motivo: string }>) {
        if (Date.now() - t0 > 110000) { errores.push("tiempo agotado: quedan detalles para la siguiente corrida"); break; }
        await dormir(pausa);
        try {
          const r = await pedir(p.url_detalle, tarro, { headers: { Referer: BASE + "/" } });
          if (!r.ok) { errores.push(`detalle ${p.id_externo}: HTTP ${r.status}`); continue; }
          const det = parseDetalle(await r.text());
          const base = porId.get(p.id_externo) ?? { fuente: "chihuahua", id_externo: p.id_externo, url_detalle: p.url_detalle, datos: {} };
          lote.push(conDetalle(base, det, new Date().toISOString()));
          detalles++;
        } catch (e) { errores.push(`detalle ${p.id_externo}: ${(e as Error).message}`); }
      }
      if (lote.length) {
        const { error: e2 } = await admin.rpc("convocatorias_upsert", { p_items: lote });
        if (e2) errores.push("upsert detalle: " + e2.message);
      }
    }
    await admin.rpc("convocatoria_corrida_cerrar", { p_id: corridaId, p_encontradas: res.encontradas, p_nuevas: res.nuevas,
      p_actualizadas: res.actualizadas, p_error: null,
      p_detalle: { consultas, detalles, avisos: errores, ms: Date.now() - t0 } });
    return json({ ok: true, corrida_id: corridaId, ...res, consultas, detalles, errores, ms: Date.now() - t0 });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    await admin.rpc("convocatoria_corrida_cerrar", { p_id: corridaId, p_encontradas: res.encontradas, p_nuevas: res.nuevas,
      p_actualizadas: res.actualizadas, p_error: msg, p_detalle: { consultas, detalles, avisos: errores, ms: Date.now() - t0 } });
    return json({ ok: false, corrida_id: corridaId, error: msg, ...res, consultas, detalles, errores }, 502);
  }
});
