import type { NotificationRule, NotificationRuleKind } from "./types.js";

export type ScheduleRow = {
  kind: NotificationRuleKind;
  scheduledFor: string;
  repeatEveryMinutes?: number;
};

// Calcula, a partir das regras de uma politica e de uma data-ancora (prazo da
// task ou inicio do evento), quando cada aviso deveria disparar.
//
// - before_due / after_due: offsetMinutes ja vem com o sinal certo (negativo
//   antes, positivo depois), entao a formula e a mesma pros dois casos.
// - repeat_until_done: so faz sentido pra task (evento nao tem "concluido"
//   pra repetir ate) - primeira ocorrencia em startAfterMinutes.
// - daily_summary: e um resumo por workspace/usuario, nao por item - fica de
//   fora daqui de proposito (precisa de um mecanismo proprio, nao por task).
export function computeSchedule(rules: NotificationRule[], anchorIso: string, itemType: "task" | "event"): ScheduleRow[] {
  const anchor = new Date(anchorIso).getTime();
  const rows: ScheduleRow[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    if ((rule.kind === "before_due" || rule.kind === "after_due") && rule.offsetMinutes !== undefined) {
      rows.push({ kind: rule.kind, scheduledFor: new Date(anchor + rule.offsetMinutes * 60000).toISOString() });
      continue;
    }

    if (rule.kind === "repeat_until_done" && itemType === "task") {
      const startAfter = rule.startAfterMinutes ?? 0;
      rows.push({
        kind: rule.kind,
        scheduledFor: new Date(anchor + startAfter * 60000).toISOString(),
        repeatEveryMinutes: rule.repeatEveryMinutes ?? 1440
      });
    }
  }

  return rows;
}
