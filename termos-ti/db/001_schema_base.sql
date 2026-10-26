-- Estrutura criada pela equipe de TI do hospital (reconstruída do dump termos_ti_teste.dump, PostgreSQL 17).
-- No banco de produção ela já existe e está registrada em schema_migrations como '001_schema_base':
-- este arquivo só roda em banco vazio (testes locais). Se a TI enviar o .sql original, substituir por ele.

create table usuarios (
  id bigint generated always as identity primary key,
  login text not null unique,
  nome text not null,
  email text,
  papel text not null check (papel in ('admin', 'tecnico', 'colaborador', 'leitor')),
  senha_hash text,
  trocar_senha boolean not null default true,
  ativo boolean not null default true,
  assinatura_png bytea,
  entra_oid text unique,
  criado_em timestamptz not null default now()
);

create table sessoes (
  token_hash text primary key,
  usuario_id bigint not null references usuarios(id) on delete cascade,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  check (expira_em > criado_em)
);
create index sessoes_expira_idx on sessoes (expira_em);
create index sessoes_usuario_idx on sessoes (usuario_id);

create table tentativas (
  chave text primary key,
  falhas integer not null default 0 check (falhas >= 0),
  bloqueado_ate timestamptz,
  atualizado_em timestamptz not null default now()
);

create table colaboradores (
  id bigint generated always as identity primary key,
  matricula text unique,
  nome text not null,
  email text,
  cpf_cifrado text,
  cpf_mascara text,
  setor text not null,
  telefone text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index colaboradores_email_idx on colaboradores (lower(email)) where email is not null;
create index colaboradores_nome_idx on colaboradores (nome);
create index colaboradores_setor_idx on colaboradores (setor);

create table perfis (
  id bigint generated always as identity primary key,
  nome text not null unique,
  categoria text not null,
  marca text not null,
  modelo text not null,
  config text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table ativos (
  id bigint generated always as identity primary key,
  patrimonio text not null unique,
  service_tag text unique,
  categoria text not null,
  marca text not null,
  modelo text not null,
  config text,
  garantia date,
  status text not null default 'disponivel' check (status in ('disponivel', 'em_uso', 'manutencao', 'baixado')),
  perfil_id bigint references perfis(id) on delete set null,
  criado_por bigint not null references usuarios(id) on delete restrict,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index ativos_categoria_idx on ativos (categoria);
create index ativos_modelo_idx on ativos (marca, modelo);
create index ativos_status_idx on ativos (status);

create table contadores (
  chave text primary key,
  ultimo bigint not null default 0 check (ultimo >= 0)
);

create table termos (
  id bigint generated always as identity primary key,
  numero text not null unique,
  tipo text not null check (tipo in ('conhecimento', 'entrega')),
  colaborador_id bigint not null references colaboradores(id) on delete restrict,
  ativo_id bigint references ativos(id) on delete restrict,
  tecnico_id bigint not null references usuarios(id) on delete restrict,
  setor text not null,
  telefone text,
  chamado text,
  local_ativo text,
  acessorios text[] not null default '{}',
  dados jsonb not null,
  hash_dados text not null,
  status text not null default 'gerado' check (status in ('gerado', 'enviado', 'assinado', 'encerrado', 'cancelado')),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  token_hash text unique,
  token_expira timestamptz,
  assinado_em timestamptz,
  assinatura_png bytea,
  aceite_nome text,
  aceite_ip inet,
  aceite_navegador text,
  aceite_identidade text,
  pdf bytea,
  pdf_hash text,
  encerrado_em timestamptz,
  cancelado_motivo text,
  constraint termos_id_ativo_uk unique (id, ativo_id),
  constraint termos_tipo_ativo_ck check ((tipo = 'entrega' and ativo_id is not null) or (tipo = 'conhecimento' and ativo_id is null))
);
create index termos_ativo_idx on termos (ativo_id) where ativo_id is not null;
create index termos_colaborador_idx on termos (colaborador_id, criado_em desc);
create index termos_status_idx on termos (status, criado_em desc);
create index termos_tipo_idx on termos (tipo, criado_em desc);
create unique index termos_um_por_ativo on termos (ativo_id) where tipo = 'entrega' and status in ('gerado', 'enviado', 'assinado');

create table devolucoes (
  id bigint generated always as identity primary key,
  termo_id bigint not null unique,
  ativo_id bigint not null,
  recebido_por bigint not null references usuarios(id) on delete restrict,
  condicao text not null check (condicao in ('sem_avarias', 'com_avaria', 'falta_acessorio')),
  destino text not null check (destino in ('disponivel', 'manutencao')),
  obs text,
  em timestamptz not null default now(),
  constraint devolucoes_termo_ativo_fk foreign key (termo_id, ativo_id) references termos(id, ativo_id) on delete restrict
);
create index devolucoes_ativo_idx on devolucoes (ativo_id, em desc);

create table auditoria (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  usuario_id bigint references usuarios(id) on delete restrict,
  quem text not null,
  acao text not null,
  ativo_id bigint references ativos(id) on delete restrict,
  termo_id bigint references termos(id) on delete restrict,
  detalhe jsonb not null default '{}'
);
create index auditoria_ativo_idx on auditoria (ativo_id, em desc);
create index auditoria_termo_idx on auditoria (termo_id, em desc);
create index auditoria_usuario_idx on auditoria (usuario_id, em desc);

create function auditoria_somente_inclusao() returns trigger language plpgsql as $$
begin
  raise exception 'A auditoria não pode ser alterada nem apagada';
end;
$$;
create trigger auditoria_trava before delete or update on auditoria
  for each row execute function auditoria_somente_inclusao();

insert into perfis (nome, categoria, marca, modelo, config) values
  ('ThinkPad L14 Padrão', 'Notebook', 'Lenovo', 'ThinkPad L14', 'Intel Core i5 · 16 GB · SSD 512 GB'),
  ('Latitude 5420', 'Notebook', 'Dell', 'Latitude 5420', 'Intel Core i5 · 16 GB · SSD 512 GB'),
  ('OptiPlex 3000', 'Desktop', 'Dell', 'OptiPlex 3000', 'Intel Core i5 · 8 GB · SSD 256 GB');
