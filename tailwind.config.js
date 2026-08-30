// Configuración de Tailwind extraída de la configuración inline de src/index.html (US-224).
// El build (scripts/build.mjs) compila el CSS con esta config; la app en producción ya no carga cdn.tailwindcss.com.
module.exports = {
  content: ['./src/index.html', './src/admin.html', './src/js/**/*.js', './src/privacidad.html', './src/terminos.html'],
  safelist: [
    // Sólo las clases que el código arma con variables (roleColors "from-x-500 to-y-500", colores de categoría/estatus, badges del admin)
    { pattern: /^(bg|text)-(slate|gray|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose)-(100|400|500|600|700)$/ },
    { pattern: /^bg-(slate|gray|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose)-(500|600)\/(10|20)$/ },
    { pattern: /^(from|to)-(slate|gray|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose)-(500|600|700|900)$/ },
    { pattern: /^border-(slate|gray|red|amber|green|emerald|cyan|blue|purple)-(200|300|500)$/ },
  ],

  theme: {theme:{extend:{colors:{accent:'var(--accent)','accent-soft':'var(--accent-soft)',ink:'var(--ink)','ink-muted':'var(--ink-muted)','ink-subtle':'var(--ink-subtle)',surface:'var(--surface)','surface-2':'var(--surface-2)',line:'var(--line)',primary:'var(--primary)',ok:'var(--ok)',warn:'var(--warn)',danger:'var(--danger)'},zIndex:{dropdown:'var(--z-dropdown)',sticky:'var(--z-sticky)',sidebar:'var(--z-sidebar)',backdrop:'var(--z-backdrop)',drawer:'var(--z-drawer)',modal:'var(--z-modal)',toast:'var(--z-toast)'}}}}.theme,
};
