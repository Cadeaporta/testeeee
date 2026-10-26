// Teste ponta a ponta com banco em memória (não toca .local-db nem produção): npm test
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const pg = await PGlite.create();
const srv = new PGLiteSocketServer({ db: pg, port: 55498, host: '127.0.0.1', maxConnections: 4 });
await srv.start();
Object.assign(process.env, { DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:55498/postgres', DB_CONEXOES: '1', CPF_CHAVE: 'ab'.repeat(32), PORT: '3098' });
const { db } = await import('../lib/db.js');
const { hashSenha } = await import('../lib/senha.js');
const sql = await db();
await sql`insert into usuarios (login, nome, papel, senha_hash, trocar_senha) values ('adm', 'Admin Teste', 'admin', ${hashSenha('Admin2026x')}, false)`;
await import('../server.mjs');
await new Promise((r) => setTimeout(r, 300));

const BASE = 'http://localhost:3098';
let ok = 0, ruim = 0;
const t = (nome, cond, extra = '') => { if (cond) { ok++; if (process.env.VERBOSE) console.log('ok   ', nome); } else { ruim++; console.log('FALHA', nome, extra); } };
async function api(caminho, { token, json, metodo } = {}) {
  const r = await fetch(BASE + caminho, { method: metodo || (json ? 'POST' : 'GET'), headers: { ...(token ? { 'x-sessao': token } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) }, body: json ? JSON.stringify(json) : undefined });
  const tipo = r.headers.get('content-type') || '';
  return { s: r.status, j: tipo.includes('json') ? await r.json() : null, buf: tipo.includes('pdf') ? Buffer.from(await r.arrayBuffer()) : null };
}
// PNG mínimo válido (assinatura): 40x20 com alguns pixels
const { PNG_TESTE } = await import('./png-teste.mjs');

let r = await api('/api/login', { json: { login: 'adm', senha: 'errada' } });
t('senha errada recusada', r.s === 401);
r = await api('/api/login', { json: { login: 'adm', senha: 'Admin2026x' } });
t('login admin', r.s === 200 && r.j.token, JSON.stringify(r.j));
const adm = r.j.token;

// técnico e leitor
r = await api('/api/usuarios', { token: adm, json: { login: 'marcos.lima', nome: 'Marcos Lima', papel: 'tecnico', email: 'marcos@hospital.com' } });
t('cria técnico', r.s === 200 && r.j.senha);
const senhaTec = r.j.senha;
r = await api('/api/login', { json: { login: 'marcos.lima', senha: senhaTec } });
let tec = r.j.token;
r = await api('/api/painel', { token: tec });
t('senha provisória bloqueia uso', r.s === 403);
r = await api('/api/senha', { token: tec, json: { atual: senhaTec, nova: 'Tecnico2026x' } });
t('troca de senha', r.s === 200);
r = await api('/api/usuarios', { token: adm, json: { login: 'leitor1', nome: 'Leitor Um', papel: 'leitor' } });
const lt = (await api('/api/login', { json: { login: 'leitor1', senha: r.j.senha } })).j.token;
await api('/api/senha', { token: lt, json: { atual: r.j.senha, nova: 'Leitor2026x' } });
r = await api('/api/usuarios', { token: tec });
t('técnico não gerencia usuários', r.s === 403);

// ativo
const cat = (await api('/api/catalogo', { token: tec })).j;
t('catálogo com perfis', cat.perfis.length >= 3 && cat.acessorios.includes('Carregador'));
const perfil = cat.perfis.find((p) => p.nome === 'Latitude 5420');
r = await api('/api/ativos', { token: tec, json: { perfilId: perfil.id, patrimonio: '004512', serviceTag: 'abc1234', garantia: '30/11/2026' } });
t('cadastra ativo pelo perfil', r.s === 200 && r.j.ativo.garantia === '30/11/2026' && r.j.ativo.modelo === 'Dell Latitude 5420' && r.j.ativo.serviceTag === 'ABC1234' && r.j.ativo.status === 'disponivel', JSON.stringify(r.j));
r = await api('/api/ativos', { token: tec, json: { perfilId: perfil.id, patrimonio: '004512', serviceTag: 'X' } });
t('patrimônio duplicado recusado', r.s === 409);
r = await api('/api/ativos', { token: lt, json: { perfilId: perfil.id, patrimonio: '009999', serviceTag: 'X' } });
t('leitor não cadastra', r.s === 403);
r = await api('/api/ativos/importar', { token: tec, json: { csv: 'patrimonio;service_tag;categoria;marca;modelo;config;garantia\n004533;LEN555;Notebook;Lenovo;Lenovo ThinkPad L14;i5 16GB;2027-01-31\n004540;OPT9;Desktop;Dell;Dell OptiPlex 3000;i5 8GB;\n004541;;Desktop;Dell;X;;' } });
t('importa CSV com erro por linha', r.s === 200 && r.j.cadastrados === 2 && r.j.erros.length === 1, JSON.stringify(r.j));

// entrega
const entrega = { patrimonio: '004512', colaborador: 'Ana Souza', setor: 'Enfermagem', telefone: '19999990000', cpf: '529.982.247-25', chamado: '48213', local: 'UTI Adulto', acessorios: ['Carregador', 'Mouse', 'Inválido'], email: 'ana@hospital.com' };
r = await api('/api/entregas/conferir', { token: tec, json: { ...entrega, cpf: '111.111.111-11' } });
t('CPF inválido recusado', r.s === 400 && /CPF/.test(r.j.erro));
r = await api('/api/entregas/conferir', { token: tec, json: entrega });
t('conferir traz dados do cadastro', r.s === 200 && r.j.ativo.serviceTag === 'ABC1234' && r.j.tecnico.nome === 'Marcos Lima' && r.j.colaborador.cpf === '***.***.***-25' && r.j.entrega.acessorios.length === 2, JSON.stringify(r.j));
r = await api('/api/entregas', { token: tec, json: entrega });
t('sem assinatura do técnico não gera', r.s === 409 && /assinatura/.test(r.j.erro));
r = await api('/api/eu/assinatura', { token: tec, json: { assinatura: 'data:image/png;base64,' + PNG_TESTE } });
t('grava assinatura do técnico', r.s === 200, JSON.stringify(r.j));
r = await api('/api/entregas', { token: tec, json: entrega });
const ano = new Date().getFullYear();
t('gera termo numerado', r.s === 200 && r.j.termo.numero === `ENT-${ano}-000001` && r.j.termo.status === 'gerado' && /^[0-9a-f]{64}$/.test(r.j.termo.hash), JSON.stringify(r.j));
const num = r.j.termo.numero;
r = await api('/api/entregas', { token: tec, json: { ...entrega, colaborador: 'Outra Pessoa' } });
t('um ativo com uma pessoa por vez', r.s === 409);
const cpfNoBanco = (await sql`select cpf_cifrado, cpf_mascara from termos where numero = ${num}`)[0];
t('CPF cifrado no banco', !cpfNoBanco.cpf_cifrado.includes('52998224725') && cpfNoBanco.cpf_mascara === '***.***.***-25');
r = await api(`/api/termos/${num}/pdf`, { token: tec });
t('PDF de prévia', r.s === 200 && r.buf.subarray(0, 4).toString() === '%PDF' && r.buf.length > 3000);

// painel
r = await api('/api/painel', { token: lt });
t('painel: quem está com o quê', r.s === 200 && r.j.contagem.emUso === 1 && r.j.contagem.disponiveis === 2 && r.j.contagem.aceitesPendentes === 1 && r.j.ativos.find((a) => a.patrimonio === '004512').responsavel === 'Ana Souza');
r = await api('/api/painel?q=ana', { token: lt });
t('busca por pessoa', r.j.ativos.length === 1);

// devolução antes do aceite
r = await api('/api/devolucoes', { token: tec, json: { patrimonio: '004512', condicao: 'sem_avarias', destino: 'disponivel' } });
t('devolução exige termo assinado', r.s === 409);

// envio e aceite
r = await api(`/api/termos/${num}/enviar`, { token: tec, json: {} });
t('envia para assinatura (link)', r.s === 200 && r.j.link.includes('/assinar.html#') && r.j.whatsapp.includes(num));
const token = r.j.link.split('#')[1];
r = await api(`/api/assinar/${token}`);
t('colaborador abre o termo pelo link', r.s === 200 && r.j.termo.numero === num && r.j.termo.cpf === '***.***.***-25' && r.j.termo.telefone === undefined);
r = await api(`/api/assinar/xyz`);
t('link falso recusado', r.s === 404);
r = await api(`/api/assinar/${token}`, { json: { conferi: false, assinatura: 'data:image/png;base64,' + PNG_TESTE } });
t('aceite exige conferência', r.s === 400);
r = await api(`/api/assinar/${token}`, { json: { conferi: true, assinatura: 'data:image/png;base64,AAAA' } });
t('assinatura vazia recusada', r.s === 400);
r = await api(`/api/assinar/${token}`, { json: { conferi: true, assinatura: 'data:image/png;base64,' + PNG_TESTE } });
t('aceite registrado', r.s === 200 && r.j.numero === num && /^[0-9a-f]{64}$/.test(r.j.pdfHash), JSON.stringify(r.j));
const pdfHash = r.j.pdfHash;
r = await api(`/api/assinar/${token}`, { json: { conferi: true, assinatura: 'data:image/png;base64,' + PNG_TESTE } });
t('não assina duas vezes', r.s === 409);
r = await api(`/api/assinar/${token}/pdf`);
const { createHash } = await import('node:crypto');
t('colaborador baixa a cópia assinada (hash confere)', r.s === 200 && createHash('sha256').update(r.buf).digest('hex') === pdfHash);
r = await api(`/api/termos/${num}`, { token: tec });
t('técnico vê Assinado', r.j.termo.status === 'assinado' && r.j.termo.aceiteNome === 'Ana Souza');
r = await api(`/api/termos/${num}/cancelar`, { token: tec, json: { motivo: 'teste de cancelamento' } });
t('assinado não pode ser cancelado', r.s === 409);

// devolução
r = await api('/api/devolucoes/consultar/004512', { token: tec });
t('devolução mostra quem está com o ativo', r.s === 200 && r.j.termo.colaborador === 'Ana Souza' && r.j.recebidoPor === 'Marcos Lima');
r = await api('/api/devolucoes', { token: tec, json: { patrimonio: '004512', condicao: 'com_avaria', destino: 'manutencao' } });
t('avaria exige observação', r.s === 400);
r = await api('/api/devolucoes', { token: tec, json: { patrimonio: '004512', condicao: 'sem_avarias', destino: 'disponivel', obs: 'Devolvido com carregador.' } });
t('devolução encerra a custódia', r.s === 200 && r.j.numero === num);
r = await api('/api/ativos/004512', { token: lt });
t('ativo disponível e histórico completo', r.j.ativo.status === 'disponivel' && !r.j.ativo.responsavel && ['Devolução', 'Aceite do colaborador', 'Termo enviado para assinatura', 'Entrega', 'Cadastro do ativo'].every((a) => r.j.historico.some((h) => h.acao === a)), JSON.stringify(r.j.historico.map((h) => h.acao)));
t('termo encerrado no histórico', r.j.termos[0].status === 'encerrado');

// nova entrega do mesmo ativo + cancelamento
r = await api('/api/entregas', { token: tec, json: { ...entrega, colaborador: 'Carlos Prado' } });
t('ativo devolvido pode ser entregue de novo', r.s === 200 && r.j.termo.numero === `ENT-${ano}-000002`);
r = await api(`/api/termos/${r.j.termo.numero}/cancelar`, { token: tec, json: { motivo: 'entrega desistida' } });
t('cancela termo não assinado e libera o ativo', r.s === 200 && (await api('/api/ativos/004512', { token: tec })).j.ativo.status === 'disponivel');

// auditoria imutável
let travou = false;
try { await sql`update auditoria set acao = 'x'`; } catch { travou = true; }
t('auditoria não pode ser alterada', travou);
travou = false;
try { await sql`delete from auditoria`; } catch { travou = true; }
t('auditoria não pode ser apagada', travou);

// colaborador com login vê só os próprios termos
r = await api('/api/usuarios', { token: adm, json: { login: 'ana.souza', nome: 'Ana Souza', papel: 'colaborador', email: 'ana@hospital.com' } });
const col = (await api('/api/login', { json: { login: 'ana.souza', senha: r.j.senha } })).j.token;
await api('/api/senha', { token: col, json: { atual: r.j.senha, nova: 'Colab2026x' } });
r = await api('/api/termos', { token: col });
t('colaborador vê só os próprios termos', r.s === 200 && r.j.termos.length === 2 && r.j.termos.every((x) => x.colaboradorEmail === 'ana@hospital.com'));
r = await api('/api/painel', { token: col });
t('colaborador não vê o painel', r.s === 403);

console.log(`\n${ok} passaram, ${ruim} falharam`);
process.exit(ruim ? 1 : 0);
