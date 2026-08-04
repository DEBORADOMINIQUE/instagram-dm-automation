// ============================================================================
// automations.js
// Lista de automações + editor visual (o "ManyChat") + construtor de
// sequência (mini-chat) + prévia ao vivo.
// ============================================================================

let editorState = null;
let editorSujo = false;
let automacoesCache = [];

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------
async function carregarListaAutomacoes() {
  automacoesCache = await DB.listarAutomacoes();
  const lista = document.getElementById("lista-automacoes");
  const vazio = document.getElementById("automacoes-vazio");

  if (automacoesCache.length === 0) {
    lista.innerHTML = "";
    vazio.classList.remove("escondido");
    return;
  }
  vazio.classList.add("escondido");

  lista.innerHTML = "";
  automacoesCache.forEach((automation) => {
    const item = document.createElement("div");
    item.className = "item-automacao";

    const info = document.createElement("div");
    info.className = "info";
    const nome = document.createElement("div");
    nome.className = "nome";
    nome.textContent = automation.nome || "(sem nome)";
    const detalhe = document.createElement("div");
    detalhe.className = "detalhe";
    detalhe.textContent = automation.match_any
      ? "Qualquer palavra"
      : automation.keyword || "(sem palavra-chave)";
    info.appendChild(nome);
    info.appendChild(detalhe);

    const selo = document.createElement("span");
    selo.className = `selo ${automation.active ? "selo-ativa" : "selo-inativa"}`;
    selo.textContent = automation.active ? "Ativa" : "Desligada";
    selo.style.cursor = "pointer";
    selo.title = "Clique pra ligar/desligar";
    selo.addEventListener("click", async () => {
      await DB.salvarAutomacao({ ...automation, active: !automation.active });
      carregarListaAutomacoes();
    });

    const btnEditar = document.createElement("button");
    btnEditar.className = "btn btn-pequeno";
    btnEditar.textContent = "Editar";
    btnEditar.addEventListener("click", () => abrirEditor(automation));

    const btnExcluir = document.createElement("button");
    btnExcluir.className = "btn btn-pequeno btn-perigo";
    btnExcluir.textContent = "Apagar";
    btnExcluir.addEventListener("click", async () => {
      if (!confirm(`Apagar a automação "${automation.nome}"? Essa ação não pode ser desfeita.`)) return;
      await DB.excluirAutomacao(automation.id);
      carregarListaAutomacoes();
    });

    item.appendChild(info);
    item.appendChild(selo);
    item.appendChild(btnEditar);
    item.appendChild(btnExcluir);
    lista.appendChild(item);
  });
}

// ---------------------------------------------------------------------------
// Estado do editor
// ---------------------------------------------------------------------------
function novoEstadoEditor() {
  return {
    id: null,
    nome: "",
    keywords: [],
    matchAny: false,
    mediaIds: [],
    publicReply: "",
    publicReplyVariants: [],
    message1: "",
    buttonEnabled: true,
    buttonTitle: "",
    buttonMode: "link",
    buttonUrl: "",
    assetId: "",
    steps: [],
  };
}

function desconstruirAutomacao(automation) {
  const steps = automation.flow?.steps ?? [];
  const passo1 = steps[0] || { message: "", buttons: [] };
  const resto = steps.slice(1);
  const botao1 = passo1.buttons?.[0];

  let buttonMode = "link";
  let buttonUrl = "";
  let buttonTitle = "";
  let buttonEnabled = false;

  if (botao1) {
    buttonEnabled = true;
    buttonTitle = botao1.title || "";
    if (botao1.url) {
      buttonMode = "link";
      buttonUrl = botao1.url;
    } else if (botao1.next !== undefined) {
      buttonMode = "continue";
    }
  }

  return {
    id: automation.id,
    nome: automation.nome || "",
    keywords: (automation.keyword || "").split(",").map((s) => s.trim()).filter(Boolean),
    matchAny: !!automation.match_any,
    mediaIds: automation.media_ids ? [...automation.media_ids] : [],
    publicReply: automation.public_reply || "",
    publicReplyVariants: automation.public_reply_variants ? [...automation.public_reply_variants] : [],
    message1: passo1.message || "",
    buttonEnabled,
    buttonTitle,
    buttonMode,
    buttonUrl,
    assetId: (passo1.assets && passo1.assets[0]) || "",
    steps: resto.map((s) => ({
      id: s.id,
      message: s.message || "",
      assetId: (s.assets && s.assets[0]) || "",
      buttons: (s.buttons ?? []).map((b) => ({
        title: b.title || "",
        destKind: b.url ? "link" : b.next !== undefined && b.next !== null ? "next" : "end",
        next: b.next ?? null,
        url: b.url || "",
      })),
    })),
  };
}

function proximoIdPasso() {
  const ids = [1, ...editorState.steps.map((s) => s.id)];
  return Math.max(...ids) + 1;
}

function marcarSujo() {
  editorSujo = true;
}

// ---------------------------------------------------------------------------
// Abrir / fechar o editor
// ---------------------------------------------------------------------------
async function abrirEditor(automacaoExistente) {
  editorState = automacaoExistente ? desconstruirAutomacao(automacaoExistente) : novoEstadoEditor();
  editorSujo = false;

  document.getElementById("editor-titulo").textContent = automacaoExistente ? "Editar automação" : "Nova automação";
  document.getElementById("edt-nome").value = editorState.nome;
  document.getElementById("edt-match-any").checked = editorState.matchAny;
  document.getElementById("edt-resposta-publica").value = editorState.publicReply;
  document.getElementById("edt-mensagem1").value = editorState.message1;
  document.getElementById("edt-botao-ativo").checked = editorState.buttonEnabled;
  document.getElementById("edt-botao-texto").value = editorState.buttonTitle;
  document.getElementById("edt-botao-modo").value = editorState.buttonMode;
  document.getElementById("edt-botao-link").value = editorState.buttonUrl;
  esconderAvisoEditor();

  renderizarTags();
  renderizarVariacoes();
  renderizarPassos();
  atualizarVisibilidadeBotao();
  atualizarContadorBotao();
  await carregarSeletorDeAssets();
  document.getElementById("edt-asset").value = editorState.assetId || "";
  renderizarPreview();

  MEDIA.renderizarSeletor(document.getElementById("edt-posts-lista"), editorState.mediaIds, () => marcarSujo());

  document.getElementById("modal-editor").classList.remove("escondido");
}

function fecharEditor(forcar) {
  if (!forcar && editorSujo) {
    const confirmar = confirm("Você tem alterações não salvas. Quer mesmo sair sem salvar?");
    if (!confirmar) return;
  }
  document.getElementById("modal-editor").classList.add("escondido");
  editorState = null;
  editorSujo = false;
}

function esconderAvisoEditor() {
  document.getElementById("aviso-editor").classList.add("escondido");
}

function mostrarAvisoEditor(mensagem) {
  const el = document.getElementById("aviso-editor");
  el.textContent = mensagem;
  el.classList.remove("escondido");
}

// ---------------------------------------------------------------------------
// Tags de palavras-chave
// ---------------------------------------------------------------------------
function renderizarTags() {
  const container = document.getElementById("edt-tags-container");
  const input = document.getElementById("edt-tag-input");
  container.querySelectorAll(".tag").forEach((el) => el.remove());

  editorState.keywords.forEach((palavra, indice) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    const texto = document.createElement("span");
    texto.textContent = palavra;
    const remover = document.createElement("button");
    remover.type = "button";
    remover.textContent = "✕";
    remover.addEventListener("click", () => {
      editorState.keywords.splice(indice, 1);
      marcarSujo();
      renderizarTags();
    });
    tag.appendChild(texto);
    tag.appendChild(remover);
    container.insertBefore(tag, input);
  });
}

// ---------------------------------------------------------------------------
// Variações A/B da resposta pública
// ---------------------------------------------------------------------------
function renderizarVariacoes() {
  const container = document.getElementById("edt-variacoes-lista");
  container.innerHTML = "";

  editorState.publicReplyVariants.forEach((variante, indice) => {
    const campo = document.createElement("div");
    campo.className = "campo";
    const label = document.createElement("label");
    label.textContent = `Variação ${String.fromCharCode(66 + indice)}`;
    const linha = document.createElement("div");
    linha.style.cssText = "display:flex; gap:8px;";
    const textarea = document.createElement("textarea");
    textarea.value = variante;
    textarea.style.flex = "1";
    textarea.addEventListener("input", () => {
      editorState.publicReplyVariants[indice] = textarea.value;
      marcarSujo();
    });
    const remover = document.createElement("button");
    remover.type = "button";
    remover.className = "btn btn-texto";
    remover.textContent = "✕";
    remover.addEventListener("click", () => {
      editorState.publicReplyVariants.splice(indice, 1);
      marcarSujo();
      renderizarVariacoes();
    });
    linha.appendChild(textarea);
    linha.appendChild(remover);
    campo.appendChild(label);
    campo.appendChild(linha);
    container.appendChild(campo);
  });
}

// ---------------------------------------------------------------------------
// Construtor de sequência (mini-chat)
// ---------------------------------------------------------------------------
function opcoesDestino(idDoPassoAtual) {
  let html = '<option value="end">Encerrar a conversa</option>';
  html += '<option value="link">Abrir um link</option>';
  editorState.steps
    .filter((s) => s.id !== idDoPassoAtual)
    .forEach((s) => {
      html += `<option value="next:${s.id}">Ir para: Mensagem ${s.id}</option>`;
    });
  return html;
}

function renderizarPassos() {
  const container = document.getElementById("edt-passos-lista");
  container.innerHTML = "";

  const refMensagem1 = document.getElementById("edt-ref-mensagem1");
  refMensagem1.textContent = editorState.message1.trim() || "(escreva a mensagem acima)";

  editorState.steps.forEach((passo, indicePasso) => {
    const bloco = document.createElement("div");
    bloco.className = "bloco-mensagem-fluxo";

    const cabecalho = document.createElement("div");
    cabecalho.className = "cabecalho-mensagem-fluxo";
    const titulo = document.createElement("strong");
    titulo.textContent = `Mensagem ${passo.id}`;
    const btnRemoverPasso = document.createElement("button");
    btnRemoverPasso.type = "button";
    btnRemoverPasso.className = "btn btn-texto";
    btnRemoverPasso.textContent = "Remover mensagem";
    btnRemoverPasso.addEventListener("click", () => {
      const idRemovido = passo.id;
      editorState.steps.splice(indicePasso, 1);
      // limpa botões (em qualquer passo) que apontavam pra esse id removido
      editorState.steps.forEach((s) => {
        s.buttons.forEach((b) => {
          if (b.destKind === "next" && b.next === idRemovido) {
            b.destKind = "end";
            b.next = null;
          }
        });
      });
      marcarSujo();
      renderizarPassos();
      renderizarPreview();
    });
    cabecalho.appendChild(titulo);
    cabecalho.appendChild(btnRemoverPasso);
    bloco.appendChild(cabecalho);

    const campoMensagem = document.createElement("div");
    campoMensagem.className = "campo";
    const textarea = document.createElement("textarea");
    textarea.placeholder = "Texto dessa mensagem";
    textarea.value = passo.message;
    textarea.addEventListener("input", () => {
      passo.message = textarea.value;
      marcarSujo();
      renderizarPreview();
    });
    campoMensagem.appendChild(textarea);
    bloco.appendChild(campoMensagem);

    passo.buttons.forEach((botao, indiceBotao) => {
      bloco.appendChild(renderizarLinhaBotao(passo, botao, indiceBotao));
    });

    const btnAddBotao = document.createElement("button");
    btnAddBotao.type = "button";
    btnAddBotao.className = "btn btn-pequeno";
    btnAddBotao.textContent = "+ Adicionar botão";
    btnAddBotao.addEventListener("click", () => {
      passo.buttons.push({ title: "", destKind: "end", next: null, url: "" });
      marcarSujo();
      renderizarPassos();
      renderizarPreview();
    });
    bloco.appendChild(btnAddBotao);

    container.appendChild(bloco);
  });
}

const REGEX_URL = /^(https?:\/\/|www\.)\S+$/i;

function renderizarLinhaBotao(passo, botao, indiceBotao) {
  const bloco = document.createElement("div");
  bloco.className = "bloco-botao-fluxo";

  const linha1 = document.createElement("div");
  linha1.className = "linha";

  const inputTitulo = document.createElement("input");
  inputTitulo.type = "text";
  inputTitulo.maxLength = 20;
  inputTitulo.placeholder = "Nome do botão (até 20 caracteres)";
  inputTitulo.value = botao.title;
  inputTitulo.addEventListener("input", () => {
    botao.title = inputTitulo.value;
    marcarSujo();
    renderizarPreview();
  });

  const btnRemover = document.createElement("button");
  btnRemover.type = "button";
  btnRemover.className = "btn btn-texto";
  btnRemover.textContent = "✕";
  btnRemover.addEventListener("click", () => {
    passo.buttons.splice(indiceBotao, 1);
    marcarSujo();
    renderizarPassos();
    renderizarPreview();
  });

  linha1.appendChild(inputTitulo);
  linha1.appendChild(btnRemover);
  bloco.appendChild(linha1);

  const linha2 = document.createElement("div");
  linha2.className = "linha";

  const select = document.createElement("select");
  select.innerHTML = opcoesDestino(passo.id);
  select.value = botao.destKind === "next" ? `next:${botao.next}` : botao.destKind;
  select.addEventListener("change", () => {
    const valor = select.value;
    if (valor === "link") {
      // regra de ouro: se colaram um link no nome do botão, move pro campo certo
      if (REGEX_URL.test(botao.title.trim())) {
        botao.url = botao.title.trim();
        botao.title = "Acessar";
        inputTitulo.value = botao.title;
      }
      botao.destKind = "link";
    } else if (valor === "end") {
      botao.destKind = "end";
      botao.next = null;
    } else if (valor.startsWith("next:")) {
      botao.destKind = "next";
      botao.next = parseInt(valor.split(":")[1], 10);
    }
    marcarSujo();
    renderizarPassos();
    renderizarPreview();
  });
  linha2.appendChild(select);
  bloco.appendChild(linha2);

  if (botao.destKind === "link") {
    const linha3 = document.createElement("div");
    linha3.className = "linha";
    const textareaLink = document.createElement("textarea");
    textareaLink.className = "textarea-link";
    textareaLink.placeholder = "https://...";
    textareaLink.value = botao.url;
    textareaLink.addEventListener("input", () => {
      botao.url = textareaLink.value;
      marcarSujo();
      renderizarPreview();
    });
    linha3.appendChild(textareaLink);
    bloco.appendChild(linha3);
  }

  return bloco;
}

// ---------------------------------------------------------------------------
// Bloco 2: botão da Mensagem 1 e biblioteca de arquivos
// ---------------------------------------------------------------------------
function atualizarVisibilidadeBotao() {
  const ativo = editorState.buttonEnabled;
  document.getElementById("edt-botao-config").classList.toggle("escondido", !ativo);

  const modoLink = editorState.buttonMode === "link";
  document.getElementById("edt-botao-link-campo").classList.toggle("escondido", !modoLink);
  document.getElementById("edt-construtor").classList.toggle("escondido", modoLink);
}

function atualizarContadorBotao() {
  document.getElementById("edt-botao-texto-contador").textContent = editorState.buttonTitle.length;
}

async function carregarSeletorDeAssets() {
  const select = document.getElementById("edt-asset");
  select.innerHTML = '<option value="">Nenhum</option>';
  const assets = await DB.listarAssets();
  assets.forEach((asset) => {
    const opcao = document.createElement("option");
    opcao.value = asset.id;
    opcao.textContent = `${asset.nome} (${asset.tipo})`;
    select.appendChild(opcao);
  });
}

// ---------------------------------------------------------------------------
// Prévia ao vivo (mockup de celular)
// ---------------------------------------------------------------------------
function renderizarPreview() {
  const tela = document.getElementById("preview-celular");
  tela.innerHTML = '<div class="celular-topo">Direct</div>';

  if (!editorState.message1.trim() && editorState.steps.length === 0) {
    const vazio = document.createElement("div");
    vazio.className = "celular-vazio";
    vazio.textContent = "Comece escrevendo sua mensagem";
    tela.appendChild(vazio);
    return;
  }

  const botoesMensagem1 = [];
  if (editorState.buttonEnabled && editorState.buttonTitle.trim()) {
    if (editorState.buttonMode === "link") {
      botoesMensagem1.push({ title: editorState.buttonTitle, isLink: true });
    } else if (editorState.buttonMode === "continue" && editorState.steps.length > 0) {
      botoesMensagem1.push({ title: editorState.buttonTitle, isLink: false });
    }
  }
  tela.appendChild(criarBolha(editorState.message1, botoesMensagem1));

  editorState.steps.forEach((passo) => {
    const botoes = passo.buttons
      .filter((b) => (b.destKind === "link" && true) || (b.destKind === "next" && b.next))
      .map((b) => ({ title: b.title || "(sem nome)", isLink: b.destKind === "link" }));
    tela.appendChild(criarBolha(passo.message, botoes));
  });
}

function criarBolha(texto, botoes) {
  const bolha = document.createElement("div");
  bolha.className = "bolha-dm";

  const textoEl = document.createElement("div");
  textoEl.className = "texto-bolha";
  textoEl.textContent = texto || "(mensagem vazia)";
  bolha.appendChild(textoEl);

  if (botoes.length > 0) {
    const container = document.createElement("div");
    container.className = "botoes-bolha";
    botoes.forEach((botao) => {
      const el = document.createElement("div");
      el.className = "botao-bolha";
      el.textContent = (botao.isLink ? "🔗 " : "") + (botao.title || "(sem nome)");
      container.appendChild(el);
    });
    bolha.appendChild(container);
  }

  return bolha;
}

// ---------------------------------------------------------------------------
// Salvar
// ---------------------------------------------------------------------------
function construirFlow() {
  const passo1 = {
    id: 1,
    message: editorState.message1,
    buttons: [],
    assets: editorState.assetId ? [editorState.assetId] : [],
  };

  if (editorState.buttonEnabled && editorState.buttonTitle.trim()) {
    if (editorState.buttonMode === "link" && editorState.buttonUrl.trim()) {
      passo1.buttons.push({ title: editorState.buttonTitle.trim(), url: editorState.buttonUrl.trim() });
    } else if (editorState.buttonMode === "continue" && editorState.steps.length > 0) {
      passo1.buttons.push({ title: editorState.buttonTitle.trim(), next: editorState.steps[0].id });
    }
  }

  const demaisPassos = editorState.steps.map((p) => ({
    id: p.id,
    message: p.message,
    assets: p.assetId ? [p.assetId] : [],
    buttons: p.buttons
      .filter((b) => (b.destKind === "link" && b.url.trim()) || (b.destKind === "next" && b.next))
      .map((b) =>
        b.destKind === "link"
          ? { title: (b.title || "Acessar").trim(), url: b.url.trim() }
          : { title: b.title.trim(), next: b.next },
      ),
  }));

  return { steps: [passo1, ...demaisPassos] };
}

function validarEditor() {
  if (!editorState.nome.trim()) return "Dê um nome pra essa automação.";
  if (!editorState.matchAny && editorState.keywords.length === 0) {
    return "Adicione pelo menos uma palavra-chave ou ative \"qualquer palavra ativa\".";
  }
  if (!editorState.message1.trim()) return "Escreva a mensagem que a pessoa vai receber.";
  if (editorState.buttonEnabled) {
    if (!editorState.buttonTitle.trim()) return "Escreva o texto do botão ou desligue o botão.";
    if (editorState.buttonMode === "link" && !editorState.buttonUrl.trim()) {
      return "Cole o link que o botão vai abrir.";
    }
    if (editorState.buttonMode === "continue" && editorState.steps.length === 0) {
      return "Adicione pelo menos uma mensagem na sequência, ou mude o botão pra \"Um link\".";
    }
  }
  return null;
}

async function salvarAutomacaoAtual() {
  const erro = validarEditor();
  if (erro) {
    mostrarAvisoEditor(erro);
    return;
  }
  esconderAvisoEditor();

  const automacao = {
    id: editorState.id,
    nome: editorState.nome.trim(),
    keyword: editorState.keywords.join(","),
    match_any: editorState.matchAny,
    active: true,
    media_ids: editorState.mediaIds,
    public_reply: editorState.publicReply,
    public_reply_variants: editorState.publicReplyVariants.filter((v) => v.trim()),
    flow: construirFlow(),
    asset_ids: editorState.assetId ? [editorState.assetId] : [],
  };

  const resultado = await DB.salvarAutomacao(automacao);
  if (!resultado.ok) {
    mostrarAvisoEditor(resultado.motivo || "Não foi possível salvar.");
    return;
  }

  editorSujo = false;
  fecharEditor(true);
  carregarListaAutomacoes();
}

// ---------------------------------------------------------------------------
// Ligações de eventos (feitas uma vez, no carregamento da página)
// ---------------------------------------------------------------------------
function inicializarEditorAutomacoes() {
  document.getElementById("btn-nova-automacao").addEventListener("click", () => abrirEditor(null));
  document.getElementById("btn-fechar-editor").addEventListener("click", () => fecharEditor(false));
  document.getElementById("btn-cancelar-editor").addEventListener("click", () => fecharEditor(false));
  document.getElementById("modal-editor").addEventListener("click", (evento) => {
    if (evento.target.id === "modal-editor") fecharEditor(false);
  });
  document.getElementById("btn-salvar-automacao").addEventListener("click", salvarAutomacaoAtual);

  document.getElementById("edt-nome").addEventListener("input", (e) => {
    editorState.nome = e.target.value;
    marcarSujo();
  });

  const tagInput = document.getElementById("edt-tag-input");
  tagInput.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") {
      evento.preventDefault();
      const valor = tagInput.value.trim();
      if (valor && !editorState.keywords.includes(valor)) {
        editorState.keywords.push(valor);
        marcarSujo();
        renderizarTags();
      }
      tagInput.value = "";
    } else if (evento.key === "Backspace" && tagInput.value === "" && editorState.keywords.length > 0) {
      editorState.keywords.pop();
      marcarSujo();
      renderizarTags();
    }
  });

  document.getElementById("edt-match-any").addEventListener("change", (e) => {
    editorState.matchAny = e.target.checked;
    marcarSujo();
  });

  document.getElementById("edt-resposta-publica").addEventListener("input", (e) => {
    editorState.publicReply = e.target.value;
    marcarSujo();
  });

  document.getElementById("btn-add-variacao").addEventListener("click", () => {
    editorState.publicReplyVariants.push("");
    marcarSujo();
    renderizarVariacoes();
  });

  const mensagem1 = document.getElementById("edt-mensagem1");
  mensagem1.addEventListener("input", (e) => {
    editorState.message1 = e.target.value;
    marcarSujo();
    renderizarPassos();
    renderizarPreview();
  });

  document.querySelectorAll(".barra-emoji button").forEach((botaoEmoji) => {
    botaoEmoji.addEventListener("click", () => {
      const emoji = botaoEmoji.getAttribute("data-emoji");
      const inicio = mensagem1.selectionStart ?? mensagem1.value.length;
      const fim = mensagem1.selectionEnd ?? mensagem1.value.length;
      mensagem1.value = mensagem1.value.slice(0, inicio) + emoji + mensagem1.value.slice(fim);
      mensagem1.focus();
      mensagem1.selectionStart = mensagem1.selectionEnd = inicio + emoji.length;
      editorState.message1 = mensagem1.value;
      marcarSujo();
      renderizarPassos();
      renderizarPreview();
    });
  });

  document.getElementById("edt-botao-ativo").addEventListener("change", (e) => {
    editorState.buttonEnabled = e.target.checked;
    marcarSujo();
    atualizarVisibilidadeBotao();
    renderizarPreview();
  });

  document.getElementById("edt-botao-texto").addEventListener("input", (e) => {
    editorState.buttonTitle = e.target.value.slice(0, 20);
    marcarSujo();
    atualizarContadorBotao();
    renderizarPreview();
  });

  document.getElementById("edt-botao-modo").addEventListener("change", (e) => {
    editorState.buttonMode = e.target.value;
    marcarSujo();
    atualizarVisibilidadeBotao();
    renderizarPreview();
  });

  document.getElementById("edt-botao-link").addEventListener("input", (e) => {
    editorState.buttonUrl = e.target.value;
    marcarSujo();
    renderizarPreview();
  });

  document.getElementById("btn-add-passo").addEventListener("click", () => {
    editorState.steps.push({ id: proximoIdPasso(), message: "", assetId: "", buttons: [] });
    marcarSujo();
    renderizarPassos();
    renderizarPreview();
  });

  document.getElementById("edt-asset").addEventListener("change", (e) => {
    editorState.assetId = e.target.value;
    marcarSujo();
  });
}
