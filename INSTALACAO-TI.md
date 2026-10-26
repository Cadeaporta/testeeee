# Termos de TI · Guia de instalação para infraestrutura

Sistema interno de controle de equipamentos e termos de responsabilidade. A aplicação é Node.js 22; o Compose padrão executa a aplicação, PostgreSQL 16 e Caddy.

## 1. Requisitos

| Item | Requisito |
|---|---|
| Servidor | Linux com Docker 24+ e Docker Compose v2 |
| CPU / memória | Referência inicial: 1 vCPU e 1 GB de RAM |
| Disco | Reservar pelo menos 5 GB e monitorar o crescimento dos PDFs |
| Banco | PostgreSQL 13+; o Compose padrão usa PostgreSQL 16 |
| Rede | Acesso de saída para baixar imagens e dependências na instalação/atualização |

## 2. Definições antes de publicar

1. **Acesso do colaborador:** o link de assinatura precisa abrir no celular. Definir se será acessível apenas pela rede Wi-Fi/intranet do hospital ou também pela internet.
2. **DNS:** definir o endereço final, por exemplo `termos.hospitalveracruz.com.br`.
3. **HTTPS:** obrigatório porque o sistema trata credenciais, CPF e assinaturas.
   - O Compose padrão usa Caddy e Let's Encrypt. Para isso, o DNS deve apontar para o servidor e as portas TCP 80 e 443 precisam ser alcançáveis pela internet.
   - Para uso somente interno ou quando a TI já fornece proxy/certificado, usar o proxy aprovado pela TI. Não publicar o sistema em HTTP simples.
4. **Banco:** escolher o PostgreSQL incluído no Compose ou um PostgreSQL gerenciado pela TI.

## 3. Segredos

### Chave de cifragem do CPF

Gere uma chave de 32 bytes, representada por 64 caracteres hexadecimais:

```bash
openssl rand -hex 32
```

Guarde a chave definitiva no cofre de senhas aprovado pela TI e mantenha uma cópia de recuperação protegida. **Não a troque depois que houver CPFs cifrados com ela**, pois os dados antigos não poderão ser decifrados com a chave nova. Para testes locais, use uma chave diferente da definitiva.

Crie o arquivo `.env` na pasta do projeto e restrinja suas permissões. Não envie esse arquivo para o GitHub nem compartilhe credenciais de produção.

## 4. Instalação com PostgreSQL no Compose (opção padrão)

No diretório do projeto, crie `.env`:

```dotenv
DOMINIO=termos.hospitalveracruz.com.br
POSTGRES_SENHA=uma_senha_longa
CPF_CHAVE=64_caracteres_hexadecimais
```

Use uma senha forte. Uma senha gerada em hexadecimal evita problemas de caracteres especiais na URL de conexão.

Suba os serviços:

```bash
docker compose up -d --build
docker compose ps
```

O banco fica no volume Docker `dados`; não publique a porta 5432 na rede sem uma necessidade e aprovação específicas. As tabelas são criadas automaticamente pela aplicação a partir de `db/001_inicial.sql` e `db/002_metricas.sql`, controladas pela tabela `migracoes`.

## 5. Instalação com PostgreSQL externo (opção alternativa)

Crie um banco vazio e um usuário com permissão para criar as tabelas, índices, função e gatilho exigidos pelas migrações. Exemplo para uma instância PostgreSQL administrada pela TI:

```sql
CREATE USER termos WITH PASSWORD 'senha_forte';
CREATE DATABASE termos OWNER termos;
```

Crie o `.env`:

```dotenv
DOMINIO=termos.hospitalveracruz.com.br
DATABASE_URL=postgres://termos:senha_forte@HOST_DO_BANCO:5432/termos
DB_SSL=true
CPF_CHAVE=64_caracteres_hexadecimais
```

Use `DB_SSL=false` somente quando o banco estiver em uma rede confiável e a política de segurança da TI permitir conexão sem TLS. A URL precisa ser compatível com os parâmetros de conexão do PostgreSQL.

Suba a aplicação com a variante de banco externo:

```bash
docker compose -f docker-compose.banco-externo.yml up -d --build
docker compose -f docker-compose.banco-externo.yml ps
```

Essa variante não inicia um serviço PostgreSQL local. A aplicação precisa alcançar o host do banco pela rede.

## 6. Validar a instalação

Com o Compose padrão:

```bash
docker compose exec app wget -qO- http://127.0.0.1:3000/saude
docker compose logs --tail=100 app
```

O endpoint de saúde deve responder `ok`. Na primeira inicialização, os logs devem registrar a aplicação das migrações `001_inicial.sql` e `002_metricas.sql`, seguidas da mensagem de servidor no ar.

Com Caddy e DNS configurados, valide também:

```bash
curl -fsS https://termos.hospitalveracruz.com.br/saude
```

## 7. Criar o primeiro administrador

No Compose padrão:

```bash
docker compose exec app node scripts/criar-admin.mjs alvaro.bandim "Alvaro Bandim" alvaro.bandim@bragait.com
```

Com banco externo, acrescente `-f docker-compose.banco-externo.yml` depois de `docker compose`:

```bash
docker compose -f docker-compose.banco-externo.yml exec app node scripts/criar-admin.mjs alvaro.bandim "Alvaro Bandim" alvaro.bandim@bragait.com
```

O comando apresenta uma senha provisória. Entregue-a por canal aprovado e troque-a no primeiro acesso.

## 8. Backup e atualização

### Backup do banco local do Compose

```bash
mkdir -p backups
docker compose exec -T banco pg_dump -U termos -d termos -Fc > "backups/termos-$(date +%F).dump"
```

Confirme que o arquivo existe e tem tamanho maior que zero. Mantenha backups em armazenamento separado e protegido. O backup do banco **não inclui** a chave `CPF_CHAVE`; ela precisa ser recuperável por meio do cofre de senhas. Teste a restauração periodicamente em um banco isolado.

Para PostgreSQL externo, faça o backup com a ferramenta e as credenciais aprovadas pela equipe que administra essa instância.

### Atualizar a aplicação

Faça backup antes da atualização e revise as alterações do repositório. Depois de copiar a versão validada:

```bash
docker compose up -d --build
docker compose logs --tail=100 app
```

As migrações novas devem ser adicionadas em `db/NNN_nome.sql`. A aplicação aplica os arquivos SQL dessa pasta em ordem alfabética, uma vez por nome, usando a tabela `migracoes`. Não edite uma migração já aplicada; crie uma nova.

## 9. Segurança e dados pessoais

- Não publique o PostgreSQL na internet.
- Não compartilhe o arquivo `.env`, senhas, `CPF_CHAVE` ou backups com dados reais.
- Use dados fictícios em desenvolvimento e validação.
- Proteja os backups, pois podem conter CPF cifrado, assinaturas, PDFs e outros dados pessoais.
- A aplicação registra auditoria e impede UPDATE/DELETE pela trigger prevista no esquema; isso não substitui controle de acesso administrativo, backups e monitoramento.
- O login Microsoft/Entra ID é uma etapa futura; não o considere habilitado apenas por preencher IDs no ambiente.

