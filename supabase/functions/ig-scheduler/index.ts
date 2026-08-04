// ============================================================================
// ig-scheduler (o carteiro)
// Roda a cada 1 minuto via pg_cron. Duas tarefas:
//   1. Esvazia a ig_send_queue (comentários que ficaram represados no freio).
//   2. Manda os passos com atraso da ig_scheduled que já venceram.
//
// Protegida por SCHED_SECRET no header x-sched-key, pra ninguém de fora
// conseguir chamar e ficar disparando mensagens fora de hora.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SCHED_SECRET = Deno.env.get("SCHED_SECRET") ?? "";
const IG_ACCESS_TOKEN = Deno.env.get("IG_ACCESS_TOKEN") ?? "";
const IG_ACCOUNT_ID = Deno.env.get("IG_ACCOUNT_ID") ?? "";
const GRAPH_API_VERSION = Deno.env.get("GRAPH_API_VERSION") ?? "v21.0";
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_API_VERSION}`;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.headers.get("x-sched-key") !== SCHED_SECRET) {
    return new Response("Não autorizado", { status: 401 });
  }

  const resultadoFila = await esvaziarFila();
  const resultadoAgendados = await mandarAgendados();

  return new Response(
    JSON.stringify({ fila: resultadoFila, agendados: resultadoAgendados }),
    { headers: { "Content-Type": "application/json" } },
  );
});

async function esvaziarFila() {
  const { data: itens } = await supabase
    .from("ig_send_queue")
    .select("*")
    .eq("status", "pendente")
    .order("created_at", { ascending: true })
    .limit(50);

  if (!itens || itens.length === 0) return { processados: 0 };

  let enviados = 0;
  let expirados = 0;

  for (const item of itens) {
    // desiste de comentário fora da janela de resposta (cerca de 7 dias)
    if (Date.now() - new Date(item.created_at).getTime() > SETE_DIAS_MS) {
      await supabase.from("ig_send_queue").update({ status: "expirado" }).eq("id", item.id);
      expirados++;
      continue;
    }

    const { data: podeEnviar } = await supabase.rpc("take_send_slot", { p_key: "private_reply" });
    if (!podeEnviar) break; // sem ficha, tenta de novo no próximo minuto

    const { data: automation } = await supabase
      .from("ig_automations")
      .select("*")
      .eq("id", item.automation_id)
      .maybeSingle();

    const primeiroPasso = automation?.flow?.steps?.[0];
    if (!automation || !primeiroPasso) {
      await supabase
        .from("ig_send_queue")
        .update({ status: "erro", last_error: "automação ou passo não encontrado" })
        .eq("id", item.id);
      continue;
    }

    try {
      await sendStep(automation, item.ig_user_id, primeiroPasso, { viaCommentId: item.comment_id });
      await supabase.rpc("record_send_result", { p_key: "private_reply", p_ok: true, p_hard: false });
      await supabase
        .from("ig_send_queue")
        .update({ status: "enviado", sent_at: new Date().toISOString() })
        .eq("id", item.id);
      await supabase.from("ig_deliveries").insert({
        ig_user_id: item.ig_user_id,
        automation_id: item.automation_id,
        canal: "private_reply",
        tipo: "flow",
        status: "ok",
        motivo: "enviado pela fila (ig-scheduler)",
      });
      enviados++;
    } catch (erro: any) {
      await supabase.rpc("record_send_result", { p_key: "private_reply", p_ok: false, p_hard: false });
      await supabase
        .from("ig_send_queue")
        .update({
          status: "erro",
          tentativas: (item.tentativas ?? 0) + 1,
          last_error: String(erro?.message ?? erro),
        })
        .eq("id", item.id);
    }
  }

  return { processados: itens.length, enviados, expirados };
}

async function mandarAgendados() {
  const agora = new Date().toISOString();
  const { data: itens } = await supabase
    .from("ig_scheduled")
    .select("*")
    .eq("sent", false)
    .lte("send_at", agora)
    .limit(50);

  if (!itens || itens.length === 0) return { processados: 0 };

  let enviados = 0;

  for (const item of itens) {
    const { data: podeEnviar } = await supabase.rpc("take_send_slot", { p_key: "private_reply" });
    if (!podeEnviar) break;

    const { data: automation } = await supabase
      .from("ig_automations")
      .select("*")
      .eq("id", item.automation_id)
      .maybeSingle();

    const passo = (automation?.flow?.steps ?? []).find((s: any) => String(s.id) === String(item.step_id));
    if (!automation || !passo) {
      await supabase.from("ig_scheduled").update({ sent: true }).eq("id", item.id);
      continue;
    }

    try {
      await sendStep(automation, item.ig_user_id, passo, {});
      await supabase.rpc("record_send_result", { p_key: "private_reply", p_ok: true, p_hard: false });
      await supabase.from("ig_scheduled").update({ sent: true }).eq("id", item.id);
      enviados++;
    } catch (erro) {
      console.error("erro ao mandar passo agendado:", erro);
    }
  }

  return { processados: itens.length, enviados };
}

// versão reduzida do sendStep (igual à do instagram-webhook) pra não precisar
// importar entre funções (cada Edge Function do Supabase é isolada)
async function sendStep(automation: any, igUserId: string, step: any, opts: { viaCommentId?: string }) {
  const recipient = opts.viaCommentId ? { comment_id: opts.viaCommentId } : { id: igUserId };
  const botoesValidos = (step.buttons ?? []).filter((b: any) => b.url || b.next !== undefined);

  let mid: string | undefined;

  if (botoesValidos.length === 0) {
    mid = await chamarSendAPI(recipient, { text: step.message || "" });
  } else {
    const botoesTemplate = botoesValidos.slice(0, 3).map((b: any) =>
      b.url
        ? { type: "web_url", url: b.url, title: b.title.slice(0, 20) }
        : { type: "postback", title: b.title.slice(0, 20), payload: `STEP:${automation.id}:${b.next}` },
    );
    try {
      mid = await chamarSendAPI(recipient, {
        attachment: {
          type: "template",
          payload: { template_type: "button", text: step.message || " ", buttons: botoesTemplate },
        },
      });
    } catch {
      try {
        const quickReplies = botoesValidos.slice(0, 13).map((b: any) => ({
          content_type: "text",
          title: b.title.slice(0, 20),
          payload: `STEP:${automation.id}:${b.next ?? "link"}`,
        }));
        mid = await chamarSendAPI(recipient, { text: step.message || " ", quick_replies: quickReplies });
      } catch {
        const linhasLink = botoesValidos
          .filter((b: any) => b.url)
          .map((b: any) => `${b.title}: ${b.url}`)
          .join("\n");
        mid = await chamarSendAPI(recipient, { text: [step.message, linhasLink].filter(Boolean).join("\n\n") || " " });
      }
    }
  }

  if (mid) await supabase.from("ig_bot_sends").insert({ mid }).then(() => {});

  if (step.collect) {
    await supabase.from("ig_leads").update({ expecting: step.collect, flow_step: String(step.id) }).eq("ig_user_id", igUserId);
  } else {
    await supabase.from("ig_leads").update({ flow_step: String(step.id) }).eq("ig_user_id", igUserId);
  }

  if (step.delay?.next !== undefined && step.delay?.seconds) {
    await supabase.from("ig_scheduled").insert({
      ig_user_id: igUserId,
      automation_id: automation.id,
      step_id: String(step.delay.next),
      send_at: new Date(Date.now() + step.delay.seconds * 1000).toISOString(),
    });
  }
}

async function chamarSendAPI(recipient: any, message: any): Promise<string | undefined> {
  const resp = await fetch(`${GRAPH_BASE}/${IG_ACCOUNT_ID}/messages?access_token=${IG_ACCESS_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient, message }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error?.message ?? `erro ${resp.status} ao enviar mensagem`);
  return json?.message_id;
}
