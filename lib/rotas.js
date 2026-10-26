// Rotas da API. Cada rota: [método, padrão, função(ctx)]; ctx = { req, params, query, corpo(), ip }.
// Regras do servidor (MVP): um ativo só com uma pessoa por vez; o técnico vem do login; toda ação vai para a auditoria.
import { db } from './db.js';
import { entrar, sair, quem, exigir, publico, entraConfigurado, PAPEIS } from './auth.js';
import { hashSenha, validarSenhaNova, senhaTemporaria, conferirSenha } from './senha.js';
import { gerarPdf, VERSAO_TEXTO } from './pdf.js';
import {
  falha, limpar, sha256, tokenAleatorio, jsonCanonico, cpfValido, cpfFormatado, cpfMascara, emailValido,
  telefoneFormatado, cifrarCpf, decifrarCpf, pngDaTela, dataHora, data,
} from './util.js';

const CATEGORIAS = ['Notebook', 'Desktop', 'All-in-one', 'Monitor', 'Impressora', 'Outro'];
const MARCAS = ['Dell', 'Lenovo', 'Outro'];
const ACESSORIOS = ['Carregador', 'Mouse', 'Teclado', 'Monitor', 'Headset', 'Mochila'];
const CONDICOES = { sem_avarias: 'Sem avarias', com_avaria: 'Com avaria', falta_acessorio: 'Falta acessório' };
const DESTINOS = { disponivel: 'Disponível', manutencao: 'Manutenção' };
const STATUS_ATIVO = { disponivel: 'Disponível', em_uso: 'Em uso', manutencao: 'Em manutenção', baixado: 'Baixado' };
const STATUS_TERMO = { gerado: 'Gerado', enviado: 'Aguardando assinatura', assinado: 'Assinado', encerrado: 'Encerrado (devolvido)', cancelado: 'Cancelado' };
const DIAS_LINK = 7, DIAS_COPIA = 30;

async function auditar(tx, u, acao, { ativo = null, termo = null, detalhe = {} } = {}) {
  await tx`insert into auditoria (usuario_id, quem, acao, ativo_id, termo_id, detalhe)
    values (${u?.id ?? null}, ${u?.nome ?? detalhe.quem ?? 'sistema'}, ${acao}, ${ativo}, ${termo}, ${tx.json(detalhe)})`;
}

const urlBase = (req) => process.env.URL_PUBLICA || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

// ---------- ativos ----------
const ativoPublico = (a) => ({
  id: a.id, patrimonio: a.patrimonio, serviceTag: a.service_tag, categoria: a.categoria, marca: a.marca, modelo: a.modelo,
  // coluna date: o driver devolve meia-noite UTC; formatar pela parte da data, sem fuso
  config: a.config, garantia: a.garantia ? new Date(a.garantia).toISOString().slice(0, 10).split('-').reverse().join('/') : null,
  status: a.status, statusNome: STATUS_ATIVO[a.status], responsavel: a.responsavel || null, termoAtual: a.termo_numero || null, termoStatus: a.termo_status || null,
});

function validarAtivo(b, perfil) {
  const patrimonio = limpar(b.patrimonio, 30).toUpperCase();
  if (!/^[A-Z0-9.-]{3,30}$/.test(patrimonio)) throw falha('Patrimônio: de 3 a 30 letras ou números.');
  const serviceTag = limpar(b.serviceTag, 40).toUpperCase();
  if (!serviceTag) throw falha('Informe a Service Tag (número de série).');
  const categoria = perfil?.categoria || limpar(b.categoria, 30);
  const marca = perfil?.marca || limpar(b.marca, 30);
  const modelo = perfil?.modelo || limpar(b.modelo, 80);
  const config = perfil?.config || limpar(b.config, 120);
  if (!CATEGORIAS.includes(categoria)) throw falha('Escolha a categoria.');
  if (!marca) throw falha('Escolha a marca.');
  if (!modelo) throw falha('Informe o modelo.');
  let garantia = null;
  if (b.garantia) {
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(b.garantia);
    garantia = br ? `${br[3]}-${br[2]}-${br[1]}` : String(b.garantia);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(garantia) || isNaN(new Date(garantia))) throw falha(`Fim da garantia inválido (${b.garantia}).`);
  }
  return { patrimonio, serviceTag, categoria, marca, modelo, config, garantia, perfilId: perfil?.id ?? null };
}

async function cadastrarAtivo(sql, u, b) {
  let perfil = null;
  if (b.perfilId) { [perfil] = await sql`select * from perfis where id = ${Number(b.perfilId)} and ativo`; if (!perfil) throw falha('Perfil não encontrado.'); }
  const a = validarAtivo(b, perfil);
  return sql.begin(async (tx) => {
    const [ex] = await tx`select id from ativos where patrimonio = ${a.patrimonio}`;
    if (ex) throw falha(`O patrimônio ${a.patrimonio} já está cadastrado.`, 409);
    const [novo] = await tx`insert into ativos (patrimonio, service_tag, categoria, marca, modelo, config, garantia, perfil_id, criado_por)
      values (${a.patrimonio}, ${a.serviceTag}, ${a.categoria}, ${a.marca}, ${a.modelo}, ${a.config}, ${a.garantia}, ${a.perfilId}, ${u.id}) returning *`;
    await auditar(tx, u, 'Cadastro do ativo', { ativo: novo.id, detalhe: { patrimonio: novo.patrimonio, modelo: novo.modelo } });
    return novo;
  });
}

// CSV: patrimonio;service_tag;categoria;marca;modelo;config;garantia (cabeçalho opcional, ; ou ,)
function lerCsv(txt) {
  const linhas = String(txt || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!linhas.length) throw falha('O arquivo está vazio.');
  const sep = linhas[0].includes(';') ? ';' : ',';
  const tab = linhas.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
  if (/patrim/i.test(tab[0][0])) tab.shift();
  if (tab.length > 500) throw falha('No máximo 500 ativos por arquivo.');
  return tab.map(([patrimonio, serviceTag, categoria, marca, modelo, config, garantia]) => ({ patrimonio, serviceTag, categoria, marca, modelo, config, garantia }));
}

// ---------- termos ----------
async function proximoNumero(tx, tipo = 'ENT') {
  const ano = new Date().toLocaleString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 4);
  const chave = `${tipo}-${ano}`;
  const [r] = await tx`insert into contadores (chave, ultimo) values (${chave}, 1)
    on conflict (chave) do update set ultimo = contadores.ultimo + 1 returning ultimo`;
  return `${chave}-${String(r.ultimo).padStart(6, '0')}`;
}

async function validarEntrega(sql, b) {
  const patrimonio = limpar(b.patrimonio, 30).toUpperCase();
  const [ativo] = await sql`select a.*, t.colaborador_nome as responsavel, t.numero as termo_numero
    from ativos a left join termos t on t.ativo_id = a.id and t.status in ('gerado', 'enviado', 'assinado') where a.patrimonio = ${patrimonio}`;
  if (!ativo) throw falha(`Patrimônio ${patrimonio || '(vazio)'} não está cadastrado. Cadastre o ativo antes.`, 404);
  if (ativo.responsavel) throw falha(`Este ativo já está com ${ativo.responsavel} (termo ${ativo.termo_numero}). Registre a devolução antes.`, 409);
  if (ativo.status !== 'disponivel') throw falha(`Este ativo está ${STATUS_ATIVO[ativo.status].toLowerCase()} e não pode ser entregue.`, 409);
  const nome = limpar(b.colaborador, 80), setor = limpar(b.setor, 60), local = limpar(b.local, 80), chamado = limpar(b.chamado, 20);
  const email = limpar(b.email, 120).toLowerCase(), telefone = telefoneFormatado(b.telefone);
  const erros = [];
  if (nome.split(' ').length < 2) erros.push('Nome completo do colaborador.');
  if (!cpfValido(b.cpf)) erros.push('CPF inválido.');
  if (!setor) erros.push('Setor.');
  if (!telefone) erros.push('Telefone com DDD.');
  if (email && !emailValido(email)) erros.push('E-mail inválido.');
  if (!/^\d{1,20}$/.test(chamado)) erros.push('Nº do chamado (só números).');
  if (!local) erros.push('Local do ativo.');
  const acessorios = [...new Set((Array.isArray(b.acessorios) ? b.acessorios : []).filter((a) => ACESSORIOS.includes(a)))];
  if (erros.length) throw falha('Confira: ' + erros.join(' '));
  return { ativo, colaborador: { nome, setor, telefone, email: email || null }, cpf: cpfFormatado(b.cpf), entrega: { local, chamado, acessorios } };
}

function retrato(e, tecnico, agora) {
  return {
    texto: VERSAO_TEXTO,
    colaborador: { ...e.colaborador, cpf: cpfMascara(e.cpf) },
    ativo: { patrimonio: e.ativo.patrimonio, serviceTag: e.ativo.service_tag, categoria: e.ativo.categoria, marca: e.ativo.marca, modelo: e.ativo.modelo, config: e.ativo.config },
    entrega: { ...e.entrega, data: data(agora) },
    tecnico: { id: tecnico.id, nome: tecnico.nome },
  };
}

const termoPublico = (t, completo = false) => ({
  numero: t.numero, tipo: t.tipo, status: t.status, statusNome: STATUS_TERMO[t.status],
  colaborador: t.colaborador_nome, colaboradorEmail: t.colaborador_email, cpf: t.cpf_mascara, setor: t.setor, telefone: t.telefone,
  chamado: t.chamado, local: t.local_ativo, acessorios: t.acessorios, patrimonio: t.dados.ativo.patrimonio, equipamento: t.dados.ativo.modelo,
  serviceTag: t.dados.ativo.serviceTag, config: t.dados.ativo.config, tecnico: t.dados.tecnico.nome,
  criadoEm: dataHora(t.criado_em), enviadoEm: dataHora(t.enviado_em), assinadoEm: dataHora(t.assinado_em), encerradoEm: dataHora(t.encerrado_em),
  hash: t.hash_dados, pdfHash: t.pdf_hash, aceiteNome: t.aceite_nome, aceiteIdentidade: t.aceite_identidade,
  ...(completo ? { linkExpira: dataHora(t.token_expira), canceladoMotivo: t.cancelado_motivo } : {}),
});

async function pdfDoTermo(sql, t) {
  if (t.pdf) return t.pdf;
  const [tec] = await sql`select assinatura_png from usuarios where id = ${t.tecnico_id}`;
  return gerarPdf({ numero: t.numero, dados: t.dados, cpf: cpfFormatado(decifrarCpf(t.cpf_cifrado)), geradoEm: dataHora(t.criado_em), hash: t.hash_dados, assinaturaTecnico: tec?.assinatura_png });
}

async function termoPorNumero(sql, numero) {
  const [t] = await sql`select * from termos where numero = ${String(numero).toUpperCase()}`;
  if (!t) throw falha('Termo não encontrado.', 404);
  return t;
}

async function termoPorLink(sql, token) {
  const [t] = await sql`select * from termos where token_hash = ${sha256(String(token))}`;
  if (!t) throw falha('Link inválido. Peça um novo link ao técnico.', 404);
  const exp = new Date(t.token_expira);
  if (t.status === 'enviado' && exp < new Date()) throw falha('Este link expirou. Peça um novo link ao técnico.', 410);
  if (t.status === 'cancelado') throw falha('Este termo foi cancelado pelo técnico.', 410);
  if (t.status !== 'enviado' && Date.now() - new Date(t.assinado_em || 0) > DIAS_COPIA * 864e5) throw falha('Este link não está mais disponível.', 410);
  return t;
}

// ---------- rotas ----------
export const rotas = [
  // sessão
  ['GET', '/api/config', async () => ({ entra: entraConfigurado(), entraTenant: process.env.ENTRA_TENANT_ID || null, entraCliente: process.env.ENTRA_CLIENT_ID || null })],
  ['POST', '/api/login', async ({ corpo, ip }) => { const b = await corpo(); return entrar(b.login, b.senha, ip); }],
  ['POST', '/api/sair', async ({ req }) => { const u = await quem(req, { permitirTroca: true }); await sair(u.token); return { ok: true }; }],
  ['GET', '/api/eu', async ({ req }) => publico(await quem(req, { permitirTroca: true }))],
  ['POST', '/api/senha', async ({ req, corpo }) => {
    const u = await quem(req, { permitirTroca: true }), b = await corpo(), sql = await db();
    if (!conferirSenha(String(b.atual || ''), u.senha_hash)) throw falha('A senha atual não confere.');
    const erro = validarSenhaNova(b.nova, u.login); if (erro) throw falha(erro);
    await sql`update usuarios set senha_hash = ${hashSenha(b.nova)}, trocar_senha = false where id = ${u.id}`;
    await sql`delete from sessoes where usuario_id = ${u.id} and token_hash <> ${sha256(u.token)}`;
    return { ok: true };
  }],
  ['POST', '/api/eu/assinatura', async ({ req, corpo }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico');
    const png = pngDaTela((await corpo()).assinatura);
    await sql.begin(async (tx) => { await tx`update usuarios set assinatura_png = ${png} where id = ${u.id}`; await auditar(tx, u, 'Assinatura do técnico gravada no perfil'); });
    return { ok: true };
  }],
  ['GET', '/api/eu/assinatura', async ({ req }) => {
    const u = await quem(req), sql = await db();
    const [r] = await sql`select assinatura_png from usuarios where id = ${u.id}`;
    if (!r?.assinatura_png) throw falha('Sem assinatura.', 404);
    return { tipo: 'image/png', corpo: r.assinatura_png };
  }],

  // painel "quem está com o quê"
  ['GET', '/api/painel', async ({ req, query }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico', 'leitor');
    const [c] = await sql`select count(*) filter (where status = 'em_uso')::int as em_uso, count(*) filter (where status = 'disponivel')::int as disponivel,
      count(*) filter (where status = 'manutencao')::int as manutencao from ativos`;
    const [p] = await sql`select count(*)::int as n from termos where status in ('gerado', 'enviado')`;
    const q = limpar(query.q, 60), st = STATUS_ATIVO[query.status] ? query.status : null;
    const lista = await sql`select a.*, t.colaborador_nome as responsavel, t.numero as termo_numero, t.status as termo_status
      from ativos a left join termos t on t.ativo_id = a.id and t.status in ('gerado', 'enviado', 'assinado')
      where (${st}::text is null or a.status = ${st})
        and (${q} = '' or a.patrimonio ilike ${'%' + q + '%'} or a.modelo ilike ${'%' + q + '%'} or a.service_tag ilike ${'%' + q + '%'} or t.colaborador_nome ilike ${'%' + q + '%'})
      order by a.patrimonio limit 300`;
    return { contagem: { emUso: c.em_uso, disponiveis: c.disponivel, manutencao: c.manutencao, aceitesPendentes: p.n }, ativos: lista.map(ativoPublico) };
  }],

  // cadastros de apoio
  ['GET', '/api/catalogo', async ({ req }) => {
    await quem(req); const sql = await db();
    const perfis = await sql`select id, nome, categoria, marca, modelo, config from perfis where ativo order by nome`;
    return { perfis, categorias: CATEGORIAS, marcas: MARCAS, acessorios: ACESSORIOS, condicoes: CONDICOES, destinos: DESTINOS };
  }],

  // ativos
  ['POST', '/api/ativos', async ({ req, corpo }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico');
    return { ativo: ativoPublico(await cadastrarAtivo(sql, u, await corpo())) };
  }],
  ['POST', '/api/ativos/importar', async ({ req, corpo }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico');
    const linhas = lerCsv((await corpo()).csv), ok = [], erros = [];
    for (const [i, l] of linhas.entries()) {
      try {
        const [perfil] = l.modelo ? [] : await sql`select * from perfis where nome ilike ${l.categoria || ''}`;
        ok.push((await cadastrarAtivo(sql, u, { ...l, perfilId: perfil?.id })).patrimonio);
      } catch (e) { erros.push(`Linha ${i + 1} (${l.patrimonio || 'sem patrimônio'}): ${e.message}`); }
    }
    return { cadastrados: ok.length, erros };
  }],
  ['GET', '/api/ativos/:patrimonio', async ({ req, params }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico', 'leitor');
    const [a] = await sql`select a.*, t.colaborador_nome as responsavel, t.numero as termo_numero, t.status as termo_status
      from ativos a left join termos t on t.ativo_id = a.id and t.status in ('gerado', 'enviado', 'assinado') where a.patrimonio = ${params.patrimonio.toUpperCase()}`;
    if (!a) throw falha('Patrimônio não cadastrado.', 404);
    const termos = await sql`select * from termos where ativo_id = ${a.id} order by criado_em desc`;
    const historico = await sql`select em, quem, acao, detalhe, termo_id from auditoria where ativo_id = ${a.id} order by em desc, id desc limit 200`;
    const [entrega] = a.termo_numero ? await sql`select criado_em from termos where numero = ${a.termo_numero}` : [];
    return {
      ativo: { ...ativoPublico(a), entregueEm: entrega ? data(entrega.criado_em) : null },
      termos: termos.map((t) => termoPublico(t)),
      historico: historico.map((h) => ({ em: dataHora(h.em), quem: h.quem, acao: h.acao, detalhe: h.detalhe })),
    };
  }],

  // entrega: conferir (não grava) e gerar termo
  ['POST', '/api/entregas/conferir', async ({ req, corpo }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico');
    const e = await validarEntrega(sql, await corpo());
    return { ...retrato(e, u, new Date()), temAssinaturaTecnico: !!u.tem_assinatura };
  }],
  ['POST', '/api/entregas', async ({ req, corpo }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico');
    if (!u.tem_assinatura) throw falha('Grave sua assinatura no perfil (menu Meu perfil) antes de gerar termos.', 409);
    const e = await validarEntrega(sql, await corpo());
    const t = await sql.begin(async (tx) => {
      const [livre] = await tx`select status from ativos where id = ${e.ativo.id} for update`;
      if (livre.status !== 'disponivel') throw falha('Este ativo acabou de ser entregue por outra pessoa.', 409);
      const agora = new Date(), numero = await proximoNumero(tx);
      const dados = retrato(e, u, agora);
      const hash = sha256(jsonCanonico({ numero, ...dados, colaborador: { ...dados.colaborador, cpf: e.cpf } }));
      const [novo] = await tx`insert into termos (numero, ativo_id, colaborador_nome, colaborador_email, cpf_cifrado, cpf_mascara, setor, telefone, chamado,
          local_ativo, acessorios, tecnico_id, dados, hash_dados, criado_em)
        values (${numero}, ${e.ativo.id}, ${e.colaborador.nome}, ${e.colaborador.email}, ${cifrarCpf(e.cpf)}, ${cpfMascara(e.cpf)}, ${e.colaborador.setor},
          ${e.colaborador.telefone}, ${e.entrega.chamado}, ${e.entrega.local}, ${e.entrega.acessorios}, ${u.id}, ${tx.json(dados)}, ${hash}, ${agora}) returning *`;
      await tx`update ativos set status = 'em_uso' where id = ${e.ativo.id}`;
      await auditar(tx, u, 'Entrega', { ativo: e.ativo.id, termo: novo.id, detalhe: { numero, para: e.colaborador.nome, local: e.entrega.local } });
      return novo;
    }).catch((err) => { if (err.code === '23505') throw falha('Este ativo já tem um termo em aberto.', 409); throw err; });
    return { termo: termoPublico(t, true) };
  }],

  // termos
  ['GET', '/api/termos', async ({ req, query }) => {
    const u = await quem(req), sql = await db();
    const st = STATUS_TERMO[query.status] ? query.status : null;
    // o colaborador vê só os próprios termos
    const meu = u.papel === 'colaborador' ? (u.email || '-').toLowerCase() : null;
    if (!meu) exigir(u, 'admin', 'tecnico', 'leitor');
    const lista = await sql`select * from termos where (${st}::text is null or status = ${st}) and (${meu}::text is null or lower(colaborador_email) = ${meu})
      order by criado_em desc limit 300`;
    return { termos: lista.map((t) => termoPublico(t)) };
  }],
  ['GET', '/api/termos/:numero', async ({ req, params }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico', 'leitor');
    return { termo: termoPublico(await termoPorNumero(sql, params.numero), true) };
  }],
  ['GET', '/api/termos/:numero/pdf', async ({ req, params }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico', 'leitor');
    const t = await termoPorNumero(sql, params.numero);
    return { tipo: 'application/pdf', nome: `${t.numero}.pdf`, corpo: await pdfDoTermo(sql, t) };
  }],
  ['POST', '/api/termos/:numero/enviar', async ({ req, params }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico');
    const t = await termoPorNumero(sql, params.numero);
    if (!['gerado', 'enviado'].includes(t.status)) throw falha(`O termo está ${STATUS_TERMO[t.status].toLowerCase()}.`, 409);
    const token = tokenAleatorio();
    await sql.begin(async (tx) => {
      await tx`update termos set status = 'enviado', enviado_em = now(), token_hash = ${sha256(token)}, token_expira = now() + ${DIAS_LINK + ' days'}::interval where id = ${t.id}`;
      await auditar(tx, u, t.status === 'enviado' ? 'Novo link de assinatura' : 'Termo enviado para assinatura', { ativo: t.ativo_id, termo: t.id, detalhe: { numero: t.numero } });
    });
    const link = `${urlBase(req)}/assinar.html#${token}`;
    return { link, expira: dataHora(Date.now() + DIAS_LINK * 864e5), whatsapp: `Olá, ${t.colaborador_nome.split(' ')[0]}! Segue o termo ${t.numero} (${t.dados.ativo.modelo}, patrimônio ${t.dados.ativo.patrimonio}) para você conferir e assinar: ${link}` };
  }],
  ['POST', '/api/termos/:numero/cancelar', async ({ req, params, corpo }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico');
    const motivo = limpar((await corpo()).motivo, 300);
    if (motivo.length < 5) throw falha('Explique o motivo do cancelamento.');
    const t = await termoPorNumero(sql, params.numero);
    if (!['gerado', 'enviado'].includes(t.status)) throw falha('Só dá para cancelar termo que ainda não foi assinado. Para assinado, registre a devolução.', 409);
    await sql.begin(async (tx) => {
      await tx`update termos set status = 'cancelado', cancelado_motivo = ${motivo}, token_hash = null where id = ${t.id}`;
      await tx`update ativos set status = 'disponivel' where id = ${t.ativo_id}`;
      await auditar(tx, u, 'Termo cancelado', { ativo: t.ativo_id, termo: t.id, detalhe: { numero: t.numero, motivo } });
    });
    return { ok: true };
  }],

  // devolução
  ['GET', '/api/devolucoes/consultar/:patrimonio', async ({ req, params }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico');
    const [t] = await sql`select t.* from termos t join ativos a on a.id = t.ativo_id where a.patrimonio = ${params.patrimonio.toUpperCase()} and t.status in ('gerado', 'enviado', 'assinado')`;
    if (!t) {
      const [a] = await sql`select status from ativos where patrimonio = ${params.patrimonio.toUpperCase()}`;
      throw falha(a ? `Este ativo não está com ninguém (${STATUS_ATIVO[a.status].toLowerCase()}).` : 'Patrimônio não cadastrado.', 404);
    }
    return { termo: termoPublico(t), entregueEm: data(t.criado_em), recebidoPor: u.nome };
  }],
  ['POST', '/api/devolucoes', async ({ req, corpo }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico');
    const b = await corpo();
    if (!CONDICOES[b.condicao]) throw falha('Escolha a condição do equipamento.');
    if (!DESTINOS[b.destino]) throw falha('Escolha o destino do equipamento.');
    const obs = limpar(b.obs, 500);
    if (b.condicao !== 'sem_avarias' && obs.length < 5) throw falha('Descreva a avaria ou o acessório que faltou na observação.');
    return sql.begin(async (tx) => {
      const [t] = await tx`select t.* from termos t join ativos a on a.id = t.ativo_id where a.patrimonio = ${limpar(b.patrimonio, 30).toUpperCase()}
        and t.status in ('gerado', 'enviado', 'assinado') for update of t`;
      if (!t) throw falha('Este ativo não está com ninguém.', 404);
      if (t.status !== 'assinado') throw falha('O colaborador ainda não assinou este termo. Se a entrega não aconteceu, cancele o termo.', 409);
      await tx`insert into devolucoes (termo_id, ativo_id, recebido_por, condicao, destino, obs) values (${t.id}, ${t.ativo_id}, ${u.id}, ${b.condicao}, ${b.destino}, ${obs || null})`;
      await tx`update termos set status = 'encerrado', encerrado_em = now() where id = ${t.id}`;
      await tx`update ativos set status = ${b.destino} where id = ${t.ativo_id}`;
      await auditar(tx, u, 'Devolução', { ativo: t.ativo_id, termo: t.id, detalhe: { numero: t.numero, de: t.colaborador_nome, condicao: CONDICOES[b.condicao], destino: DESTINOS[b.destino], obs } });
      return { ok: true, numero: t.numero, destino: DESTINOS[b.destino] };
    });
  }],

  // assinatura do colaborador (pelo link; com o Entra ID ligado passa a exigir o login Microsoft)
  ['GET', '/api/assinar/:token', async ({ params }) => {
    const sql = await db(), t = await termoPorLink(sql, params.token);
    return { termo: { ...termoPublico(t), telefone: undefined, colaboradorEmail: undefined } };
  }],
  ['GET', '/api/assinar/:token/pdf', async ({ params }) => {
    const sql = await db(), t = await termoPorLink(sql, params.token);
    return { tipo: 'application/pdf', nome: `${t.numero}.pdf`, corpo: await pdfDoTermo(sql, t) };
  }],
  ['POST', '/api/assinar/:token', async ({ params, corpo, req, ip }) => {
    const sql = await db(), b = await corpo();
    if (b.conferi !== true) throw falha('Marque que conferiu o equipamento e os acessórios.');
    const png = pngDaTela(b.assinatura);
    return sql.begin(async (tx) => {
      const [t] = await tx`select * from termos where token_hash = ${sha256(String(params.token))} for update`;
      if (!t) throw falha('Link inválido.', 404);
      if (t.status === 'assinado') throw falha('Este termo já foi assinado.', 409);
      if (t.status !== 'enviado' || new Date(t.token_expira) < new Date()) throw falha('Este link não vale mais. Peça um novo ao técnico.', 410);
      const agora = new Date(), navegador = limpar(req.headers['user-agent'], 300);
      const [tec] = await tx`select assinatura_png from usuarios where id = ${t.tecnico_id}`;
      const aceite = { nome: t.colaborador_nome, em: dataHora(agora), identidade: 'link pessoal enviado pelo técnico', ip };
      const pdf = await gerarPdf({ numero: t.numero, dados: t.dados, cpf: cpfFormatado(decifrarCpf(t.cpf_cifrado)), geradoEm: dataHora(t.criado_em), hash: t.hash_dados,
        assinaturaTecnico: tec?.assinatura_png, assinaturaColab: png, aceite });
      const pdfHash = sha256(pdf);
      await tx`update termos set status = 'assinado', assinado_em = ${agora}, assinatura_png = ${png}, aceite_nome = ${t.colaborador_nome}, aceite_ip = ${ip},
        aceite_navegador = ${navegador}, aceite_identidade = 'link', pdf = ${pdf}, pdf_hash = ${pdfHash} where id = ${t.id}`;
      await auditar(tx, null, 'Aceite do colaborador', { ativo: t.ativo_id, termo: t.id, detalhe: { quem: t.colaborador_nome, numero: t.numero, ip, navegador, pdfHash } });
      return { ok: true, numero: t.numero, assinadoEm: dataHora(agora), hash: t.hash_dados, pdfHash, equipamento: t.dados.ativo.modelo, patrimonio: t.dados.ativo.patrimonio };
    });
  }],

  // usuários (administrador)
  ['GET', '/api/usuarios', async ({ req }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin');
    const l = await sql`select *, assinatura_png is not null as tem_assinatura from usuarios order by nome`;
    return { usuarios: l.map((x) => ({ ...publico(x), ativo: x.ativo })), papeis: PAPEIS };
  }],
  ['POST', '/api/usuarios', async ({ req, corpo }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin');
    const b = await corpo(), login = limpar(b.login, 30).toLowerCase(), nome = limpar(b.nome, 80), email = limpar(b.email, 120).toLowerCase() || null;
    if (!/^[a-z0-9._-]{3,30}$/.test(login)) throw falha('Usuário: de 3 a 30 letras minúsculas, números, ponto, hífen ou sublinhado.');
    if (nome.length < 3) throw falha('Informe o nome.');
    if (email && !emailValido(email)) throw falha('E-mail inválido.');
    if (!PAPEIS[b.papel]) throw falha('Escolha o perfil.');
    const senha = senhaTemporaria();
    const novo = await sql.begin(async (tx) => {
      const [ex] = await tx`select id from usuarios where login = ${login}`;
      if (ex) throw falha('Já existe alguém com esse usuário.', 409);
      const [n] = await tx`insert into usuarios (login, nome, email, papel, senha_hash) values (${login}, ${nome}, ${email}, ${b.papel}, ${hashSenha(senha)}) returning *`;
      await auditar(tx, u, 'Usuário criado', { detalhe: { login, papel: b.papel } });
      return n;
    });
    return { usuario: publico(novo), senha };
  }],
  ['POST', '/api/usuarios/:id', async ({ req, params, corpo }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin');
    const b = await corpo(), id = Number(params.id);
    const [alvo] = await sql`select * from usuarios where id = ${id}`;
    if (!alvo) throw falha('Usuário não encontrado.', 404);
    if (b.acao === 'ativo') {
      if (alvo.id === u.id) throw falha('Você não pode desativar a si mesmo.');
      await sql.begin(async (tx) => {
        await tx`update usuarios set ativo = ${!!b.valor} where id = ${id}`;
        if (!b.valor) await tx`delete from sessoes where usuario_id = ${id}`;
        await auditar(tx, u, b.valor ? 'Usuário reativado' : 'Usuário desativado', { detalhe: { login: alvo.login } });
      });
      return { ok: true };
    }
    if (b.acao === 'redefinir-senha') {
      const senha = senhaTemporaria();
      await sql.begin(async (tx) => {
        await tx`update usuarios set senha_hash = ${hashSenha(senha)}, trocar_senha = true where id = ${id}`;
        await tx`delete from sessoes where usuario_id = ${id}`;
        await auditar(tx, u, 'Senha redefinida', { detalhe: { login: alvo.login } });
      });
      return { ok: true, senha };
    }
    throw falha('Ação desconhecida.');
  }],
];
