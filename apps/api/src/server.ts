import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { config } from "./config.js";
import {
  commandSchema,
  createEventSchema,
  createTaskSchema,
  listItemsQuerySchema,
  updateEventSchema,
  updateTaskSchema
} from "./schemas.js";
import { startScheduler } from "./scheduler.js";
import { store } from "./store.js";
import type { ItemListRow } from "./types.js";

// TODO(seguranca): nenhuma rota abaixo valida o Bearer token do Supabase Auth.
// O front ja manda o token em toda chamada (apiFetch em main.tsx) mas a API
// ignora - hoje qualquer um com a URL da API le/edita/apaga tudo. Antes de
// expor isso fora da rede local, adicionar aqui um preHandler que verifica o
// JWT do Supabase (supabase.auth.getUser(token)) e rejeita sem token valido.
// Fica registrado tambem no PLANO_DE_ACAO.md.
const app = Fastify({ logger: true });

await app.register(cors, { origin: config.corsOrigin });
await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

const response = (intent: string, data: unknown, warnings: string[] = []) => ({
  ok: true,
  intent,
  data,
  errors: [],
  warnings,
  meta: {
    request_id: crypto.randomUUID(),
    processed_at: new Date().toISOString()
  }
});

// A IA/usuario escolhe a politica pelo nome ("leve"/"normal"/"intenso"), nao
// pelo UUID - resolve pro id de verdade aqui. Nome invalido ou ausente cai
// pro comportamento padrao do store (pickPolicy usa a politica default).
async function resolvePolicyId(name?: string): Promise<string | undefined> {
  if (!name) return undefined;
  const policies = await store.listNotificationPolicies();
  return policies.find((policy) => policy.name.toLowerCase() === name.toLowerCase())?.id;
}

// Task/CalendarEvent so guardam notificationPolicyId (uuid) - sem isso, quem
// le a resposta (IA/front) nao tem como saber que "leve"/"normal"/"intenso"
// aquilo significa. Anexa o nome pra toda resposta que devolve item(ns).
type WithPolicyId = { notificationPolicyId?: string };
function withPolicyName<T extends WithPolicyId>(
  item: T,
  policies: Awaited<ReturnType<typeof store.listNotificationPolicies>>
): T & { notificationPolicyName?: string } {
  const policy = item.notificationPolicyId ? policies.find((p) => p.id === item.notificationPolicyId) : undefined;
  return { ...item, notificationPolicyName: policy?.name.toLowerCase() };
}

// list_items do /api/commands e sempre consumido pela IA (n8n) - cada campo a
// mais em cada item de uma lista e tokens a mais, multiplicados pela
// quantidade de itens. /api/items (usado pelo site) continua devolvendo o
// item completo direto do store, sem passar por aqui - o site precisa de
// tudo (id, description, etc.) pra editar. So essa rota (a "porta" de
// entrada da IA) resume; o formato do dado guardado nao muda.
function toListSummary(item: ItemListRow & { notificationPolicyName?: string }) {
  const base = {
    itemType: item.itemType,
    number: item.number,
    title: item.title,
    status: item.status,
    alarmEnabled: item.alarmEnabled,
    notificationPolicyName: item.notificationPolicyName
  };
  if (item.itemType === "task") {
    return { ...base, priority: item.priority, dueAt: item.dueAt };
  }
  return { ...base, startsAt: item.startsAt, endsAt: item.endsAt, location: item.location };
}

app.get("/health", async () => response("health", { status: "ok" }));

app.get("/api/items", async (request) => {
  const filters = listItemsQuerySchema.parse(request.query);
  return response("list_items", { items: await store.listItems(filters) });
});

app.post("/api/tasks", async (request) => {
  const body = createTaskSchema.parse(request.body);
  return response("create_task", { task: await store.createTask(body) });
});

app.patch("/api/tasks/:id/complete", async (request) => {
  const params = request.params as { id: string };
  const task = await store.completeTaskById(params.id);
  return response("complete_task", { task });
});

app.patch("/api/tasks/:id/archive", async (request) => {
  const params = request.params as { id: string };
  const task = await store.archiveTaskById(params.id);
  return response("archive_task", { task });
});

app.patch("/api/tasks/:id/cancel", async (request) => {
  const params = request.params as { id: string };
  const task = await store.cancelTaskById(params.id);
  return response("cancel_task", { task });
});

app.patch("/api/tasks/:id", async (request) => {
  const params = request.params as { id: string };
  const body = updateTaskSchema.parse(request.body);
  const task = await store.updateTaskById(params.id, body);
  return response("update_task", { task });
});

app.delete("/api/tasks/:id", async (request) => {
  const params = request.params as { id: string };
  const deleted = await store.deleteTaskById(params.id);
  return response("delete_task", { deleted });
});

app.get("/api/notification-policies", async () => {
  return response("list_notification_policies", { policies: await store.listNotificationPolicies() });
});

app.post("/api/events", async (request) => {
  const body = createEventSchema.parse(request.body);
  return response("create_event", { event: await store.createEvent(body) });
});

app.patch("/api/events/:id", async (request) => {
  const params = request.params as { id: string };
  const body = updateEventSchema.parse(request.body);
  const event = await store.updateEventById(params.id, body);
  return response("update_event", { event });
});

app.patch("/api/events/:id/cancel", async (request) => {
  const params = request.params as { id: string };
  const event = await store.cancelEventById(params.id);
  return response("cancel_event", { event });
});

app.patch("/api/events/:id/archive", async (request) => {
  const params = request.params as { id: string };
  const event = await store.archiveEventById(params.id);
  return response("archive_event", { event });
});

app.delete("/api/events/:id", async (request) => {
  const params = request.params as { id: string };
  const deleted = await store.deleteEventById(params.id);
  return response("delete_event", { deleted });
});

app.post("/api/commands", async (request, reply) => {
  const secret = request.headers["x-n8n-to-api-secret"];
  if (config.n8nToApiSecret && secret !== config.n8nToApiSecret) {
    return reply.code(401).send({ ok: false, errors: [{ message: "Invalid n8n secret" }] });
  }

  const command = commandSchema.parse(request.body);
  if (command.intent === "create_task") {
    const { notificationPolicy, ...payload } = command.payload;
    const notificationPolicyId = payload.notificationPolicyId || (await resolvePolicyId(notificationPolicy));
    const task = await store.createTask({ ...payload, notificationPolicyId });
    const policies = await store.listNotificationPolicies();
    return response(command.intent, { task: withPolicyName(task, policies) });
  }
  if (command.intent === "create_event") {
    const { notificationPolicy, ...payload } = command.payload;
    const notificationPolicyId = payload.notificationPolicyId || (await resolvePolicyId(notificationPolicy));
    const event = await store.createEvent({ ...payload, notificationPolicyId });
    const policies = await store.listNotificationPolicies();
    return response(command.intent, { event: withPolicyName(event, policies) });
  }
  if (command.intent === "complete_task") {
    const result = await store.completeTasks(command.task_numbers);
    const policies = await store.listNotificationPolicies();
    return response(command.intent, { ...result, completed: result.completed.map((task) => withPolicyName(task, policies)) });
  }
  if (command.intent === "archive_item") {
    const result =
      command.item_type === "task"
        ? await store.archiveTasks(command.numbers)
        : await store.archiveEvents(command.numbers);
    const policies = await store.listNotificationPolicies();
    return response(command.intent, { ...result, archived: result.archived.map((item) => withPolicyName(item, policies)) });
  }
  if (command.intent === "delete_item") {
    const result =
      command.item_type === "task" ? await store.deleteTasks(command.numbers) : await store.deleteEvents(command.numbers);
    return response(command.intent, result);
  }
  if (command.intent === "get_item") {
    const item =
      command.item_type === "task"
        ? await store.getTaskByNumber(command.number)
        : await store.getEventByNumber(command.number);
    const policies = await store.listNotificationPolicies();
    return response(command.intent, { item: item ? withPolicyName(item, policies) : item });
  }
  if (command.intent === "update_item") {
    const raw = command.patch;
    if (command.item_type === "task") {
      const cleaned: Record<string, unknown> = {};
      if (typeof raw.title === "string" && raw.title.trim() !== "") cleaned.title = raw.title.trim();
      if (typeof raw.description === "string" && raw.description.trim() !== "") cleaned.description = raw.description.trim();
      if (typeof raw.dueAt === "string" && raw.dueAt.trim() !== "") cleaned.dueAt = raw.dueAt;
      if (raw.priority !== undefined && raw.priority !== "") cleaned.priority = raw.priority;
      if (typeof raw.notificationPolicy === "string" && raw.notificationPolicy.trim() !== "") {
        const resolvedId = await resolvePolicyId(raw.notificationPolicy);
        if (resolvedId) cleaned.notificationPolicyId = resolvedId;
      }
      if (raw.alarmEnabled !== undefined && raw.alarmEnabled !== "") {
        cleaned.alarmEnabled = typeof raw.alarmEnabled === "string" ? raw.alarmEnabled.trim().toLowerCase() === "true" : raw.alarmEnabled;
      }

      const patch = updateTaskSchema.parse(cleaned);
      const item = await store.updateTaskByNumber(command.number, patch);
      const policies = await store.listNotificationPolicies();
      return response(command.intent, { item: item ? withPolicyName(item, policies) : item });
    }

    const cleaned: Record<string, unknown> = {};
    if (typeof raw.title === "string" && raw.title.trim() !== "") cleaned.title = raw.title.trim();
    if (typeof raw.description === "string" && raw.description.trim() !== "") cleaned.description = raw.description.trim();
    if (typeof raw.startsAt === "string" && raw.startsAt.trim() !== "") cleaned.startsAt = raw.startsAt;
    if (typeof raw.endsAt === "string" && raw.endsAt.trim() !== "") cleaned.endsAt = raw.endsAt;
    if (typeof raw.location === "string" && raw.location.trim() !== "") cleaned.location = raw.location.trim();
    if (typeof raw.notificationPolicy === "string" && raw.notificationPolicy.trim() !== "") {
      const resolvedId = await resolvePolicyId(raw.notificationPolicy);
      if (resolvedId) cleaned.notificationPolicyId = resolvedId;
    }
    if (raw.alarmEnabled !== undefined && raw.alarmEnabled !== "") {
      cleaned.alarmEnabled = typeof raw.alarmEnabled === "string" ? raw.alarmEnabled.trim().toLowerCase() === "true" : raw.alarmEnabled;
    }

    const patch = updateEventSchema.parse(cleaned);
    const item = await store.updateEventByNumber(command.number, patch);
    const policies = await store.listNotificationPolicies();
    return response(command.intent, { item: item ? withPolicyName(item, policies) : item });
  }
  const items = await store.listItems(command.filters);
  const policies = await store.listNotificationPolicies();
  const detail = command.filters.detail ?? "simple";
  return response(command.intent, {
    items: items.map((item) => {
      const withPolicy = withPolicyName(item, policies);
      return detail === "advanced" ? withPolicy : toListSummary(withPolicy);
    })
  });
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const message = error instanceof Error ? error.message : "Unexpected error";
  reply.code(400).send({
    ok: false,
    errors: [{ message }],
    warnings: [],
    meta: { request_id: crypto.randomUUID(), processed_at: new Date().toISOString() }
  });
});

app.listen({ port: config.port, host: "0.0.0.0" });
startScheduler();
