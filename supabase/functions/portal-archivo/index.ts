// Edge Function portal-archivo: entrega al cliente (por token del portal) enlaces firmados de los CFDI de su obra. US-238.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  let b: { token?: string; cfdi_id?: number; tipo?: string } = {};
  try { b = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const token = String(b.token ?? "");
  if (!/^[a-f0-9]{48}$/.test(token)) return json({ error: "Enlace inválido" }, 400);
  const { data: t } = await admin.schema("control_obra").from("obra_portal_tokens").select("obra_id,empresa_id").eq("token", token).eq("activo", true).maybeSingle();
  if (!t) return json({ error: "Enlace inválido" }, 403);
  const { data: c } = await admin.schema("control_obra").from("cfdis_emitidos").select("id,archivo_path,pdf_url,xml_url,uuid").eq("id", b.cfdi_id ?? -1).eq("obra_id", t.obra_id).maybeSingle();
  if (!c) return json({ error: "Factura no encontrada" }, 404);
  const tipo = b.tipo === "xml" ? "xml" : "pdf";
  // archivo_path apunta al XML en el bucket comprobantes; el PDF, si existe, comparte nombre con extensión .pdf
  let path = c.archivo_path as string | null;
  if (path && tipo === "pdf") path = path.replace(/\.xml$/i, ".pdf");
  if (path) {
    const { data, error } = await admin.storage.from("comprobantes").createSignedUrl(path, 300);
    if (!error && data?.signedUrl) return json({ url: data.signedUrl });
  }
  const directo = tipo === "pdf" ? c.pdf_url : c.xml_url;
  if (directo) return json({ url: directo });
  return json({ error: "Archivo no disponible" }, 404);
});
