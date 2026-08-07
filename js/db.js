// ============================================================================
// db.js
// Camada de acesso ao banco (Supabase) e às Edge Functions, TOLERANTE A
// FALHA: se o Supabase não estiver configurado ainda, ou a conexão falhar,
// devolve valores vazios em vez de quebrar a tela.
// ============================================================================

async function chamarFuncao(nome, opcoes = {}) {
  const cliente = getSupabaseClient();
  if (!cliente) return { erro: "Supabase não configurado" };

  try {
    const resp = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/${nome}`, {
      method: opcoes.method || "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        apikey: CONFIG.SUPABASE_ANON_KEY,
      },
      body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
    });
    return await resp.json();
  } catch (erro) {
    console.warn(`falha ao chamar a função ${nome}:`, erro);
    return { erro: String(erro) };
  }
}

const DB = {
  async listarAutomacoes() {
    const cliente = getSupabaseClient();
    if (!cliente) return [];
    try {
      const { data, error } = await cliente
        .from("ig_automations")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    } catch (erro) {
      console.warn("não foi possível listar automações:", erro);
      return [];
    }
  },

  async salvarAutomacao(automacao) {
    const cliente = getSupabaseClient();
    if (!cliente) return { ok: false, motivo: "Supabase não configurado ainda. Siga o LEIA-ME pra ligar o banco." };
    try {
      const linha = { ...automacao, updated_at: new Date().toISOString() };
      let error;
      if (automacao.id) {
        ({ error } = await cliente.from("ig_automations").update(linha).eq("id", automacao.id));
      } else {
        // numa automação nova o id precisa ficar de fora (não só null), pra o
        // banco gerar o uuid sozinho: um id explicitamente null viola a coluna
        delete linha.id;
        ({ error } = await cliente.from("ig_automations").insert(linha));
      }
      if (error) throw error;
      return { ok: true };
    } catch (erro) {
      console.warn("não foi possível salvar a automação:", erro);
      const motivo = erro?.message ? `Não foi possível salvar: ${erro.message}` : "Não foi possível salvar. Confira a conexão com o Supabase.";
      return { ok: false, motivo };
    }
  },

  async excluirAutomacao(id) {
    const cliente = getSupabaseClient();
    if (!cliente) return false;
    try {
      const { error } = await cliente.from("ig_automations").delete().eq("id", id);
      return !error;
    } catch (erro) {
      console.warn("não foi possível excluir a automação:", erro);
      return false;
    }
  },

  async listarAssets() {
    const cliente = getSupabaseClient();
    if (!cliente) return [];
    try {
      const { data, error } = await cliente.from("ig_assets").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    } catch (erro) {
      console.warn("não foi possível listar arquivos:", erro);
      return [];
    }
  },

  async contarLeads() {
    const cliente = getSupabaseClient();
    if (!cliente) return 0;
    try {
      const { count, error } = await cliente.from("ig_leads").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    } catch {
      return 0;
    }
  },

  async contarAutomacoesAtivas() {
    const cliente = getSupabaseClient();
    if (!cliente) return 0;
    try {
      const { count, error } = await cliente
        .from("ig_automations")
        .select("*", { count: "exact", head: true })
        .eq("active", true);
      if (error) throw error;
      return count ?? 0;
    } catch {
      return 0;
    }
  },

  async contarDmsUltimos7Dias() {
    const cliente = getSupabaseClient();
    if (!cliente) return 0;
    try {
      const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count, error } = await cliente
        .from("ig_deliveries")
        .select("*", { count: "exact", head: true })
        .eq("status", "ok")
        .gte("ts", desde);
      if (error) throw error;
      return count ?? 0;
    } catch {
      return 0;
    }
  },

  async buscarInsights() {
    const resultado = await chamarFuncao("ig-insights");
    if (!resultado || resultado.erro || resultado.conectado === false) return null;
    return resultado;
  },

  async listarPosts() {
    const resultado = await chamarFuncao("ig-media");
    if (!resultado || resultado.erro || resultado.conectado === false) return [];
    return resultado.posts ?? [];
  },
};
