-- Medidas do piloto: tempo para localizar e erros de digitação barrados pelo sistema.
-- Esta migração é aplicada por lib/db.js depois de db/001_inicial.sql.
-- Separada da auditoria: registra medições operacionais, não eventos de auditoria.

CREATE TABLE metricas (
  id bigserial PRIMARY KEY,
  em timestamptz NOT NULL DEFAULT now(),
  usuario_id int REFERENCES usuarios(id),
  tipo text NOT NULL CHECK (tipo IN ('busca', 'erro')),
  ms int CHECK (ms IS NULL OR ms >= 0),
  campo text,
  detalhe text
);

CREATE INDEX metricas_tipo_em ON metricas (tipo, em);
