// Edge Function cfdi-suscripcion: timbra con Facturama el CFDI de un cobro de suscripción (US-217).
// Emisor: Supernova Arquitectos (cuenta de Facturama en app_secrets: facturama_user / facturama_pass / facturama_sandbox).
// Sin credenciales propias usa el sandbox público de Facturama para pruebas. Se invoca con x-internal-key (webhook o jobs).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const FN_URL = Deno.env.get("SUPABASE_URL")! + "/functions/v1";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function secrets(): Promise<Record<string, string>> {
  const { data } = await admin.from("app_secrets").select("key,value").in("key", ["internal_key", "facturama_user", "facturama_pass", "facturama_sandbox", "facturama_serie"]);
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
}
function facturama(s: Record<string, string>) {
  const sandbox = s.facturama_sandbox !== "false" && !(s.facturama_user && s.facturama_sandbox === "false");
  const user = s.facturama_user || "pruebas"; const pass = s.facturama_pass || "pruebas2011";
  const base = sandbox ? "https://apisandbox.facturama.mx" : "https://api.facturama.mx";
  const auth = "Basic " + btoa(`${user}:${pass}`);
  return {
    sandbox,
    async call(method: string, path: string, body?: unknown) {
      const r = await fetch(base + path, { method, headers: { Authorization: auth, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const txt = await r.text(); let j: any = {}; try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt }; }
      if (!r.ok) throw new Error(`Facturama ${r.status}: ${j.Message || j.message || (j.ModelState ? JSON.stringify(j.ModelState) : txt.slice(0, 300))}`);
      return j;
    },
  };
}
const r2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const s = await secrets();
  if (!s.internal_key || req.headers.get("x-internal-key") !== s.internal_key) return json({ error: "No autorizado" }, 401);
  let body: { payment_id?: number; reintentar_pendientes?: boolean } = {};
  try { body = await req.json(); } catch { /* vacío */ }

  // Cola: un pago concreto o todos los pendientes de CFDI
  let pagos: any[] = [];
  if (body.payment_id) {
    const { data } = await admin.from("subscription_payments").select("*").eq("id", body.payment_id).maybeSingle();
    if (data) pagos = [data];
  } else {
    const { data } = await admin.from("subscription_payments").select("*").eq("estado", "pagado").is("cfdi_uuid", null).order("created_at").limit(20);
    pagos = data ?? [];
  }
  const fx = facturama(s);
  const out: Record<string, unknown>[] = [];
  for (const p of pagos) {
    try {
      if (p.estado !== "pagado" || p.cfdi_uuid) { out.push({ id: p.id, omitido: true }); continue; }
      const { data: sub } = await admin.from("empresa_subscriptions").select("datos_fiscales,billing_email,periodicidad").eq("empresa_id", p.empresa_id).maybeSingle();
      const df = sub?.datos_fiscales ?? null;
      if (!df || !df.rfc || !df.razon_social || !df.cp) {
        await admin.from("subscription_payments").update({ cfdi_error: "Faltan datos fiscales (RFC, razón social, código postal)" }).eq("id", p.id);
        out.push({ id: p.id, error: "sin datos fiscales" }); continue;
      }
      const subtotal = r2(Number(p.monto)); const iva = r2(subtotal * 0.16); const total = r2(subtotal + iva);
      const cfdi = {
        Serie: s.facturama_serie || "SUB", Currency: "MXN", ExpeditionPlace: "31214", CfdiType: "I", PaymentForm: "04", PaymentMethod: "PUE",
        Exportation: "01", OrderNumber: String(p.id),
        Receiver: { Rfc: String(df.rfc).toUpperCase(), Name: String(df.razon_social).toUpperCase(), CfdiUse: df.uso || "G03", FiscalRegime: df.regimen || "601", TaxZipCode: String(df.cp) },
        Items: [{
          ProductCode: "81112501", IdentificationNumber: "SUB-" + p.id, Description: `Suscripción Control de Obra ${p.descripcion ?? ""} (${p.periodo_inicio ?? ""} a ${p.periodo_fin ?? ""})`.trim(),
          Unit: "Servicio", UnitCode: "E48", Quantity: 1, UnitPrice: subtotal, Subtotal: subtotal, TaxObject: "02",
          Taxes: [{ Total: iva, Name: "IVA", Base: subtotal, Rate: 0.16, IsRetention: false }], Total: total,
        }],
      };
      const emitido = await fx.call("POST", "/3/cfdis", cfdi);
      const uuid = emitido?.Complement?.TaxStamp?.Uuid ?? emitido?.Uuid ?? null;
      const id = emitido?.Id;
      // Archivos
      const pdf = await fx.call("GET", `/cfdi/pdf/issued/${id}`);
      const xml = await fx.call("GET", `/cfdi/xml/issued/${id}`);
      const b64 = (c: string) => Uint8Array.from(atob(c), (ch) => ch.charCodeAt(0));
      const base = `empresa/${p.empresa_id}/suscripcion/${uuid || id}`;
      await admin.storage.from("comprobantes").upload(base + ".pdf", b64(pdf.Content), { contentType: "application/pdf", upsert: true });
      await admin.storage.from("comprobantes").upload(base + ".xml", b64(xml.Content), { contentType: "application/xml", upsert: true });
      await admin.from("subscription_payments").update({ cfdi_uuid: uuid || id, cfdi_pdf_path: base + ".pdf", cfdi_xml_path: base + ".xml", cfdi_error: null, monto: subtotal }).eq("id", p.id);
      // Correo con enlaces firmados (7 días)
      const to = df.email || sub?.billing_email;
      if (to) {
        const { data: su } = await admin.storage.from("comprobantes").createSignedUrls([base + ".pdf", base + ".xml"], 7 * 86400);
        const links = (su ?? []).map((u: any, i: number) => `<a href="${u.signedUrl}">${i === 0 ? "Descargar PDF" : "Descargar XML"}</a>`).join(" · ");
        await fetch(FN_URL + "/send-email", { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": s.internal_key }, body: JSON.stringify({ to, template: "generico", empresa_id: p.empresa_id, data: { subject: "Tu factura de Control de Obra", titulo: "Factura de tu suscripción", cuerpo: `Timbramos el CFDI de tu pago de ${new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(total)} (folio fiscal ${uuid || id}). Los enlaces vencen en 7 días; siempre puedes descargarla desde Configuración › Plan.<br><br>${links}`, url: "https://app.supernovarquitectos.com/?m=z", cta: "Ver mis facturas" } }) }).catch(() => {});
      }
      out.push({ id: p.id, uuid, sandbox: fx.sandbox });
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 400);
      await admin.from("subscription_payments").update({ cfdi_error: msg }).eq("id", p.id);
      out.push({ id: p.id, error: msg });
    }
  }
  return json({ ok: true, procesados: out, sandbox: fx.sandbox });
});
