# Termos de TI — somente banco de dados

Este branch contém apenas os arquivos necessários para reproduzir o PostgreSQL e o esquema de banco que montamos para testes. A aplicação, telas, PDFs, autenticação e deployment ficam fora deste pacote.

## Conteúdo

- `compose.yml`: PostgreSQL 17 em Docker, com volume persistente e health check.
- `.env.example`: modelo de variável de ambiente. Copie para `.env` e defina uma senha forte.
- `db/migrations/001_schema_base.sql`: estrutura atual preparada para o banco `termos_ti`.
- `*.dump` e `*.tar`: backups e imagens exportadas não devem ser commitados no Git.

## Subir o banco localmente

```bash
cp .env.example .env
# Edite .env e substitua a senha de exemplo.
docker compose up -d
docker compose ps
```

A porta 5432 é publicada apenas em `127.0.0.1`, para permitir conexão local sem expor o banco para a rede. Para conectar uma aplicação que rode no próprio host:

```text
postgresql://termos_app:SENHA_DO_ENV@127.0.0.1:5432/termos_ti
```

Se a aplicação também estiver em Docker, conecte-a à mesma rede Docker e use o hostname `banco` e a porta `5432`. Não publique a porta na interface de rede externa.

## Aplicar o esquema

Em um banco vazio, aplique a migração uma vez:

```bash
docker compose exec -T banco psql -U termos_app -d termos_ti < db/migrations/001_schema_base.sql
```

Confirme as tabelas:

```bash
docker compose exec banco psql -U termos_app -d termos_ti -c '\dt'
docker compose exec banco psql -U termos_app -d termos_ti -c 'SELECT * FROM schema_migrations;'
```

A migração cria 11 tabelas, as restrições, índices, trigger de auditoria e três perfis iniciais. Ela é para banco novo; não execute sobre um banco que já tenha tabelas.

## Sobre compatibilidade com a aplicação

Este esquema representa o banco preparado no `PAINEL-TI`. **Ainda precisa ser validado e alinhado com a aplicação**: a aplicação deverá usar nomes e tipos compatíveis com estas tabelas. Não trate este branch como integração já concluída.

## Segurança

- Nunca versione `.env`, senhas, chaves de cifragem, dumps com dados reais ou arquivos `.tar` de imagem.
- Use dados fictícios para desenvolvimento.
- Para criar um dump de teste: `docker compose exec -T banco pg_dump -U termos_app -d termos_ti -Fc > termos_ti_teste.dump`.
- O dump não contém a imagem Docker; a imagem é baixada pelo Compose.
- A chave de cifragem de CPF deve ser independente por ambiente e guardada no cofre aprovado pela TI.
