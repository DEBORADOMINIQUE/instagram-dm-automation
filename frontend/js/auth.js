// ============================================================================
// auth.js
// Login com dois modos:
//  - Modo local (localhost/127.0.0.1/file://): qualquer e-mail + senha de
//    5 dígitos entra direto, sem Supabase. Só serve pra testar a interface.
//  - Modo produção: Supabase Auth (signInWithPassword), com usuário
//    cadastrado manualmente no painel do Supabase.
// ============================================================================

const CHAVE_LOGIN_LOCAL = "painel_login_local";

async function inicializarAuth() {
  const avisoLocal1 = document.getElementById("aviso-modo-local");
  const avisoLocal2 = document.getElementById("aviso-modo-local-app");

  if (MODO_LOCAL) {
    avisoLocal1.style.display = "flex";
    avisoLocal2.classList.remove("escondido");
  }

  document.getElementById("form-login").addEventListener("submit", tratarSubmitLogin);
  document.getElementById("btn-sair").addEventListener("click", sair);

  // já está logado?
  if (MODO_LOCAL) {
    const sessaoLocal = localStorage.getItem(CHAVE_LOGIN_LOCAL);
    mostrarTela(!!sessaoLocal);
    return;
  }

  const cliente = getSupabaseClient();
  if (!cliente) {
    // produção sem Supabase configurado ainda: fica na tela de login com aviso
    mostrarTela(false);
    mostrarErroLogin("O Supabase ainda não foi configurado neste site. Preencha config.js.");
    return;
  }

  const { data } = await cliente.auth.getSession();
  mostrarTela(!!data?.session);

  cliente.auth.onAuthStateChange((_evento, session) => {
    mostrarTela(!!session);
  });
}

async function tratarSubmitLogin(evento) {
  evento.preventDefault();
  esconderErroLogin();

  const email = document.getElementById("login-email").value.trim();
  const senha = document.getElementById("login-senha").value;

  if (MODO_LOCAL) {
    if (!/^\d{5}$/.test(senha)) {
      mostrarErroLogin("No modo de teste local, a senha precisa ter exatamente 5 dígitos.");
      return;
    }
    if (!email) {
      mostrarErroLogin("Digite um e-mail.");
      return;
    }
    localStorage.setItem(CHAVE_LOGIN_LOCAL, JSON.stringify({ email, ts: Date.now() }));
    mostrarTela(true);
    return;
  }

  const cliente = getSupabaseClient();
  if (!cliente) {
    mostrarErroLogin("O Supabase ainda não foi configurado neste site. Preencha config.js.");
    return;
  }

  const { error } = await cliente.auth.signInWithPassword({ email, password: senha });
  if (error) {
    mostrarErroLogin("E-mail ou senha incorretos.");
    return;
  }
  mostrarTela(true);
}

async function sair() {
  if (MODO_LOCAL) {
    localStorage.removeItem(CHAVE_LOGIN_LOCAL);
    mostrarTela(false);
    return;
  }
  const cliente = getSupabaseClient();
  if (cliente) await cliente.auth.signOut();
  mostrarTela(false);
}

function mostrarTela(logado) {
  document.getElementById("tela-login").classList.toggle("escondido", logado);
  document.getElementById("tela-app").classList.toggle("escondido", !logado);
  if (logado && typeof aoEntrarNoApp === "function") {
    aoEntrarNoApp();
  }
}

function mostrarErroLogin(mensagem) {
  const el = document.getElementById("erro-login");
  el.textContent = mensagem;
  el.classList.remove("escondido");
}

function esconderErroLogin() {
  document.getElementById("erro-login").classList.add("escondido");
}
