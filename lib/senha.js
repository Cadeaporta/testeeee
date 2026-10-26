// Senhas: hash scrypt com sal próprio ("s1$sal$hash") e regras mínimas para senhas novas.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashSenha(senha) {
  const sal = randomBytes(16);
  return 's1$' + sal.toString('hex') + '$' + scryptSync(String(senha), sal, 64).toString('hex');
}

export function conferirSenha(senha, guardado) {
  const [v, sal, h] = String(guardado || '').split('$');
  if (v !== 's1' || !sal || !h) return false;
  const a = Buffer.from(h, 'hex'), b = scryptSync(String(senha), Buffer.from(sal, 'hex'), 64);
  return a.length === b.length && timingSafeEqual(a, b);
}
// gasta o mesmo tempo quando o usuário não existe, para não revelar quais usuários existem
const FALSO = hashSenha('falso');
export const conferirFalso = (senha) => { conferirSenha(senha, FALSO); return false; };

const FRACAS = new Set(['12345678', '123456789', '1234567890', 'senha123', 'password', 'qwerty123', 'mudar123', 'hospital', 'hospital123']);
// devolve a mensagem de erro, ou null se a senha serve
export function validarSenhaNova(nova, usuario = '') {
  const s = String(nova || '');
  if (s.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (s.length > 100) return 'A senha é longa demais.';
  if (/^(.)\1+$/.test(s) || FRACAS.has(s.toLowerCase())) return 'Essa senha é fácil demais de adivinhar. Escolha outra.';
  if (usuario && s.toLowerCase() === String(usuario).toLowerCase()) return 'A senha não pode ser igual ao usuário.';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'Use letras e números na senha.';
  return null;
}

// senha temporária legível (sem 0/O/1/l)
export function senhaTemporaria() {
  const L = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', N = '23456789';
  const b = randomBytes(10); let s = '';
  for (let i = 0; i < 8; i++) s += (i % 4 === 3 ? N : L)[b[i] % (i % 4 === 3 ? N.length : L.length)];
  return s.slice(0, 4) + '-' + s.slice(4);
}
