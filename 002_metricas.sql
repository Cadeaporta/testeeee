-- Medidas do piloto (slide 20): tempo para localizar e erros de digitação barrados pelo sistema.
-- Separado da auditoria: aqui não é "quem fez o quê", é medição.
create table metricas (
  id bigserial primary key,
  em timestamptz not null default now(),
  usuario_id int references usuarios(id),
  tipo text not null check (tipo in ('busca', 'erro')),
  ms int,            -- busca: tempo do começo da busca até abrir o ativo/termo
  campo text,        -- erro: qual campo foi barrado (cpf, telefone, patrimonio...)
  detalhe text
);
create index metricas_tipo_em on metricas (tipo, em);
