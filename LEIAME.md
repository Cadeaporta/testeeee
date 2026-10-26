# Termos de TI · MVP

Implementação do documento **"Braga IT - Termos de TI MVP v2"**: cadastro de ativo, entrega com termo em PDF, aceite do colaborador no celular e devolução.

## O que já funciona

| Tela do PDF | Onde no sistema |
|---|---|
| 1 · Entrada | Usuário e senha do piloto. O botão "Entrar com a conta Microsoft" aparece, mas a validação do login Entra ID ainda é futura |
| 2 · Quem está com o quê | **Início**: números (em uso, disponíveis, manutenção, aceites pendentes), busca por patrimônio/pessoa e filtro |
| 3 · Cadastro de ativo | **Ativos**: perfil pronto + patrimônio, Service Tag e garantia; "Salvar e cadastrar outro"; importação por CSV |
| 4 e 5 · Entrega e conferência | **Entregas**: o patrimônio puxa equipamento, Service Tag e configuração; CPF e telefone validados |
| 6 · Termo gerado | Número `ENT-AAAA-NNNNNN`, andamento, miniatura do PDF, **Enviar para assinatura** e **Assinar neste aparelho** |
| 7 · Termo assinado | PDF com as duas assinaturas, hash SHA-256 do termo e do PDF, "Baixar PDF" |
| 8 e 9 · Celular do colaborador | Link pessoal (WhatsApp ou e-mail): confere, marca "Conferi", assina com o dedo, baixa a cópia |
| 10 · Devolução | Mostra com quem está, condição e destino; encerra a custódia |
| 11 · Histórico do ativo | Cada cadastro, entrega, envio, aceite e devolução com quem fez e quando |
| Ativo · manutenção | **Enviar para manutenção** (com motivo) e **Liberar da manutenção**; ativo com alguém só sai pela devolução |
| Ativo · correção | **Corrigir cadastro** com motivo; o histórico guarda o antes e depois. O patrimônio só muda se o ativo nunca teve termo; termos antigos mantêm os dados da época |
| Slide 20 · Relatórios | Medidas do piloto por período: tempo para localizar, % em uso com termo assinado, erros de digitação barrados, termos aceitos/pendentes e movimento por técnico |

**Importante:** as garantias descritas acima representam o comportamento pretendido pelo MVP e precisam ser validadas com os testes e uma revisão de segurança antes de produção.

## Diferenças em relação ao PDF (decisões provisórias)

- **Tecnologia:** Node.js no lugar de Python/FastAPI, e telas em HTML simples no lugar de React. Banco PostgreSQL e Docker como no PDF.
- **PDF:** gerado com pdf-lib (JavaScript) no lugar do WeasyPrint. Tem número, hash SHA-256 e as assinaturas.
- **Login Microsoft:** pendente de implementação e validação do token Entra ID. No piloto, o colaborador assina por um **link pessoal** que vale 7 dias e só serve uma vez.
- **CPF:** o banco guarda o CPF cifrado e uma versão mascarada. A chave de cifragem é um segredo operacional e não deve ser versionada.
- **Cópia por e-mail:** no piloto o colaborador baixa a cópia na hora. O envio automático por e-mail depende de um remetente oficial do hospital.

## Testar no seu computador

Para o desenvolvimento rápido, não precisa instalar PostgreSQL nem Docker: o modo de desenvolvimento usa PGlite, um PostgreSQL embutido para testes.

```bash
npm install
npm run dev
```

Abra http://localhost:3002. Na primeira vez aparece no terminal o usuário `admin` com uma senha provisória.

- `npm test`: executa os testes automatizados do fluxo em um banco PGlite descartável.
- `npm run dev -- --limpo`: começa com o banco local de desenvolvimento vazio.

Esse modo não usa o banco PostgreSQL do servidor e não precisa restaurar o backup do `PAINEL-TI`.

## Banco e migrações

O esquema oficial da aplicação está em `db/001_inicial.sql`; a migração de métricas fica em `db/002_metricas.sql`. O módulo `lib/db.js` aplica os arquivos `db/NNN_*.sql` em ordem alfabética, uma única vez por nome, e registra os arquivos aplicados na tabela `migracoes`.

Não restaure no ambiente da aplicação um dump criado a partir de outro esquema sem verificar a compatibilidade. Para um ambiente novo, deixe a aplicação aplicar suas migrações. Alterações futuras devem entrar em novos arquivos numerados, sem editar migrações já aplicadas.

## Publicar

Consulte [INSTALACAO-TI.md](INSTALACAO-TI.md) para as opções de Docker Compose, PostgreSQL externo, HTTPS, segredos, backup e operação.

Antes da produção, a TI ainda precisa decidir se o link de assinatura será acessível somente pela rede interna ou também pela internet, e provisionar o DNS/certificado correspondente.

## Estrutura

- `server.mjs`: servidor HTTP (API + páginas)
- `lib/rotas.js`: regras e rotas da API
- `lib/db.js`: conexão e execução das migrações
- `lib/pdf.js`: geração do termo em PDF
- `db/001_inicial.sql`: esquema inicial oficial da aplicação
- `db/002_metricas.sql`: métricas operacionais
- `public/index.html`: telas do técnico
- `public/assinar.html`: tela do colaborador no celular
