-- 002 · acréscimos do sistema sobre a estrutura da TI (não altera nem apaga nada existente)

-- 1. Medidas do piloto (slide 20): tempo para localizar e erros de digitação barrados.
create table metricas (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  usuario_id bigint references usuarios(id) on delete restrict,
  tipo text not null check (tipo in ('busca', 'erro')),
  ms integer,          -- busca: do começo da busca até abrir o ativo
  campo text,          -- erro: qual campo foi barrado (cpf, telefone, patrimonio...)
  detalhe text
);
create index metricas_tipo_em_idx on metricas (tipo, em);

-- 2. Achar o colaborador pelo CPF sem guardar o CPF aberto: o cifrado usa IV aleatório e não serve para busca,
--    então guardamos um HMAC-SHA256 do CPF com a chave do servidor (CPF_CHAVE).
alter table colaboradores add column cpf_hash text;
create unique index colaboradores_cpf_hash_uk on colaboradores (cpf_hash) where cpf_hash is not null;

-- 3. Leitura dos termos com os dados do colaborador (o termo guarda só colaborador_id).
create view termos_v as
  select t.*, c.nome as colaborador_nome, c.email as colaborador_email, c.matricula as colaborador_matricula,
         c.cpf_cifrado, c.cpf_mascara
  from termos t join colaboradores c on c.id = t.colaborador_id;
