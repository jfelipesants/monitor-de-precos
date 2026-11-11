-- =========================================================
-- 003_rls.sql — Segurança (Row Level Security)
--
-- O backend usa a chave SERVICE_ROLE, que ignora RLS.
-- Ativar RLS SEM criar policies públicas faz com que a chave
-- "anon" (pública) não consiga ler nem escrever nada.
-- =========================================================

alter table public.produtos         enable row level security;
alter table public.historico_precos enable row level security;
alter table public.alertas          enable row level security;
