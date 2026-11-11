-- =========================================================
-- 002_views.sql — Estatísticas por produto
-- Usada pelo PriceAnalyzer para comparar o preço atual com
-- a média dos últimos 30 dias e com o menor preço já visto.
-- =========================================================

create or replace view public.v_estatisticas_produto
with (security_invoker = true) as
select
  p.id                    as produto_id,
  p.nome,
  p.preco_alvo,
  count(h.id)::int        as amostras_30d,
  round(avg(h.preco), 2)  as media_30d,
  min(h.preco)            as minimo_30d,
  max(h.preco)            as maximo_30d,
  (
    select min(hh.preco)
    from public.historico_precos hh
    where hh.produto_id = p.id
  )                       as minimo_historico
from public.produtos p
left join public.historico_precos h
  on h.produto_id = p.id
 and h.coletado_em >= now() - interval '30 days'
group by p.id;

comment on view public.v_estatisticas_produto is
  'Média, mínimo e máximo dos últimos 30 dias + menor preço histórico por produto.';
