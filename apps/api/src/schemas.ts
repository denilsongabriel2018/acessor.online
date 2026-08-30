import { z } from "zod";

// O agente de IA (n8n) manda string vazia "" pra dizer "esse campo opcional
// nao se aplica" (e o jeito que instruimos ele a fazer, ja que a definicao
// de tool nao tem um jeito confiavel de simplesmente omitir a chave). Sem
// isso, "" cai em z.string().datetime() ou z.coerce.number() e quebra a
// validacao mesmo o campo sendo opcional. Aplicado em todo campo opcional
// que a IA preenche.
const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

// A IA por vezes manda uma lista de numeros como string separada por virgula
// (ex: "1,2") em vez de array de verdade ([1, 2]) - o formato exato do
// function-calling nem sempre bate com o que pedimos na descricao do tool.
// Aceita os dois formatos em vez de depender da IA acertar sempre.
const flexibleNumberList = z.preprocess((value) => {
  if (Array.isArray(value)) return value.map((item) => Number(item));
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => !Number.isNaN(item));
  }
  if (typeof value === "number") return [value];
  return value;
}, z.array(z.number().int().positive()).min(1));

// Nomes fixos das 3 politicas seedadas (ver migration 001) - a IA/usuario
// escolhe por nome, nao por UUID; server.ts resolve o nome pro id de verdade.
export const notificationPolicyNameSchema = z.enum(["leve", "normal", "intenso"]);

// A IA manda booleano como string ("true"/"false") na maioria das vezes -
// string vazia = "nao especificou" (cai no default), qualquer outra string
// e comparada por igualdade com "true" pra virar boolean de verdade.
const flexibleBoolean = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === "" || value === undefined) return undefined;
    if (typeof value === "string") return value.trim().toLowerCase() === "true";
    return value;
  }, z.boolean().default(defaultValue));

export const createTaskSchema = z.object({
  title: z.string().trim().min(1),
  description: emptyToUndefined(z.string().trim()),
  dueAt: emptyToUndefined(z.string().datetime()),
  priority: z.coerce.number().int().min(1).max(5).default(3),
  source: z.enum(["front", "n8n", "api"]).default("front"),
  originalMessage: z.string().optional(),
  notificationPolicyId: z.string().optional(),
  notificationPolicy: emptyToUndefined(notificationPolicyNameSchema),
  alarmEnabled: flexibleBoolean(true)
});

export const createEventSchema = z.object({
  title: z.string().trim().min(1),
  description: emptyToUndefined(z.string().trim()),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  location: emptyToUndefined(z.string().trim()),
  source: z.enum(["front", "n8n", "api"]).default("front"),
  originalMessage: z.string().optional(),
  notificationPolicyId: z.string().optional(),
  notificationPolicy: emptyToUndefined(notificationPolicyNameSchema),
  alarmEnabled: flexibleBoolean(true)
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().optional(),
    dueAt: z.string().datetime().optional(),
    priority: z.coerce.number().int().min(1).max(5).optional(),
    notificationPolicyId: z.string().optional(),
    alarmEnabled: z.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Informe ao menos um campo para atualizar" });

export const updateEventSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    location: z.string().trim().optional(),
    notificationPolicyId: z.string().optional(),
    alarmEnabled: z.boolean().optional()
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
  order: emptyToUndefined(z.enum(["asc", "desc"])),
  // "simple" (padrao no /api/commands) devolve so os campos essenciais por
  // item - cada campo a mais numa listagem e tokens a mais multiplicados
  // pela quantidade de itens, o que pesa no custo/velocidade da IA. "advanced"
  // devolve o item completo. /api/items (site) ignora esse campo e sempre
  // devolve completo, independente do que vier aqui.
  detail: emptyToUndefined(z.enum(["simple", "advanced"]))
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
    task_numbers: flexibleNumberList
  }),
  // archive/delete/get/update sao unificados (item_type: "task" | "event")
  // em vez de um par de intents por tipo - a API ja sabe rotear pro store
  // certo, entao nao faz sentido duplicar isso no agente de IA/n8n como 8
  // ferramentas quase identicas quando 4 bastam.
  z.object({
    intent: z.literal("archive_item"),
    item_type: z.enum(["task", "event"]),
    numbers: flexibleNumberList
  }),
  z.object({
    intent: z.literal("delete_item"),
    item_type: z.enum(["task", "event"]),
    numbers: flexibleNumberList
  }),
  z.object({
    intent: z.literal("get_item"),
    item_type: z.enum(["task", "event"]),
    number: z.coerce.number().int().positive()
  }),
  z.object({
    intent: z.literal("update_item"),
    item_type: z.enum(["task", "event"]),
    number: z.coerce.number().int().positive(),
    // Campos soltos de tarefa e evento juntos (nao usa updateTaskSchema/
    // updateEventSchema aqui de proposito): a IA manda string vazia pra "nao
    // mudei esse campo", e o server.ts filtra isso e escolhe os campos certos
    // pro item_type antes de validar de verdade.
    patch: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      dueAt: z.string().optional(),
      priority: z.union([z.string(), z.number()]).optional(),
      startsAt: z.string().optional(),
      endsAt: z.string().optional(),
      location: z.string().optional(),
      // Nome da politica ("leve"/"normal"/"intenso"), string vazia = nao muda.
      // Resolvido pro id de verdade no server.ts antes de validar com
      // updateTaskSchema/updateEventSchema.
      notificationPolicy: z.string().optional(),
      // "true"/"false" como string (ou boolean de verdade), string vazia =
      // nao muda. Convertido pro tipo certo no server.ts.
      alarmEnabled: z.union([z.string(), z.boolean()]).optional()
    })
  }),
  z.object({
    intent: z.literal("list_items"),
    filters: listItemsQuerySchema
  })
]);

