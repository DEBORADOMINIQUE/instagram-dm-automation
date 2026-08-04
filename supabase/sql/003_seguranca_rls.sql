-- ============================================================================
-- 003_seguranca_rls.sql
-- Regras de acesso (Row Level Security). Sem isso, o banco fica aberto.
--
-- Regra geral: só usuários autenticados no painel (Supabase Auth) podem ler
-- e escrever. As Edge Functions usam a chave de service_role, que ignora o
-- RLS por padrão, então elas continuam funcionando normalmente.
-- ============================================================================

alter table public.ig_automations   enable row level security;
alter table public.ig_leads         enable row level security;
alter table public.ig_deliveries    enable row level security;
alter table public.ig_send_queue    enable row level security;
alter table public.ig_send_budget   enable row level security;
alter table public.ig_scheduled     enable row level security;
alter table public.ig_assets        enable row level security;
alter table public.ig_token_status  enable row level security;
alter table public.ig_bot_sends     enable row level security;

-- política padrão: usuário autenticado pode ler e escrever em tudo.
-- (o painel é de uso interno, de uma pessoa/equipe só; não há hierarquia de
-- permissões aqui. Se precisar de perfis diferentes no futuro, refine estas
-- políticas por tabela.)

create policy "autenticados podem tudo em ig_automations"
  on public.ig_automations for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "autenticados podem tudo em ig_leads"
  on public.ig_leads for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "autenticados podem tudo em ig_deliveries"
  on public.ig_deliveries for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "autenticados podem tudo em ig_send_queue"
  on public.ig_send_queue for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "autenticados podem tudo em ig_send_budget"
  on public.ig_send_budget for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "autenticados podem tudo em ig_scheduled"
  on public.ig_scheduled for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "autenticados podem tudo em ig_assets"
  on public.ig_assets for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "autenticados podem tudo em ig_token_status"
  on public.ig_token_status for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "autenticados podem tudo em ig_bot_sends"
  on public.ig_bot_sends for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- nenhuma política para o papel "anon": o público não autenticado não
-- enxerga nada nessas tabelas.
