// Edge Function pac-config: datos fiscales de la empresa y alta del sello digital (CSD) en el PAC multiemisor. US-231.
//
// Acciones (sesión de empresa con nivel >= 100 por x-obra-token):
//   leer                        → configuración actual + si la cuenta del PAC está lista
//   guardar { ...datos }        → RFC, razón social, régimen, CP, serie, concepto por omisión, modo sandbox/producción
//   subir_csd { cer, key, password }  → registra el CSD en el PAC y guarda sólo serie y vigencia
//   probar                      → consulta al PAC si el RFC tiene sello cargado
//   borrar_csd                  → da de baja el sello
//
// El .key y su contraseña NUNCA se guardan: viajan cifrados por TLS hasta el PAC y se descartan. En la base
// quedan el número de serie y la vigencia, que es lo que la app necesita para avisar antes de que venza.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { leerCertificado, revisarCsd } from "./certificado.js";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-obra-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const RE_RFC = /^([A-ZÑ&]{3,4})\d{6}[A-Z\d]{3}$/;
const REGIMENES = ["601", "603", "605", "606", "608", "610", "611", "612", "614", "615", "616", "620", "621", "622", "623", "624", "625", "626", "628", "629", "630"];
const limpio = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

async function secretos(): Promise<Record<string, string>> {
  const { data } = await admin.from("app_secrets").select("key,value").like("key", "facturama_%");
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
}
type Sesion = { user_id: string; nombre: string; email: string; empresa_id: number; nivel_acceso: number };
async function sesion(req: Request): Promise<Sesion | null> {
  const t = req.headers.get("x-obra-token") ?? "";
  if (!t) return null;
  const { data } = await admin.rpc("validar_sesion", { p_token: t });
  return data && data.length ? data[0] : null;
}
function pac(s: Record<string, string>, sandbox: boolean) {
  const usuario = (sandbox && s.facturama_usuario_sandbox) || s.facturama_usuario || "";
  const password = (sandbox && s.facturama_password_sandbox) || s.facturama_password || "";
  if (!usuario || !password) throw new Error("La facturación todavía no está habilitada en tu cuenta. Escríbenos y la activamos.");
  const base = s.facturama_base_url || (sandbox ? "https://apisandbox.facturama.mx" : "https://api.facturama.mx");
  const auth = "Basic " + btoa(`${usuario}:${password}`);
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { Authorization: auth, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    let j: any = {}; try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt }; }
    if (!r.ok) throw new Error(`Facturama ${r.status}: ${j?.Message || j?.message || txt.slice(0, 300)}`);
    return j;
  };
}
const aBytes = (b64: string) => Uint8Array.from(atob(String(b64).replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  let body: any = {}; try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const ses = await sesion(req);
  if (!ses) return json({ error: "No autorizado" }, 401);
  if ((ses.nivel_acceso ?? 0) < 100) return json({ error: "Sólo el administrador de la empresa puede configurar la facturación" }, 403);

  const s = await secretos();
  const hayCuenta = !!((s.facturama_usuario && s.facturama_password) || (s.facturama_usuario_sandbox && s.facturama_password_sandbox));
  const traer = async () => (await admin.schema("control_obra").from("config_pac").select("*").eq("empresa_id", ses.empresa_id).maybeSingle()).data;

  try {
    if (!body.action || body.action === "leer") {
      const cfg = await traer();
      return json({ ok: true, cuenta_pac: hayCuenta, config: cfg ?? null });
    }

    if (body.action === "guardar") {
      const rfc = limpio(body.rfc_emisor).toUpperCase();
      if (!RE_RFC.test(rfc) || (rfc.length !== 12 && rfc.length !== 13)) return json({ error: "El RFC no tiene el formato del SAT." }, 400);
      const cp = limpio(body.codigo_postal);
      if (!/^\d{5}$/.test(cp)) return json({ error: "El código postal debe tener 5 dígitos." }, 400);
      const regimen = limpio(body.regimen_fiscal);
      if (REGIMENES.indexOf(regimen) < 0) return json({ error: "Elige un régimen fiscal del catálogo del SAT." }, 400);
      if (!limpio(body.razon_social)) return json({ error: "Falta la razón social tal como aparece en tu constancia." }, 400);

      const previo = await traer();
      const datos: Record<string, unknown> = {
        empresa_id: ses.empresa_id,
        pac_nombre: "facturama",
        pac_modo: body.pac_modo === "produccion" ? "produccion" : "sandbox",
        rfc_emisor: rfc,
        razon_social: limpio(body.razon_social).toUpperCase(),
        nombre_comercial: limpio(body.nombre_comercial) || null,
        regimen_fiscal: regimen,
        codigo_postal: cp,
        lugar_expedicion: limpio(body.lugar_expedicion) || cp,
        serie_default: (limpio(body.serie_default) || "A").toUpperCase().slice(0, 10),
        concepto_default: limpio(body.concepto_default) || "Servicios de construcción",
        clave_prodserv_default: limpio(body.clave_prodserv_default) || "72141500",
        clave_unidad_default: (limpio(body.clave_unidad_default) || "E48").toUpperCase(),
        uso_cfdi_default: limpio(body.uso_cfdi_default) || "G03",
        logo_url: limpio(body.logo_url) || previo?.logo_url || null,
        activo: body.activo !== false,
        updated_at: new Date().toISOString()
      };
      // El folio inicial sólo se puede fijar mientras no haya facturas timbradas: después rompería el consecutivo.
      if (body.folio_inicial != null) {
        const { count } = await admin.schema("control_obra").from("cfdis_emitidos").select("id", { count: "exact", head: true }).eq("empresa_id", ses.empresa_id).eq("estatus", "timbrado");
        if (!count) datos.folio_actual = Math.max(0, Number(body.folio_inicial) - 1);
      }
      // Cambiar de RFC invalida el sello que estaba dado de alta.
      if (previo && previo.rfc_emisor && previo.rfc_emisor !== rfc) {
        datos.csd_registrado_at = null; datos.csd_no_certificado = null; datos.csd_vigencia_ini = null; datos.csd_vigencia_fin = null;
      }
      const res = previo
        ? await admin.schema("control_obra").from("config_pac").update(datos).eq("id", previo.id).select().single()
        : await admin.schema("control_obra").from("config_pac").insert({ ...datos, created_at: new Date().toISOString() }).select().single();
      if (res.error) return json({ error: res.error.message }, 500);
      return json({ ok: true, config: res.data, cuenta_pac: hayCuenta });
    }

    if (body.action === "subir_csd") {
      const cfg = await traer();
      if (!cfg) return json({ error: "Primero guarda tus datos fiscales." }, 400);
      const cerB64 = limpio(body.cer), keyB64 = limpio(body.key), password = String(body.password ?? "");
      if (!cerB64 || !keyB64 || !password) return json({ error: "Sube el .cer, el .key y escribe la contraseña de la llave." }, 400);
      let info = null;
      try { info = leerCertificado(aBytes(cerB64)); } catch { info = null; }
      const problemas = revisarCsd(info, cfg.rfc_emisor);
      if (problemas.length) return json({ error: problemas[0], errores: problemas }, 400);

      const llamar = pac(s, String(cfg.pac_modo ?? "sandbox") !== "produccion");
      await llamar("POST", "/api/csds", { Rfc: String(cfg.rfc_emisor).toUpperCase(), Certificate: cerB64, PrivateKey: keyB64, PrivateKeyPassword: password });

      const { data, error } = await admin.schema("control_obra").from("config_pac").update({
        csd_no_certificado: info?.serie ?? null,
        csd_vigencia_ini: info?.vigenciaIni ?? null,
        csd_vigencia_fin: info?.vigenciaFin ?? null,
        csd_registrado_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq("id", cfg.id).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, config: data });
    }

    if (body.action === "probar") {
      const cfg = await traer();
      if (!cfg) return json({ error: "Primero guarda tus datos fiscales." }, 400);
      const llamar = pac(s, String(cfg.pac_modo ?? "sandbox") !== "produccion");
      const r = await llamar("GET", `/api/csds/${encodeURIComponent(String(cfg.rfc_emisor).toUpperCase())}`);
      const lista = Array.isArray(r) ? r : (r ? [r] : []);
      return json({ ok: true, registrado: lista.length > 0, sellos: lista });
    }

    if (body.action === "borrar_csd") {
      const cfg = await traer();
      if (!cfg) return json({ error: "No hay configuración que borrar." }, 400);
      const llamar = pac(s, String(cfg.pac_modo ?? "sandbox") !== "produccion");
      try { await llamar("DELETE", `/api/csds/${encodeURIComponent(String(cfg.rfc_emisor).toUpperCase())}`); } catch { /* si ya no está en el PAC, seguimos */ }
      const { data } = await admin.schema("control_obra").from("config_pac").update({
        csd_registrado_at: null, csd_no_certificado: null, csd_vigencia_ini: null, csd_vigencia_fin: null, updated_at: new Date().toISOString()
      }).eq("id", cfg.id).select().single();
      return json({ ok: true, config: data });
    }

    return json({ error: "Acción no reconocida" }, 400);
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    if (/(^|\s)401(\D|$)|unauthorized/i.test(m)) return json({ error: "La cuenta del proveedor de timbrado no aceptó las credenciales. Avísanos para revisarlas." }, 502);
    if (/contrase|password/i.test(m)) return json({ error: "La contraseña de la llave privada no coincide con el archivo .key." }, 400);
    return json({ error: m.replace(/^Facturama \d+: /, "").slice(0, 300) }, 502);
  }
});
