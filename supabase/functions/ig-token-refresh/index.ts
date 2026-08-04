// ============================================================================
// ig-token-refresh
// Roda cerca de 1x por semana via pg_cron. Renova o token long-lived do
// Instagram (que vence a cada ~60 dias) antes que ele expire.
//
// Protegida por SCHED_SECRET no header x-sched-key.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SCHED_SECRET = Deno.env.get("SCHED_SECRET") ?? "";
const IG_ACCESS_TOKEN = Deno.env.get("IG_ACCESS_TOKEN") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// atenção: este endpoint NÃO leva a versão da API no caminho, ao contrário
// dos outros endpoints do Graph API.
const REFRESH_URL = "https://graph.instagram.com/refresh_access_token";

Deno.serve(async (req) => {
  if (req.headers.get("x-sched-key") !== SCHED_SECRET) {
    return new Response("Não autorizado", { status: 401 });
  }

  try {
    const url = `${REFRESH_URL}?grant_type=ig_refresh_token&access_token=${IG_ACCESS_TOKEN}`;
    const resp = await fetch(url);
    const json = await resp.json();

    if (!resp.ok) {
      throw new Error(json?.error?.message ?? `erro ${resp.status} ao renovar o token`);
    }

    const expiresAt = new Date(Date.now() + (json.expires_in ?? 0) * 1000).toISOString();

    await supabase.from("ig_token_status").upsert({
      id: "main",
      expires_at: expiresAt,
      last_ok: true,
      last_error: null,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ ok: true, expires_at: expiresAt }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (erro: any) {
    await supabase.from("ig_token_status").upsert({
      id: "main",
      last_ok: false,
      last_error: String(erro?.message ?? erro),
      updated_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ ok: false, erro: String(erro?.message ?? erro) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
