// PDF do termo de entrega (A4), feito com pdf-lib. Antes do aceite sai com a marca "AGUARDANDO ASSINATURA".
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const TEXTO = {
  titulo: 'TERMO DE ENTREGA DE EQUIPAMENTO',
  intro: 'Recebi gratuitamente do HOSPITAL CARE, CNPJ: 25.249.439/0001-83, a título de comodato, para meu uso exclusivo, conforme determinado na lei, os equipamentos especificados neste termo de responsabilidade, comprometendo-me a mantê-los em perfeito estado de conservação, ficando ciente de que:',
  clausulas: [
    'Se o equipamento for danificado ou inutilizado por emprego inadequado, mau uso, negligência ou extravio, a empresa poderá fornecer novo equipamento e cobrará o valor de um equipamento da mesma marca ou equivalente na praça, realizando o desconto do valor correspondente em folha de pagamento.',
    'Em caso de dano, inutilização ou extravio do equipamento deverei comunicar imediatamente ao setor competente.',
    'Terminando os serviços ou no caso de rescisão do contrato de trabalho, devolverei ao setor competente o equipamento completo e em perfeito estado de conservação, considerando-se o tempo do uso do mesmo.',
    'Estando os equipamentos em minha posse, estarei sujeito a inspeções sem prévio aviso.',
    'Declaro estar ciente e comprometo-me a cumprir os termos contidos na Política de Uso de Dispositivos Móveis da Instituição: http://intranet.hospitalveracruz.com.br//Uso_Recursos_TIC_HVC.pdf',
    'Estou ciente de que o equipamento cedido é de propriedade da empresa e não integra o meu salário/remuneração a qualquer título.',
  ],
  penal: 'A falta de cumprimento do compromisso ora assumido poderá ser sujeito a aplicação de penalidades pela empregadora.',
};
export const VERSAO_TEXTO = 'entrega-v1';

const PRETO = rgb(0.1, 0.1, 0.1), CINZA = rgb(0.42, 0.42, 0.42), LINHA = rgb(0.8, 0.8, 0.8), LARANJA = rgb(0.894, 0.4, 0.153), AZUL = rgb(0.027, 0.125, 0.306);

// t = { numero, dados, cpf, geradoEm, hash, assinaturaTecnico (png), assinaturaColab (png), aceite: {nome, em, identidade, ip} }
export async function gerarPdf(t) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${TEXTO.titulo} ${t.numero}`); pdf.setAuthor('Termos de TI'); pdf.setCreator('Termos de TI');
  const f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pg = pdf.addPage([595.28, 841.89]);
  const M = 48, W = 595.28 - 2 * M; let y = 841.89 - M;
  const d = t.dados;

  const quebrar = (txt, fonte, tam, larg) => {
    const linhas = []; let atual = '';
    for (const p of String(txt).split(/\s+/)) {
      const teste = atual ? atual + ' ' + p : p;
      if (fonte.widthOfTextAtSize(teste, tam) <= larg) atual = teste; else { if (atual) linhas.push(atual); atual = p; }
    }
    if (atual) linhas.push(atual);
    return linhas;
  };
  const texto = (txt, { x = M, tam = 9.5, fonte = f, cor = PRETO, larg = W, entre = 1.35 } = {}) => {
    for (const l of quebrar(txt, fonte, tam, larg)) { pg.drawText(l, { x, y: y - tam, size: tam, font: fonte, color: cor }); y -= tam * entre; }
  };

  // cabeçalho
  pg.drawRectangle({ x: 0, y: 841.89 - 6, width: 595.28, height: 6, color: LARANJA });
  pg.drawText('Hospital Vera Cruz · Termos de TI', { x: M, y: y - 9, size: 9, font: f, color: CINZA });
  pg.drawText(t.numero, { x: M + W - fb.widthOfTextAtSize(t.numero, 11), y: y - 10, size: 11, font: fb, color: AZUL });
  y -= 30;
  pg.drawText(TEXTO.titulo, { x: M, y: y - 15, size: 15, font: fb, color: AZUL });
  y -= 30;

  const secao = (titulo, pares) => {
    pg.drawText(titulo, { x: M, y: y - 10, size: 10, font: fb, color: AZUL });
    y -= 16; pg.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.6, color: LINHA }); y -= 6;
    const col = W / 2;
    for (let i = 0; i < pares.length; i += 2) {
      const alt = Math.max(...pares.slice(i, i + 2).map(([, v]) => quebrar(v || '-', f, 9.5, col - 12).length));
      pares.slice(i, i + 2).forEach(([r, v], j) => {
        if (!r) return; // célula vazia só para alinhar a grade
        const x = M + j * col;
        pg.drawText(r, { x, y: y - 8, size: 7.5, font: f, color: CINZA });
        quebrar(v || '-', f, 9.5, col - 12).forEach((l, k) => pg.drawText(l, { x, y: y - 20 - k * 12, size: 9.5, font: f, color: PRETO }));
      });
      y -= 16 + alt * 12;
    }
    y -= 6;
  };
  secao('1. Colaborador', [['Nome', d.colaborador.nome], ['CPF', t.cpf], ['Setor', d.colaborador.setor], ['Telefone', d.colaborador.telefone], ['E-mail', d.colaborador.email || '-'], ['', '']]);
  secao('2. Equipamento', [['Equipamento', d.ativo.modelo], ['Patrimônio', d.ativo.patrimonio], ['Service Tag', d.ativo.serviceTag || '-'], ['Configuração', d.ativo.config || '-'], ['Categoria', d.ativo.categoria], ['Marca', d.ativo.marca]]);
  secao('3. Entrega', [['Local do ativo', d.entrega.local], ['Nº do chamado', d.entrega.chamado], ['Acessórios', d.entrega.acessorios.length ? d.entrega.acessorios.join(', ') : 'Sem acessórios'], ['Data', d.entrega.data], ['Técnico', d.tecnico.nome], ['', '']]);

  y -= 2;
  texto(TEXTO.intro, { tam: 9 });
  y -= 3;
  TEXTO.clausulas.forEach((c, i) => {
    const ini = y;
    pg.drawText(`${i + 1}.`, { x: M + 4, y: y - 9, size: 9, font: fb, color: PRETO });
    texto(c, { x: M + 18, larg: W - 18, tam: 9 });
    if (y === ini) y -= 12;
    y -= 2;
  });
  y -= 2;
  texto(TEXTO.penal, { tam: 9, fonte: fb });

  // assinaturas
  y -= 14;
  const caixa = async (x, rotulo, nome, png, sub) => {
    const larg = W / 2 - 16, alt = 64;
    if (png) {
      const img = await pdf.embedPng(png);
      const esc = Math.min(larg / img.width, alt / img.height);
      pg.drawImage(img, { x: x + (larg - img.width * esc) / 2, y: y - alt, width: img.width * esc, height: img.height * esc });
    }
    pg.drawLine({ start: { x, y: y - alt - 4 }, end: { x: x + larg, y: y - alt - 4 }, thickness: 0.8, color: PRETO });
    pg.drawText(nome, { x, y: y - alt - 16, size: 9.5, font: fb, color: PRETO });
    pg.drawText(rotulo + (sub ? ' · ' + sub : ''), { x, y: y - alt - 28, size: 8, font: f, color: CINZA });
  };
  await caixa(M, 'Colaborador', d.colaborador.nome, t.assinaturaColab, t.aceite ? 'assinou em ' + t.aceite.em : 'aguardando assinatura');
  await caixa(M + W / 2 + 16, 'Técnico', d.tecnico.nome, t.assinaturaTecnico, 'assinatura do perfil');

  // rodapé de autenticidade
  const rod = [
    `Número ${t.numero} · Gerado em ${t.geradoEm} · Texto ${VERSAO_TEXTO}`,
    `Hash SHA-256 do termo: ${t.hash}`,
    t.aceite ? `Aceite: ${t.aceite.nome}, ${t.aceite.em} · identificação: ${t.aceite.identidade} · IP ${t.aceite.ip || '-'}` : 'Aceite do colaborador: pendente',
  ];
  pg.drawLine({ start: { x: M, y: M + 40 }, end: { x: M + W, y: M + 40 }, thickness: 0.6, color: LINHA });
  rod.forEach((l, i) => pg.drawText(l, { x: M, y: M + 28 - i * 11, size: 7, font: f, color: CINZA }));

  if (!t.aceite) {
    pg.drawText('AGUARDANDO ASSINATURA', { x: 120, y: 330, size: 40, font: fb, color: LARANJA, opacity: 0.12, rotate: { type: 'degrees', angle: 35 } });
  }
  if (y < M + 50) console.warn('PDF: conteúdo encostou no rodapé', t.numero);
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
