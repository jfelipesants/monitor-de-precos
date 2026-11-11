-- =========================================================
-- 001_schema.sql — Monitor de Preços
-- Tabelas, tipos, índices e triggers.
-- Execute no Supabase: SQL Editor > New query > cole e rode.
-- =========================================================

-- Lojas suportadas. Ao criar um novo scraper, adicione o valor aqui:
--   alter type public.loja_tipo add value 'nova_loja';
create type public.loja_tipo as enum ('kabum', 'mercado_livre', 'amazon');

create type public.alerta_tipo as enum ('meta_atingida', 'queda_media', 'menor_preco_historico');

-- ---------------------------------------------------------
-- Produtos monitorados
-- ---------------------------------------------------------
create table public.produtos (
  id            uuid primary key default gen_random_uuid(),
  nome          text          not null check (char_length(nome) between 2 and 200),
  url           text          not null unique check (url ~* '^https?://'),
  loja          public.loja_tipo not null,
  preco_alvo    numeric(12,2) check (preco_alvo is null or preco_alvo > 0),
  ativo         boolean       not null default true,
  ultimo_preco  numeric(12,2),
  ultima_coleta timestamptz,
  ultimo_erro   text,                         -- última falha de scraping (debug)
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now()
);

comment on table  public.produtos             is 'Produtos cujo preço é monitorado.';
comment on column public.produtos.preco_alvo  is 'Meta de preço: alerta quando o preço atual for menor ou igual.';
comment on column public.produtos.ultimo_erro is 'Mensagem da última falha de coleta (null quando a última coleta teve sucesso).';

create index idx_produtos_ativos on public.produtos (ativo) where ativo = true;

-- ---------------------------------------------------------
-- Histórico de preços (série temporal)
-- ---------------------------------------------------------
create table public.historico_precos (
  id             bigint generated always as identity primary key,
  produto_id     uuid          not null references public.produtos(id) on delete cascade,
  preco          numeric(12,2) not null check (preco > 0),
  preco_original numeric(12,2) check (preco_original is null or preco_original > 0), -- "de R$ X por..."
  disponivel     boolean       not null default true,
  coletado_em    timestamptz   not null default now()
);

comment on table public.historico_precos is 'Cada linha é uma coleta de preço de um produto.';

-- Consulta mais comum: histórico de um produto ordenado por data.
create index idx_historico_produto_data
  on public.historico_precos (produto_id, coletado_em desc);

-- ---------------------------------------------------------
-- Alertas enviados (auditoria + cooldown anti-spam)
-- ---------------------------------------------------------
create table public.alertas (
  id               bigint generated always as identity primary key,
  produto_id       uuid               not null references public.produtos(id) on delete cascade,
  tipo             public.alerta_tipo not null,
  preco            numeric(12,2)      not null check (preco > 0),
  preco_referencia numeric(12,2),     -- meta, média ou mínimo usado na comparação
  canais           text[]             not null default '{}',  -- ex.: {email}
  enviado_em       timestamptz        not null default now()
);

comment on table public.alertas is 'Alertas disparados. Usado para auditoria e para evitar alertas repetidos (cooldown).';

create index idx_alertas_produto_tipo_data
  on public.alertas (produto_id, tipo, enviado_em desc);

-- ---------------------------------------------------------
-- Trigger: mantém updated_at atualizado automaticamente
-- ---------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_produtos_updated_at
  before update on public.produtos
  for each row execute function public.set_updated_at();
