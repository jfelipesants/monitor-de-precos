-- =========================================================
-- seed.sql — Produtos de exemplo (opcional)
--
-- Troque as URLs por produtos reais que você quer monitorar.
-- Também é possível cadastrar pela CLI:
--   npm run produto -- add --url "<url>" --alvo 1500
-- =========================================================

insert into public.produtos (nome, url, loja, preco_alvo)
values
  ('Exemplo Kabum — troque a URL',
   'https://www.kabum.com.br/produto/000000/exemplo',
   'kabum', 1500.00),
  ('Exemplo Mercado Livre — troque a URL',
   'https://produto.mercadolivre.com.br/MLB-0000000000-exemplo',
   'mercado_livre', 300.00)
on conflict (url) do nothing;
