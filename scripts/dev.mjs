// Teste local sem instalar nada: PostgreSQL embutido (PGlite) em .local-db/ + o servidor.
//   npm run dev            -> http://localhost:3002
//   npm run dev -- --limpo -> apaga o banco local antes
// Na 1ª vez cria o administrador "admin" e mostra a senha provisória.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

if (process.argv.includes('--limpo')) rmSync('.local-db', { recursive: true, force: true });
const porta = Number(process.env.PG_PORTA || 55433);
const pg = await PGlite.create('./.local-db');
const servidorPg = new PGLiteSocketServer({ db: pg, port: porta, host: '127.0.0.1', maxConnections: 4 });
await servidorPg.start();

process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${porta}/postgres`;
process.env.DB_CONEXOES = '1'; // o PGlite atende uma consulta por vez
process.env.CPF_CHAVE ||= '0'.repeat(63) + '1'; // chave só de teste
process.env.PORT ||= '3002';

const { db } = await import('../lib/db.js');
const { hashSenha, senhaTemporaria } = await import('../lib/senha.js');
const sql = await db();
const [n] = await sql`select count(*)::int as n from usuarios`;
if (!n.n) {
  const senha = senhaTemporaria();
  await sql`insert into usuarios (login, nome, papel, senha_hash) values ('admin', 'Administrador', 'admin', ${hashSenha(senha)})`;
  console.log(`\nAdministrador criado: usuário "admin", senha provisória ${senha}\n`);
}
await import('../server.mjs');
