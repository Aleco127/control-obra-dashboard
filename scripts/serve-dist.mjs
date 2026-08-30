// Servidor estático mínimo para probar dist/ (o src/) en local. Uso: node scripts/serve-dist.mjs [carpeta] [puerto]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DIR = join(ROOT, process.argv[2] || 'dist');
const PORT = Number(process.argv[3] || 8765);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(DIR, p));
  if (!file.startsWith(DIR)) { res.writeHead(403); return res.end(); }
  try {
    const st = await stat(file);
    if (st.isDirectory()) { res.writeHead(302, { Location: p + '/' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('404'); }
}).listen(PORT, '127.0.0.1', () => console.log(`sirviendo ${DIR} en http://127.0.0.1:${PORT}`));
