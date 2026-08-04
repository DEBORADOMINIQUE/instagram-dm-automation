// ============================================================================
// config.js
// Configuração do Supabase e detecção do modo (teste local x produção).
//
// SUPABASE_URL e SUPABASE_ANON_KEY podem ficar públicas: quem tranca o banco
// é o RLS (as regras de acesso), não o sigilo dessas duas variáveis.
// ============================================================================

const CONFIG = {
  SUPABASE_URL: "SUA_SUPABASE_URL_AQUI",
  SUPABASE_ANON_KEY: "SUA_SUPABASE_ANON_KEY_AQUI",
};

// Detecta se está rodando em localhost/arquivo local (modo de teste) ou num
// domínio de verdade (modo de produção).
function ehAmbienteLocal() {
  const host = window.location.hostname;
  return (
    window.location.protocol === "file:" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === ""
  );
}

const MODO_LOCAL = ehAmbienteLocal();

// Cria o cliente do Supabase só quando faz sentido (produção, ou quando a
// pessoa já preencheu as credenciais). Em modo local sem configuração, isso
// não impede o app de funcionar (ver auth.js e db.js, tudo tolerante a falha).
let supabaseClient = null;

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;

  const configurado =
    CONFIG.SUPABASE_URL &&
    CONFIG.SUPABASE_ANON_KEY &&
    !CONFIG.SUPABASE_URL.includes("SUA_SUPABASE_URL_AQUI") &&
    !CONFIG.SUPABASE_ANON_KEY.includes("SUA_SUPABASE_ANON_KEY_AQUI");

  if (!configurado) return null;

  try {
    supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    return supabaseClient;
  } catch (erro) {
    console.warn("não foi possível criar o cliente do Supabase:", erro);
    return null;
  }
}
