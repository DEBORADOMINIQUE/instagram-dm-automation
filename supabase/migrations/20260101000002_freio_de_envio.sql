-- ============================================================================
-- 002_freio_de_envio.sql
-- Funções do freio de envio (token bucket) que protegem a conta contra bloqueio.
--
-- AVISO IMPORTANTE: sem este script, o freio falha fechado e NENHUMA DM por
-- comentário sai (tudo vai pra fila e a fila nunca anda). Rode este script
-- logo depois do 001_tabelas.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- take_send_slot: tenta pegar uma ficha de envio.
-- Retorna true se pode enviar agora, false se precisa esperar (vai pra fila).
-- Usa trava atômica (FOR UPDATE) pra evitar corrida quando dois envios
-- acontecem ao mesmo tempo.
-- ----------------------------------------------------------------------------
create or replace function public.take_send_slot(p_key text)
returns boolean
language plpgsql
as $$
declare
  v_row public.ig_send_budget%rowtype;
  v_now timestamptz := now();
begin
  -- trava a linha pra ninguém mais mexer enquanto decidimos
  select * into v_row from public.ig_send_budget where id = p_key for update;

  if not found then
    -- se a chave não existe ainda, cria com os padrões conservadores
    insert into public.ig_send_budget (id) values (p_key)
    returning * into v_row;
  end if;

  -- disjuntor: se está pausado por causa de falhas seguidas, nega direto
  if v_row.paused_until is not null and v_row.paused_until > v_now then
    return false;
  end if;

  -- zera a janela do minuto se já virou o minuto
  if v_now - v_row.min_started_at >= interval '1 minute' then
    v_row.min_count := 0;
    v_row.min_started_at := v_now;
  end if;

  -- zera a janela da hora se já virou a hora
  if v_now - v_row.hour_started_at >= interval '1 hour' then
    v_row.hour_count := 0;
    v_row.hour_started_at := v_now;
  end if;

  -- zera a janela do dia se já virou o dia
  if v_now - v_row.day_started_at >= interval '1 day' then
    v_row.day_count := 0;
    v_row.day_started_at := v_now;
  end if;

  -- confere se ainda cabe uma ficha em todas as janelas
  if v_row.min_count >= v_row.cap_minute
     or v_row.hour_count >= v_row.cap_hour
     or v_row.day_count >= v_row.cap_day then
    -- não cabe: salva as janelas zeradas (se foi o caso) e nega
    update public.ig_send_budget set
      min_count = v_row.min_count,
      hour_count = v_row.hour_count,
      day_count = v_row.day_count,
      min_started_at = v_row.min_started_at,
      hour_started_at = v_row.hour_started_at,
      day_started_at = v_row.day_started_at,
      updated_at = v_now
    where id = p_key;
    return false;
  end if;

  -- cabe: consome uma ficha em cada janela e libera o envio
  update public.ig_send_budget set
    min_count = v_row.min_count + 1,
    hour_count = v_row.hour_count + 1,
    day_count = v_row.day_count + 1,
    min_started_at = v_row.min_started_at,
    hour_started_at = v_row.hour_started_at,
    day_started_at = v_row.day_started_at,
    updated_at = v_now
  where id = p_key;

  return true;
end;
$$;

comment on function public.take_send_slot(text) is 'Pega uma ficha de envio do freio (token bucket) por minuto/hora/dia. Retorna false se não há ficha disponível ou se o disjuntor está pausado.';

-- ----------------------------------------------------------------------------
-- record_send_result: registra o resultado de um envio pra alimentar o
-- disjuntor. Falhas "duras" (ex: bloqueio da conta) pausam os envios por
-- algumas horas depois de algumas falhas seguidas.
-- ----------------------------------------------------------------------------
create or replace function public.record_send_result(p_key text, p_ok boolean, p_hard boolean default false)
returns void
language plpgsql
as $$
declare
  v_streak int;
begin
  if p_ok then
    -- sucesso zera a sequência de falhas
    update public.ig_send_budget
    set err_streak = 0, updated_at = now()
    where id = p_key;
    return;
  end if;

  -- falha: incrementa a sequência
  update public.ig_send_budget
  set err_streak = err_streak + 1, updated_at = now()
  where id = p_key
  returning err_streak into v_streak;

  if v_streak is null then
    return;
  end if;

  -- disjuntor: 3 falhas duras seguidas pausam os envios por 3 horas
  if p_hard and v_streak >= 3 then
    update public.ig_send_budget
    set paused_until = now() + interval '3 hours', updated_at = now()
    where id = p_key;
  end if;
end;
$$;

comment on function public.record_send_result(text, boolean, boolean) is 'Registra sucesso/falha de um envio. Falhas duras (p_hard=true) seguidas acionam o disjuntor e pausam os envios por algumas horas.';
