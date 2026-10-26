-- Termos de TI · estrutura inicial (MVP: ativo, entrega, aceite, devolução)

create table usuarios (
  id serial primary key,
  login text not null unique,
  nome text not null,
  email text,
  papel text not null check (papel in ('admin', 'tecnico', 'colaborador', 'leitor')),
  senha_hash text,
  trocar_senha boolean not null default true,
  ativo boolean not null default true,
  assinatura_png bytea,              -- assinatura do técnico, gravada uma vez no perfil
  entra_oid text unique,             -- id da pessoa no Entra ID (login Microsoft, quando ligado)
  criado_em timestamptz not null default now()
);

create table sessoes (
  token_hash text primary key,
  usuario_id int not null references usuarios(id),
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null
);

create table tentativas (
  chave text primary key,
  falhas int not null default 0,
  bloqueado_ate timestamptz
);

-- perfis prontos de máquina (Fase 3: editáveis pelo administrador)
create table perfis (
  id serial primary key,
  nome text not null unique,
  categoria text not null,
  marca text not null,
  modelo text not null,
  config text not null,
  ativo boolean not null default true
);

create table ativos (
  id serial primary key,
  patrimonio text not null unique,
  service_tag text,
  categoria text not null,
  marca text not null,
  modelo text not null,
  config text,
  garantia date,
  status text not null default 'disponivel' check (status in ('disponivel', 'em_uso', 'manutencao', 'baixado')),
  perfil_id int references perfis(id),
  criado_por int not null references usuarios(id),
  criado_em timestamptz not null default now()
);

create table contadores (
  chave text primary key,
  ultimo int not null
);

create table termos (
  id serial primary key,
  numero text not null unique,                 -- ENT-2026-000123
  tipo text not null default 'entrega' check (tipo in ('entrega')),
  ativo_id int not null references ativos(id),
  colaborador_nome text not null,
  colaborador_email text,
  cpf_cifrado text,                            -- CPF completo cifrado (AES-GCM); só aparece no PDF
  cpf_mascara text,                            -- ***.***.***-25
  setor text not null,
  telefone text not null,
  chamado text not null,
  local_ativo text not null,
  acessorios text[] not null default '{}',
  tecnico_id int not null references usuarios(id),
  dados jsonb not null,                        -- retrato do termo no momento em que foi gerado
  hash_dados text not null,                    -- SHA-256 do retrato
  status text not null default 'gerado' check (status in ('gerado', 'enviado', 'assinado', 'encerrado', 'cancelado')),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  token_hash text unique,                      -- link de assinatura (só o hash fica no banco)
  token_expira timestamptz,
  assinado_em timestamptz,
  assinatura_png bytea,
  aceite_nome text,
  aceite_ip text,
  aceite_navegador text,
  aceite_identidade text,                      -- 'link' no piloto; e-mail Microsoft quando o Entra ID estiver ligado
  pdf bytea,
  pdf_hash text,
  encerrado_em timestamptz,
  cancelado_motivo text
);
-- o servidor garante: um ativo só fica com uma pessoa por vez
create unique index termos_um_por_ativo on termos (ativo_id) where status in ('gerado', 'enviado', 'assinado');
create index termos_ativo on termos (ativo_id);

create table devolucoes (
  id serial primary key,
  termo_id int not null unique references termos(id),
  ativo_id int not null references ativos(id),
  recebido_por int not null references usuarios(id),
  condicao text not null check (condicao in ('sem_avarias', 'com_avaria', 'falta_acessorio')),
  destino text not null check (destino in ('disponivel', 'manutencao')),
  obs text,
  em timestamptz not null default now()
);

-- trilha de auditoria: só aceita inclusão
create table auditoria (
  id bigserial primary key,
  em timestamptz not null default now(),
  usuario_id int references usuarios(id),
  quem text not null,
  acao text not null,
  ativo_id int references ativos(id),
  termo_id int references termos(id),
  detalhe jsonb not null default '{}'
);
create index auditoria_ativo on auditoria (ativo_id, em desc);
create function auditoria_somente_inclusao() returns trigger language plpgsql as $$
begin
  raise exception 'A auditoria não pode ser alterada nem apagada';
end $$;
create trigger auditoria_trava before update or delete on auditoria
  for each row execute function auditoria_somente_inclusao();

insert into perfis (nome, categoria, marca, modelo, config) values
  ('ThinkPad L14 Padrão', 'Notebook', 'Lenovo', 'Lenovo ThinkPad L14', 'Intel Core i5 · 16 GB · SSD 512 GB'),
  ('Latitude 5420', 'Notebook', 'Dell', 'Dell Latitude 5420', 'Intel Core i5 · 16 GB · SSD 512 GB'),
  ('OptiPlex 3000', 'Desktop', 'Dell', 'Dell OptiPlex 3000', 'Intel Core i5 · 8 GB · SSD 256 GB');
