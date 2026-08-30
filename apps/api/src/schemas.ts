import { z } from "zod";

// O agente de IA (n8n) manda string vazia "" pra dizer "esse campo opcional
// nao se aplica" (e o jeito que instruimos ele a fazer, ja que a definicao
// de tool nao tem um jeito confiavel de simplesmente omitir a chave). Sem
// isso, "" cai em z.string().datetime() ou z.coerce.number() e quebra a
// validacao mesmo o campo sendo opcional. Aplicado em todo campo opcional
// que a IA preenche.
const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const createTaskSchema = z.object({
  title: z.string().trim().min(1),
  description: emptyToUndefined(z.string().trim()),
  dueAt: emptyToUndefined(z.string().datetime()),
  priority: z.coerce.number().int().min(1).max(5).default(3),
  source: z.enum(["front", "n8n", "api"]).default("front"),
  originalMessage: z.string().optional(),
  notificationPolicyId: z.string().uuid().optional()
});

export const createEventSchema = z.object({
  title: z.string().trim().min(1),
  description: emptyToUndefined(z.string().trim()),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  location: emptyToUndefined(z.string().trim()),
  source: z.enum(["front", "n8n", "api"]).default("front"),
  originalMessage: z.string().optional(),
  notificationPolicyId: z.string().uuid().optional()
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().optional(),
    dueAt: z.string().datetime().optional(),
    priority: z.coerce.number().int().min(1).max(5).optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Informe ao menos um campo para atualizar" });

export const updateEventSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    location: z.string().trim().optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Informe ao menos um campo para atualizar" })
  .refine((data) => !(data.startsAt && data.endsAt) || new Date(data.endsAt) > new Date(data.startsAt), {
    message: "endsAt deve ser depois de startsAt"
  });

export const listItemsQuerySchema = z.object({
  type: z.enum(["task", "event", "all"]).default("all"),
  status: emptyToUndefined(z.string()),
  priority: emptyToUndefined(z.coerce.number().int().min(1).max(5)),
  period_start: emptyToUndefined(z.string().datetime()),
  period_end: emptyToUndefined(z.string().datetime()),
  q: emptyToUndefined(z.string().trim()),
  // limit/order cobrem busca por quantidade em vez de por periodo (ex: "os
  // ultimos 10 eventos", "so 5 tarefas") - independente de period_start/end.
  limit: emptyToUndefined(z.coerce.number().int().min(1).max(200)),
  order: emptyToUndefined(z.enum(["asc", "desc"]))
});

export const commandSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create_task"),
    payload: createTaskSchema
  }),
  z.object({
    intent: z.literal("create_event"),
    payload: createEventSchema
  }),
  z.object({
    intent: z.literal("complete_task"),
    task_numbers: z.array(z.number().int().positive()).min(1)
  }),
  z.object({
    intent: z.literal("archive_task"),
    task_numbers: z.array(z.number().int().positive()).min(1)
  }),
  z.object({
    intent: z.literal("delete_task"),
    task_numbers: z.array(z.number().int().positive()).min(1)
  }),
  z.object({
    intent: z.literal("get_task"),
    task_number: z.number().int().positive()
  }),
  z.object({
    intent: z.literal("update_task"),
    task_number: z.number().int().positive(),
    // Campos soltos (nao usa updateTaskSchema aqui de proposito): a IA manda
    // string vazia pra "nao mudei esse campo", e o server.ts filtra isso
    // antes de validar de verdade com updateTaskSchema. Se validasse direto
    // aqui, "" passaria e sobrescreveria o campo com vazio.
    patch: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      dueAt: z.string().optional(),
      priority: z.union([z.string(), z.number()]).optional()
    })
  }),
  z.object({
    intent: z.literal("list_items"),
    filters: listItemsQuerySchema
  })
]);

