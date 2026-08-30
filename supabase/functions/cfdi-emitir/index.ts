// Edge Function cfdi-emitir: timbra un CFDI 4.0 de ingreso con el PAC multiemisor (Facturama) desde una
// estimación, un cobro o una captura libre, y guarda XML y PDF en el bucket comprobantes. US-232.
//
// Acciones (sesión de empresa con nivel >= 80 por x-obra-token):
//   estado                     → si la facturación está lista (cuenta del PAC + CSD registrado) y los valores por omisión
//   emitir { ... }             → arma el comprobante, lo timbra y lo guarda en cfdis_emitidos
//
// El navegador nunca ve la cuenta del PAC ni arma el comprobante: manda datos de negocio y aquí se traducen
// a la estructura del SAT (cfdi-payload.js, probado en scripts/qa/cfdi-emitir.test.mjs).
// Secretos en app_secrets: facturama_usuario, facturama_password (y su par _sandbox), facturama_base_url (opcional).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { construirCfdi, humanizarPac } from "./cfdi-payload.js";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-obra-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

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

/** Cliente mínimo del PAC. El modo lo decide la empresa; las credenciales viven en app_secrets. */
export class Pac {
  base: string; auth: string; sandbox: boolean;
  constructor(s: Record<string, string>, sandbox: boolean) {
    this.sandbox = sandbox;
    const usuario = (sandbox && s.facturama_usuario_sandbox) || s.facturama_usuario || "";
    const password = (sandbox && s.facturama_password_sandbox) || s.facturama_password || "";
    this.base = s.facturama_base_url || (sandbox ? "https://apisandbox.facturama.mx" : "https://api.facturama.mx");
    this.auth = "Basic " + btoa(`${usuario}:${password}`);
    if (!usuario || !password) throw new Error("La cuenta del proveedor de timbrado no está configurada.");
  }
  async call(method: string, path: string, body?: unknown) {
    const r = await fetch(this.base + path, { method, headers: { Authorization: this.auth, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    let j: any = {}; try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt }; }
    if (!r.ok) {
      const detalle = j?.Message || j?.message || (j?.ModelState ? JSON.stringify(j.ModelState) : "") || txt.slice(0, 400);
      const e = new Error(`Facturama ${r.status}: ${detalle}`); (e as any).cuerpo = j; (e as any).status = r.status; throw e;
    }
    return j;
  }
  /** Los archivos llegan en base64 dentro de { Content }. issuedLite es el tipo de los CFDI multiemisor. */
  async archivo(formato: "xml" | "pdf", id: string): Promise<string | null> {
    try { const r = await this.call("GET", `/api/Cfdi/${formato}/issuedLite/${encodeURIComponent(id)}`); return r?.Content ?? null; }
    catch { return null; }
  }
}

const b64aBytes = (b64: string) => Uint8Array.from(atob(String(b64).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  let body: any = {}; try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const ses = await sesion(req);
  if (!ses) return json({ error: "No autorizado" }, 401);
  if ((ses.nivel_acceso ?? 0) < 80) return json({ error: "Sólo el administrador o el contador pueden facturar" }, 403);

  const { data: cfg } = await admin.schema("control_obra").from("config_pac").select("*").eq("empresa_id", ses.empresa_id).maybeSingle();
  const s = await secretos();
  const hayCuenta = !!((s.facturama_usuario && s.facturama_password) || (s.facturama_usuario_sandbox && s.facturama_password_sandbox));

  if (body.action === "estado") {
    return json({
      ok: true,
      cuenta_pac: hayCuenta,
      configurado: !!(cfg && cfg.activo && cfg.csd_registrado_at),
      modo: cfg?.pac_modo ?? "sandbox",
      config: cfg ? { rfc_emisor: cfg.rfc_emisor, razon_social: cfg.razon_social, regimen_fiscal: cfg.regimen_fiscal, lugar_expedicion: cfg.lugar_expedicion ?? cfg.codigo_postal, codigo_postal: cfg.codigo_postal, pac_modo: cfg.pac_modo, serie_default: cfg.serie_default, folio_actual: cfg.folio_actual, csd_vigencia_fin: cfg.csd_vigencia_fin, csd_no_certificado: cfg.csd_no_certificado, csd_registrado_at: cfg.csd_registrado_at, concepto_default: cfg.concepto_default, clave_prodserv_default: cfg.clave_prodserv_default, clave_unidad_default: cfg.clave_unidad_default, uso_cfdi_default: cfg.uso_cfdi_default } : null
    });
  }

  if (body.action !== "emitir") return json({ error: "Acción no reconocida" }, 400);
  if (!cfg || !cfg.activo) return json({ error: "Primero completa tus datos fiscales en Configuración › Facturación." }, 400);
  if (!cfg.csd_registrado_at) return json({ error: "Falta subir tu sello digital (CSD) en Configuración › Facturación." }, 400);
  if (!hayCuenta) return json({ error: "La facturación todavía no está habilitada en tu cuenta. Escríbenos y la activamos." }, 503);
  if (cfg.csd_vigencia_fin && new Date(cfg.csd_vigencia_fin) < new Date()) {
    return json({ error: "Tu sello digital venció el " + cfg.csd_vigencia_fin + ". Renuévalo en el SAT y súbelo de nuevo." }, 400);
  }

  // El origen decide contra qué documento queda amarrada la factura y qué se prellena.
  const origen = body.origen === "cobro" ? "cobro" : body.origen === "estimacion" ? "estimacion" : "libre";
  const serie = String(body.serie || cfg.serie_default || "A").toUpperCase().slice(0, 10);

  // Se arma y valida ANTES de reservar folio: un dato mal capturado no debe abrir un hueco en el consecutivo.
  const armado = construirCfdi({
    emisor: { rfc: cfg.rfc_emisor, nombre: cfg.razon_social, regimen: cfg.regimen_fiscal, cp: cfg.lugar_expedicion || cfg.codigo_postal },
    receptor: body.receptor || {},
    conceptos: body.conceptos || [],
    serie,
    formaPago: body.forma_pago, metodoPago: body.metodo_pago,
    modoIva: body.modo_iva, ivaRetenido: body.iva_retenido, isrRetenido: body.isr_retenido,
    condiciones: body.condiciones
  });
  if (armado.errores && armado.errores.length) return json({ error: armado.errores[0], errores: armado.errores }, 400);

  let folio = 0;
  try {
    const { data: f, error } = await admin.schema("control_obra").rpc("reservar_folio_cfdi", { p_empresa_id: ses.empresa_id, p_serie: serie });
    if (error) throw error;
    folio = Number(f) || 0;
  } catch (e) {
    return json({ error: "No se pudo reservar el folio: " + String((e as Error).message ?? e) }, 500);
  }
  armado.cfdi.Folio = String(folio);

  let timbrado: any;
  try {
    const pac = new Pac(s, String(cfg.pac_modo ?? "sandbox") !== "produccion");
    timbrado = await pac.call("POST", "/api-lite/3/cfdis", armado.cfdi);
    const uuid = String(timbrado?.Complement?.TaxStamp?.Uuid ?? timbrado?.Uuid ?? "").toUpperCase();
    const pacId = String(timbrado?.Id ?? "");
    const xmlB64 = pacId ? await pac.archivo("xml", pacId) : null;
    const pdfB64 = pacId ? await pac.archivo("pdf", pacId) : null;

    let xmlPath: string | null = null, pdfPath: string | null = null, xmlTexto: string | null = null;
    const nombre = uuid || pacId || `${serie}-${folio}`;
    if (xmlB64) {
      xmlTexto = new TextDecoder().decode(b64aBytes(xmlB64));
      const p = `empresa/${ses.empresa_id}/emitidos/${nombre}.xml`;
      const { error } = await admin.storage.from("comprobantes").upload(p, new Blob([xmlTexto], { type: "application/xml" }), { contentType: "application/xml", upsert: true });
      if (!error) xmlPath = p;
    }
    if (pdfB64) {
      const p = `empresa/${ses.empresa_id}/emitidos/${nombre}.pdf`;
      const { error } = await admin.storage.from("comprobantes").upload(p, new Blob([b64aBytes(pdfB64)], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
      if (!error) pdfPath = p;
    }

    const t = armado.totales;
    const fila = {
      empresa_id: ses.empresa_id,
      obra_id: body.obra_id ?? null,
      cliente_id: body.cliente_id ?? null,
      estimacion_id: origen === "estimacion" ? (body.estimacion_id ?? null) : null,
      pago_recibido_id: origen === "cobro" ? (body.pago_recibido_id ?? null) : null,
      cuenta_cobrar_id: body.cuenta_cobrar_id ?? null,
      uuid: uuid || null,
      serie, folio,
      fecha_emision: timbrado?.Date ?? new Date().toISOString(),
      fecha_timbrado: timbrado?.Complement?.TaxStamp?.Date ?? new Date().toISOString(),
      tipo_comprobante: "I",
      forma_pago: armado.cfdi.PaymentForm,
      metodo_pago: armado.cfdi.PaymentMethod,
      uso_cfdi: armado.cfdi.Receiver.CfdiUse,
      receptor_rfc: armado.cfdi.Receiver.Rfc,
      receptor_nombre: armado.cfdi.Receiver.Name,
      receptor_regimen: armado.cfdi.Receiver.FiscalRegime,
      receptor_domicilio_cp: armado.cfdi.Receiver.TaxZipCode,
      receptor_uso_cfdi: armado.cfdi.Receiver.CfdiUse,
      subtotal: t.subtotal, descuento: 0,
      iva_tasa: body.modo_iva === "exento" ? 0 : Number(body.modo_iva ?? 16),
      iva_monto: t.iva, isr_retenido: t.isrRetenido, iva_retenido: t.ivaRetenido, total: t.total,
      moneda: "MXN",
      conceptos: armado.cfdi.Items,
      estatus: "timbrado",
      cadena_original: timbrado?.Complement?.TaxStamp?.CadenaOriginalSat ?? null,
      sello_cfdi: timbrado?.Complement?.TaxStamp?.CfdiSign ?? null,
      sello_sat: timbrado?.Complement?.TaxStamp?.SatSign ?? null,
      certificado_sat: timbrado?.Complement?.TaxStamp?.SatCertNumber ?? null,
      xml_content: xmlTexto,
      archivo_path: xmlPath, pdf_path: pdfPath,
      pac_cfdi_id: pacId || null, pac_modo: cfg.pac_modo ?? "sandbox",
      notas: body.notas ?? null,
      created_by: ses.nombre ?? ses.email ?? null
    };
    const { data: guardado, error: e2 } = await admin.schema("control_obra").from("cfdis_emitidos").insert(fila).select().single();
    if (e2) return json({ error: "La factura se timbró pero no se pudo guardar: " + e2.message, uuid }, 500);
    return json({ ok: true, cfdi: guardado, uuid, folio });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // Un timbrado fallido deja rastro para poder explicarle al usuario qué pasó, sin dar por buena la factura.
    await admin.schema("control_obra").from("cfdis_emitidos").insert({
      empresa_id: ses.empresa_id, obra_id: body.obra_id ?? null, cliente_id: body.cliente_id ?? null,
      estimacion_id: origen === "estimacion" ? (body.estimacion_id ?? null) : null,
      pago_recibido_id: origen === "cobro" ? (body.pago_recibido_id ?? null) : null,
      serie, folio, fecha_emision: new Date().toISOString(), tipo_comprobante: "I",
      forma_pago: armado.cfdi.PaymentForm, metodo_pago: armado.cfdi.PaymentMethod, uso_cfdi: armado.cfdi.Receiver.CfdiUse,
      receptor_rfc: armado.cfdi.Receiver.Rfc, receptor_nombre: armado.cfdi.Receiver.Name,
      receptor_regimen: armado.cfdi.Receiver.FiscalRegime, receptor_domicilio_cp: armado.cfdi.Receiver.TaxZipCode,
      subtotal: armado.totales.subtotal, iva_monto: armado.totales.iva, total: armado.totales.total, moneda: "MXN",
      conceptos: armado.cfdi.Items, estatus: "error", pac_response: { error: msg }, pac_modo: cfg.pac_modo ?? "sandbox",
      created_by: ses.nombre ?? ses.email ?? null
    });
    return json({ error: humanizarPac(msg), detalle: msg }, 502);
  }
});
