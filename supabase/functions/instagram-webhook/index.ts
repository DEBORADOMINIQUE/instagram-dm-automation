// ============================================================================
// instagram-webhook
// A função mais importante do sistema: recebe os eventos do Instagram
// (comentários, mensagens, toques em botão) e responde sozinha.
//
// Publique com --no-verify-jwt (ela precisa ser pública pro Meta conseguir
// chamar). Veja o LEIA-ME.md pro passo a passo completo.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// ---------------------------------------------------------------------------
// Variáveis de ambiente (segredos configurados no painel do Supabase)
// ---------------------------------------------------------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IG_ACCESS_TOKEN = Deno.env.get("IG_ACCESS_TOKEN") ?? "";
const IG_ACCOUNT_ID = Deno.env.get("IG_ACCOUNT_ID") ?? "";
const APP_SECRET = Deno.env.get("APP_SECRET") ?? "";
const APP_SECRET_ENFORCE = (Deno.env.get("APP_SECRET_ENFORCE") ?? "false") === "true";
const VERIFY_TOKEN = Deno.env.get("VERIFY_TOKEN") ?? "";
const GRAPH_API_VERSION = Deno.env.get("GRAPH_API_VERSION") ?? "v21.0";
const TEST_IG_ACCOUNTS = (Deno.env.get("TEST_IG_ACCOUNTS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_API_VERSION}`;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Ponto de entrada
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // ---- Verificação do webhook (aperto de mão inicial do Meta) -------------
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Token de verificação inválido", { status: 403 });
  }

  // ---- Recebimento dos eventos ---------------------------------------------
  if (req.method === "POST") {
    const rawBody = await req.text();

    const assinaturaValida = await verificarAssinatura(
      rawBody,
      req.headers.get("x-hub-signature-256"),
    );

    if (!assinaturaValida) {
      if (APP_SECRET_ENFORCE) {
        return new Response("Assinatura inválida", { status: 401 });
      }
      console.warn(
        "[aviso] assinatura inválida, mas APP_SECRET_ENFORCE está desligado (modo teste). " +
          "Processando o evento mesmo assim.",
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("JSON inválido", { status: 400 });
    }

    // Responde rápido ao Meta e processa os eventos.
    try {
      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          if (change.field === "comments") {
            await handleComment(change.value);
          }
        }
        for (const evento of entry.messaging ?? []) {
          await handleMessage(evento);
        }
      }
    } catch (erro) {
      console.error("erro ao processar evento do webhook:", erro);
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  return new Response("Método não suportado", { status: 405 });
});

// ---------------------------------------------------------------------------
// Verificação de assinatura (HMAC SHA-256)
// ---------------------------------------------------------------------------
async function verificarAssinatura(rawBody: string, header: string | null): Promise<boolean> {
  if (!header || !APP_SECRET) return false;
  const esperado = header.replace("sha256=", "");

  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(rawBody));
  const calculado = Array.from(new Uint8Array(assinatura))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return calculado === esperado;
}

// ---------------------------------------------------------------------------
// Dedupe simples de eventos (evita reprocessar o mesmo evento em retry)
// ---------------------------------------------------------------------------
async function jaProcessado(chave: string): Promise<boolean> {
  const { data } = await supabase
    .from("ig_deliveries")
    .select("id")
    .eq("motivo", `dedupe:${chave}`)
    .limit(1);
  return !!data && data.length > 0;
}

async function marcarProcessado(chave: string) {
  await supabase
    .from("ig_deliveries")
    .insert({ motivo: `dedupe:${chave}`, tipo: "dedupe", status: "ok" });
}

// ---------------------------------------------------------------------------
// COMENTÁRIOS
// ---------------------------------------------------------------------------
async function handleComment(value: any) {
  const commentId: string | undefined = value?.id;
  const fromId: string | undefined = value?.from?.id;
  const fromUsername: string | undefined = value?.from?.username;
  const mediaId: string | undefined = value?.media?.id;
  const texto: string = value?.text ?? "";

  if (!commentId || !fromId) return;

  // 1. ignora eventos duplicados
  if (await jaProcessado(`comment:${commentId}`)) return;
  await marcarProcessado(`comment:${commentId}`);

  // 2. ignora comentário feito pela própria conta (dono do post)
  if (IG_ACCOUNT_ID && fromId === IG_ACCOUNT_ID) return;

  // 3. acha a automação certa (palavra-chave + post)
  const automation = await encontrarAutomacao(texto, mediaId);
  if (!automation) return;

  // 4. regra do "1 por dia" (contas de teste ignoram)
  const ehContaDeTeste = TEST_IG_ACCOUNTS.includes(fromId);
  if (!ehContaDeTeste && (await recebeuDmNasUltimas24h(fromId))) {
    console.log(`lead ${fromId} já recebeu DM nas últimas 24h, pulando`);
    return;
  }

  // 5. entrega o conteúdo
  const resultado = await entregarAutomacao(automation, fromId, fromUsername, commentId);

  // só responde no comentário e marca o lead se realmente saiu ou está
  // garantido na fila (pra permitir retry se der erro de verdade)
  if (resultado === "enviado" || resultado === "na_fila") {
    await responderComentario(commentId, escolherRespostaPublica(automation));
    await upsertLead(fromId, fromUsername, "comment", texto, automation.id);
  }
}

function escolherRespostaPublica(automation: any): string {
  const opcoes = [automation.public_reply, ...(automation.public_reply_variants ?? [])].filter(
    (t) => t && t.trim().length > 0,
  );
  if (opcoes.length === 0) return "";
  return opcoes[Math.floor(Math.random() * opcoes.length)];
}

async function encontrarAutomacao(texto: string, mediaId?: string) {
  const { data: automations } = await supabase
    .from("ig_automations")
    .select("*")
    .eq("active", true);

  if (!automations) return null;

  const textoLower = texto.toLowerCase();

  for (const automation of automations) {
    const valeProEssePost =
      !automation.media_ids ||
      automation.media_ids.length === 0 ||
      (mediaId ? automation.media_ids.includes(mediaId) : false);

    if (!valeProEssePost) continue;

    if (automation.match_any) return automation;

    const palavras = (automation.keyword ?? "")
      .split(",")
      .map((p: string) => p.trim().toLowerCase())
      .filter(Boolean);

    if (palavras.some((p: string) => textoLower.includes(p))) {
      return automation;
    }
  }

  return null;
}

async function recebeuDmNasUltimas24h(igUserId: string): Promise<boolean> {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("ig_deliveries")
    .select("id")
    .eq("ig_user_id", igUserId)
    .eq("canal", "private_reply")
    .eq("status", "ok")
    .gte("ts", desde)
    .limit(1);
  return !!data && data.length > 0;
}

// ---------------------------------------------------------------------------
// ENTREGA (passa pelo freio antes de mandar)
// ---------------------------------------------------------------------------
async function entregarAutomacao(
  automation: any,
  igUserId: string,
  username: string | undefined,
  commentId: string,
): Promise<"enviado" | "na_fila" | "erro"> {
  const primeiroPasso = automation.flow?.steps?.[0];
  if (!primeiroPasso) {
    console.warn(`automação ${automation.id} não tem nenhum passo no fluxo`);
    return "erro";
  }

  const { data: podeEnviar } = await supabase.rpc("take_send_slot", { p_key: "private_reply" });

  if (!podeEnviar) {
    // sem ficha: represa na fila pro ig-scheduler mandar depois
    const { error } = await supabase.from("ig_send_queue").insert({
      comment_id: commentId,
      automation_id: automation.id,
      ig_user_id: igUserId,
      username,
      status: "pendente",
    });
    // se já existe (conflito de unique), não é erro de verdade
    if (error && !`${error.message}`.includes("duplicate")) {
      console.error("erro ao enfileirar:", error);
    }
    await supabase.from("ig_deliveries").insert({
      ig_user_id: igUserId,
      automation_id: automation.id,
      canal: "private_reply",
      tipo: "flow",
      status: "na_fila",
      motivo: "sem ficha no freio de envio",
    });
    return "na_fila";
  }

  try {
    await sendStep(automation, igUserId, primeiroPasso, { viaCommentId: commentId });
    await supabase.rpc("record_send_result", { p_key: "private_reply", p_ok: true, p_hard: false });
    await supabase.from("ig_deliveries").insert({
      ig_user_id: igUserId,
      automation_id: automation.id,
      canal: "private_reply",
      tipo: "flow",
      status: "ok",
    });
    return "enviado";
  } catch (erro: any) {
    const ehErroDuro = ehErroDeBlocqueio(erro);
    await supabase.rpc("record_send_result", { p_key: "private_reply", p_ok: false, p_hard: ehErroDuro });
    await supabase.from("ig_deliveries").insert({
      ig_user_id: igUserId,
      automation_id: automation.id,
      canal: "private_reply",
      tipo: "flow",
      status: "erro",
      motivo: String(erro?.message ?? erro),
    });
    return "erro";
  }
}

function ehErroDeBlocqueio(erro: any): boolean {
  const msg = String(erro?.message ?? erro).toLowerCase();
  return msg.includes("blocked") || msg.includes("rate limit") || msg.includes("spam");
}

async function upsertLead(
  igUserId: string,
  username: string | undefined,
  fonte: string,
  keyword: string,
  automationId: string,
) {
  await supabase.from("ig_leads").upsert(
    {
      ig_user_id: igUserId,
      username,
      last_source: fonte,
      last_keyword: keyword,
      automation_id: automationId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "ig_user_id" },
  );
}

// ---------------------------------------------------------------------------
// ENVIO DE UM PASSO DO FLUXO (botões anexados, com fallback)
// ---------------------------------------------------------------------------
async function sendStep(
  automation: any,
  igUserId: string,
  step: any,
  opts: { viaCommentId?: string } = {},
) {
  const recipient = opts.viaCommentId ? { comment_id: opts.viaCommentId } : { id: igUserId };

  const botoesValidos = (step.buttons ?? []).filter((b: any) => b.url || b.next !== undefined);

  let mid: string | undefined;

  if (botoesValidos.length === 0) {
    mid = await chamarSendAPI(recipient, { text: step.message || "" });
  } else {
    const botoesTemplate = botoesValidos.slice(0, 3).map((b: any) =>
      b.url
        ? { type: "web_url", url: b.url, title: b.title.slice(0, 20) }
        : {
            type: "postback",
            title: b.title.slice(0, 20),
            payload: `STEP:${automation.id}:${b.next}`,
          },
    );

    try {
      mid = await chamarSendAPI(recipient, {
        attachment: {
          type: "template",
          payload: { template_type: "button", text: step.message || " ", buttons: botoesTemplate },
        },
      });
    } catch (erroTemplate) {
      console.warn("button template recusado, tentando quick_reply:", erroTemplate);
      try {
        const quickReplies = botoesValidos.slice(0, 13).map((b: any) => ({
          content_type: "text",
          title: b.title.slice(0, 20),
          payload: `STEP:${automation.id}:${b.next ?? "link"}`,
        }));
        mid = await chamarSendAPI(recipient, { text: step.message || " ", quick_replies: quickReplies });
      } catch (erroQuickReply) {
        console.warn("quick_reply recusado, mandando texto puro:", erroQuickReply);
        const linhasLink = botoesValidos
          .filter((b: any) => b.url)
          .map((b: any) => `${b.title}: ${b.url}`)
          .join("\n");
        const textoFinal = [step.message, linhasLink].filter(Boolean).join("\n\n");
        mid = await chamarSendAPI(recipient, { text: textoFinal || " " });
      }
    }
  }

  if (mid) {
    await supabase.from("ig_bot_sends").insert({ mid }).then(() => {});
  }

  // arquivos anexados ao passo
  for (const assetId of step.assets ?? []) {
    await enviarAsset(recipient, assetId);
  }

  // se o passo pede um dado (coleta), marca o lead esperando a resposta
  if (step.collect) {
    await supabase
      .from("ig_leads")
      .update({ expecting: step.collect, flow_step: String(step.id) })
      .eq("ig_user_id", igUserId);
  } else {
    await supabase
      .from("ig_leads")
      .update({ flow_step: String(step.id) })
      .eq("ig_user_id", igUserId);
  }

  // passo com atraso programado: agenda o próximo passo pro ig-scheduler mandar sozinho
  if (step.delay?.next !== undefined && step.delay?.seconds) {
    await supabase.from("ig_scheduled").insert({
      ig_user_id: igUserId,
      automation_id: automation.id,
      step_id: String(step.delay.next),
      send_at: new Date(Date.now() + step.delay.seconds * 1000).toISOString(),
    });
  }
}

async function enviarAsset(recipient: any, assetId: string) {
  const { data: asset } = await supabase.from("ig_assets").select("*").eq("id", assetId).maybeSingle();
  if (!asset) return;

  const tipoAttachment = asset.tipo === "file" ? "file" : asset.tipo; // image / audio / video / file

  const mid = await chamarSendAPI(recipient, {
    attachment: { type: tipoAttachment, payload: { url: asset.public_url, is_reusable: true } },
  });
  if (mid) {
    await supabase.from("ig_bot_sends").insert({ mid }).then(() => {});
  }
}

async function chamarSendAPI(recipient: any, message: any): Promise<string | undefined> {
  const resp = await fetch(`${GRAPH_BASE}/${IG_ACCOUNT_ID}/messages?access_token=${IG_ACCESS_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient, message }),
  });

  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json?.error?.message ?? `erro ${resp.status} ao enviar mensagem`);
  }
  return json?.message_id;
}

async function responderComentario(commentId: string, texto: string) {
  if (!texto) return;
  try {
    await fetch(`${GRAPH_BASE}/${commentId}/replies?access_token=${IG_ACCESS_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: texto }),
    });
  } catch (erro) {
    console.error("erro ao responder o comentário publicamente:", erro);
  }
}

// ---------------------------------------------------------------------------
// MENSAGENS / POSTBACK / QUICK REPLY
// ---------------------------------------------------------------------------
async function handleMessage(evento: any) {
  // ignora eco (mensagem que a própria conta mandou)
  if (evento?.message?.is_echo) return;

  const senderId: string | undefined = evento?.sender?.id;
  if (!senderId) return;

  const mid: string | undefined = evento?.message?.mid;
  if (mid) {
    const { data: jaEnviado } = await supabase.from("ig_bot_sends").select("mid").eq("mid", mid).maybeSingle();
    if (jaEnviado) return; // é um eco de um envio nosso, ignora
  }

  const eventoId = mid ?? `${senderId}:${evento?.timestamp}`;
  if (await jaProcessado(`msg:${eventoId}`)) return;
  await marcarProcessado(`msg:${eventoId}`);

  // toque em botão: postback ou quick_reply carregam o mesmo formato de payload
  const payload: string | undefined = evento?.postback?.payload ?? evento?.message?.quick_reply?.payload;

  if (payload && payload.startsWith("STEP:")) {
    const [, automationId, stepId] = payload.split(":");
    await avancarFluxo(senderId, automationId, stepId);
    return;
  }

  const textoRecebido: string | undefined = evento?.message?.text;
  if (!textoRecebido) return;

  // coleta de dado pendente (o passo anterior pediu email/telefone/etc)
  const { data: lead } = await supabase.from("ig_leads").select("*").eq("ig_user_id", senderId).maybeSingle();

  if (lead?.expecting?.field) {
    await tratarColeta(lead, textoRecebido, senderId);
    return;
  }

  // mensagem de texto solta que não bate com nada: silêncio, não responde
}

async function avancarFluxo(igUserId: string, automationId: string, stepId: string) {
  const { data: automation } = await supabase
    .from("ig_automations")
    .select("*")
    .eq("id", automationId)
    .maybeSingle();

  if (!automation || !automation.active) return;

  const passo = (automation.flow?.steps ?? []).find((s: any) => String(s.id) === String(stepId));
  if (!passo) return;

  try {
    await sendStep(automation, igUserId, passo);
    await supabase.rpc("record_send_result", { p_key: "private_reply", p_ok: true, p_hard: false });
  } catch (erro) {
    console.error("erro ao avançar o fluxo:", erro);
  }
}

async function tratarColeta(lead: any, textoRecebido: string, igUserId: string) {
  const campo = lead.expecting.field;
  const proximoPasso = lead.expecting.next;

  const valido = validarCampo(campo, textoRecebido);
  if (!valido) {
    await chamarSendAPI(
      { id: igUserId },
      { text: mensagemDeErroDeValidacao(campo) },
    );
    return;
  }

  await supabase
    .from("ig_leads")
    .update({ [campo]: textoRecebido, expecting: null })
    .eq("ig_user_id", igUserId);

  const { data: automation } = await supabase
    .from("ig_automations")
    .select("*")
    .eq("id", lead.automation_id)
    .maybeSingle();

  if (!automation) return;

  const passo = (automation.flow?.steps ?? []).find((s: any) => String(s.id) === String(proximoPasso));
  if (passo) {
    await sendStep(automation, igUserId, passo);
  }
}

function validarCampo(campo: string, valor: string): boolean {
  if (campo === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor.trim());
  }
  if (campo === "telefone") {
    return valor.replace(/\D/g, "").length >= 8;
  }
  return valor.trim().length > 0;
}

function mensagemDeErroDeValidacao(campo: string): string {
  if (campo === "email") return "Esse e-mail não parece válido. Pode digitar de novo?";
  if (campo === "telefone") return "Esse telefone não parece válido. Pode digitar de novo?";
  return "Não entendi, pode digitar de novo?";
}
