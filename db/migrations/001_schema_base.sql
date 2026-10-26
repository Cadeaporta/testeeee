-- Termos de TI: esquema inicial versionado para PostgreSQL 17.
-- Esta migração é para banco NOVO. Executar uma única vez, em transação.
BEGIN;

CREATE TABLE usuarios (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login text NOT NULL UNIQUE,
  nome text NOT NULL,
  email text,
  papel text NOT NULL CHECK (papel IN ('admin', 'tecnico', 'colaborador', 'leitor')),
  senha_hash text,
  trocar_senha boolean NOT NULL DEFAULT true,
  ativo boolean NOT NULL DEFAULT true,
  assinatura_png bytea,
  entra_oid text UNIQUE,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessoes (
  token_hash text PRIMARY KEY,
  usuario_id bigint NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  CHECK (expira_em > criado_em)
);

CREATE INDEX sessoes_usuario_idx ON sessoes (usuario_id);
CREATE INDEX sessoes_expira_idx ON sessoes (expira_em);

CREATE TABLE tentativas (
  chave text PRIMARY KEY,
  falhas integer NOT NULL DEFAULT 0 CHECK (falhas >= 0),
  bloqueado_ate timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE colaboradores (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  matricula text UNIQUE,
  nome text NOT NULL,
  email text,
  cpf_cifrado text,
  cpf_mascara text,
  setor text NOT NULL,
  telefone text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX colaboradores_nome_idx ON colaboradores (nome);
CREATE INDEX colaboradores_setor_idx ON colaboradores (setor);
CREATE INDEX colaboradores_email_idx ON colaboradores (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE perfis (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome text NOT NULL UNIQUE,
  categoria text NOT NULL,
  marca text NOT NULL,
  modelo text NOT NULL,
  config text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ativos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patrimonio text NOT NULL UNIQUE,
  service_tag text UNIQUE,
  categoria text NOT NULL,
  marca text NOT NULL,
  modelo text NOT NULL,
  config text,
  garantia date,
  status text NOT NULL DEFAULT 'disponivel'
    CHECK (status IN ('disponivel', 'em_uso', 'manutencao', 'baixado')),
  perfil_id bigint REFERENCES perfis(id) ON DELETE SET NULL,
  criado_por bigint NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ativos_status_idx ON ativos (status);
CREATE INDEX ativos_categoria_idx ON ativos (categoria);
CREATE INDEX ativos_modelo_idx ON ativos (marca, modelo);

CREATE TABLE contadores (
  chave text PRIMARY KEY,
  ultimo bigint NOT NULL DEFAULT 0 CHECK (ultimo >= 0)
);

CREATE TABLE termos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero text NOT NULL UNIQUE,
  tipo text NOT NULL CHECK (tipo IN ('conhecimento', 'entrega')),
  colaborador_id bigint NOT NULL REFERENCES colaboradores(id) ON DELETE RESTRICT,
  ativo_id bigint REFERENCES ativos(id) ON DELETE RESTRICT,
  tecnico_id bigint NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  setor text NOT NULL,
  telefone text,
  chamado text,
  local_ativo text,
  acessorios text[] NOT NULL DEFAULT '{}',
  dados jsonb NOT NULL,
  hash_dados text NOT NULL,
  status text NOT NULL DEFAULT 'gerado'
    CHECK (status IN ('gerado', 'enviado', 'assinado', 'encerrado', 'cancelado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  enviado_em timestamptz,
  token_hash text UNIQUE,
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
  CONSTRAINT termos_tipo_ativo_ck CHECK (
    (tipo = 'entrega' AND ativo_id IS NOT NULL) OR
    (tipo = 'conhecimento' AND ativo_id IS NULL)
  ),
  CONSTRAINT termos_id_ativo_uk UNIQUE (id, ativo_id)
);

CREATE UNIQUE INDEX termos_um_por_ativo
  ON termos (ativo_id)
  WHERE tipo = 'entrega' AND status IN ('gerado', 'enviado', 'assinado');

CREATE INDEX termos_colaborador_idx ON termos (colaborador_id, criado_em DESC);
CREATE INDEX termos_ativo_idx ON termos (ativo_id) WHERE ativo_id IS NOT NULL;
CREATE INDEX termos_status_idx ON termos (status, criado_em DESC);
CREATE INDEX termos_tipo_idx ON termos (tipo, criado_em DESC);

CREATE TABLE devolucoes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  termo_id bigint NOT NULL UNIQUE,
  ativo_id bigint NOT NULL,
  recebido_por bigint NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  condicao text NOT NULL
    CHECK (condicao IN ('sem_avarias', 'com_avaria', 'falta_acessorio')),
  destino text NOT NULL CHECK (destino IN ('disponivel', 'manutencao')),
  obs text,
  em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devolucoes_termo_ativo_fk
    FOREIGN KEY (termo_id, ativo_id) REFERENCES termos(id, ativo_id) ON DELETE RESTRICT
);

CREATE INDEX devolucoes_ativo_idx ON devolucoes (ativo_id, em DESC);

CREATE TABLE auditoria (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  em timestamptz NOT NULL DEFAULT now(),
  usuario_id bigint REFERENCES usuarios(id) ON DELETE SET NULL,
  quem text NOT NULL,
  acao text NOT NULL,
  ativo_id bigint REFERENCES ativos(id) ON DELETE SET NULL,
  termo_id bigint REFERENCES termos(id) ON DELETE SET NULL,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX auditoria_ativo_idx ON auditoria (ativo_id, em DESC);
CREATE INDEX auditoria_termo_idx ON auditoria (termo_id, em DESC);
CREATE INDEX auditoria_usuario_idx ON auditoria (usuario_id, em DESC);

CREATE FUNCTION auditoria_somente_inclusao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A auditoria não pode ser alterada nem apagada';
END;
$$;

CREATE TRIGGER auditoria_trava
BEFORE UPDATE OR DELETE ON auditoria
FOR EACH ROW EXECUTE FUNCTION auditoria_somente_inclusao();

INSERT INTO perfis (nome, categoria, marca, modelo, config) VALUES
  ('ThinkPad L14 Padrão', 'Notebook', 'Lenovo', 'ThinkPad L14', 'Intel Core i5 · 16 GB · SSD 512 GB'),
  ('Latitude 5420', 'Notebook', 'Dell', 'Latitude 5420', 'Intel Core i5 · 16 GB · SSD 512 GB'),
  ('OptiPlex 3000', 'Desktop', 'Dell', 'OptiPlex 3000', 'Intel Core i5 · 8 GB · SSD 256 GB')
ON CONFLICT (nome) DO NOTHING;

COMMIT;
