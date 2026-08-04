# Painel de Automação de DM do Instagram

Sistema com painel web (login e menu com Início, Calendário e Instagram) e um motor de
automação de direct do Instagram (estilo ManyChat): alguém comenta uma palavra num post,
recebe uma DM automática com botões, e a conversa segue do jeito que você montar.

Este documento é o passo a passo pra colocar tudo no ar de verdade. Se você só quer navegar
o sistema agora, pule direto pro passo 0.

---

## 0. Testar agora, sem configurar nada

O frontend já está pronto pra abrir e navegar, mesmo sem Supabase e sem Instagram
conectados. Rode:

```bash
cd frontend
python3 -m http.server 5173
```

Abra `http://localhost:5173` no navegador. Na tela de login, digite qualquer e-mail e uma
senha de 5 dígitos (ex: `12345`) e clique em Entrar. Isso é só pra teste local: em produção
o login vira o Supabase Auth de verdade.

Nesse modo você consegue navegar tudo: Início, Calendário, e dentro de Instagram as abas
Métricas e Automações, incluindo abrir o editor completo de automação com a prévia ao vivo.
Como o Supabase ainda não está ligado, os números aparecem zerados e salvar uma automação
mostra um aviso pedindo pra configurar o banco primeiro. Isso é esperado.

Os passos a seguir ligam tudo de verdade.

---

## 1. Criar o projeto no Supabase e rodar os scripts SQL

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No painel do projeto, vá em **SQL Editor** e rode, NESTA ORDEM, os arquivos da pasta
   `supabase/sql/`:
   1. `001_tabelas.sql`
   2. `002_freio_de_envio.sql` (as funções do freio; sem isso nenhuma DM por comentário sai)
   3. `003_seguranca_rls.sql`
   4. `004_agendamento_cron.sql` (troque `SEU_PROJECT_REF` e `SEU_SCHED_SECRET` antes de
      rodar; veja o passo 5)

## 2. Criar o usuário admin (login de produção)

No painel do Supabase: **Authentication > Users > Add user**. Cadastre um e-mail e uma senha.
É esse login que vale quando o site estiver no ar (fora do localhost); o modo de teste local
(qualquer e-mail + senha de 5 dígitos) só funciona em `localhost`.

## 3. Configurar os segredos das Edge Functions

No painel do Supabase: **Edge Functions > Manage secrets** (ou pela CLI, veja o passo 4).
Preencha:

| Variável | O que é |
|---|---|
| `IG_ACCESS_TOKEN` | Token long-lived do Instagram |
| `IG_ACCOUNT_ID` | Id numérico da conta do Instagram |
| `APP_SECRET` | Segredo do app do Meta (assinatura) |
| `APP_SECRET_ENFORCE` | `false` no começo (modo teste), `true` depois de testar |
| `VERIFY_TOKEN` | Uma senha que você inventa (aperto de mão do webhook) |
| `GRAPH_API_VERSION` | Ex: `v21.0` |
| `SCHED_SECRET` | Uma senha que você inventa (protege os robôs agendados) |
| `TEST_IG_ACCOUNTS` | Ids numéricos das contas de teste, separados por vírgula (ignoram a regra do 1 por dia) |
| `SUPABASE_URL` | URL do seu projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de service_role (Settings > API) |

Nunca coloque a `SUPABASE_SERVICE_ROLE_KEY` no frontend.

## 4. Publicar as Edge Functions

Com a [CLI do Supabase](https://supabase.com/docs/guides/cli) instalada e logada:

```bash
supabase link --project-ref SEU_PROJECT_REF

# a instagram-webhook precisa ser pública, senão o Meta não consegue chamar
supabase functions deploy instagram-webhook --no-verify-jwt

supabase functions deploy ig-scheduler --no-verify-jwt
supabase functions deploy ig-token-refresh --no-verify-jwt
supabase functions deploy ig-insights
supabase functions deploy ig-media
```

(`ig-scheduler` e `ig-token-refresh` também levam `--no-verify-jwt` porque são chamadas pelo
pg_cron, não por um usuário logado; elas se protegem sozinhas com o `SCHED_SECRET`.)

## 5. Agendar os robôs (pg_cron)

No `supabase/sql/004_agendamento_cron.sql`, troque `SEU_PROJECT_REF` pela referência do seu
projeto (aparece na URL do painel) e `SEU_SCHED_SECRET` pelo mesmo valor que você configurou
no passo 3. Rode o script no SQL Editor. Isso agenda:
- `ig-scheduler` a cada 1 minuto
- `ig-token-refresh` uma vez por semana

## 6. Criar o app no Meta for Developers

1. Crie um app em [developers.facebook.com](https://developers.facebook.com), tipo
   **Instagram API with Instagram Login**.
2. Conecte a conta profissional do Instagram que vai usar.
3. Libere as permissões de ler comentários e ler/enviar mensagens.
4. Gere o token long-lived e copie o id numérico da conta. Preencha `IG_ACCESS_TOKEN` e
   `IG_ACCOUNT_ID` (passo 3).

## 7. Cadastrar o webhook no Meta

No painel do app, em **Webhooks**:
- URL de callback: a URL pública da função `instagram-webhook`
  (`https://SEU_PROJECT_REF.supabase.co/functions/v1/instagram-webhook`)
- Token de verificação: o mesmo `VERIFY_TOKEN` do passo 3
- Assine os campos: `comments`, `messages` e `messaging_postbacks`

Os três campos são obrigatórios: sem `messaging_postbacks`, os botões da conversa não
funcionam.

## 8. Publicar o frontend

Edite `frontend/js/config.js` e preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` (Settings >
API, no painel do Supabase). Depois publique a pasta `frontend/` em qualquer host estático,
por exemplo GitHub Pages:

```bash
# dentro da raiz do projeto, com o git já iniciado
git add .
git commit -m "publica o painel"
git push
# depois ative o GitHub Pages apontando pra pasta /frontend, nas configurações do repositório
```

## 9. Testar com uma segunda conta

Comente a palavra-chave configurada num post, usando uma conta DIFERENTE da conta dona do
Instagram (a própria conta é ignorada de propósito, pra não responder você mesmo). Confira se
a DM chegou com o botão.

## 10. Ligar a trava de segurança

Depois que tudo estiver funcionando, volte no passo 3 e mude `APP_SECRET_ENFORCE` pra `true`.
Isso passa a exigir que toda requisição ao webhook tenha a assinatura correta do Meta.

---

## Regras e limites (pra não tomar bloqueio)

- **Opt-in sempre**: o sistema só responde quem comentou, nunca dispara em massa.
- **1 DM por pessoa a cada 24h** em gatilho de comentário (as contas listadas em
  `TEST_IG_ACCOUNTS` ignoram essa regra, só pra você testar à vontade).
- **Freio de envio**: respeita o teto do Instagram (padrão: 6/minuto, 60/hora, 180/dia, bem
  abaixo do limite real), segura os excedentes na fila, e pausa os envios por algumas horas
  se detectar sinais de bloqueio.
- **Janela de 24h da Meta**: só dá pra mandar DM dentro de 24h depois de uma interação
  (comentário ou toque num botão).
- **Token do Instagram vence em cerca de 60 dias**: a renovação automática (`ig-token-refresh`)
  cuida disso, mas confira `ig_token_status` de vez em quando.
- **Título de botão**: máximo 20 caracteres. **Botões anexados à mensagem**: máximo 3 por
  mensagem (o formato de pílula avulsa, usado como reserva, aceita mais).
- **Resposta a comentário**: só vale por cerca de 7 dias.
- **Consultas ao banco**: no máximo 1000 linhas por vez (pagine telas que listam muitos
  registros).
- Nada de spam, nada de lista comprada. O sistema foi desenhado pra responder só quem pediu.

---

## Estrutura do projeto

```
frontend/                  painel web (HTML/CSS/JS puro)
  index.html
  css/styles.css
  js/
    config.js               credenciais do Supabase (preencha aqui)
    db.js                   acesso ao banco e às Edge Functions
    auth.js                 login (local e Supabase)
    media.js                seletor de posts
    metrics.js               sub-aba Métricas
    automations.js          lista + editor + construtor de conversa + prévia
    app.js                  navegação e bootstrapping

supabase/
  sql/
    001_tabelas.sql
    002_freio_de_envio.sql
    003_seguranca_rls.sql
    004_agendamento_cron.sql
  functions/
    instagram-webhook/      recebe comentários, mensagens e toques em botão
    ig-scheduler/           esvazia a fila e manda passos com atraso (a cada 1 min)
    ig-token-refresh/       renova o token do Instagram (semanal)
    ig-insights/            métricas da conta
    ig-media/                lista de posts
```

## Checklist de variáveis pra preencher

- [ ] `frontend/js/config.js`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- [ ] Segredos das Edge Functions: `IG_ACCESS_TOKEN`, `IG_ACCOUNT_ID`, `APP_SECRET`,
      `APP_SECRET_ENFORCE`, `VERIFY_TOKEN`, `GRAPH_API_VERSION`, `SCHED_SECRET`,
      `TEST_IG_ACCOUNTS`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `supabase/sql/004_agendamento_cron.sql`: `SEU_PROJECT_REF`, `SEU_SCHED_SECRET`
- [ ] Usuário admin criado em Authentication > Users
