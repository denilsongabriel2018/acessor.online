export type ItemType = "task" | "event";
export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled" | "archived";
export type EventStatus = "scheduled" | "cancelled" | "archived";

export type Task = {
  id: string;
  workspaceId: string;
  number: number;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: number;
  dueAt?: string;
  completedAt?: string;
  source: "front" | "n8n" | "api";
  originalMessage?: string;
  notificationPolicyId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CalendarEvent = {
  id: string;
  workspaceId: string;
  number: number;
  title: string;
  description?: string;
  status: EventStatus;
  startsAt: string;
  endsAt: string;
  location?: string;
  source: "front" | "n8n" | "api";
  originalMessage?: string;
  notificationPolicyId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ItemListRow =
  | ({ itemType: "task" } & Task)
  | ({ itemType: "event" } & CalendarEvent);

export type NotificationRuleKind = "before_due" | "after_due" | "repeat_until_done" | "daily_summary";

export type NotificationRule = {
  id: string;
  policyId: string;
  kind: NotificationRuleKind;
  offsetMinutes?: number;
  startAfterMinutes?: number;
  repeatEveryMinutes?: number;
  timeOfDay?: string;
  enabled: boolean;
};

export type NotificationPolicy = {
  id: string;
  workspaceId?: string;
  name: string;
  isDefault: boolean;
  rules: NotificationRule[];
};

export type IntegrationProvider = "evolution_api" | "n8n";

export type IntegrationSetting = {
  id: string;
  workspaceId: string;
  provider: IntegrationProvider;
  baseUrl: string;
  instanceName?: string;
  extra: Record<string, unknown>;
  isActive: boolean;
};

export type NotificationStatus = "pending" | "sent" | "skipped" | "failed";

export type ScheduledNotification = {
  id: string;
  workspaceId: string;
  itemType: "task" | "event";
  itemId: string;
  notificationKind: NotificationRuleKind;
  scheduledFor: string;
  status: NotificationStatus;
  attemptCount: number;
  payload: Record<string, unknown>;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
};
