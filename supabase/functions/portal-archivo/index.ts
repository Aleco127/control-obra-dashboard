// Edge Function portal-archivo: entrega al cliente enlaces firmados de los archivos de su obra (facturas, documentos y fotos). US-238, US-248.
// Acepta las dos formas de entrar al portal: el enlace privado (token de 48 hex) o la sesión con correo y contraseña (64 hex).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// La base sólo guarda el SHA-256 del token de sesión (migración 076).
async function sha256(t: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Devuelve las obras a las que el visitante tiene derecho, según cómo entró.
async function obrasPermitidas(b: { token?: string; sesion?: string }): Promise<number[] | null> {
  const token = String(b.token ?? "");
  if (/^[a-f0-9]{48}$/.test(token)) {
    const { data } = await admin.schema("control_obra").from("obra_portal_tokens").select("obra_id").eq("token", token).eq("activo", true).maybeSingle();
    return data ? [data.obra_id as number] : null;
  }
  const ses = String(b.sesion ?? "");
  if (/^[a-f0-9]{64}$/.test(ses)) {
    const { data: s } = await admin.schema("control_obra").from("portal_sesiones").select("usuario_id,expires_at,activo").eq("token", await sha256(ses)).maybeSingle();
    if (!s || !s.activo || new Date(s.expires_at as string) < new Date()) return null;
    const { data: u } = await admin.schema("control_obra").from("portal_usuarios").select("activo").eq("id", s.usuario_id).maybeSingle();
    if (!u || !u.activo) return null;
    const { data: obras } = await admin.schema("control_obra").from("portal_usuario_obras").select("obra_id").eq("usuario_id", s.usuario_id);
    return (obras ?? []).map((o: { obra_id: number }) => o.obra_id);
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  let b: { token?: string; sesion?: string; cfdi_id?: number; documento_id?: number; tipo?: string; fotos?: boolean; obra_id?: number } = {};
  try { b = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const obras = await obrasPermitidas(b);
  if (!obras || !obras.length) return json({ error: "Enlace inválido" }, 403);

  // Fotos de la obra: el bucket es privado, así que el portal pide aquí los enlaces firmados (6 h) de las fotos publicadas.
  if (b.fotos) {
    const obraId = Number(b.obra_id);
    if (!obras.includes(obraId)) return json({ error: "Obra no encontrada" }, 404);
    const { data: fs } = await admin.schema("control_obra").from("fotos_obra")
      .select("id,url_foto,url_thumbnail").eq("obra_id", obraId).eq("visible_cliente", true).order("id", { ascending: false }).limit(300);
    const ruta = (u: unknown) => { const m = /\/storage\/v1\/object\/(?:public|sign)\/fotos\/([^?#]+)/.exec(String(u ?? "")); return m ? decodeURIComponent(m[1]) : null; };
    const rutas = new Set<string>();
    for (const f of fs ?? []) { for (const u of [f.url_foto, f.url_thumbnail]) { const p = ruta(u); if (p) rutas.add(p); } }
    const firmadas: Record<string, string> = {};
    if (rutas.size) {
      const { data: su } = await admin.storage.from("fotos").createSignedUrls([...rutas], 6 * 3600);
      for (const s of su ?? []) if (s.path && s.signedUrl) firmadas[s.path] = s.signedUrl;
    }
    const out: Record<string, { url: string | null; thumb: string | null }> = {};
    for (const f of fs ?? []) {
      const pu = ruta(f.url_foto), pt = ruta(f.url_thumbnail);
      out[String(f.id)] = { url: pu ? (firmadas[pu] ?? null) : null, thumb: pt ? (firmadas[pt] ?? null) : null };
    }
    return json({ fotos: out });
  }

  if (b.documento_id != null) {
    const { data: d } = await admin.schema("control_obra").from("documentos")
      .select("id,nombre,archivo_path,url_archivo,obra_id,visible_cliente").eq("id", b.documento_id).maybeSingle();
    if (!d || !d.visible_cliente || !obras.includes(d.obra_id as number)) return json({ error: "Documento no encontrado" }, 404);
    // Sin `download`: el PDF o la imagen se abren en el visor del navegador y el cliente decide si lo guarda.
    // Forzar la descarga dejaba una pestaña en blanco en el celular.
    if (d.archivo_path) {
      const { data, error } = await admin.storage.from("documentos").createSignedUrl(d.archivo_path as string, 300);
      if (!error && data?.signedUrl) return json({ url: data.signedUrl });
    }
    if (d.url_archivo && /^https?:\/\//i.test(String(d.url_archivo))) return json({ url: d.url_archivo });
    return json({ error: "Archivo no disponible" }, 404);
  }

  const { data: c } = await admin.schema("control_obra").from("cfdis_emitidos").select("id,archivo_path,pdf_url,xml_url,uuid,obra_id").eq("id", b.cfdi_id ?? -1).maybeSingle();
  if (!c || !obras.includes(c.obra_id as number)) return json({ error: "Factura no encontrada" }, 404);
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
