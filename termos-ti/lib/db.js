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
    // ids e contadores são bigint no schema da TI; os valores cabem com folga em number
    types: { bigint: { to: 20, from: [20], parse: (x) => Number(x), serialize: (x) => String(x) } },
  });
  await migrar(sql);
  return sql;
}

// Controle de versões no padrão da TI: tabela schema_migrations(version, aplicado_em), version = nome do arquivo sem ".sql".
// No banco da TI a 001_schema_base já vem registrada e não roda de novo.
async function migrar(sql) {
  await sql`create table if not exists schema_migrations (version text primary key, aplicado_em timestamptz not null default now())`;
  const feitas = new Set((await sql`select version from schema_migrations`).map((r) => r.version));
  const pasta = join(process.cwd(), 'db');
  for (const f of readdirSync(pasta).filter((n) => /^\d{3}_.*\.sql$/.test(n)).sort()) {
    const versao = f.replace(/\.sql$/, '');
    if (feitas.has(versao)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(pasta, f), 'utf8'));
      await tx`insert into schema_migrations (version) values (${versao})`;
    });
    console.log('migração aplicada:', versao);
  }
}

export async function fechar() { if (pronto) { const sql = await pronto; pronto = undefined; await sql.end(); } }
