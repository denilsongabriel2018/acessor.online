import { config } from "./config.js";
import { store } from "./store.js";
import type { ScheduledNotification } from "./types.js";

// Status que significam "esse item nao esta mais ativo, nao faz sentido
// avisar sobre ele". Uma vez aqui, qualquer aviso pendente ja foi limpo pelo
// store (clearPendingNotifications) na hora da mudanca de status - isso aqui
// e so uma segunda trava de seguranca contra corrida entre o aviso ja estar
// "devido" e o item mudar de status entre uma varredura e outra.
const FINAL_TASK_STATUSES = new Set(["completed", "cancelled", "archived"]);
const FINAL_EVENT_STATUSES = new Set(["cancelled", "archived"]);

type WebhookResult = { delivered: boolean; reason?: string };

// 200 OK so prova que o n8n RECEBEU a chamada - nao que a mensagem saiu de
// verdade no WhatsApp (isso pode falhar depois, silenciosamente, se a gente
// confiar so no status HTTP). Por isso o contrato exige que o n8n devolva um
// corpo JSON dizendo explicitamente { "delivered": true|false, "reason"?:
// string }. Sem esse campo (ou com HTTP de erro), tratamos como NAO
// entregue - falha fechada, nunca otimista.
async function callNotificationWebhook(payload: Record<string, unknown>): Promise<WebhookResult> {
  if (!config.notificationWebhookUrl) return { delivered: false, reason: "webhook nao configurado" };

  try {
    const res = await fetch(config.notificationWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiToN8nSecret ? { "x-api-to-n8n-secret": config.apiToN8nSecret } : {})
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      return { delivered: false, reason: `n8n respondeu HTTP ${res.status}` };
    }

    const body = await res.json().catch(() => null);
    if (body && typeof body.delivered === "boolean") {
      return { delivered: body.delivered, reason: body.reason };
    }

    // n8n respondeu 200 mas sem o campo "delivered" no corpo - nao da pra
    // confirmar entrega de verdade, entao nao assumimos sucesso so pelo 200.
    return { delivered: false, reason: "n8n respondeu 200 mas sem confirmar 'delivered' no corpo" };
  } catch (err) {
    console.error("[scheduler] falha ao chamar o webhook de notificacao do n8n:", err);
    return { delivered: false, reason: "erro de rede/timeout chamando o n8n" };
  }
}

// O "tick": busca tudo que esta pendente e cuja hora ja chegou, processa um
// por um, marca o resultado. E chamado tanto pelo timer (startScheduler)
// quanto manualmente (util pra testar sem esperar o relogio andar).
export async function processDueNotifications() {
  const due = await store.listDueNotifications();
  const results: { notification: ScheduledNotification; outcome: string }[] = [];

  for (const notification of due) {
    const item =
      notification.itemType === "task"
        ? await store.getTaskById(notification.itemId)
        : await store.getEventById(notification.itemId);

    if (!item) {
      await store.markNotification(notification.id, "skipped");
      results.push({ notification, outcome: "skipped (item nao existe mais)" });
      continue;
    }

    const isFinal =
      notification.itemType === "task"
        ? FINAL_TASK_STATUSES.has(item.status)
        : FINAL_EVENT_STATUSES.has(item.status);

    if (isFinal) {
      await store.markNotification(notification.id, "skipped");
      results.push({ notification, outcome: `skipped (item esta '${item.status}')` });
      continue;
    }

    const webhookResult = await callNotificationWebhook({
      workspace_id: notification.workspaceId,
      item_type: notification.itemType,
      item_id: notification.itemId,
      notification_kind: notification.notificationKind,
      scheduled_for: notification.scheduledFor,
      item
    });

    // Sem webhook configurado ainda e um estado esperado nessa fase do
    // projeto (n8n de avisos fica pra depois) - fica como "skipped", nao
    // "failed". Com webhook configurado, "delivered: false" e falha de
    // verdade.
    const status = webhookResult.delivered ? "sent" : config.notificationWebhookUrl ? "failed" : "skipped";
    await store.markNotification(notification.id, status);
    results.push({
      notification,
      outcome: webhookResult.delivered ? "sent" : `${status} (${webhookResult.reason || "sem motivo informado"})`
    });

    // repeat_until_done so continua se o item ainda nao chegou num estado
    // final - senao a proxima ocorrencia nunca seria util.
    if (notification.notificationKind === "repeat_until_done" && !isFinal) {
      await store.scheduleNextOccurrence(notification);
    }
  }

  return results;
}

let timer: ReturnType<typeof setInterval> | undefined;

export function startScheduler() {
  if (!config.schedulerEnabled) {
    console.log("[scheduler] desligado (SCHEDULER_ENABLED=false)");
    return;
  }

  if (!config.notificationWebhookUrl) {
    console.warn(
      "[scheduler] N8N_NOTIFICATION_WEBHOOK_URL nao configurado - avisos serao calculados e marcados como 'skipped' quando vencerem, mas nada sera enviado de verdade ate o fluxo de avisos do n8n existir."
    );
  }

  timer = setInterval(() => {
    processDueNotifications().catch((err) => console.error("[scheduler] erro processando notificacoes:", err));
  }, config.schedulerIntervalSeconds * 1000);

  console.log(`[scheduler] rodando, varredura a cada ${config.schedulerIntervalSeconds}s`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
}
