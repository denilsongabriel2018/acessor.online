# Fluxo n8n: Agente IA (WhatsApp -> API)

> **Status (2026-08-30)**: o modelo descrito neste documento (pipeline manual,
> 1 chamada de IA pra interpretar + respostas por template, sem `AI Agent`
> nativo) e o que estava rodando em producao e **funciona** — foi testado
> ponta a ponta (criacao de tarefa confirmada). Por decisao do usuario, para
> ganhar velocidade agora, o workflow vai migrar pra usar o node nativo
> **AI Agent** do n8n (mais rapido de montar, mais caro por mensagem — ver
> comparacao de custo abaixo). **Este documento fica preservado como
> referencia** pra quando fizer sentido voltar a otimizar custo/determinismo
> depois que o MVP estiver no ar.

Aviso antes de tudo: esta sessao nao tem uma conexao MCP com n8n nem acesso a
uma instancia real para testar a importacao. O arquivo abaixo foi escrito a
mao seguindo o formato de export do n8n. Importe, rode um teste e me diga se
algum node aparecer com erro — ajusto rapido.

Um unico workflow: `whatsapp-ai-agent.workflow.json`.

## O que esse fluxo faz

Cobre a parte de IA + integracao com a nossa API. **A parte de receber e
enviar mensagem no WhatsApp fica por sua conta** — o fluxo comeca num webhook
generico e termina num node vazio ("Saida - conectar WhatsApp aqui") pronto
pra voce plugar o node de envio.

```
Webhook (mensagem chega)
  -> Normalizar entrada (extrai mensagem/telefone, monta o prompt)
  -> OpenAI: interpreta a mensagem e devolve um JSON de intent
  -> Parsear intent (valida o JSON, resolve periodo, decide se da pra executar)
  -> Intent suportada?
       nao -> resposta padrao pedindo pra reformular (sem custo de IA)
       sim -> API: POST /api/commands (nossa API real)
           -> Preparar resposta (texto pronto, SEM IA, pra criar/concluir/evento/lista curta)
           -> Precisa de IA pra resumir? (so quando a lista tem mais de 3 itens)
                nao -> segue direto
                sim -> OpenAI: resume a lista -> extrai o texto
  -> Saida (telefone + resposta prontos pra voce mandar no WhatsApp)
```

## Onde fica a otimizacao de custo

Duas coisas reduzem gasto de IA de proposito, em vez de usar um `AI Agent`
generico sempre carregado com todas as ferramentas:

1. **Uma unica chamada de IA pra interpretar** — sem tool-schemas, sem ida e
   volta de agente. So um prompt enxuto -> um JSON de volta.
2. **Resposta simples vira automacao, so o complexo vai pra IA**: criar
   tarefa, criar evento, concluir tarefa e listas curtas (ate 3 itens) geram
   o texto de resposta direto por codigo (node "Preparar resposta"), sem
   gastar IA nenhuma. So quando a listagem tem mais de 3 itens e vale a pena
   uma segunda chamada de IA pra resumir de forma legivel.

Isso significa: a maioria das mensagens (criar algo, concluir algo, lista
curta) custa **1 chamada de IA no total**. So listas longas custam 2.

## Onde fica a otimizacao de busca/filtro

A IA **nao calcula data exata**. No prompt, pra `list_items` ela so escolhe um
label pronto (`hoje`, `amanha`, `essa_semana`, `proximos_7_dias`, `esse_mes`,
ou `personalizado` quando o usuario da um intervalo especifico tipo "entre
10/09 e 20/09"). Quem transforma o label em `period_start`/`period_end`
exatos (UTC) e uma funcao determinística dentro do node "Parsear intent"
(`resolvePeriodo`) — nao e a IA fazendo conta de data, e codigo fixo. Isso:

- reduz o que a IA precisa acertar (menos tokens, menos chance de erro de
  fuso horario)
- garante que a API sempre recebe um intervalo valido e bem formado, sem
  consultas malfeitas por causa de uma conta errada da IA

Isso e exatamente o que o `PLANO_DE_ACAO.md` ja previa na secao "Consultas
por Periodo" (labels como "hoje", "essa semana", "proximos 7 dias") — so que
resolvido em codigo no n8n em vez de mudar a API. Se no futuro quiser mover
essa resolucao pra dentro da propria API (pra qualquer outro cliente, nao so
o WhatsApp, se beneficiar do mesmo atalho), e um passo natural depois.

## Por que assim (e nao com o node OpenAI do n8n ou um AI Agent)

Os parametros do node oficial `OpenAI` do n8n mudam de versao pra versao, e
eu nao tinha como testar contra a sua instancia. Preferi chamar a API de Chat
Completions da OpenAI direto por `HTTP Request` — funciona igual em qualquer
versao do n8n, e da pra ver exatamente o que esta sendo enviado/recebido.

Sobre o `AI Agent` nativo (com tools conectadas): cheguei a montar uma versao
assim, mas ela manda o schema completo das 4 ferramentas pro modelo em toda
mensagem e normalmente gasta 2 chamadas de IA por mensagem de qualquer jeito
— sai mais caro que o pipeline manual pra esse caso de uso (poucas acoes bem
definidas), entao ficamos so com esta versao.

## Import

No n8n: **Workflows -> Import from File** -> selecione
`whatsapp-ai-agent.workflow.json`.

## Variaveis de ambiente que o n8n precisa ter

Configure no ambiente onde o n8n roda (nao no `.env` deste projeto):

| Variavel | Para que serve |
|---|---|
| `OPENAI_API_KEY` | Chave da OpenAI, usada nos nodes de HTTP Request pra `api.openai.com` |
| `API_URL` | URL da nossa API (`http://localhost:3000` local, ou a URL de staging/producao) |
| `N8N_TO_API_SECRET` | Tem que ser **identico** ao `N8N_TO_API_SECRET` configurado no `.env` da `apps/api` — e o segredo que prova pra API que o comando veio do n8n oficial |

Os nodes que chamam a OpenAI e a nossa API tem "continuar em caso de falha"
ligado — se a OpenAI cair ou a API responder erro, o fluxo nao trava: ou cai
no intent `unknown` (resposta padrao, sem IA) ou o node "Preparar resposta"
devolve uma mensagem de erro amigavel a partir do corpo de erro da API.

## O que sua integracao de WhatsApp precisa mandar pro webhook

`POST` pra URL do webhook (path `whatsapp-mensagem`) com JSON:

```json
{
  "phone": "5511999999999",
  "message": "me lembra de enviar a proposta pro Joao amanha as 10, prioridade 2",
  "userExternalId": "5511999999999"
}
```

`userExternalId` e opcional (cai pro telefone se nao vier). Se sua integracao
usa outros nomes de campo, so precisa ajustar as 3 primeiras expressoes do
node **Normalizar entrada** — o resto do fluxo nao muda.

## O que o agente ja consegue fazer

Hoje a API (`POST /api/commands`) so implementa 4 intents, entao o prompt de
interpretacao so oferece essas 4 opcoes pra IA escolher:

- `create_task` — criar tarefa (titulo, prazo, prioridade)
- `create_event` — criar evento (titulo, inicio, fim, local)
- `complete_task` — concluir tarefa(s) pelo numero (ex: "concluir a task 12")
- `list_items` — listar/consultar tarefas e eventos por periodo (label pronto
  ou intervalo especifico), status ou prioridade

Qualquer outra coisa (reagendar, cancelar, mudar politica de aviso, pedir
resumo do dia) ainda **nao existe na API** — o `PLANO_DE_ACAO.md` lista esses
intents como parte do roadmap (`reschedule_item`, `cancel_item`,
`update_notification_policy`, `get_summary`), mas o backend ainda nao
implementa nenhum deles. O agente cai em `unknown` nesses casos e responde
pedindo pra reformular, sem gastar uma segunda chamada de IA. Quando esses
endpoints existirem na API, e so adicionar a opcao correspondente no prompt
de interpretacao e um novo `if` no node "Parsear intent" e no "Preparar
resposta".

## O outro fluxo: avisos/lembretes (API -> n8n -> WhatsApp) — ainda nao construido

Esse README ate aqui e so do fluxo de **entrada** (WhatsApp -> IA -> nossa
API). Existe um segundo fluxo, na direcao contraria, que a API ja sabe chamar
mas cujo lado n8n ainda nao foi construido (ficou combinado de fazer depois):
o **scheduler de lembretes**, que roda dentro da `apps/api`, decide sozinho
quando cada aviso deve disparar (baseado na politica de notificacao da
tarefa/evento) e, na hora certa, faz um `POST` pra
`N8N_NOTIFICATION_WEBHOOK_URL` — a URL de um webhook do n8n que ainda nao
existe.

Quando for construir esse workflow, ele recebe assim:

```json
{
  "workspace_id": "...",
  "item_type": "task",
  "item_id": "...",
  "notification_kind": "before_due",
  "scheduled_for": "2026-08-30T13:00:00.000Z",
  "item": { "id": "...", "title": "...", "dueAt": "...", "priority": 2, "status": "pending", "..." : "..." }
}
```

### Contrato de resposta — isso e obrigatorio, nao opcional

O workflow **precisa responder** com um corpo JSON confirmando se a mensagem
foi entregue de verdade no WhatsApp, nao so que a chamada foi recebida:

```json
{ "delivered": true }
```
ou, se falhar ao mandar (numero invalido, WhatsApp fora do ar, etc):
```json
{ "delivered": false, "reason": "numero invalido" }
```

**Por que isso importa**: um `200 OK` sozinho so prova que o n8n recebeu a
chamada, nao que o WhatsApp realmente entregou a mensagem (isso pode falhar
depois, silenciosamente, dentro do proprio workflow). Por isso o
`apps/api/src/scheduler.ts` **nao confia so no status HTTP** — ele le
especificamente o campo `delivered` do corpo da resposta. Se o n8n responder
200 mas sem esse campo (ou com `delivered: false`), a API marca o aviso como
`failed`, nao como `sent`, mesmo a chamada HTTP tendo "dado certo". Isso foi
testado na pratica (rodei os dois cenarios com um servidor simulando o n8n:
um confirmando entrega, outro so respondendo 200 "ingenuo" — o segundo
corretamente vira `failed`).

## Um ponto em aberto do lado da API

O `PLANO_DE_ACAO.md` prevê que a API resolva o usuário a partir do
`user_external_id`/WhatsApp (nunca aceitar um `user_id` livre vindo do n8n).
Isso ainda não está implementado — `POST /api/commands` hoje sempre opera no
workspace padrão único (`DEFAULT_WORKSPACE_ID`), sem diferenciar quem mandou
a mensagem. Funciona bem para um usuário/teste; para múltiplos usuários reais
no WhatsApp isso precisa ser resolvido na API antes.
