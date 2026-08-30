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
    return response(command.intent, { task: await store.createTask(command.payload) });
  }
  if (command.intent === "create_event") {
    return response(command.intent, { event: await store.createEvent(command.payload) });
  }
  if (command.intent === "complete_task") {
    return response(command.intent, await store.completeTasks(command.task_numbers));
  }
  if (command.intent === "archive_item") {
    const result =
      command.item_type === "task"
        ? await store.archiveTasks(command.numbers)
        : await store.archiveEvents(command.numbers);
    return response(command.intent, result);
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
    return response(command.intent, { item });
  }
  if (command.intent === "update_item") {
    const raw = command.patch;
    if (command.item_type === "task") {
      const cleaned: Record<string, unknown> = {};
      if (typeof raw.title === "string" && raw.title.trim() !== "") cleaned.title = raw.title.trim();
      if (typeof raw.description === "string" && raw.description.trim() !== "") cleaned.description = raw.description.trim();
      if (typeof raw.dueAt === "string" && raw.dueAt.trim() !== "") cleaned.dueAt = raw.dueAt;
      if (raw.priority !== undefined && raw.priority !== "") cleaned.priority = raw.priority;

      const patch = updateTaskSchema.parse(cleaned);
      const item = await store.updateTaskByNumber(command.number, patch);
      return response(command.intent, { item });
    }

    const cleaned: Record<string, unknown> = {};
    if (typeof raw.title === "string" && raw.title.trim() !== "") cleaned.title = raw.title.trim();
    if (typeof raw.description === "string" && raw.description.trim() !== "") cleaned.description = raw.description.trim();
    if (typeof raw.startsAt === "string" && raw.startsAt.trim() !== "") cleaned.startsAt = raw.startsAt;
    if (typeof raw.endsAt === "string" && raw.endsAt.trim() !== "") cleaned.endsAt = raw.endsAt;
    if (typeof raw.location === "string" && raw.location.trim() !== "") cleaned.location = raw.location.trim();

    const patch = updateEventSchema.parse(cleaned);
    const item = await store.updateEventByNumber(command.number, patch);
    return response(command.intent, { item });
  }
  return response(command.intent, { items: await store.listItems(command.filters) });
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
