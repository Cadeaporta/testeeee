// Termos de TI · servidor: node server.mjs
// Variáveis: PORT, DATABASE_URL, CPF_CHAVE (64 hex), URL_PUBLICA (opcional), ENTRA_TENANT_ID/ENTRA_CLIENT_ID (quando houver).
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
const { rotas } = await import('./lib/rotas.js');
const { db } = await import('./lib/db.js');

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const SEGURANCA = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'self' blob:",
};
const PUBLICO = join(process.cwd(), 'public');

// '/api/termos/:numero/pdf' -> regex com grupos nomeados
const tabela = rotas.map(([metodo, padrao, fn]) => ({
  metodo, fn, re: new RegExp('^' + padrao.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'),
}));

if (!/^[0-9a-f]{64}$/i.test(process.env.CPF_CHAVE || '')) console.warn('ATENÇÃO: CPF_CHAVE não configurada; não será possível gerar termos.');

http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SEGURANCA)) res.setHeader(k, v);
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/saude') { res.setHeader('Content-Type', 'text/plain'); return res.end('ok'); }

  if (u.pathname.startsWith('/api/')) {
    const r = tabela.find((x) => x.metodo === req.method && x.re.test(u.pathname));
    res.setHeader('Cache-Control', 'no-store');
    if (!r) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json; charset=utf-8'); return res.end('{"erro":"Rota não encontrada."}'); }
    const params = Object.fromEntries(Object.entries(r.re.exec(u.pathname).groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    try {
      const { lerCorpo } = await import('./lib/util.js');
      const saida = await r.fn({ req, params, query: Object.fromEntries(u.searchParams), corpo: () => lerCorpo(req), ip });
      if (saida && Buffer.isBuffer(saida.corpo)) {
        res.setHeader('Content-Type', saida.tipo);
        if (saida.nome) res.setHeader('Content-Disposition', `inline; filename="${saida.nome}"`);
        return res.end(saida.corpo);
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify(saida));
    } catch (e) {
      if (!e.status) console.error(req.method, u.pathname, e);
      res.statusCode = e.status || 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ erro: e.status ? e.message : 'Erro no servidor. Tente de novo; se continuar, avise o administrador.' }));
    }
  }

  const f = normalize(join(PUBLICO, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname)));
  if (f.startsWith(PUBLICO) && existsSync(f) && statSync(f).isFile()) {
    res.setHeader('Content-Type', TIPOS[extname(f)] || 'application/octet-stream');
    // html e js sempre conferem a versão (atualização chega na hora); imagens podem ficar 1 h
    res.setHeader('Cache-Control', ['.html', '.js', '.css'].includes(extname(f)) ? 'no-cache' : 'public, max-age=3600');
    return res.end(readFileSync(f));
  }
  res.statusCode = 404; res.end('404');
}).listen(Number(process.env.PORT || 3000), async () => {
  await db(); // aplica as migrações já na subida
  console.log('Termos de TI no ar: http://localhost:' + (process.env.PORT || 3000));
});
