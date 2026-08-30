// Plantillas de correo de Control de Obra (Supernova Arquitectos, S.A. de C.V.)
// Cada plantilla devuelve { subject, html, text }. Los datos llegan ya escapados por esc().

export type Tpl = (d: Record<string, string>) => { subject: string; html: string; text: string };

const APP = "https://app.supernovarquitectos.com";

export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function layout(title: string, body: string, empresa = ""): string {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e293b">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px">
<tr><td style="padding:22px 28px 8px;border-bottom:1px solid #e2e8f0">
  <div style="font-weight:700;font-size:16px;color:#1e3a5f">Control de Obra</div>
  <div style="font-size:12px;color:#64748b">${empresa ? esc(empresa) + " · " : ""}Supernova Arquitectos</div>
</td></tr>
<tr><td style="padding:22px 28px;font-size:15px;line-height:1.55">
  <h1 style="font-size:20px;line-height:1.25;margin:0 0 14px;color:#0f172a">${title}</h1>
  ${body}
</td></tr>
<tr><td style="padding:14px 28px 20px;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0">
  Supernova Arquitectos, S.A. de C.V. · Av. Politécnico Nacional 4716-1B, Col. Lomas La Salle, C.P. 31214, Chihuahua, Chih.<br>
  <a href="${APP}/privacidad.html" style="color:#0369a1">Aviso de privacidad</a> · <a href="${APP}/terminos.html" style="color:#0369a1">Términos</a>
  {{UNSUB}}
</td></tr></table></td></tr></table></body></html>`;
}

function btn(href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${href}" style="display:inline-block;background:#1e3a5f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${label}</a></p>
<p style="font-size:12px;color:#64748b">Si el botón no funciona, copia este enlace:<br><span style="word-break:break-all">${href}</span></p>`;
}

export const TEMPLATES: Record<string, Tpl> = {
  generico: (d) => ({
    subject: d.subject || "Aviso de Control de Obra",
    html: layout(d.titulo || d.subject || "Aviso", `<p>${d.cuerpo || ""}</p>${d.url ? btn(d.url, d.cta || "Abrir") : ""}`, d.empresa),
    text: `${d.titulo || d.subject || "Aviso"}\n\n${d.cuerpo || ""}\n${d.url || ""}`,
  }),
  bienvenida: (d) => ({
    subject: `Bienvenido a Control de Obra, ${d.nombre}`,
    html: layout(`Hola ${d.nombre}, tu cuenta está lista`,
      `<p>Creaste la empresa <strong>${d.empresa}</strong>. Tienes <strong>30 días</strong> con todas las funciones para probar la plataforma con tus obras reales.</p>
       <p>Te recomendamos empezar así:</p>
       <ol style="padding-left:20px"><li>Crea tu primera obra con el asistente (5 pasos).</li><li>Carga 5 gastos con foto del ticket desde el celular.</li><li>Registra un cobro y mira el resultado por obra.</li></ol>
       ${btn(APP, "Entrar a Control de Obra")}
       <p>Tu código de invitación para tu equipo: <strong>${d.codigo || ""}</strong>.</p>
       <p>¿Dudas? Escríbenos a <a href="mailto:soporte@supernovarquitectos.com">soporte@supernovarquitectos.com</a> o por WhatsApp al +52 614 344 3936 (L a V de 9 a 18 h).</p>`, d.empresa),
    text: `Hola ${d.nombre}, tu cuenta de Control de Obra está lista. Empresa: ${d.empresa}. Entra en ${APP}. Código de invitación: ${d.codigo || ""}.`,
  }),
  verificar_correo: (d) => ({
    subject: "Confirma tu correo en Control de Obra",
    html: layout("Confirma tu correo",
      `<p>Hola ${d.nombre}, confirma que este correo es tuyo para proteger tu cuenta.</p>${btn(d.url, "Confirmar correo")}<p style="font-size:13px;color:#64748b">El enlace vence en 48 horas. Si no creaste una cuenta, ignora este mensaje.</p>`, d.empresa),
    text: `Confirma tu correo en Control de Obra: ${d.url} (vence en 48 horas).`,
  }),
  recuperar_password: (d) => ({
    subject: "Restablecer tu contraseña de Control de Obra",
    html: layout("Restablecer contraseña",
      `<p>Hola ${d.nombre}, recibimos una solicitud para cambiar tu contraseña.</p>${btn(d.url, "Crear nueva contraseña")}<p style="font-size:13px;color:#64748b">El enlace vence en 1 hora y sólo sirve una vez. Si no lo pediste, no hagas nada: tu contraseña sigue igual.</p>`, d.empresa),
    text: `Para crear una nueva contraseña entra en ${d.url} (vence en 1 hora).`,
  }),
  prueba_dia3: (d) => ({
    subject: "Captura tus gastos con una foto",
    html: layout("Tres días con Control de Obra",
      `<p>Hola ${d.nombre}. Lo que más tiempo ahorra a los residentes es capturar el gasto desde el celular con la foto del ticket: la app sugiere categoría y destino, y después pides la factura por WhatsApp desde la misma pantalla.</p>${btn(APP + "/?m=g", "Probar Compras y gastos")}`, d.empresa),
    text: `Captura tus gastos con foto del ticket desde el celular: ${APP}`,
  }),
  prueba_dia7: (d) => ({
    subject: "¿Cuánto ganaste en cada obra?",
    html: layout("Tu resultado por obra",
      `<p>Hola ${d.nombre}. Con cobros y gastos capturados, la ficha de cada obra ya muestra su margen real con semáforo, y el módulo Socios reparte la utilidad según los porcentajes que definas.</p>${btn(APP + "/?m=o", "Ver mis obras")}`, d.empresa),
    text: `Revisa el resultado por obra y el reparto entre socios: ${APP}`,
  }),
  prueba_dia25: (d) => ({
    subject: "Tu prueba termina en 5 días",
    html: layout("Elige tu plan",
      `<p>Hola ${d.nombre}. Tu prueba de 30 días termina el <strong>${d.fecha}</strong>. Para seguir sin interrupciones elige un plan; tus datos se conservan tal cual.</p>${btn(APP + "/?m=z&tab=plan", "Ver planes")}<p style="font-size:13px;color:#64748b">Si no eliges plan, la cuenta pasa a modo lectura 7 días después y podrás activarla cuando quieras.</p>`, d.empresa),
    text: `Tu prueba termina el ${d.fecha}. Elige un plan en ${APP}`,
  }),
  cobro_fallido: (d) => ({
    subject: "No pudimos cobrar tu suscripción",
    html: layout("Cobro rechazado",
      `<p>Hola ${d.nombre}. El cobro de <strong>${d.monto}</strong> por el plan ${d.plan} fue rechazado por el banco. Reintentaremos durante 7 días; puedes actualizar tu tarjeta ahora para evitar el modo lectura.</p>${btn(APP + "/?m=z&tab=plan", "Actualizar tarjeta")}`, d.empresa),
    text: `El cobro de ${d.monto} fue rechazado. Actualiza tu tarjeta en ${APP}`,
  }),
  baja_empresa: (d) => ({
    subject: "Recibimos tu solicitud de eliminar la empresa",
    html: layout("Eliminación programada",
      `<p>Hola ${d.nombre}. La empresa <strong>${d.empresa}</strong> se eliminará el <strong>${d.fecha}</strong>. Hasta entonces la cuenta queda en modo lectura y puedes cancelar la baja desde Configuración › Empresa.</p><p>Antes de esa fecha descarga tu respaldo completo desde Configuración › Respaldo.</p>${btn(APP + "/?m=z", "Ir a Configuración")}`, d.empresa),
    text: `La empresa ${d.empresa} se eliminará el ${d.fecha}. Cancela o descarga tu respaldo en ${APP}`,
  }),
  baja_recordatorio: (d) => ({
    subject: "Tu empresa se elimina en 7 días",
    html: layout("Último aviso",
      `<p>Hola ${d.nombre}. La empresa <strong>${d.empresa}</strong> se eliminará definitivamente el <strong>${d.fecha}</strong>, incluidos archivos y respaldos. Si cambiaste de opinión, cancela la baja ahora.</p>${btn(APP + "/?m=z", "Cancelar la baja")}`, d.empresa),
    text: `La empresa ${d.empresa} se elimina el ${d.fecha}. Cancela en ${APP}`,
  }),
  notificacion: (d) => ({
    subject: d.subject || "Tienes pendientes en Control de Obra",
    html: layout(d.titulo || "Pendientes de hoy", `${d.cuerpo || ""}${btn(d.url || APP, d.cta || "Abrir Control de Obra")}`, d.empresa),
    text: `${d.titulo || "Pendientes"}\n${(d.cuerpo || "").replace(/<[^>]+>/g, " ")}\n${d.url || APP}`,
  }),
};
