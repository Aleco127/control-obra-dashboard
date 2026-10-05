// Edge Function convocatorias-chihuahua (US-840): recolector de Contrataciones Chihuahua.
//
// 1. GET de la portada: cookie `csrftoken` + token CSRF del HTML.
// 2. POST /busqueda/ (como lo hace el navegador) para Obra pública (3) y Servicios relacionados con obra (1), con
//    estatus Vigente (0) y En seguimiento (2): 4 consultas, con pausa entre ellas.
// 3. Upsert de lo encontrado en `convocatorias` (RPC convocatorias_upsert, sólo service_role): no duplica.
// 4. Lee hasta `max_detalles` páginas de detalle (fechas y documentos), priorizadas por convocatorias_por_revisar:
//    primero las que dejaron de salir (cambiaron de estatus), luego las que nunca se han leído, luego refrescos.
// 5. Registra la corrida en `convocatoria_corridas`.
//
// La invoca el job diario (acción `convocatorias`, 7:00 de Chihuahua) con la cabecera x-internal-key
// (app_secrets.internal_key, la misma de `jobs`), o un recolector con x-convocatorias-secret. POST {max_detalles?: number (0-60, def. 30), pausa_ms?: number,
// detalle?: boolean}. Responde {ok, corrida_id, encontradas, nuevas, actualizadas, detalles, errores}.
// Sólo lectura sobre el portal: nunca envía nada distinto de la búsqueda pública.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { BASE, ESTATUS, MATERIA, conDetalle, formBusqueda, normalizarFila, parseDetalle, tokenCsrf } from "./parse.mjs";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 ControlDeObra-Convocatorias/1.0";
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function secret(key: string): Promise<string> {
  const { data } = await admin.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value ?? "";
}

// Dos llaves de servidor (nunca un token de usuario):
//   x-internal-key          = app_secrets.internal_key (la usa el job diario `jobs`)
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
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
