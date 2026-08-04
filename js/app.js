// ============================================================================
// app.js
// Bootstrapping do painel: navegação entre páginas, abas do Instagram e o
// carregamento do painel-resumo (Início).
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  inicializarAuth();
  inicializarEditorAutomacoes();
  inicializarNavegacao();
});

function inicializarNavegacao() {
  document.querySelectorAll(".nav-item[data-pagina]").forEach((item) => {
    item.addEventListener("click", () => irParaPagina(item.getAttribute("data-pagina")));
  });

  document.querySelectorAll("[data-ir-para]").forEach((el) => {
    el.addEventListener("click", () => irParaPagina(el.getAttribute("data-ir-para")));
  });

  document.querySelectorAll(".aba[data-aba]").forEach((aba) => {
    aba.addEventListener("click", () => irParaAba(aba.getAttribute("data-aba")));
  });
}

function irParaPagina(pagina) {
  document.querySelectorAll(".nav-item[data-pagina]").forEach((item) => {
    item.classList.toggle("ativo", item.getAttribute("data-pagina") === pagina);
  });

  ["inicio", "calendario", "instagram"].forEach((p) => {
    document.getElementById(`pagina-${p}`).classList.toggle("escondido", p !== pagina);
  });

  if (pagina === "instagram") {
    irParaAba("metricas");
  }
  if (pagina === "inicio") {
    carregarPainelInicio();
  }
}

function irParaAba(aba) {
  document.querySelectorAll(".aba[data-aba]").forEach((el) => {
    el.classList.toggle("ativa", el.getAttribute("data-aba") === aba);
  });
  document.getElementById("aba-metricas").classList.toggle("escondido", aba !== "metricas");
  document.getElementById("aba-automacoes").classList.toggle("escondido", aba !== "automacoes");

  if (aba === "metricas") carregarMetricas();
  if (aba === "automacoes") carregarListaAutomacoes();
}

// chamada pelo auth.js assim que o login (local ou Supabase) é confirmado
async function aoEntrarNoApp() {
  irParaPagina("inicio");
}

async function carregarPainelInicio() {
  const [leads, ativas, dms] = await Promise.all([
    DB.contarLeads(),
    DB.contarAutomacoesAtivas(),
    DB.contarDmsUltimos7Dias(),
  ]);
  document.getElementById("numero-leads").textContent = leads;
  document.getElementById("numero-automacoes-ativas").textContent = ativas;
  document.getElementById("numero-dms-7dias").textContent = dms;
}
