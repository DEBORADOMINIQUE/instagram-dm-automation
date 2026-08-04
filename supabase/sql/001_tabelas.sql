-- ============================================================================
-- 001_tabelas.sql
-- Estrutura de tabelas do sistema de automação de DM do Instagram.
-- Rode este script no editor SQL do Supabase (SQL Editor > New query).
-- ============================================================================

-- Extensão de UUID (o Supabase já costuma vir com isso ligado, mas garantimos aqui)
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- ig_automations: cada automação criada no painel (o "ManyChat" da conta)
-- ----------------------------------------------------------------------------
create table if not exists public.ig_automations (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  keyword text default '',                    -- palavras-gatilho separadas por vírgula
  match_any boolean not null default false,    -- true = qualquer comentário ativa
  active boolean not null default true,
  media_ids text[] not null default '{}',      -- posts em que a automação vale (vazio = todos)
  public_reply text default '',                -- resposta pública padrão no comentário
  public_reply_variants text[] not null default '{}', -- variações A/B da resposta pública
  flow jsonb not null default '{"steps":[]}',  -- a conversa inteira (ver seção 7 do prompt de build)
  asset_ids text[] not null default '{}',      -- arquivos vinculados (referência solta a ig_assets)
  updated_at timestamptz not null default now()
);

comment on table public.ig_automations is 'Automações de resposta a comentário/DM, cada uma com um fluxo de conversa (flow).';
comment on column public.ig_automations.flow is 'Formato: { steps: [ { id, message, buttons:[{title,next|url}], assets, collect, delay } ] }. O primeiro item do array é sempre a Mensagem 1.';

-- ----------------------------------------------------------------------------
-- ig_leads: cada pessoa que já interagiu (comentou ou mandou DM)
-- ----------------------------------------------------------------------------
create table if not exists public.ig_leads (
  ig_user_id text primary key,
  username text,
  last_source text,                 -- comment / dm / story_reply
  last_keyword text,
  automation_id uuid references public.ig_automations(id) on delete set null,
  flow_step text,                   -- em que passo da conversa a pessoa está (id do step)
  link_sent boolean not null default false,
  expecting jsonb,                  -- quando um passo pede um dado (ex: {"field":"email","next":3})
  tags text[] not null default '{}',
  email text,
  telefone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ig_leads is 'Contatos que já interagiram com alguma automação. Chave primária é o id do usuário no Instagram.';

-- ----------------------------------------------------------------------------
-- ig_deliveries: log de cada tentativa de envio (auditoria)
-- ----------------------------------------------------------------------------
create table if not exists public.ig_deliveries (
  id uuid primary key default gen_random_uuid(),
  ig_user_id text,
  automation_id uuid references public.ig_automations(id) on delete set null,
  canal text,                       -- private_reply / dm
  tipo text,                        -- flow / link / text
  status text,                      -- ok / erro / na_fila
  motivo text,
  ts timestamptz not null default now()
);

comment on table public.ig_deliveries is 'Log de auditoria de cada envio tentado (sucesso, erro ou enfileirado).';

-- ----------------------------------------------------------------------------
-- ig_send_queue: fila de envios represados pelo freio de disparo
-- ----------------------------------------------------------------------------
create table if not exists public.ig_send_queue (
  id uuid primary key default gen_random_uuid(),
  comment_id text unique not null,
  automation_id uuid references public.ig_automations(id) on delete set null,
  ig_user_id text not null,
  username text,
  status text not null default 'pendente', -- pendente / enviado / erro / expirado
  tentativas int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text
);

comment on table public.ig_send_queue is 'Fila de espera quando o freio de envio não tem ficha disponível na hora. O ig-scheduler esvazia isso a cada minuto.';

-- ----------------------------------------------------------------------------
-- ig_send_budget: o contador do freio (token bucket). Uma linha por chave.
-- ----------------------------------------------------------------------------
create table if not exists public.ig_send_budget (
  id text primary key,              -- ex: 'private_reply'
  min_count int not null default 0,
  hour_count int not null default 0,
  day_count int not null default 0,
  min_started_at timestamptz not null default now(),
  hour_started_at timestamptz not null default now(),
  day_started_at timestamptz not null default now(),
  err_streak int not null default 0,
  cap_minute int not null default 6,
  cap_hour int not null default 60,
  cap_day int not null default 180,
  paused_until timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.ig_send_budget is 'Contador atômico do freio de envio (token bucket). Sem a linha inicial aqui, take_send_slot() não tem onde contar e todo envio falha fechado.';

-- linha inicial (seed) do freio de resposta privada / DM
insert into public.ig_send_budget (id, cap_minute, cap_hour, cap_day)
values ('private_reply', 6, 60, 180)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- ig_scheduled: passos do fluxo com atraso programado (delay)
-- ----------------------------------------------------------------------------
create table if not exists public.ig_scheduled (
  id uuid primary key default gen_random_uuid(),
  ig_user_id text not null,
  automation_id uuid references public.ig_automations(id) on delete set null,
  step_id text not null,
  send_at timestamptz not null,
  sent boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.ig_scheduled is 'Passos de conversa que devem ser enviados sozinhos depois de um atraso (delay). O ig-scheduler varre isso a cada minuto.';

-- ----------------------------------------------------------------------------
-- ig_assets: biblioteca de arquivos (PDF, áudio, foto, vídeo)
-- ----------------------------------------------------------------------------
create table if not exists public.ig_assets (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null,               -- image / audio / video / file
  public_url text not null,
  attachment_id text,               -- cache do id de anexo já enviado ao Instagram
  size_bytes bigint,
  created_at timestamptz not null default now()
);

comment on table public.ig_assets is 'Arquivos que podem ser anexados a um passo do fluxo de uma automação.';

-- ----------------------------------------------------------------------------
-- ig_token_status: situação do token de acesso do Instagram
-- ----------------------------------------------------------------------------
create table if not exists public.ig_token_status (
  id text primary key,              -- sempre 'main'
  expires_at timestamptz,
  last_ok boolean,
  last_error text,
  last_refreshed_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.ig_token_status is 'Situação do token long-lived do Instagram, atualizada pelo ig-token-refresh.';

insert into public.ig_token_status (id) values ('main') on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- ig_bot_sends: ids das mensagens que o PRÓPRIO sistema enviou (evita eco)
-- ----------------------------------------------------------------------------
create table if not exists public.ig_bot_sends (
  mid text primary key,
  created_at timestamptz not null default now()
);

comment on table public.ig_bot_sends is 'Guarda o mid de cada mensagem enviada pelo próprio sistema. O webhook usa isso pra ignorar o eco (evento de mensagem enviada por nós mesmos) e não se confundir com uma resposta manual.';

-- índices úteis
create index if not exists idx_ig_leads_automation on public.ig_leads(automation_id);
create index if not exists idx_ig_send_queue_status on public.ig_send_queue(status);
create index if not exists idx_ig_scheduled_pendentes on public.ig_scheduled(send_at) where sent = false;
create index if not exists idx_ig_deliveries_ig_user on public.ig_deliveries(ig_user_id, ts desc);
