# Pendencias de seguranca (adiadas de proposito)

Foco atual do projeto e funcionalidade e otimizacao. Isto aqui e a lista do
que fica em aberto de seguranca ate decidirmos fechar - antes de expor a API
fora da rede local / pra mais gente, isto precisa ser resolvido.

## 1. API sem autenticacao nenhuma

`apps/api/src/server.ts` — **nenhuma** rota valida o Bearer token do Supabase.
O front (`apiFetch` em `apps/web/src/main.tsx`) ja manda o token em toda
chamada, mas o backend ignora. Hoje, quem souber a URL da API le, cria,
edita e **apaga** qualquer tarefa/evento sem login nenhum.

Rotas afetadas: `/api/tasks*`, `/api/events*`, `/api/items`,
`/api/notification-policies`.

Correcao prevista: um `preHandler` no Fastify que chama
`supabase.auth.getUser(token)` e rejeita sem token valido, antes de liberar
qualquer rota que nao seja `/health` ou `/api/commands` (essa usa outro
segredo, ver item 2).

## 2. Segredo n8n <-> API e opcional se nao configurado

Em `server.ts`, o check do `/api/commands` e:
```ts
if (config.n8nToApiSecret && secret !== config.n8nToApiSecret) { ... }
```
Se `N8N_TO_API_SECRET` estiver vazio no `.env` (como fica por padrao ate
alguem preencher), a checagem inteira e pulada e `/api/commands` fica aberto
tambem. Bom pra testar local, perigoso se subir assim pra staging/producao.

## 3. Deletar e permanente e esta no mesmo nivel de acesso que tudo o resto

`DELETE /api/tasks/:id` e `DELETE /api/events/:id` apagam de vez (sem soft
delete). Combinado com o item 1 (sem auth), e a combinacao mais perigosa da
lista: qualquer requisicao apaga dado de verdade, para sempre.

## 4. Sem resolucao de usuario no WhatsApp

`POST /api/commands` sempre opera no `DEFAULT_WORKSPACE_ID` unico, nao
resolve `user_external_id`. Ok pra 1 pessoa testando; errado assim que tiver
mais de um usuario real (um usuario consegue mexer nos dados "do outro" via
WhatsApp, ja que nao existe isolamento por usuario ainda). Detalhado tambem
em `n8n/README.md`.

## 5. `WEBHOOK_HMAC_SECRET` existe no `.env.example` mas nao e usado

Nenhum codigo assina ou verifica HMAC em nenhum payload ainda.

## 6. `CORS_ORIGIN` e um valor unico fixo

O `.env.example` ja prevê `LOCAL_CORS_ORIGIN` / `STAGING_CORS_ORIGIN` /
`PRODUCTION_CORS_ORIGIN` separados, mas `config.ts` so le `CORS_ORIGIN` -
nao troca sozinho conforme o ambiente (`APP_ENV`).

---

Quando for a hora de fechar isso, a ordem que faz mais sentido: **1 -> 3**
(auth geral fecha o delete tambem) **-> 2 -> 4 -> 5/6**.
