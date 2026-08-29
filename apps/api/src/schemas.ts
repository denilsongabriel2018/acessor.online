import { z } from "zod";

export const createTaskSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  dueAt: z.string().datetime().optional(),
  priority: z.coerce.number().int().min(1).max(5).default(3),
  source: z.enum(["front", "n8n", "api"]).default("front"),
  originalMessage: z.string().optional(),
  notificationPolicyId: z.string().uuid().optional()
});

export const createEventSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  location: z.string().trim().optional(),
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
  status: z.string().optional(),
  priority: z.coerce.number().int().min(1).max(5).optional(),
  period_start: z.string().datetime().optional(),
  period_end: z.string().datetime().optional(),
  q: z.string().trim().optional()
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
    intent: z.literal("list_items"),
    filters: listItemsQuerySchema
  })
]);

