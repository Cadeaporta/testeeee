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

// erro de digitação barrado: guarda o campo para o relatório do piloto ("erros de digitação evitados")
const erroCampo = (msg, campo, status = 400) => Object.assign(falha(msg, status), { campos: [campo] });
async function medirErros(sql, u, fn) {
  try { return await fn(); } catch (e) {
    if (e.campos?.length) {
      await sql`insert into metricas (usuario_id, tipo, campo, detalhe)
        select ${u.id}, 'erro', c, ${e.message.slice(0, 200)} from unnest(${e.campos}::text[]) as c`.catch(() => {});
    }
    throw e;
  }
}

const urlBase = (req) => process.env.URL_PUBLICA || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

// ---------- ativos ----------
const ativoPublico = (a) => ({
  id: a.id, patrimonio: a.patrimonio, serviceTag: a.service_tag, categoria: a.categoria, marca: a.marca, modelo: a.modelo,
  // coluna date: o driver devolve meia-noite UTC; formatar pela parte da data, sem fuso
  config: a.config, garantia: a.garantia ? new Date(a.garantia).toISOString().slice(0, 10).split('-').reverse().join('/') : null,
  garantiaIso: a.garantia ? new Date(a.garantia).toISOString().slice(0, 10) : null,
  status: a.status, statusNome: STATUS_ATIVO[a.status], responsavel: a.responsavel || null, termoAtual: a.termo_numero || null, termoStatus: a.termo_status || null,
});

function validarAtivo(b, perfil) {
  const patrimonio = limpar(b.patrimonio, 30).toUpperCase();
  if (!/^[A-Z0-9.-]{3,30}$/.test(patrimonio)) throw erroCampo('Patrimônio: de 3 a 30 letras ou números.', 'patrimonio');
  const serviceTag = limpar(b.serviceTag, 40).toUpperCase();
  if (!serviceTag) throw erroCampo('Informe a Service Tag (número de série).', 'service_tag');
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(garantia) || isNaN(new Date(garantia))) throw erroCampo(`Fim da garantia inválido (${b.garantia}).`, 'garantia');
  }
  return { patrimonio, serviceTag, categoria, marca, modelo, config, garantia, perfilId: perfil?.id ?? null };
}

async function cadastrarAtivo(sql, u, b) {
  let perfil = null;
  if (b.perfilId) { [perfil] = await sql`select * from perfis where id = ${Number(b.perfilId)} and ativo`; if (!perfil) throw falha('Perfil não encontrado.'); }
  const a = validarAtivo(b, perfil);
  return sql.begin(async (tx) => {
    const [ex] = await tx`select id from ativos where patrimonio = ${a.patrimonio}`;
    if (ex) throw erroCampo(`O patrimônio ${a.patrimonio} já está cadastrado.`, 'patrimonio_duplicado', 409);
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
  if (!ativo) throw erroCampo(`Patrimônio ${patrimonio || '(vazio)'} não está cadastrado. Cadastre o ativo antes.`, 'patrimonio', 404);
  if (ativo.responsavel) throw erroCampo(`Este ativo já está com ${ativo.responsavel} (termo ${ativo.termo_numero}). Registre a devolução antes.`, 'ativo_com_outra_pessoa', 409);
  if (ativo.status !== 'disponivel') throw erroCampo(`Este ativo está ${STATUS_ATIVO[ativo.status].toLowerCase()} e não pode ser entregue.`, 'ativo_indisponivel', 409);
  const nome = limpar(b.colaborador, 80), setor = limpar(b.setor, 60), local = limpar(b.local, 80), chamado = limpar(b.chamado, 20);
  const email = limpar(b.email, 120).toLowerCase(), telefone = telefoneFormatado(b.telefone);
  const erros = []; // [campo, mensagem]
  if (nome.split(' ').length < 2) erros.push(['nome', 'Nome completo do colaborador.']);
  if (!cpfValido(b.cpf)) erros.push(['cpf', 'CPF inválido.']);
  if (!setor) erros.push(['setor', 'Setor.']);
  if (!telefone) erros.push(['telefone', 'Telefone com DDD.']);
  if (email && !emailValido(email)) erros.push(['email', 'E-mail inválido.']);
  if (!/^\d{1,20}$/.test(chamado)) erros.push(['chamado', 'Nº do chamado (só números).']);
  if (!local) erros.push(['local', 'Local do ativo.']);
  const acessorios = [...new Set((Array.isArray(b.acessorios) ? b.acessorios : []).filter((a) => ACESSORIOS.includes(a)))];
  if (erros.length) throw Object.assign(falha('Confira: ' + erros.map((e) => e[1]).join(' ')), { campos: erros.map((e) => e[0]) });
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
    const b = await corpo();
    return { ativo: ativoPublico(await medirErros(sql, u, () => cadastrarAtivo(sql, u, b))) };
  }],
  ['POST', '/api/ativos/importar', async ({ req, corpo }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico');
    const linhas = lerCsv((await corpo()).csv), ok = [], erros = [];
    for (const [i, l] of linhas.entries()) {
      try {
        const [perfil] = l.modelo ? [] : await sql`select * from perfis where nome ilike ${l.categoria || ''}`;
        ok.push((await medirErros(sql, u, () => cadastrarAtivo(sql, u, { ...l, perfilId: perfil?.id }))).patrimonio);
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

  // manutenção: disponível <-> em manutenção (ativo com alguém não muda por aqui; use a devolução)
  ['POST', '/api/ativos/:patrimonio/situacao', async ({ req, params, corpo }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico');
    const b = await corpo(), para = b.status, obs = limpar(b.obs, 300);
    if (!['disponivel', 'manutencao'].includes(para)) throw falha('Situação inválida.');
    if (para === 'manutencao' && obs.length < 5) throw falha('Descreva o motivo da manutenção.');
    return sql.begin(async (tx) => {
      const [a] = await tx`select * from ativos where patrimonio = ${params.patrimonio.toUpperCase()} for update`;
      if (!a) throw falha('Patrimônio não cadastrado.', 404);
      const de = { disponivel: 'manutencao', manutencao: 'disponivel' }[para];
      if (a.status !== de) throw falha(a.status === 'em_uso' ? 'Este ativo está com alguém. Registre a devolução antes.' : `O ativo está ${STATUS_ATIVO[a.status].toLowerCase()}.`, 409);
      await tx`update ativos set status = ${para} where id = ${a.id}`;
      await auditar(tx, u, para === 'manutencao' ? 'Enviado para manutenção' : 'Liberado da manutenção', { ativo: a.id, detalhe: { obs } });
      return { ok: true, status: para, statusNome: STATUS_ATIVO[para] };
    });
  }],

  // correção de cadastro: termos já gerados guardam o retrato da época e não mudam
  ['POST', '/api/ativos/:patrimonio/corrigir', async ({ req, params, corpo }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico');
    const b = await corpo(), motivo = limpar(b.motivo, 300);
    if (motivo.length < 5) throw falha('Explique o motivo da correção (ex.: Service Tag digitada errada).');
    // valida antes de abrir a transação (registrar o erro usa outra conexão)
    const novo = await medirErros(sql, u, async () => validarAtivo({ ...b, patrimonio: b.patrimonio || params.patrimonio }, null));
    return sql.begin(async (tx) => {
      const [a] = await tx`select * from ativos where patrimonio = ${params.patrimonio.toUpperCase()} for update`;
      if (!a) throw falha('Patrimônio não cadastrado.', 404);
      const [{ n: termos }] = await tx`select count(*)::int as n from termos where ativo_id = ${a.id}`;
      if (novo.patrimonio !== a.patrimonio) {
        if (termos) throw falha('O patrimônio não pode mudar depois que o ativo já teve termo: os termos ficariam com um número diferente do etiquetado.', 409);
        const [ex] = await tx`select id from ativos where patrimonio = ${novo.patrimonio}`;
        if (ex) throw falha(`O patrimônio ${novo.patrimonio} já está cadastrado.`, 409);
      }
      const garantiaAtual = a.garantia ? new Date(a.garantia).toISOString().slice(0, 10) : null;
      const campos = [['Patrimônio', a.patrimonio, novo.patrimonio], ['Service Tag', a.service_tag, novo.serviceTag], ['Categoria', a.categoria, novo.categoria],
        ['Marca', a.marca, novo.marca], ['Modelo', a.modelo, novo.modelo], ['Configuração', a.config || '', novo.config || ''], ['Garantia', garantiaAtual, novo.garantia]];
      const mudancas = campos.filter(([, x, y]) => (x || '') !== (y || '')).map(([r, x, y]) => `${r}: ${x || '(vazio)'} -> ${y || '(vazio)'}`);
      if (!mudancas.length) throw falha('Nada foi alterado.');
      const [atualizado] = await tx`update ativos set patrimonio = ${novo.patrimonio}, service_tag = ${novo.serviceTag}, categoria = ${novo.categoria}, marca = ${novo.marca},
        modelo = ${novo.modelo}, config = ${novo.config}, garantia = ${novo.garantia} where id = ${a.id} returning *`;
      await auditar(tx, u, 'Cadastro corrigido', { ativo: a.id, detalhe: { motivo, mudancas } });
      return { ativo: ativoPublico(atualizado), mudancas };
    });
  }],

  // tempo para localizar (medido na tela: do começo da busca até abrir o ativo)
  ['POST', '/api/metricas/busca', async ({ req, corpo }) => {
    const u = await quem(req), sql = await db(), ms = Math.round(Number((await corpo()).ms));
    if (ms >= 300 && ms <= 30 * 60_000) await sql`insert into metricas (usuario_id, tipo, ms) values (${u.id}, 'busca', ${ms})`;
    return { ok: true };
  }],

  // relatório do piloto: as quatro medidas do slide 20
  ['GET', '/api/relatorio', async ({ req, query }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico', 'leitor');
    const dia = /^\d{4}-\d{2}-\d{2}$/;
    const hoje = new Date().toLocaleString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 10);
    const ate = dia.test(query.ate || '') ? query.ate : hoje;
    const de = dia.test(query.de || '') ? query.de : new Date(Date.parse(ate) - 13 * 864e5).toISOString().slice(0, 10);
    if (de > ate) throw falha('A data inicial é depois da final.');
    // período em horário de Brasília, dia final inteiro
    const ini = `${de}T00:00:00-03:00`, fim = new Date(Date.parse(`${ate}T00:00:00-03:00`) + 864e5).toISOString();
    const [busca] = await sql`select count(*)::int as n, percentile_cont(0.5) within group (order by ms) as mediana, percentile_cont(0.9) within group (order by ms) as p90
      from metricas where tipo = 'busca' and em >= ${ini} and em < ${fim}`;
    const [resp] = await sql`select count(*) filter (where a.status = 'em_uso')::int as em_uso,
        count(*) filter (where a.status = 'em_uso' and t.status = 'assinado')::int as assinados,
        count(*) filter (where a.status = 'em_uso' and t.status in ('gerado', 'enviado'))::int as pendentes,
        count(*)::int as total
      from ativos a left join termos t on t.ativo_id = a.id and t.status in ('gerado', 'enviado', 'assinado') where a.status <> 'baixado'`;
    const erros = await sql`select campo, count(*)::int as n from metricas where tipo = 'erro' and em >= ${ini} and em < ${fim} group by campo order by n desc`;
    const [ace] = await sql`select count(*) filter (where status <> 'cancelado')::int as gerados,
        count(*) filter (where assinado_em is not null)::int as assinados,
        count(*) filter (where status = 'cancelado')::int as cancelados,
        percentile_cont(0.5) within group (order by extract(epoch from assinado_em - coalesce(enviado_em, criado_em))) filter (where assinado_em is not null) as mediana_s
      from termos where criado_em >= ${ini} and criado_em < ${fim}`;
    const pendentes = await sql`select numero, colaborador_nome, status, criado_em, enviado_em, dados->'ativo'->>'patrimonio' as patrimonio
      from termos where status in ('gerado', 'enviado') order by criado_em limit 50`;
    const porTecnico = await sql`select dados->'tecnico'->>'nome' as tecnico, count(*)::int as entregas, count(assinado_em)::int as assinados
      from termos where criado_em >= ${ini} and criado_em < ${fim} and status <> 'cancelado' group by 1 order by 2 desc`;
    const [mov] = await sql`select
        (select count(*)::int from auditoria where acao = 'Cadastro do ativo' and em >= ${ini} and em < ${fim}) as cadastros,
        (select count(*)::int from auditoria where acao = 'Devolução' and em >= ${ini} and em < ${fim}) as devolucoes,
        (select count(*)::int from auditoria where acao = 'Cadastro corrigido' and em >= ${ini} and em < ${fim}) as correcoes`;
    const NOMES = { cpf: 'CPF inválido', telefone: 'Telefone incompleto', nome: 'Nome incompleto', email: 'E-mail inválido', chamado: 'Nº do chamado inválido',
      setor: 'Setor em branco', local: 'Local em branco', patrimonio: 'Patrimônio inexistente ou inválido', patrimonio_duplicado: 'Patrimônio já cadastrado',
      service_tag: 'Service Tag em branco', garantia: 'Data de garantia inválida', ativo_com_outra_pessoa: 'Entrega de ativo que já estava com alguém',
      ativo_indisponivel: 'Entrega de ativo em manutenção' };
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
    const dias = (d) => Math.floor((Date.now() - new Date(d)) / 864e5);
    return {
      periodo: { de, ate },
      localizar: { buscas: busca.n, medianaSeg: busca.mediana == null ? null : Math.round(busca.mediana / 100) / 10, p90Seg: busca.p90 == null ? null : Math.round(busca.p90 / 100) / 10 },
      responsavel: { ativos: resp.total, emUso: resp.em_uso, comTermoAssinado: resp.assinados, aceitePendente: resp.pendentes, percentual: pct(resp.assinados, resp.em_uso) },
      erros: { total: erros.reduce((s, e) => s + e.n, 0), porTipo: erros.map((e) => ({ tipo: NOMES[e.campo] || e.campo, n: e.n })) },
      aceites: {
        gerados: ace.gerados, assinados: ace.assinados, cancelados: ace.cancelados, percentual: pct(ace.assinados, ace.gerados),
        medianaMin: ace.mediana_s == null ? null : Math.round(ace.mediana_s / 60),
        pendentes: pendentes.map((p) => ({ numero: p.numero, colaborador: p.colaborador_nome, patrimonio: p.patrimonio, statusNome: STATUS_TERMO[p.status], desde: data(p.enviado_em || p.criado_em), dias: dias(p.enviado_em || p.criado_em) })),
      },
      movimento: { ...mov, porTecnico },
    };
  }],

  // entrega: conferir (não grava) e gerar termo
  ['POST', '/api/entregas/conferir', async ({ req, corpo }) => {
    const u = await quem(req), sql = await db(); exigir(u, 'admin', 'tecnico');
    const b = await corpo();
    const e = await medirErros(sql, u, () => validarEntrega(sql, b));
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
