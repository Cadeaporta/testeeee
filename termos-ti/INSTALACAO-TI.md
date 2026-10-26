# Termos de TI · Guia de instalação (equipe de infraestrutura)

Sistema interno de controle de equipamentos e termos de responsabilidade (piloto com 2 a 3 técnicos).
Aplicação Node.js 22 em um contêiner + PostgreSQL. Sem dependência de serviços externos pagos.

Contato do projeto: Alvaro Bandim (Braga IT).

---

## 1. Requisitos

| Item | Mínimo |
|---|---|
| Servidor | Linux com Docker 24+ e Docker Compose v2 |
| CPU / memória | 1 vCPU, 1 GB de RAM (o app usa ~150 MB) |
| Disco | 5 GB (o banco cresce ~1 MB a cada 20 termos assinados, PDF incluso) |
| PostgreSQL | versão 13 ou superior |
| Internet de saída | Só na instalação/atualização (baixar imagens Docker e pacotes npm) |

## 2. Decisões que precisamos da TI

1. **Acesso pelo celular do colaborador.** O colaborador assina o termo no próprio celular, abrindo um link. O endereço precisa abrir no celular:
   - pelo Wi-Fi do hospital (se for só intranet), **ou**
   - pela internet (recomendado: o colaborador pode assinar de qualquer lugar).
2. **Endereço (DNS)**, por exemplo `termos.hospitalveracruz.com.br`.
3. **Certificado HTTPS**:
   - endereço público: o compose já traz o Caddy, que emite o certificado sozinho (Let's Encrypt; precisa das portas 80 e 443 abertas para a internet);
   - só intranet, ou proxy/certificado próprio da TI: remover o Caddy e publicar a porta 3000 atrás do proxy de vocês (HTTPS é obrigatório: trafegam senha, CPF e assinatura; o botão "Copiar" do link também só funciona em HTTPS).
4. **Banco**: PostgreSQL de vocês (opção A) ou um PostgreSQL dentro do próprio compose (opção B).

## 3. Instalação

Copie a pasta do sistema para o servidor (ex.: `/opt/termos-ti`) e entre nela.

### Gerar a chave do CPF

O CPF dos colaboradores fica cifrado no banco (AES-256-GCM). Gere a chave uma vez:

```
openssl rand -hex 32
```

> **Guarde essa chave no cofre de senhas da TI.** Sem ela não é possível gerar o PDF de termos ainda não assinados. Ela não pode mudar depois do primeiro uso.

### Opção A · PostgreSQL fornecido pela TI (banco `termos_ti` já criado por vocês)

O sistema foi adaptado à estrutura enviada no `termos_ti_teste.dump` (PostgreSQL 17, versão `001_schema_base` em `schema_migrations`). Na primeira subida ele **só acrescenta** a versão `002_metricas_colaborador` (arquivo `db/002_metricas_colaborador.sql`), sem alterar nem apagar nada:

- tabela `metricas` (medidas do piloto: tempo de busca e erros de digitação barrados);
- coluna `colaboradores.cpf_hash` + índice único parcial (HMAC-SHA256 do CPF com a `CPF_CHAVE`, para achar o colaborador pelo CPF; o CPF cifrado usa IV aleatório e não serve para busca);
- visão `termos_v` (termo + nome, e-mail, matrícula e CPF mascarado/cifrado do colaborador).

Se preferirem aplicar a 002 vocês mesmos, rodem o arquivo e registrem `INSERT INTO schema_migrations (version) VALUES ('002_metricas_colaborador');`. O usuário do app (`termos_app`) precisa ser dono das tabelas, como está no dump, para a 002 rodar sozinha.

1. Arquivo `.env` na pasta:
   ```
   DOMINIO=termos.hospitalveracruz.com.br
   DATABASE_URL=postgres://termos_app:<senha>@<host-do-banco>:5432/termos_ti
   DB_SSL=false          # true se o PostgreSQL exige SSL
   CPF_CHAVE=<64 caracteres gerados acima>
   ```
3. Subir:
   ```
   docker compose -f docker-compose.banco-externo.yml up -d --build
   ```

### Opção B · PostgreSQL dentro do compose

1. Arquivo `.env`:
   ```
   DOMINIO=termos.hospitalveracruz.com.br
   POSTGRES_SENHA=<senha longa>
   CPF_CHAVE=<64 caracteres gerados acima>
   ```
2. Subir:
   ```
   docker compose up -d --build
   ```
   Os dados ficam no volume Docker `dados`. Num banco vazio o sistema cria a mesma estrutura da opção A (`db/001_schema_base.sql`, reconstruída do dump de vocês) e depois a 002.

### Conferir

- `curl -s http://localhost:3000/saude` (de dentro do contêiner) ou `https://<DOMINIO>/saude` deve responder `ok`.
- `docker compose logs app` deve mostrar `migração aplicada: 002_metricas_colaborador` (opção A) ou também `001_schema_base` (opção B, banco vazio) e `Termos de TI no ar`.

### Criar o primeiro administrador

```
docker compose exec app node scripts/criar-admin.mjs alvaro.bandim "Alvaro Bandim" alvaro.bandim@bragait.com
```

(com a opção A, acrescente `-f docker-compose.banco-externo.yml` logo depois de `docker compose`)

O comando mostra uma senha provisória; a pessoa troca no primeiro acesso. Os demais usuários são criados pela tela **Usuários**.

## 4. Operação

| Tarefa | Como |
|---|---|
| Backup diário | `pg_dump` do banco `termos` (opção B: `docker compose exec banco pg_dump -U termos termos > termos-AAAA-MM-DD.sql`). Guardar fora do servidor, junto com a `CPF_CHAVE` em local separado. |
| Atualizar versão | Substituir os arquivos da pasta e `docker compose up -d --build`. Mudanças de banco são aplicadas sozinhas na subida (pasta `db/`). |
| Logs | `docker compose logs -f app` |
| Reiniciar | `docker compose restart app` |

## 5. Segurança (resumo)

- Senhas com hash scrypt; bloqueio de 15 min após 5 tentativas erradas; sessão expira em 12 h.
- CPF cifrado no banco; telas e listas só mostram `***.***.***-NN`. O CPF completo aparece apenas no PDF do termo.
- Link de assinatura: aleatório (256 bits), vale 7 dias e só aceita uma assinatura; depois serve apenas para baixar a cópia por 30 dias. O banco guarda só o hash do link.
- Trilha de auditoria protegida por gatilho: não aceita UPDATE nem DELETE.
- Cabeçalhos de segurança (CSP, nosniff, frame) no próprio servidor.
- Dados pessoais tratados: nome, CPF, setor, telefone e e-mail do colaborador (LGPD; finalidade: controle de responsabilidade sobre equipamentos).

## 6. Próximo passo: login com a conta Microsoft (Entra ID)

Quando houver o registro do aplicativo (single tenant, plataforma SPA, permissões `openid profile email User.Read`), preencher no `.env`:

```
ENTRA_TENANT_ID=<id do diretório>
ENTRA_CLIENT_ID=<id do aplicativo>
```

A validação do login Microsoft será ligada em uma atualização seguinte.
