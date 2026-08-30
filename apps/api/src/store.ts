import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { computeSchedule } from "./notifications.js";
import { createSupabaseAdmin } from "./supabase.js";
import type {
  CalendarEvent,
  ItemListRow,
  NotificationPolicy,
  NotificationStatus,
  ScheduledNotification,
  Task
} from "./types.js";

const workspaceId = config.defaultWorkspaceId;
let nextTaskNumber = 1;
let nextEventNumber = 1;

const nowIso = () => new Date().toISOString();
const tasks: Task[] = [];
const events: CalendarEvent[] = [];
const scheduledNotifications: ScheduledNotification[] = [];

function pickPolicy(policies: NotificationPolicy[], policyId?: string) {
  if (policyId) return policies.find((policy) => policy.id === policyId);
  return policies.find((policy) => policy.isDefault) || policies[0];
}

// Mirrors the presets seeded in supabase/migrations/001_initial_schema.sql so
// the "Automações" view has something to show even with STORAGE_DRIVER=memory.
const memoryNotificationPolicies: NotificationPolicy[] = [
  {
    id: "mem-policy-leve",
    name: "Leve",
    description: "Poucos avisos: 1h e 10min antes do prazo; se passar, avisa 1h depois e insiste a cada 24h ate voce concluir.",
    isDefault: false,
    rules: [
      { id: "mem-rule-1", policyId: "mem-policy-leve", kind: "before_due", offsetMinutes: -60, enabled: true },
      { id: "mem-rule-2", policyId: "mem-policy-leve", kind: "before_due", offsetMinutes: -10, enabled: true },
      { id: "mem-rule-3", policyId: "mem-policy-leve", kind: "after_due", offsetMinutes: 60, enabled: true },
      {
        id: "mem-rule-4",
        policyId: "mem-policy-leve",
        kind: "repeat_until_done",
        startAfterMinutes: 60,
        repeatEveryMinutes: 1440,
        enabled: true
      }
    ]
  },
  {
    id: "mem-policy-normal",
    name: "Normal",
    description: "Equilibrio: avisa 3h, 1h e 30min antes do prazo; se passar, avisa 1h e 3h depois e insiste a cada 12h ate concluir; tambem manda um resumo diario as 8h30.",
    isDefault: true,
    rules: [
      { id: "mem-rule-5", policyId: "mem-policy-normal", kind: "before_due", offsetMinutes: -180, enabled: true },
      { id: "mem-rule-6", policyId: "mem-policy-normal", kind: "before_due", offsetMinutes: -60, enabled: true },
      { id: "mem-rule-7", policyId: "mem-policy-normal", kind: "before_due", offsetMinutes: -30, enabled: true },
      { id: "mem-rule-8", policyId: "mem-policy-normal", kind: "after_due", offsetMinutes: 60, enabled: true },
      { id: "mem-rule-9", policyId: "mem-policy-normal", kind: "after_due", offsetMinutes: 180, enabled: true },
      {
        id: "mem-rule-10",
        policyId: "mem-policy-normal",
        kind: "repeat_until_done",
        startAfterMinutes: 180,
        repeatEveryMinutes: 720,
        enabled: true
      },
      { id: "mem-rule-11", policyId: "mem-policy-normal", kind: "daily_summary", timeOfDay: "08:30", enabled: true }
    ]
  },
  {
    id: "mem-policy-intenso",
    name: "Intenso",
    description: "Maxima insistencia: avisa 10h, 3h, 1h, 30min, 5min e 1min antes do prazo; se passar, avisa 1h e 3h depois e insiste a cada 6h ate voce concluir.",
    isDefault: false,
    rules: [
      { id: "mem-rule-12", policyId: "mem-policy-intenso", kind: "before_due", offsetMinutes: -600, enabled: true },
      { id: "mem-rule-13", policyId: "mem-policy-intenso", kind: "before_due", offsetMinutes: -180, enabled: true },
      { id: "mem-rule-14", policyId: "mem-policy-intenso", kind: "before_due", offsetMinutes: -60, enabled: true },
      { id: "mem-rule-15", policyId: "mem-policy-intenso", kind: "before_due", offsetMinutes: -30, enabled: true },
      { id: "mem-rule-16", policyId: "mem-policy-intenso", kind: "before_due", offsetMinutes: -5, enabled: true },
      { id: "mem-rule-17", policyId: "mem-policy-intenso", kind: "before_due", offsetMinutes: -1, enabled: true },
      { id: "mem-rule-18", policyId: "mem-policy-intenso", kind: "after_due", offsetMinutes: 60, enabled: true },
      { id: "mem-rule-19", policyId: "mem-policy-intenso", kind: "after_due", offsetMinutes: 180, enabled: true },
      {
        id: "mem-rule-20",
        policyId: "mem-policy-intenso",
        kind: "repeat_until_done",
        startAfterMinutes: 180,
        repeatEveryMinutes: 360,
        enabled: true
      }
    ]
  }
];

function inPeriod(value: string | undefined, start?: string, end?: string) {
  if (!value) return !start && !end;
  const time = new Date(value).getTime();
  if (start && time < new Date(start).getTime()) return false;
  if (end && time > new Date(end).getTime()) return false;
  return true;
}

export const store = {
  async createTask(input: Omit<Task, "id" | "workspaceId" | "number" | "status" | "createdAt" | "updatedAt">) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.createTask(input);
    }

    const task: Task = {
      id: randomUUID(),
      workspaceId,
      number: nextTaskNumber++,
      status: "pending",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...input
    };
    tasks.push(task);
    await store.scheduleNotificationsForItem("task", task.id, task.dueAt, task.notificationPolicyId, task.alarmEnabled);
    return task;
  },

  async createEvent(input: Omit<CalendarEvent, "id" | "workspaceId" | "number" | "status" | "createdAt" | "updatedAt">) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.createEvent(input);
    }

    const event: CalendarEvent = {
      id: randomUUID(),
      workspaceId,
      number: nextEventNumber++,
      status: "scheduled",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...input
    };
    events.push(event);
    await store.scheduleNotificationsForItem("event", event.id, event.startsAt, event.notificationPolicyId, event.alarmEnabled);
    return event;
  },

  async completeTaskById(id: string) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.completeTaskById(id);
    }

    const task = tasks.find((item) => item.id === id && item.status !== "cancelled");
    if (!task) return undefined;
    task.status = "completed";
    task.completedAt = nowIso();
    task.updatedAt = nowIso();
    await store.clearPendingNotifications("task", task.id);
    return task;
  },

  async archiveTaskById(id: string) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.archiveTaskById(id);
    }

    const task = tasks.find((item) => item.id === id && item.status !== "cancelled");
    if (!task) return undefined;
    task.status = "archived";
    task.updatedAt = nowIso();
    await store.clearPendingNotifications("task", task.id);
    return task;
  },

  async updateTaskById(id: string, patch: Partial<Pick<Task, "title" | "description" | "dueAt" | "priority" | "notificationPolicyId" | "alarmEnabled">>) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.updateTaskById(id, patch);
    }

    const task = tasks.find((item) => item.id === id && item.status !== "cancelled");
    if (!task) return undefined;
    Object.assign(task, patch, { updatedAt: nowIso() });
    if (patch.dueAt !== undefined || patch.notificationPolicyId !== undefined || patch.alarmEnabled !== undefined) {
      await store.clearPendingNotifications("task", task.id);
      await store.scheduleNotificationsForItem("task", task.id, task.dueAt, task.notificationPolicyId, task.alarmEnabled);
    }
    return task;
  },

  async cancelTaskById(id: string) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.cancelTaskById(id);
    }

    const task = tasks.find((item) => item.id === id);
    if (!task) return undefined;
    task.status = "cancelled";
    task.updatedAt = nowIso();
    await store.clearPendingNotifications("task", task.id);
    return task;
  },

  async deleteTaskById(id: string) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.deleteTaskById(id);
    }

    const index = tasks.findIndex((item) => item.id === id);
    if (index === -1) return false;
    tasks.splice(index, 1);
    await store.clearPendingNotifications("task", id);
    return true;
  },

  async updateEventById(
    id: string,
    patch: Partial<Pick<CalendarEvent, "title" | "description" | "startsAt" | "endsAt" | "location" | "notificationPolicyId" | "alarmEnabled">>
  ) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.updateEventById(id, patch);
    }

    const event = events.find((item) => item.id === id && item.status !== "cancelled");
    if (!event) return undefined;
    Object.assign(event, patch, { updatedAt: nowIso() });
    if (patch.startsAt !== undefined || patch.notificationPolicyId !== undefined || patch.alarmEnabled !== undefined) {
      await store.clearPendingNotifications("event", event.id);
      await store.scheduleNotificationsForItem("event", event.id, event.startsAt, event.notificationPolicyId, event.alarmEnabled);
    }
    return event;
  },

  async cancelEventById(id: string) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.cancelEventById(id);
    }

    const event = events.find((item) => item.id === id);
    if (!event) return undefined;
    event.status = "cancelled";
    event.updatedAt = nowIso();
    await store.clearPendingNotifications("event", event.id);
    return event;
  },

  async archiveEventById(id: string) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.archiveEventById(id);
    }

    const event = events.find((item) => item.id === id && item.status !== "cancelled");
    if (!event) return undefined;
    event.status = "archived";
    event.updatedAt = nowIso();
    await store.clearPendingNotifications("event", event.id);
    return event;
  },

  async deleteEventById(id: string) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.deleteEventById(id);
    }

    const index = events.findIndex((item) => item.id === id);
    if (index === -1) return false;
    events.splice(index, 1);
    await store.clearPendingNotifications("event", id);
    return true;
  },

  async archiveEvents(numbers: number[]) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.archiveEvents(numbers);
    }

    const archived: CalendarEvent[] = [];
    const notFound: number[] = [];

    for (const number of numbers) {
      const event = events.find((item) => item.number === number && item.status !== "cancelled");
      if (!event) {
        notFound.push(number);
        continue;
      }
      event.status = "archived";
      event.updatedAt = nowIso();
      await store.clearPendingNotifications("event", event.id);
      archived.push(event);
    }

    return { archived, notFound };
  },

  async deleteEvents(numbers: number[]) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.deleteEvents(numbers);
    }

    const deleted: number[] = [];
    const notFound: number[] = [];

    for (const number of numbers) {
      const index = events.findIndex((item) => item.number === number);
      if (index === -1) {
        notFound.push(number);
        continue;
      }
      const [event] = events.splice(index, 1);
      await store.clearPendingNotifications("event", event.id);
      deleted.push(number);
    }

    return { deleted, notFound };
  },

  async getEventByNumber(number: number) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.getEventByNumber(number);
    }
    return events.find((item) => item.number === number);
  },

  async updateEventByNumber(
    number: number,
    patch: Partial<Pick<CalendarEvent, "title" | "description" | "startsAt" | "endsAt" | "location" | "notificationPolicyId" | "alarmEnabled">>
  ) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.updateEventByNumber(number, patch);
    }

    const event = events.find((item) => item.number === number && item.status !== "cancelled");
    if (!event) return undefined;
    Object.assign(event, patch, { updatedAt: nowIso() });
    if (patch.startsAt !== undefined || patch.notificationPolicyId !== undefined || patch.alarmEnabled !== undefined) {
      await store.clearPendingNotifications("event", event.id);
      await store.scheduleNotificationsForItem("event", event.id, event.startsAt, event.notificationPolicyId, event.alarmEnabled);
    }
    return event;
  },

  async completeTasks(numbers: number[]) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.completeTasks(numbers);
    }

    const completed: Task[] = [];
    const notFound: number[] = [];

    for (const number of numbers) {
      const task = tasks.find((item) => item.number === number && item.status !== "cancelled");
      if (!task) {
        notFound.push(number);
        continue;
      }
      task.status = "completed";
      task.completedAt = nowIso();
      task.updatedAt = nowIso();
      await store.clearPendingNotifications("task", task.id);
      completed.push(task);
    }

    return {
      completed,
      notFound,
      stillPendingCount: tasks.filter((task) => task.status === "pending" || task.status === "in_progress").length
    };
  },

  async archiveTasks(numbers: number[]) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.archiveTasks(numbers);
    }

    const archived: Task[] = [];
    const notFound: number[] = [];

    for (const number of numbers) {
      const task = tasks.find((item) => item.number === number && item.status !== "cancelled");
      if (!task) {
        notFound.push(number);
        continue;
      }
      task.status = "archived";
      task.updatedAt = nowIso();
      await store.clearPendingNotifications("task", task.id);
      archived.push(task);
    }

    return { archived, notFound };
  },

  async deleteTasks(numbers: number[]) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.deleteTasks(numbers);
    }

    const deleted: number[] = [];
    const notFound: number[] = [];

    for (const number of numbers) {
      const index = tasks.findIndex((item) => item.number === number);
      if (index === -1) {
        notFound.push(number);
        continue;
      }
      const [task] = tasks.splice(index, 1);
      await store.clearPendingNotifications("task", task.id);
      deleted.push(number);
    }

    return { deleted, notFound };
  },

  async getTaskByNumber(number: number) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.getTaskByNumber(number);
    }
    return tasks.find((item) => item.number === number);
  },

  async updateTaskByNumber(number: number, patch: Partial<Pick<Task, "title" | "description" | "dueAt" | "priority" | "notificationPolicyId" | "alarmEnabled">>) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.updateTaskByNumber(number, patch);
    }

    const task = tasks.find((item) => item.number === number && item.status !== "cancelled");
    if (!task) return undefined;
    Object.assign(task, patch, { updatedAt: nowIso() });
    if (patch.dueAt !== undefined || patch.notificationPolicyId !== undefined || patch.alarmEnabled !== undefined) {
      await store.clearPendingNotifications("task", task.id);
      await store.scheduleNotificationsForItem("task", task.id, task.dueAt, task.notificationPolicyId, task.alarmEnabled);
    }
    return task;
  },

  async listItems(filters: {
    type?: "task" | "event" | "all";
    status?: string;
    priority?: number;
    period_start?: string;
    period_end?: string;
    q?: string;
    limit?: number;
    order?: "asc" | "desc";
  }): Promise<ItemListRow[]> {
    if (config.storageDriver === "supabase") {
      return supabaseStore.listItems(filters);
    }

    const query = filters.q?.toLowerCase();
    const rows: ItemListRow[] = [];

    if (filters.type !== "event") {
      rows.push(
        ...tasks
          .filter((task) => !filters.status || task.status === filters.status)
          .filter((task) => !filters.priority || task.priority === filters.priority)
          .filter((task) => inPeriod(task.dueAt, filters.period_start, filters.period_end))
          .filter((task) => !query || task.title.toLowerCase().includes(query))
          .map((task) => ({ ...task, itemType: "task" as const }))
      );
    }

    if (filters.type !== "task") {
      rows.push(
        ...events
          .filter((event) => !filters.status || event.status === filters.status)
          .filter((event) => inPeriod(event.startsAt, filters.period_start, filters.period_end))
          .filter((event) => !query || event.title.toLowerCase().includes(query))
          .map((event) => ({ ...event, itemType: "event" as const }))
      );
    }

    const itemDate = (item: ItemListRow) => (item.itemType === "task" ? item.dueAt || item.createdAt : item.startsAt);

    // "order" pede busca por quantidade/recencia (ex: "ultimos 10 eventos"),
    // ordenando so por data, sem o desempate por prioridade que a listagem
    // por periodo usa - senao "ultimos 10" viraria "os 10 de maior prioridade".
    const sorted = filters.order
      ? rows.sort((a, b) => {
          const diff = new Date(itemDate(a)).getTime() - new Date(itemDate(b)).getTime();
          return filters.order === "desc" ? -diff : diff;
        })
      : rows.sort((a, b) => {
          if (a.itemType === "task" && b.itemType === "task") {
            return a.priority - b.priority || a.number - b.number;
          }
          return new Date(itemDate(a)).getTime() - new Date(itemDate(b)).getTime();
        });

    return filters.limit ? sorted.slice(0, filters.limit) : sorted;
  },

  async listNotificationPolicies(): Promise<NotificationPolicy[]> {
    if (config.storageDriver === "supabase") {
      return supabaseStore.listNotificationPolicies();
    }

    return memoryNotificationPolicies;
  },

  async getTaskById(id: string) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.getTaskById(id);
    }
    return tasks.find((item) => item.id === id);
  },

  async getEventById(id: string) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.getEventById(id);
    }
    return events.find((item) => item.id === id);
  },

  // Calcula e grava os avisos de uma task/evento a partir da politica dele
  // (ou da politica padrao do workspace, se nenhuma for informada).
  async scheduleNotificationsForItem(
    itemType: "task" | "event",
    itemId: string,
    anchorIso: string | undefined,
    policyId?: string,
    alarmEnabled = true
  ) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.scheduleNotificationsForItem(itemType, itemId, anchorIso, policyId, alarmEnabled);
    }
    if (!anchorIso || !alarmEnabled) return;

    const policy = pickPolicy(memoryNotificationPolicies, policyId);
    if (!policy) return;

    const rows = computeSchedule(policy.rules, anchorIso, itemType);
    const createdAt = nowIso();
    for (const row of rows) {
      scheduledNotifications.push({
        id: randomUUID(),
        workspaceId,
        itemType,
        itemId,
        notificationKind: row.kind,
        scheduledFor: row.scheduledFor,
        status: "pending",
        attemptCount: 0,
        payload: row.repeatEveryMinutes ? { repeatEveryMinutes: row.repeatEveryMinutes } : {},
        createdAt,
        updatedAt: createdAt
      });
    }
  },

  // Remove avisos ainda nao disparados de um item - usado quando ele e
  // reagendado (os antigos nao fazem mais sentido) ou sai de circulacao
  // (concluido, cancelado, arquivado, apagado).
  async clearPendingNotifications(itemType: "task" | "event", itemId: string) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.clearPendingNotifications(itemType, itemId);
    }
    for (let index = scheduledNotifications.length - 1; index >= 0; index -= 1) {
      const notification = scheduledNotifications[index];
      if (notification.itemType === itemType && notification.itemId === itemId && notification.status === "pending") {
        scheduledNotifications.splice(index, 1);
      }
    }
  },

  async listDueNotifications(): Promise<ScheduledNotification[]> {
    if (config.storageDriver === "supabase") {
      return supabaseStore.listDueNotifications();
    }
    const now = nowIso();
    return scheduledNotifications.filter((notification) => notification.status === "pending" && notification.scheduledFor <= now);
  },

  async markNotification(id: string, status: NotificationStatus) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.markNotification(id, status);
    }
    const notification = scheduledNotifications.find((item) => item.id === id);
    if (!notification) return;
    notification.status = status;
    notification.attemptCount += 1;
    notification.updatedAt = nowIso();
    if (status === "sent") notification.sentAt = nowIso();
  },

  // Uma regra repeat_until_done gera a proxima ocorrencia so quando a
  // anterior dispara e o item ainda nao foi concluido.
  async scheduleNextOccurrence(notification: ScheduledNotification) {
    if (config.storageDriver === "supabase") {
      return supabaseStore.scheduleNextOccurrence(notification);
    }
    const everyMinutes = Number(notification.payload.repeatEveryMinutes ?? 1440);
    const nextAt = new Date(new Date(notification.scheduledFor).getTime() + everyMinutes * 60000).toISOString();
    const createdAt = nowIso();
    scheduledNotifications.push({
      id: randomUUID(),
      workspaceId: notification.workspaceId,
      itemType: notification.itemType,
      itemId: notification.itemId,
      notificationKind: notification.notificationKind,
      scheduledFor: nextAt,
      status: "pending",
      attemptCount: 0,
      payload: notification.payload,
      createdAt,
      updatedAt: createdAt
    });
  }
};

function mapTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    number: Number(row.number),
    title: String(row.title),
    description: row.description ? String(row.description) : undefined,
    status: row.status as Task["status"],
    priority: Number(row.priority),
    dueAt: row.due_at ? String(row.due_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    source: row.source as Task["source"],
    originalMessage: row.original_message ? String(row.original_message) : undefined,
    notificationPolicyId: row.notification_policy_id ? String(row.notification_policy_id) : undefined,
    alarmEnabled: row.alarm_enabled !== false,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapEvent(row: Record<string, unknown>): CalendarEvent {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    number: Number(row.number),
    title: String(row.title),
    description: row.description ? String(row.description) : undefined,
    status: row.status as CalendarEvent["status"],
    startsAt: String(row.starts_at),
    endsAt: String(row.ends_at),
    location: row.location ? String(row.location) : undefined,
    source: row.source as CalendarEvent["source"],
    originalMessage: row.original_message ? String(row.original_message) : undefined,
    notificationPolicyId: row.notification_policy_id ? String(row.notification_policy_id) : undefined,
    alarmEnabled: row.alarm_enabled !== false,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapScheduledNotification(row: Record<string, unknown>): ScheduledNotification {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    itemType: row.item_type as "task" | "event",
    itemId: String(row.item_id),
    notificationKind: row.notification_kind as ScheduledNotification["notificationKind"],
    scheduledFor: String(row.scheduled_for),
    status: row.status as NotificationStatus,
    attemptCount: Number(row.attempt_count || 0),
    payload: (row.payload as Record<string, unknown>) || {},
    sentAt: row.sent_at ? String(row.sent_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

const supabaseStore = {
  async createTask(input: Omit<Task, "id" | "workspaceId" | "number" | "status" | "createdAt" | "updatedAt">) {
    const supabase = createSupabaseAdmin();
    const { data: latest, error: latestError } = await supabase
      .from("tasks")
      .select("number")
      .eq("workspace_id", workspaceId)
      .order("number", { ascending: false })
      .limit(1);

    if (latestError) throw latestError;
    const number = Number(latest?.[0]?.number || 0) + 1;

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        workspace_id: workspaceId,
        number,
        title: input.title,
        description: input.description,
        priority: input.priority,
        due_at: input.dueAt,
        source: input.source,
        original_message: input.originalMessage,
        notification_policy_id: input.notificationPolicyId,
        alarm_enabled: input.alarmEnabled
      })
      .select("*")
      .single();

    if (error) throw error;
    const task = mapTask(data);
    await store.scheduleNotificationsForItem("task", task.id, task.dueAt, task.notificationPolicyId, task.alarmEnabled);
    return task;
  },

  async createEvent(input: Omit<CalendarEvent, "id" | "workspaceId" | "number" | "status" | "createdAt" | "updatedAt">) {
    const supabase = createSupabaseAdmin();
    const { data: latest, error: latestError } = await supabase
      .from("events")
      .select("number")
      .eq("workspace_id", workspaceId)
      .order("number", { ascending: false })
      .limit(1);

    if (latestError) throw latestError;
    const number = Number(latest?.[0]?.number || 0) + 1;

    const { data, error } = await supabase
      .from("events")
      .insert({
        workspace_id: workspaceId,
        number,
        title: input.title,
        description: input.description,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        location: input.location,
        source: input.source,
        original_message: input.originalMessage,
        notification_policy_id: input.notificationPolicyId,
        alarm_enabled: input.alarmEnabled
      })
      .select("*")
      .single();

    if (error) throw error;
    const event = mapEvent(data);
    await store.scheduleNotificationsForItem("event", event.id, event.startsAt, event.notificationPolicyId, event.alarmEnabled);
    return event;
  },

  async completeTasks(numbers: number[]) {
    const supabase = createSupabaseAdmin();
    const completedAt = nowIso();
    const { data: found, error: findError } = await supabase
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("number", numbers)
      .neq("status", "cancelled");

    if (findError) throw findError;

    const foundNumbers = new Set((found || []).map((task) => Number(task.number)));
    const notFound = numbers.filter((number) => !foundNumbers.has(number));

    const { data: updated, error: updateError } = await supabase
      .from("tasks")
      .update({ status: "completed", completed_at: completedAt, updated_at: completedAt })
      .eq("workspace_id", workspaceId)
      .in("number", [...foundNumbers])
      .select("*");

    if (updateError) throw updateError;

    for (const task of updated || []) {
      await store.clearPendingNotifications("task", String(task.id));
    }

    const { count, error: countError } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("status", ["pending", "in_progress"]);

    if (countError) throw countError;

    return {
      completed: (updated || []).map(mapTask),
      notFound,
      stillPendingCount: count || 0
    };
  },

  async archiveTasks(numbers: number[]) {
    const supabase = createSupabaseAdmin();
    const updatedAt = nowIso();
    const { data: found, error: findError } = await supabase
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("number", numbers)
      .neq("status", "cancelled");

    if (findError) throw findError;

    const foundNumbers = new Set((found || []).map((task) => Number(task.number)));
    const notFound = numbers.filter((number) => !foundNumbers.has(number));

    const { data: updated, error: updateError } = await supabase
      .from("tasks")
      .update({ status: "archived", updated_at: updatedAt })
      .eq("workspace_id", workspaceId)
      .in("number", [...foundNumbers])
      .select("*");

    if (updateError) throw updateError;

    for (const task of updated || []) {
      await store.clearPendingNotifications("task", String(task.id));
    }

    return { archived: (updated || []).map(mapTask), notFound };
  },

  async deleteTasks(numbers: number[]) {
    const supabase = createSupabaseAdmin();
    const { data: found, error: findError } = await supabase
      .from("tasks")
      .select("id, number")
      .eq("workspace_id", workspaceId)
      .in("number", numbers);

    if (findError) throw findError;

    const foundNumbers = new Set((found || []).map((task) => Number(task.number)));
    const notFound = numbers.filter((number) => !foundNumbers.has(number));

    const { error: deleteError } = await supabase
      .from("tasks")
      .delete()
      .eq("workspace_id", workspaceId)
      .in("number", [...foundNumbers]);

    if (deleteError) throw deleteError;

    for (const task of found || []) {
      await store.clearPendingNotifications("task", String(task.id));
    }

    return { deleted: [...foundNumbers], notFound };
  },

  async getTaskByNumber(number: number) {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("number", number)
      .maybeSingle();
    if (error) throw error;
    return data ? mapTask(data) : undefined;
  },

  async updateTaskByNumber(number: number, patch: Partial<Pick<Task, "title" | "description" | "dueAt" | "priority" | "notificationPolicyId" | "alarmEnabled">>) {
    const supabase = createSupabaseAdmin();
    const dbPatch: Record<string, unknown> = { updated_at: nowIso() };
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.dueAt !== undefined) dbPatch.due_at = patch.dueAt;
    if (patch.priority !== undefined) dbPatch.priority = patch.priority;
    if (patch.notificationPolicyId !== undefined) dbPatch.notification_policy_id = patch.notificationPolicyId;
    if (patch.alarmEnabled !== undefined) dbPatch.alarm_enabled = patch.alarmEnabled;

    const { data, error } = await supabase
      .from("tasks")
      .update(dbPatch)
      .eq("workspace_id", workspaceId)
      .eq("number", number)
      .neq("status", "cancelled")
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) return undefined;
    const task = mapTask(data);
    if (patch.dueAt !== undefined || patch.notificationPolicyId !== undefined || patch.alarmEnabled !== undefined) {
      await store.clearPendingNotifications("task", task.id);
      await store.scheduleNotificationsForItem("task", task.id, task.dueAt, task.notificationPolicyId, task.alarmEnabled);
    }
    return task;
  },

  async completeTaskById(id: string) {
    const supabase = createSupabaseAdmin();
    const completedAt = nowIso();
    const { data, error } = await supabase
      .from("tasks")
      .update({ status: "completed", completed_at: completedAt, updated_at: completedAt })
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .neq("status", "cancelled")
      .select("*")
      .single();

    if (error) throw error;
    await store.clearPendingNotifications("task", id);
    return mapTask(data);
  },

  async archiveTaskById(id: string) {
    const supabase = createSupabaseAdmin();
    const updatedAt = nowIso();
    const { data, error } = await supabase
      .from("tasks")
      .update({ status: "archived", updated_at: updatedAt })
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .neq("status", "cancelled")
      .select("*")
      .single();

    if (error) throw error;
    await store.clearPendingNotifications("task", id);
    return mapTask(data);
  },

  async updateTaskById(id: string, patch: Partial<Pick<Task, "title" | "description" | "dueAt" | "priority" | "notificationPolicyId" | "alarmEnabled">>) {
    const supabase = createSupabaseAdmin();
    const dbPatch: Record<string, unknown> = { updated_at: nowIso() };
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.dueAt !== undefined) dbPatch.due_at = patch.dueAt;
    if (patch.priority !== undefined) dbPatch.priority = patch.priority;
    if (patch.notificationPolicyId !== undefined) dbPatch.notification_policy_id = patch.notificationPolicyId;
    if (patch.alarmEnabled !== undefined) dbPatch.alarm_enabled = patch.alarmEnabled;

    const { data, error } = await supabase
      .from("tasks")
      .update(dbPatch)
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .neq("status", "cancelled")
      .select("*")
      .single();

    if (error) throw error;
    const task = mapTask(data);
    if (patch.dueAt !== undefined || patch.notificationPolicyId !== undefined || patch.alarmEnabled !== undefined) {
      await store.clearPendingNotifications("task", id);
      await store.scheduleNotificationsForItem("task", id, task.dueAt, task.notificationPolicyId, task.alarmEnabled);
    }
    return task;
  },

  async cancelTaskById(id: string) {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("tasks")
      .update({ status: "cancelled", updated_at: nowIso() })
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    await store.clearPendingNotifications("task", id);
    return mapTask(data);
  },

  async deleteTaskById(id: string) {
    const supabase = createSupabaseAdmin();
    const { error } = await supabase.from("tasks").delete().eq("workspace_id", workspaceId).eq("id", id);
    if (error) throw error;
    await store.clearPendingNotifications("task", id);
    return true;
  },

  async updateEventById(
    id: string,
    patch: Partial<Pick<CalendarEvent, "title" | "description" | "startsAt" | "endsAt" | "location" | "notificationPolicyId" | "alarmEnabled">>
  ) {
    const supabase = createSupabaseAdmin();
    const dbPatch: Record<string, unknown> = { updated_at: nowIso() };
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.startsAt !== undefined) dbPatch.starts_at = patch.startsAt;
    if (patch.endsAt !== undefined) dbPatch.ends_at = patch.endsAt;
    if (patch.location !== undefined) dbPatch.location = patch.location;
    if (patch.notificationPolicyId !== undefined) dbPatch.notification_policy_id = patch.notificationPolicyId;
    if (patch.alarmEnabled !== undefined) dbPatch.alarm_enabled = patch.alarmEnabled;

    const { data, error } = await supabase
      .from("events")
      .update(dbPatch)
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .neq("status", "cancelled")
      .select("*")
      .single();

    if (error) throw error;
    const event = mapEvent(data);
    if (patch.startsAt !== undefined || patch.notificationPolicyId !== undefined || patch.alarmEnabled !== undefined) {
      await store.clearPendingNotifications("event", id);
      await store.scheduleNotificationsForItem("event", id, event.startsAt, event.notificationPolicyId, event.alarmEnabled);
    }
    return event;
  },

  async cancelEventById(id: string) {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("events")
      .update({ status: "cancelled", updated_at: nowIso() })
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    await store.clearPendingNotifications("event", id);
    return mapEvent(data);
  },

  async archiveEventById(id: string) {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("events")
      .update({ status: "archived", updated_at: nowIso() })
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .neq("status", "cancelled")
      .select("*")
      .single();

    if (error) throw error;
    await store.clearPendingNotifications("event", id);
    return mapEvent(data);
  },

  async deleteEventById(id: string) {
    const supabase = createSupabaseAdmin();
    const { error } = await supabase.from("events").delete().eq("workspace_id", workspaceId).eq("id", id);
    if (error) throw error;
    await store.clearPendingNotifications("event", id);
    return true;
  },

  async archiveEvents(numbers: number[]) {
    const supabase = createSupabaseAdmin();
    const updatedAt = nowIso();
    const { data: found, error: findError } = await supabase
      .from("events")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("number", numbers)
      .neq("status", "cancelled");

    if (findError) throw findError;

    const foundNumbers = new Set((found || []).map((event) => Number(event.number)));
    const notFound = numbers.filter((number) => !foundNumbers.has(number));

    const { data: updated, error: updateError } = await supabase
      .from("events")
      .update({ status: "archived", updated_at: updatedAt })
      .eq("workspace_id", workspaceId)
      .in("number", [...foundNumbers])
      .select("*");

    if (updateError) throw updateError;

    for (const event of updated || []) {
      await store.clearPendingNotifications("event", String(event.id));
    }

    return { archived: (updated || []).map(mapEvent), notFound };
  },

  async deleteEvents(numbers: number[]) {
    const supabase = createSupabaseAdmin();
    const { data: found, error: findError } = await supabase
      .from("events")
      .select("id, number")
      .eq("workspace_id", workspaceId)
      .in("number", numbers);

    if (findError) throw findError;

    const foundNumbers = new Set((found || []).map((event) => Number(event.number)));
    const notFound = numbers.filter((number) => !foundNumbers.has(number));

    const { error: deleteError } = await supabase
      .from("events")
      .delete()
      .eq("workspace_id", workspaceId)
      .in("number", [...foundNumbers]);

    if (deleteError) throw deleteError;

    for (const event of found || []) {
      await store.clearPendingNotifications("event", String(event.id));
    }

    return { deleted: [...foundNumbers], notFound };
  },

  async getEventByNumber(number: number) {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("number", number)
      .maybeSingle();
    if (error) throw error;
    return data ? mapEvent(data) : undefined;
  },

  async updateEventByNumber(
    number: number,
    patch: Partial<Pick<CalendarEvent, "title" | "description" | "startsAt" | "endsAt" | "location" | "notificationPolicyId" | "alarmEnabled">>
  ) {
    const supabase = createSupabaseAdmin();
    const dbPatch: Record<string, unknown> = { updated_at: nowIso() };
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.startsAt !== undefined) dbPatch.starts_at = patch.startsAt;
    if (patch.endsAt !== undefined) dbPatch.ends_at = patch.endsAt;
    if (patch.location !== undefined) dbPatch.location = patch.location;
    if (patch.notificationPolicyId !== undefined) dbPatch.notification_policy_id = patch.notificationPolicyId;
    if (patch.alarmEnabled !== undefined) dbPatch.alarm_enabled = patch.alarmEnabled;

    const { data, error } = await supabase
      .from("events")
      .update(dbPatch)
      .eq("workspace_id", workspaceId)
      .eq("number", number)
      .neq("status", "cancelled")
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) return undefined;
    const event = mapEvent(data);
    if (patch.startsAt !== undefined || patch.notificationPolicyId !== undefined || patch.alarmEnabled !== undefined) {
      await store.clearPendingNotifications("event", event.id);
      await store.scheduleNotificationsForItem("event", event.id, event.startsAt, event.notificationPolicyId, event.alarmEnabled);
    }
    return event;
  },

  async listItems(filters: {
    type?: "task" | "event" | "all";
    status?: string;
    priority?: number;
    period_start?: string;
    period_end?: string;
    q?: string;
    limit?: number;
    order?: "asc" | "desc";
  }): Promise<ItemListRow[]> {
    const supabase = createSupabaseAdmin();
    const rows: ItemListRow[] = [];
    const ascending = filters.order !== "desc";
    const rowLimit = filters.limit || 200;

    if (filters.type !== "event") {
      let query = supabase.from("tasks").select("*").eq("workspace_id", workspaceId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.priority) query = query.eq("priority", filters.priority);
      if (filters.period_start) query = query.gte("due_at", filters.period_start);
      if (filters.period_end) query = query.lte("due_at", filters.period_end);
      if (filters.q) query = query.ilike("title", `%${filters.q}%`);
      query = filters.order
        ? query.order("due_at", { ascending }).limit(rowLimit)
        : query.order("priority", { ascending: true }).order("number", { ascending: true }).limit(rowLimit);

      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data || []).map((task) => ({ ...mapTask(task), itemType: "task" as const })));
    }

    if (filters.type !== "task") {
      let query = supabase.from("events").select("*").eq("workspace_id", workspaceId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.period_start) query = query.gte("starts_at", filters.period_start);
      if (filters.period_end) query = query.lte("starts_at", filters.period_end);
      if (filters.q) query = query.ilike("title", `%${filters.q}%`);
      query = query.order("starts_at", { ascending }).limit(rowLimit);

      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data || []).map((event) => ({ ...mapEvent(event), itemType: "event" as const })));
    }

    const itemDate = (item: ItemListRow) => (item.itemType === "task" ? item.dueAt || item.createdAt : item.startsAt);

    const sorted = filters.order
      ? rows.sort((a, b) => {
          const diff = new Date(itemDate(a)).getTime() - new Date(itemDate(b)).getTime();
          return filters.order === "desc" ? -diff : diff;
        })
      : rows.sort((a, b) => {
          if (a.itemType === "task" && b.itemType === "task") {
            return a.priority - b.priority || a.number - b.number;
          }
          return new Date(itemDate(a)).getTime() - new Date(itemDate(b)).getTime();
        });

    return filters.limit ? sorted.slice(0, filters.limit) : sorted;
  },

  async listNotificationPolicies(): Promise<NotificationPolicy[]> {
    const supabase = createSupabaseAdmin();
    const { data: policies, error: policiesError } = await supabase
      .from("notification_policies")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true });

    if (policiesError) throw policiesError;

    const { data: rules, error: rulesError } = await supabase
      .from("notification_rules")
      .select("*")
      .in("policy_id", (policies || []).map((policy) => policy.id));

    if (rulesError) throw rulesError;

    return (policies || []).map((policy) => ({
      id: String(policy.id),
      workspaceId: String(policy.workspace_id),
      name: String(policy.name),
      description: policy.description ? String(policy.description) : undefined,
      isDefault: Boolean(policy.is_default),
      rules: (rules || [])
        .filter((rule) => rule.policy_id === policy.id)
        .map((rule) => ({
          id: String(rule.id),
          policyId: String(rule.policy_id),
          kind: rule.kind as NotificationPolicy["rules"][number]["kind"],
          offsetMinutes: rule.offset_minutes === null ? undefined : Number(rule.offset_minutes),
          startAfterMinutes: rule.start_after_minutes === null ? undefined : Number(rule.start_after_minutes),
          repeatEveryMinutes: rule.repeat_every_minutes === null ? undefined : Number(rule.repeat_every_minutes),
          timeOfDay: rule.time_of_day ? String(rule.time_of_day) : undefined,
          enabled: Boolean(rule.enabled)
        }))
    }));
  },

  async getTaskById(id: string) {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.from("tasks").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapTask(data) : undefined;
  },

  async getEventById(id: string) {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.from("events").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapEvent(data) : undefined;
  },

  async scheduleNotificationsForItem(
    itemType: "task" | "event",
    itemId: string,
    anchorIso: string | undefined,
    policyId?: string,
    alarmEnabled = true
  ) {
    if (!anchorIso || !alarmEnabled) return;

    const policies = await store.listNotificationPolicies();
    const policy = pickPolicy(policies, policyId);
    if (!policy) return;

    const rows = computeSchedule(policy.rules, anchorIso, itemType);
    if (rows.length === 0) return;

    const supabase = createSupabaseAdmin();
    const { error } = await supabase.from("scheduled_notifications").insert(
      rows.map((row) => ({
        workspace_id: workspaceId,
        item_type: itemType,
        item_id: itemId,
        notification_kind: row.kind,
        scheduled_for: row.scheduledFor,
        status: "pending",
        payload: row.repeatEveryMinutes ? { repeatEveryMinutes: row.repeatEveryMinutes } : {}
      }))
    );

    if (error) throw error;
  },

  async clearPendingNotifications(itemType: "task" | "event", itemId: string) {
    const supabase = createSupabaseAdmin();
    const { error } = await supabase
      .from("scheduled_notifications")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("item_type", itemType)
      .eq("item_id", itemId)
      .eq("status", "pending");

    if (error) throw error;
  },

  async listDueNotifications(): Promise<ScheduledNotification[]> {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("scheduled_notifications")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .lte("scheduled_for", nowIso())
      .limit(200);

    if (error) throw error;
    return (data || []).map(mapScheduledNotification);
  },

  async markNotification(id: string, status: NotificationStatus) {
    const supabase = createSupabaseAdmin();
    const updatedAt = nowIso();
    const { data, error } = await supabase
      .from("scheduled_notifications")
      .select("attempt_count")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;

    const patch: Record<string, unknown> = {
      status,
      updated_at: updatedAt,
      attempt_count: Number(data?.attempt_count || 0) + 1
    };
    if (status === "sent") patch.sent_at = updatedAt;

    const { error: updateError } = await supabase.from("scheduled_notifications").update(patch).eq("id", id);
    if (updateError) throw updateError;
  },

  async scheduleNextOccurrence(notification: ScheduledNotification) {
    const everyMinutes = Number(notification.payload.repeatEveryMinutes ?? 1440);
    const nextAt = new Date(new Date(notification.scheduledFor).getTime() + everyMinutes * 60000).toISOString();
    const supabase = createSupabaseAdmin();
    const { error } = await supabase.from("scheduled_notifications").insert({
      workspace_id: notification.workspaceId,
      item_type: notification.itemType,
      item_id: notification.itemId,
      notification_kind: notification.notificationKind,
      scheduled_for: nextAt,
      status: "pending",
      payload: notification.payload
    });
    if (error) throw error;
  }
};
