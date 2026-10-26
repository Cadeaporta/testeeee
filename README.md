# Termos de TI — pacote do banco

Este repositório contém somente os arquivos necessários para preparar e documentar o PostgreSQL do projeto. A aplicação, frontend, PDFs, dependências Node.js e configurações de hospedagem da aplicação ficam fora do escopo.

## Arquivos mantidos

- `compose.yml`: PostgreSQL 17 com volume persistente e health check.
- `.env.example`: modelo de variável de ambiente; não contém credenciais reais.
- `.gitignore`: impede versionar segredos e backups.
- `db/migrations/001_schema_base.sql`: esquema-base reconstruído a partir do dump de teste.
- `db/migrations/002_metricas_colaborador.sql`: acrescenta métricas, hash de CPF e a view `termos_v`.

## Iniciar uma instância de teste vazia

```bash
cp .env.example .env
# Edite .env e configure uma senha forte.
docker compose up -d
docker compose ps
```

A porta 5432 é publicada somente em `127.0.0.1`. Não a exponha à rede sem necessidade e aprovação específicas.

Para criar o esquema num banco de teste vazio, aplique os SQLs em ordem:

```bash
docker compose exec -T banco psql -U termos_app -d termos_ti < db/migrations/001_schema_base.sql
docker compose exec -T banco psql -U termos_app -d termos_ti < db/migrations/002_metricas_colaborador.sql
```

Valide as tabelas e as alterações antes de usar a instância. As migrações acima são para uma base vazia; não as execute novamente em uma base já inicializada.

## Banco existente no PAINEL-TI

Este repositório não executa comandos no servidor nem altera dados automaticamente. O esquema-base foi reconstruído do dump de teste e a migração 002 acrescenta objetos ao esquema descrito. Antes de executar qualquer SQL no banco existente, confirme o estado real de `schema_migrations`, as tabelas e as colunas. Não restaure o dump nem reaplique a migração 001 sobre uma base já criada.

## Segurança

- Nunca versione `.env`, senhas, chaves de cifragem, dumps com dados reais ou imagens Docker exportadas.
- Use dados fictícios em desenvolvimento.
- Armazene a chave de cifragem de CPF no cofre aprovado pela TI, separada dos backups.
- Proteja os backups e teste a restauração em uma instância isolada.
