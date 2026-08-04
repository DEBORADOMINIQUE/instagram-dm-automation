// ============================================================================
// ig-insights
// Devolve as métricas da conta (seguidores, novos seguidores por dia,
// alcance por dia) num formato pronto pro dashboard de Métricas.
//
// Chamada pelo painel (frontend), autenticado como usuário logado. Publique
// SEM --no-verify-jwt (ao contrário do webhook, esta função exige login).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const IG_ACCESS_TOKEN = Deno.env.get("IG_ACCESS_TOKEN") ?? "";
const IG_ACCOUNT_ID = Deno.env.get("IG_ACCOUNT_ID") ?? "";
const GRAPH_API_VERSION = Deno.env.get("GRAPH_API_VERSION") ?? "v21.0";
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_API_VERSION}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!IG_ACCESS_TOKEN || !IG_ACCOUNT_ID) {
    return new Response(
      JSON.stringify({ conectado: false, motivo: "Instagram ainda não conectado" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const [perfil, seguidoresPorDia, alcancePorDia] = await Promise.all([
      buscarPerfil(),
      buscarSerieDiaria("follower_count", 15),
      buscarSerieDiaria("reach", 15),
    ]);

    return new Response(
      JSON.stringify({
        conectado: true,
        seguidores: perfil.followers_count ?? 0,
        seguidores_por_dia: seguidoresPorDia,
        alcance_por_dia: alcancePorDia,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (erro: any) {
    return new Response(
      JSON.stringify({ conectado: false, motivo: String(erro?.message ?? erro) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function buscarPerfil() {
  const resp = await fetch(
    `${GRAPH_BASE}/${IG_ACCOUNT_ID}?fields=followers_count&access_token=${IG_ACCESS_TOKEN}`,
  );
  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error?.message ?? "erro ao buscar perfil");
  return json;
}

async function buscarSerieDiaria(metrica: string, dias: number) {
  const resp = await fetch(
    `${GRAPH_BASE}/${IG_ACCOUNT_ID}/insights?metric=${metrica}&period=day&access_token=${IG_ACCESS_TOKEN}`,
  );
  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error?.message ?? `erro ao buscar métrica ${metrica}`);

  const valores = json?.data?.[0]?.values ?? [];
  return valores.slice(-dias).map((v: any) => ({
    data: v.end_time?.slice(0, 10),
    valor: v.value ?? 0,
  }));
}
