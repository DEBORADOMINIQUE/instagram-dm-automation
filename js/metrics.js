// ============================================================================
// metrics.js
// Sub-aba Métricas: seguidores, novos seguidores por dia, alcance por dia,
// leads captados. Se o Instagram ainda não estiver conectado, mostra um
// estado vazio simpático em vez de quebrar.
// ============================================================================

async function carregarMetricas() {
  const vazio = document.getElementById("metricas-vazio");
  const conteudo = document.getElementById("metricas-conteudo");

  const insights = await DB.buscarInsights();

  if (!insights) {
    vazio.classList.remove("escondido");
    conteudo.classList.add("escondido");
    return;
  }

  vazio.classList.add("escondido");
  conteudo.classList.remove("escondido");

  document.getElementById("metrica-seguidores").textContent = insights.seguidores ?? 0;
  document.getElementById("metrica-leads").textContent = await DB.contarLeads();

  desenharGrafico("grafico-seguidores", insights.seguidores_por_dia ?? []);
  desenharGrafico("grafico-alcance", insights.alcance_por_dia ?? []);
}

function desenharGrafico(idContainer, pontos) {
  const container = document.getElementById(idContainer);
  container.innerHTML = "";

  if (!pontos || pontos.length === 0) {
    container.innerHTML = '<p class="subtitulo" style="margin:0;">Sem dados ainda</p>';
    return;
  }

  const maiorValor = Math.max(...pontos.map((p) => p.valor), 1);

  pontos.forEach((ponto) => {
    const barra = document.createElement("div");
    barra.className = "barra";
    const altura = Math.max((ponto.valor / maiorValor) * 100, 2);
    barra.style.height = `${altura}%`;
    barra.setAttribute("data-valor", `${ponto.data}: ${ponto.valor}`);
    container.appendChild(barra);
  });
}
