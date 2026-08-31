# API — Agenda Motor

Referência da API do backend (`apps/api`). Cobre as rotas REST (usadas pelo site) e a rota de comandos (`/api/commands`, usada pelo n8n/agente de IA no WhatsApp).

## Envelope de resposta

Toda resposta, sucesso ou erro, segue o mesmo formato:

```json
{
  "ok": true,
  "intent": "create_task",
  "data": { "task": { ... } },
  "errors": [],
  "warnings": [],
  "meta": { "request_id": "uuid", "processed_at": "2026-08-30T16:00:00.000Z" }
}
```

Erro (validação ou erro interno, sempre HTTP 400 exceto secret inválido que é 401):
```json
{
  "ok": false,
  "errors": [{ "message": "..." }],
  "warnings": [],
  "meta": { "request_id": "uuid", "processed_at": "..." }
}
```

## Autenticação

- **`/api/commands`**: header `x-n8n-to-api-secret` precisa bater com `N8N_TO_API_SECRET` (env). Sem isso, `401`.
- **Rotas REST** (`/api/tasks`, `/api/events`, `/api/items`, etc.): sem verificação de token hoje — TODO de segurança conhecido e documentado em `server.ts` e `PLANO_DE_ACAO.md` (rede ainda fechada, não exposta publicamente).
- Rate limit global: 100 req/min por IP (`@fastify/rate-limit`).

## Conceitos

- **`number`** (não confundir com `id`): número sequencial pequeno, por tipo (uma tarefa #3 e um evento #3 são itens diferentes). É como humano/IA referenciam um item em conversa. `id` é o UUID interno, usado só entre a API e o banco.
- **`notificationPolicy` vs `notificationPolicyId`**: ao criar/editar, você manda o **nome** (`"leve"`, `"normal"`, `"intenso"`) e a API resolve pro UUID internamente. Toda resposta que devolve um item também traz `notificationPolicyName` (resolvido do id) — nunca precisa lidar com UUID de política na prática.
- **`alarmEnabled`**: liga/desliga os avisos de um item, independente do modo de política configurado (desligar não apaga a política, só pausa os avisos).
- Campos de data (`dueAt`, `startsAt`, `endsAt`, `period_start`, `period_end`) são sempre **ISO 8601 em UTC**, terminando em `Z`.

## Rotas REST (usadas pelo site)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Healthcheck |
| GET | `/api/items` | Lista tarefas+eventos (sempre completo — sem resumo) |
| GET | `/api/notification-policies` | Lista as políticas (leve/normal/intenso) |
| POST | `/api/tasks` | Cria tarefa |
| PATCH | `/api/tasks/:id` | Edita tarefa (por UUID) |
| PATCH | `/api/tasks/:id/complete` | Marca concluída |
| PATCH | `/api/tasks/:id/archive` | Arquiva |
| PATCH | `/api/tasks/:id/cancel` | Cancela |
| DELETE | `/api/tasks/:id` | Apaga |
| POST | `/api/events` | Cria evento |
| PATCH | `/api/events/:id` | Edita evento |
| PATCH | `/api/events/:id/archive` | Arquiva |
| PATCH | `/api/events/:id/cancel` | Cancela |
| DELETE | `/api/events/:id` | Apaga |

Essas rotas usam **UUID** (`:id`) porque o site sempre tem o objeto completo carregado (com o id) antes de editar. `GET /api/items` aceita os mesmos filtros de query que `list_items` abaixo, mas ignora `detail` — sempre devolve o item completo.

## `/api/commands` (POST) — usado pelo n8n/agente de IA

Um único endpoint, o campo `intent` no corpo decide o comando. Todos os comandos abaixo (exceto `create_task`/`create_event`) referenciam item por **`number`**, não UUID.

### `create_task`
```json
{
  "intent": "create_task",
  "payload": {
    "title": "Ligar pro dentista",
    "description": "",
    "dueAt": "2026-08-31T16:00:00.000Z",
    "priority": 2,
    "notificationPolicy": "intenso",
    "originalMessage": "me lembra de ligar pro dentista amanha as 13h, intenso",
    "source": "n8n"
  }
}
```
Campos opcionais aceitam `""` (equivalente a "não especificado" → usa default). `priority` padrão `3`, `notificationPolicy` padrão `"normal"`, `alarmEnabled` padrão `true`.

### `create_event`
Igual a `create_task`, mas com `startsAt`/`endsAt` (obrigatórios) e `location` em vez de `dueAt`/`priority`.

### `complete_task`
```json
{ "intent": "complete_task", "task_numbers": [3, 7] }
```
Aceita array, string CSV (`"3,7"`) ou número único — sempre normalizado pra array. Resposta: `{ completed: [...], notFound: [...], stillPendingCount }`.

### `archive_item` / `delete_item`
```json
{ "intent": "archive_item", "item_type": "task", "numbers": [3, 7] }
```
`item_type` é `"task"` ou `"event"` — um tipo por chamada. Resposta: `{ archived: [...], notFound: [...] }` (ou `deleted: [numbers]` pra delete).

### `get_item`
```json
{ "intent": "get_item", "item_type": "task", "number": 3 }
```
Devolve `{ item: {...} | undefined }` — sempre completo (não passa pelo resumo do `list_items`).

### `update_item`
```json
{
  "intent": "update_item",
  "item_type": "task",
  "number": 3,
  "patch": {
    "title": "",
    "dueAt": "2026-09-01T13:00:00.000Z",
    "priority": "",
    "notificationPolicy": "leve",
    "alarmEnabled": "false"
  }
}
```
`patch` mistura campos de tarefa e evento no mesmo objeto — a API filtra pelos válidos pra `item_type` e ignora `""`. Só o que for realmente enviado (não vazio) é alterado.

### `list_items`
```json
{
  "intent": "list_items",
  "filters": {
    "type": "task",
    "status": "",
    "priority": "",
    "period_start": "",
    "period_end": "",
    "q": "",
    "limit": "10",
    "order": "desc",
    "detail": "simple"
  }
}
```
Três formas de busca (podem combinar):
- **Por período**: `period_start`/`period_end`.
- **Por quantidade**: `limit` + `order` (`"asc"` ou `"desc"`), sem período.
- **Por palavra-chave**: `q` busca no título.

`detail`:
- `"simple"` (padrão) — devolve só `itemType, number, title, status, alarmEnabled, notificationPolicyName` + (`priority, dueAt` pra tarefa | `startsAt, endsAt, location` pra evento). Pensado pra IA — pesa menos tokens numa listagem grande.
- `"advanced"` — devolve o item completo (mesmo formato de `get_item`).

## Políticas de notificação

3 políticas fixas, seedadas no banco: **leve**, **normal**, **intenso** — cada uma com regras de aviso antes/depois do prazo. `GET /api/notification-policies` lista todas (com `description` de cada uma).

## Agendamento de notificações

Todo `create`/`update` que muda `dueAt`/`startsAt`/`notificationPolicy`/`alarmEnabled` reagenda os avisos automaticamente (limpa os pendentes antigos e recalcula). O scheduler roda a cada 60s, dedupli­cando avisos que vencem juntos (só manda o mais recente por item, não todos de uma vez).
