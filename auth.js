// Login e perfis. Piloto: usuário e senha. Login Microsoft (Entra ID) entra aqui quando o registro do
// aplicativo existir (ENTRA_TENANT_ID + ENTRA_CLIENT_ID): a pessoa é achada pelo e-mail/oid do token.
import { db } from './db.js';
import { sha256, tokenAleatorio, falha } from './util.js';
import { conferirSenha, conferirFalso } from './senha.js';

const HORAS_SESSAO = 12;
export const PAPEIS = { admin: 'Administrador', tecnico: 'Técnico', colaborador: 'Colaborador', leitor: 'Leitor' };

export const publico = (u) => ({ id: u.id, login: u.login, nome: u.nome, email: u.email, papel: u.papel, papelNome: PAPEIS[u.papel], trocarSenha: u.trocar_senha, temAssinatura: !!u.tem_assinatura });

export async function entrar(login, senha, ip) {
  const sql = await db();
  login = String(login || '').trim().toLowerCase();
  const chave = 'login:' + login;
  const [t] = await sql`select falhas, bloqueado_ate from tentativas where chave = ${chave}`;
  if (t?.bloqueado_ate && new Date(t.bloqueado_ate) > new Date()) throw falha('Muitas tentativas erradas. Espere 15 minutos.', 429);
  const [u] = await sql`select * from usuarios where login = ${login}`;
  const ok = u && u.ativo && u.senha_hash ? conferirSenha(String(senha || ''), u.senha_hash) : conferirFalso(String(senha || ''));
  if (!ok) {
    await sql`insert into tentativas (chave, falhas) values (${chave}, 1)
      on conflict (chave) do update set falhas = case when tentativas.bloqueado_ate < now() then 1 else tentativas.falhas + 1 end,
      bloqueado_ate = case when tentativas.bloqueado_ate < now() then null
        when tentativas.falhas + 1 >= 5 then now() + interval '15 minutes' else null end`;
    throw falha('Usuário ou senha incorretos.', 401);
  }
  await sql`delete from tentativas where chave = ${chave}`;
  return { token: await criarSessao(u.id), usuario: publico(u) };
}

export async function criarSessao(usuarioId) {
  const sql = await db(), token = 'tts_' + tokenAleatorio();
  await sql`delete from sessoes where expira_em < now()`;
  await sql`insert into sessoes (token_hash, usuario_id, expira_em) values (${sha256(token)}, ${usuarioId}, now() + ${HORAS_SESSAO + ' hours'}::interval)`;
  return token;
}

export async function sair(token) { const sql = await db(); await sql`delete from sessoes where token_hash = ${sha256(token)}`; }

// devolve o usuário da sessão ou lança 401
export async function quem(req, { permitirTroca = false } = {}) {
  const token = String(req.headers['x-sessao'] || '');
  if (!token) throw falha('Entre com seu usuário.', 401);
  const sql = await db();
  const [u] = await sql`select u.*, u.assinatura_png is not null as tem_assinatura from sessoes s join usuarios u on u.id = s.usuario_id
    where s.token_hash = ${sha256(token)} and s.expira_em > now() and u.ativo`;
  if (!u) throw falha('Sessão expirada. Entre de novo.', 401);
  if (u.trocar_senha && !permitirTroca) throw falha('Troque a senha provisória antes de continuar.', 403);
  u.token = token;
  return u;
}

export function exigir(u, ...papeis) {
  if (!papeis.includes(u.papel)) throw falha('Seu perfil não permite esta ação.', 403);
}

export const entraConfigurado = () => !!(process.env.ENTRA_TENANT_ID && process.env.ENTRA_CLIENT_ID);
