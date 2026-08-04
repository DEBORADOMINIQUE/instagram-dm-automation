// ============================================================================
// media.js
// Seletor de posts ("Em quais posts") usado no editor de automações.
// ============================================================================

const MEDIA = {
  async renderizarSeletor(container, selecionados, aoMudar) {
    container.innerHTML = '<p class="subtitulo" style="margin:0;">Carregando posts...</p>';

    const posts = await DB.listarPosts();

    if (!posts || posts.length === 0) {
      container.innerHTML =
        '<p class="subtitulo" style="margin:0;">Conecte seu Instagram pra escolher os posts. Sem posts selecionados, a automação vale pra todos.</p>';
      return;
    }

    container.innerHTML = "";
    posts.forEach((post) => {
      const linha = document.createElement("label");
      linha.style.cssText = "display:flex; align-items:center; gap:10px; padding:8px 4px; cursor:pointer;";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.value = post.id;
      check.checked = selecionados.includes(post.id);
      check.addEventListener("change", () => {
        if (check.checked) {
          if (!selecionados.includes(post.id)) selecionados.push(post.id);
        } else {
          const i = selecionados.indexOf(post.id);
          if (i >= 0) selecionados.splice(i, 1);
        }
        aoMudar();
      });

      const miniatura = document.createElement("div");
      miniatura.style.cssText =
        "width:36px; height:36px; border-radius:6px; background:#eee center/cover no-repeat; flex-shrink:0;";
      if (post.miniatura) miniatura.style.backgroundImage = `url(${post.miniatura})`;

      const legenda = document.createElement("span");
      legenda.style.cssText = "font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
      legenda.textContent = post.legenda || "(sem legenda)";

      linha.appendChild(check);
      linha.appendChild(miniatura);
      linha.appendChild(legenda);
      container.appendChild(linha);
    });
  },
};
