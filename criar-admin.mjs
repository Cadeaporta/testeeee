// Cria um administrador no banco de produção (senha provisória, troca obrigatória no 1º acesso).
//   DATABASE_URL=... node scripts/criar-admin.mjs <usuario> "<Nome>" [email]
const [login, nome, email] = process.argv.slice(2);
if (!login || !nome) { console.log('uso: DATABASE_URL=... node scripts/criar-admin.mjs <usuario> "<Nome>" [email]'); process.exit(1); }
const { db, fechar } = await import('../lib/db.js');
const { hashSenha, senhaTemporaria } = await import('../lib/senha.js');
const sql = await db(), senha = senhaTemporaria();
const [ex] = await sql`select id from usuarios where login = ${login.toLowerCase()}`;
if (ex) console.log('já existe:', login);
else {
  await sql`insert into usuarios (login, nome, email, papel, senha_hash) values (${login.toLowerCase()}, ${nome}, ${email || null}, 'admin', ${hashSenha(senha)})`;
  console.log(`criado: ${login.toLowerCase()}  senha provisória: ${senha}  (trocar no primeiro acesso)`);
}
await fechar();
