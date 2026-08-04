-- ============================================================================
-- 004_agendamento_cron.sql
-- Agenda as chamadas automáticas (pg_cron) pro carteiro (ig-scheduler) e pra
-- renovação do token (ig-token-refresh).
--
-- ANTES DE RODAR: troque os placeholders abaixo:
--   SEU_PROJECT_REF   -> a referência do seu projeto Supabase (aparece na URL,
--                         ex: abcdefghijklmnop)
--   SEU_SCHED_SECRET  -> o mesmo valor que você configurou na variável de
--                         ambiente SCHED_SECRET das Edge Functions
--
-- Pré-requisitos: habilitar as extensões "pg_cron" e "pg_net" no projeto
-- (Database > Extensions, no painel do Supabase).
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- remove agendamentos antigos com o mesmo nome, se já existirem (permite
-- rodar este script de novo sem duplicar)
select cron.unschedule(jobid)
from cron.job
where jobname in ('ig-scheduler-1min', 'ig-token-refresh-semanal');

-- ig-scheduler: esvazia a fila de envios e manda os passos com atraso vencidos.
-- Roda a cada 1 minuto.
select cron.schedule(
  'ig-scheduler-1min',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://SEU_PROJECT_REF.supabase.co/functions/v1/ig-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sched-key', 'SEU_SCHED_SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ig-token-refresh: renova o token long-lived do Instagram antes de vencer.
-- Roda 1x por semana (toda segunda-feira às 03:00 UTC).
select cron.schedule(
  'ig-token-refresh-semanal',
  '0 3 * * 1',
  $$
  select net.http_post(
    url := 'https://SEU_PROJECT_REF.supabase.co/functions/v1/ig-token-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sched-key', 'SEU_SCHED_SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- pra conferir que os dois agendamentos foram criados:
-- select jobid, jobname, schedule, active from cron.job;
