# Termos de TI · MVP

Implementação do documento **"Braga IT - Termos de TI MVP v2"**: cadastro de ativo, entrega com termo em PDF, aceite do colaborador no celular e devolução.

## O que já funciona

| Tela do PDF | Onde no sistema |
|---|---|
| 1 · Entrada | Usuário e senha do piloto. O botão "Entrar com a conta Microsoft" já aparece e liga quando houver o registro no Entra ID |
| 2 · Quem está com o quê | **Início**: números (em uso, disponíveis, manutenção, aceites pendentes), busca por patrimônio/pessoa e filtro |
| 3 · Cadastro de ativo | **Ativos**: perfil pronto + patrimônio, Service Tag e garantia; "Salvar e cadastrar outro"; importação por CSV |
| 4 e 5 · Entrega e conferência | **Entregas**: o patrimônio puxa equipamento, Service Tag e configuração (em cinza); CPF e telefone validados |
| 6 · Termo gerado | Número `ENT-AAAA-NNNNNN`, andamento, miniatura do PDF, **Enviar para assinatura** e **Assinar neste aparelho** |
| 7 · Termo assinado | PDF com as duas assinaturas, hash SHA-256 do termo e do PDF, "Baixar PDF" |
| 8 e 9 · Celular do colaborador | Link pessoal (WhatsApp ou e-mail): confere, marca "Conferi", assina com o dedo, baixa a cópia |
| 10 · Devolução | Mostra com quem está, condição e destino; encerra a custódia |
| 11 · Histórico do ativo | Cada cadastro, entrega, envio, aceite e devolução com quem fez e quando |

**O servidor garante** (página 19 do PDF): um ativo só fica com uma pessoa por vez (regra no próprio banco); o colaborador vê só os próprios termos; perfis administrador, técnico, colaborador e leitor; a auditoria não pode ser alterada nem apagada (trava no banco); o técnico vem do login, nunca é digitado; a assinatura do técnico é gravada uma vez no perfil.

## Diferenças em relação ao PDF (decisões provisórias)

- **Tecnologia:** Node.js no lugar de Python/FastAPI, e telas em HTML simples no lugar de React. Banco PostgreSQL e Docker como no PDF. Para trocar a API por Python no futuro, as tabelas continuam as mesmas.
- **PDF:** gerado com pdf-lib (JavaScript) no lugar do WeasyPrint. Tem número, hash SHA-256 e as assinaturas.
- **Login Microsoft:** pendente do registro do aplicativo no Entra ID. No piloto, o colaborador assina por um **link pessoal** que vale 7 dias e só serve uma vez. O PDF registra isso como "link pessoal enviado pelo técnico", com data, hora e IP.
- **CPF** (decisão do Jurídico pendente): o banco guarda o CPF **cifrado** (AES-256) e uma versão mascarada (`***.***.***-25`). O CPF completo só aparece dentro do PDF. Se o Jurídico decidir "só no PDF", basta apagar a coluna `cpf_cifrado` depois de gerar os PDFs.
- **Cópia por e-mail:** no piloto o colaborador baixa a cópia na hora. O envio automático por e-mail depende de um remetente oficial do hospital.
- **Relatórios:** ficaram de fora do MVP (estão em "Depois, a validar" no PDF).

## Testar no seu computador

Não precisa instalar banco nem Docker: o teste usa um PostgreSQL embutido.

```
cd Documents\termos-ti
npm install
npm run dev
```

Abra http://localhost:3002. Na primeira vez aparece no terminal o usuário `admin` com uma senha provisória.

- `npm test`: roda 43 verificações do fluxo completo, num banco em memória.
- `npm run dev -- --limpo`: começa com o banco local vazio.

## Publicar

### Opção A · VM Linux do hospital (como no PDF)

1. Instalar o Docker na VM e copiar esta pasta para lá.
2. Criar o arquivo `.env` ao lado do `docker-compose.yml`:
   ```
   DOMINIO=termos.hospitalveracruz.com.br
   POSTGRES_SENHA=<uma senha longa>
   CPF_CHAVE=<64 caracteres; gerar com: openssl rand -hex 32>
   ```
3. `docker compose up -d`. O Caddy cria o HTTPS sozinho; o DNS do domínio precisa apontar para a VM.
4. Criar o primeiro administrador: `docker compose exec app node scripts/criar-admin.mjs seu.usuario "Seu Nome"`.

> **Guarde a CPF_CHAVE em lugar seguro.** Sem ela não dá para gerar o PDF de termos antigos que ainda não foram assinados. Os termos já assinados ficam com o PDF pronto no banco.

**Backup:** `docker compose exec banco pg_dump -U termos termos > backup.sql` (agendar diariamente).

### Opção B · Gratuito, enquanto não há VM (Render + Supabase)

O mesmo caminho da Ronda: o banco fica no Supabase e o servidor no Render (`render.yaml`). Preencher `DATABASE_URL` e `CPF_CHAVE`.

## Para ligar o login Microsoft

Pedir a quem administra o Microsoft 365/Entra ID:

> Registro de aplicativo "Termos de TI", single tenant, plataforma SPA, redirect `https://<endereço do sistema>/`, permissões `openid profile email User.Read`. Preciso do **ID do diretório (tenant)** e do **ID do aplicativo (client)**.

Com os dois IDs: preencher `ENTRA_TENANT_ID` e `ENTRA_CLIENT_ID`. Ainda falta programar a validação do token (marco 1 do PDF) quando os IDs chegarem.

## Estrutura

- `server.mjs`: servidor HTTP (API + páginas)
- `lib/rotas.js`: regras e rotas da API
- `lib/pdf.js`: o termo em PDF (texto das cláusulas, versão `entrega-v1`)
- `db/001_inicial.sql`: tabelas. Mudanças futuras entram como `db/002_...sql` e são aplicadas sozinhas na subida.
- `public/index.html`: telas do técnico
- `public/assinar.html`: tela do colaborador no celular
