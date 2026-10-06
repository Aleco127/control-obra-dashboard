// Edge Function convocatorias-ingesta (US-842): recibe lotes de convocatorias de un recolector externo
// (scripts/licitaciones/comprasmx-recolector.py, que corre con Chrome real en el VPS o en la PC porque ComprasMX
// exige reCAPTCHA v3) y los guarda en `convocatorias`.
//
// Autenticación: cabecera x-convocatorias-secret = CONVOCATORIAS_INGESTA_SECRET (secreto de servidor del .env del
// recolector, permisos 600, fuera del repo). En la BD sólo vive su SHA-256 (app_secrets.convocatorias_ingesta_sha256).
// Nunca acepta tokens de usuario.
//
// POST {accion, ...}:
//   iniciar  {fuente, origen, con_sesion?, empresa_id?} → {ok, corrida_id}   (US-855: búsqueda con la cuenta)
//   lote     {corrida_id?, items: Convocatoria[]}   → {ok, encontradas, nuevas, actualizadas, descartadas}
//            (máx. 200 por lote; se normalizan y validan aquí: el recolector no decide qué entra a la BD)
//            US-855: cada item puede traer con_sesion: true y origen_detalle: 'invitacion' (ésta sólo vale si la corrida
//            es con sesión; la invitación queda ligada a la empresa de la corrida)
//   cerrar   {corrida_id, encontradas, nuevas, actualizadas, error?, detalle?} → {ok}
//   config   {}                                      → {ok, entidades[], todas_las_entidades: bool}
//            entidades de los filtros activos que incluyen ComprasMX (vacío + true = algún filtro pide todo el país)
//   por_revisar {fuente, vistos[], limite}         → {ok, pendientes: [{id_externo, url_detalle, motivo}]}
//   sin_descripcion {fuente, ids[], limite}        → {ok, pendientes: [{id_externo, url_detalle}]} (US-852: de ESTA búsqueda,
//            las que aún no tienen descripción, en el orden pedido; tope 200)
//   estado   {}                                      → {ok, fuentes: [{fuente, ultima_ok, horas_sin_ok, ultima_error}]}
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizar } from "./normalizar.mjs";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function secret(key: string): Promise<string> {
  const { data } = await admin.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value ?? "";
}
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
  const cs = req.headers.get("x-convocatorias-secret") ?? "";
  if (cs.length < 32) return false;
  const h = await secret("convocatorias_ingesta_sha256");
  return !!h && igual(await sha256Hex(cs), h);
}

const FUENTES = new Set(["comprasmx", "chihuahua"]);
const entero = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  if (!(await autorizado(req))) return json({ ok: false, error: "No autorizado" }, 401);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ ok: false, error: "JSON inválido" }, 400); }

  switch (b.accion) {
    case "iniciar": {
      const fuente = String(b.fuente ?? "comprasmx");
      if (!FUENTES.has(fuente)) return json({ ok: false, error: "fuente no válida" }, 400);
      // US-855: con_sesion = la búsqueda se hizo con la cuenta de la empresa (empresa_id = la del boleto canjeado).
      const emp = Number(b.empresa_id);
      const { data, error } = await admin.rpc("convocatoria_corrida_iniciar", { p_fuente: fuente, p_origen: String(b.origen ?? "script").slice(0, 40),
        p_con_sesion: b.con_sesion === true, p_empresa: b.con_sesion === true && Number.isInteger(emp) && emp > 0 ? emp : null });
      return error ? json({ ok: false, error: error.message }, 500) : json({ ok: true, corrida_id: data });
    }
    case "lote": {
      const items = Array.isArray(b.items) ? b.items : null;
      if (!items) return json({ ok: false, error: "items debe ser una lista" }, 400);
      if (items.length > 200) return json({ ok: false, error: "máximo 200 por lote" }, 413);
      // US-855: con_sesion y origen_detalle viajan aparte de la normalización; una invitación queda ligada a la empresa
      // de la corrida (la de la cuenta con la que se trajo) y sólo esa empresa la ve en convocatorias_buscar.
      let empCorrida: number | null = null;
      if (items.some((x) => x && (x as Record<string, unknown>).origen_detalle === "invitacion") && Number(b.corrida_id) > 0) {
        const { data: k } = await admin.schema("control_obra").from("convocatoria_corridas").select("empresa_id,con_sesion").eq("id", Number(b.corrida_id)).maybeSingle();
        empCorrida = k && k.con_sesion ? (k.empresa_id ?? null) : null;
      }
      const limpios = items.map((x) => {
        const n = normalizar(x) as Record<string, unknown> | null;
        if (!n) return null;
        const r = x as Record<string, unknown>;
        if (r.con_sesion === true) n.con_sesion = true;
        if (r.origen_detalle === "invitacion" && empCorrida) { n.origen_detalle = "invitacion"; n.sesion_empresa_id = empCorrida; }
        return n;
      }).filter(Boolean);
      if (!limpios.length) return json({ ok: true, encontradas: 0, nuevas: 0, actualizadas: 0, descartadas: items.length });
      const { data, error } = await admin.rpc("convocatorias_upsert", { p_items: limpios });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, ...data, descartadas: items.length - limpios.length });
    }
    case "cerrar": {
      const id = Number(b.corrida_id);
      if (!Number.isFinite(id) || id <= 0) return json({ ok: false, error: "corrida_id requerido" }, 400);
      const detalle = b.detalle && typeof b.detalle === "object" ? b.detalle : {};
      const { error } = await admin.rpc("convocatoria_corrida_cerrar", {
        p_id: id, p_encontradas: entero(b.encontradas), p_nuevas: entero(b.nuevas), p_actualizadas: entero(b.actualizadas),
        p_error: b.error ? String(b.error).slice(0, 2000) : null,
        p_detalle: JSON.stringify(detalle).length > 20000 ? { truncado: true } : detalle,
      });
      return error ? json({ ok: false, error: error.message }, 500) : json({ ok: true });
    }
    case "config": {
      const { data, error } = await admin.rpc("convocatorias_config_servicio", { p_fuente: "comprasmx" });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, ...data });
    }
    case "por_revisar": {
      const fuente = String(b.fuente ?? "comprasmx");
      if (!FUENTES.has(fuente)) return json({ ok: false, error: "fuente no válida" }, 400);
      const vistos = Array.isArray(b.vistos) ? b.vistos.map(String).slice(0, 5000) : [];
      const { data, error } = await admin.rpc("convocatorias_por_revisar",
        { p_fuente: fuente, p_vistos: vistos, p_limite: Math.min(30, entero(b.limite) || 10), p_horas: 72 });
      return error ? json({ ok: false, error: error.message }, 500) : json({ ok: true, pendientes: data });
    }
    case "sin_descripcion": {
      const fuente = String(b.fuente ?? "comprasmx");
      if (!FUENTES.has(fuente)) return json({ ok: false, error: "fuente no válida" }, 400);
      const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 1000) : [];
      const { data, error } = await admin.rpc("convocatorias_sin_descripcion",
        { p_fuente: fuente, p_ids: ids, p_limite: Math.min(200, entero(b.limite) || 40) });
      return error ? json({ ok: false, error: error.message }, 500) : json({ ok: true, pendientes: data });
    }
    case "estado": {
      const { data, error } = await admin.rpc("convocatorias_estado_servicio");
      return error ? json({ ok: false, error: error.message }, 500) : json({ ok: true, fuentes: data });
    }
    default:
      return json({ ok: false, error: "acción no válida" }, 400);
  }
});
