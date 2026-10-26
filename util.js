// Utilidades comuns da API.
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export const sha256 = (dado) => createHash('sha256').update(dado).digest('hex');
export const tokenAleatorio = () => randomBytes(32).toString('base64url');

export function falha(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }

export async function lerCorpo(req, limite = 2_000_000) {
  const partes = []; let tam = 0;
  for await (const c of req) { tam += c.length; if (tam > limite) throw falha('Envio grande demais.', 413); partes.push(c); }
  const txt = Buffer.concat(partes).toString('utf8');
  if (!txt) return {};
  try { return JSON.parse(txt); } catch { throw falha('Dados inválidos.'); }
}

export const limpar = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// JSON com chaves em ordem fixa: o mesmo conteúdo sempre gera o mesmo hash
export function jsonCanonico(v) {
  if (Array.isArray(v)) return '[' + v.map(jsonCanonico).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + jsonCanonico(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}

// ---- validações (as mesmas regras do protótipo de termos) ----
export const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
export function cpfValido(v) {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
export const cpfFormatado = (v) => soDigitos(v).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
export const cpfMascara = (v) => '***.***.***-' + soDigitos(v).slice(-2);
export const emailValido = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export function telefoneFormatado(v) {
  const d = soDigitos(v);
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return null;
}

// ---- CPF cifrado (AES-256-GCM). A chave fica só no servidor (CPF_CHAVE, 64 caracteres hex). ----
function chaveCpf() {
  const k = process.env.CPF_CHAVE || '';
  if (!/^[0-9a-f]{64}$/i.test(k)) throw falha('CPF_CHAVE não configurada no servidor.', 500);
  return Buffer.from(k, 'hex');
}
export function cifrarCpf(cpf) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', chaveCpf(), iv);
  const dado = Buffer.concat([c.update(soDigitos(cpf), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), dado.toString('base64')].join('.');
}
export function decifrarCpf(txt) {
  if (!txt) return null;
  const [v, iv, tag, dado] = txt.split('.');
  if (v !== 'v1') return null;
  const d = createDecipheriv('aes-256-gcm', chaveCpf(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dado, 'base64')), d.final()]).toString('utf8');
}

// imagem de assinatura enviada pela tela (data:image/png;base64,...)
export function pngDaTela(v) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(v || ''));
  if (!m) throw falha('Assinatura inválida. Desenhe de novo.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 200) throw falha('A assinatura está vazia. Desenhe no quadro.');
  if (buf.length > 600_000) throw falha('Assinatura grande demais.');
  if (buf.readUInt32BE(0) !== 0x89504e47) throw falha('Assinatura inválida.');
  return buf;
}

export const dataHora = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const data = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
