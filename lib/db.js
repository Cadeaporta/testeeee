// Conexão com o PostgreSQL e migrações (db/NNN_*.sql, aplicadas em ordem, uma vez cada).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let pronto;
export function db() {
  if (!pronto) pronto = abrir().catch((e) => { pronto = undefined; throw e; });
  return pronto;
}

async function abrir() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não definida (para testar localmente use: npm run dev)');
  const { default: postgres } = await import('postgres');
  // SSL obrigatório em banco na nuvem; desligado no banco local ou no mesmo servidor (DB_SSL=false, docker compose)
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL) || process.env.DB_SSL === 'false';
  // prepare:false porque poolers (Supabase/PgBouncer) não aceitam comandos preparados
  const sql = postgres(process.env.DATABASE_URL, {
    ssl: local ? false : 'require', prepare: false, max: Number(process.env.DB_CONEXOES || 5), idle_timeout: 30, onnotice: () => {},
  });
  await migrar(sql);
  return sql;
}

async function migrar(sql) {
  await sql`create table if not exists migracoes (versao text primary key, em timestamptz not null default now())`;
  const feitas = new Set((await sql`select versao from migracoes`).map((r) => r.versao));
  const pasta = join(process.cwd(), 'db');
  for (const f of readdirSync(pasta).filter((n) => /^\d{3}_.*\.sql$/.test(n)).sort()) {
    if (feitas.has(f)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(pasta, f), 'utf8'));
      await tx`insert into migracoes (versao) values (${f})`;
    });
    console.log('migração aplicada:', f);
  }
}

export async function fechar() { if (pronto) { const sql = await pronto; pronto = undefined; await sql.end(); } }
