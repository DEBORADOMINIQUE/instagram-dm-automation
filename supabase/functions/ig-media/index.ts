// ============================================================================
// ig-media
// Lista os posts da conta (com miniatura), pra alimentar o seletor
// "Em quais posts" do editor de automações.
//
// Chamada pelo painel (frontend), autenticado como usuário logado. Publique
// SEM --no-verify-jwt.
// ============================================================================

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
    return new Response(JSON.stringify({ conectado: false, posts: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const campos = "id,caption,media_type,media_url,thumbnail_url,timestamp,permalink";
    const resp = await fetch(
      `${GRAPH_BASE}/${IG_ACCOUNT_ID}/media?fields=${campos}&limit=100&access_token=${IG_ACCESS_TOKEN}`,
    );
    const json = await resp.json();
    if (!resp.ok) throw new Error(json?.error?.message ?? "erro ao listar posts");

    const posts = (json.data ?? []).map((m: any) => ({
      id: m.id,
      legenda: (m.caption ?? "").slice(0, 80),
      tipo: m.media_type,
      miniatura: m.thumbnail_url ?? m.media_url,
      data: m.timestamp,
      link: m.permalink,
    }));

    return new Response(JSON.stringify({ conectado: true, posts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (erro: any) {
    return new Response(JSON.stringify({ conectado: false, posts: [], motivo: String(erro?.message ?? erro) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
