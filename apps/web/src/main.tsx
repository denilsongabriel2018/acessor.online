import {
  BellRing,
  CalendarDays,
  Archive,
  Check,
  ListChecks,
  LogOut,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Table,
  User
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { hasSupabaseAuth, supabase } from "./supabaseClient";
import "./styles.css";

type View = "agenda" | "tasks" | "list" | "automations" | "notifications" | "settings";
type AgendaMode = "day" | "week" | "month";
type ItemTypeFilter = "all" | "task" | "event";
type StatusFilter = "" | "pending" | "completed" | "scheduled" | "cancelled" | "archived";

type Item = {
  id: string;
  itemType: "task" | "event";
  number?: number;
  title: string;
  description?: string;
  status: string;
  priority?: number;
  dueAt?: string;
  startsAt?: string;
  endsAt?: string;
  location?: string;
  alarmEnabled?: boolean;
};

type NotificationRuleKind = "before_due" | "after_due" | "repeat_until_done" | "daily_summary";

type NotificationRule = {
  id: string;
  policyId: string;
  kind: NotificationRuleKind;
  offsetMinutes?: number;
  startAfterMinutes?: number;
  repeatEveryMinutes?: number;
  timeOfDay?: string;
  enabled: boolean;
};

type NotificationPolicy = {
  id: string;
  name: string;
  isDefault: boolean;
  rules: NotificationRule[];
};

const apiUrl = import.meta.env.VITE_API_URL || "http://127.0.0.1:3000";

function toInputDate(date: Date) {
  // Use local date parts, not toISOString() — that converts to UTC first,
  // which silently rolls 23:59:59 local into the next day in timezones
  // behind UTC (e.g. -03:00), producing an extra day in the range.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toInputTime(date: Date) {
  return date.toTimeString().slice(0, 5);
}

function dateTimeIso(date: string, time: string) {
  return new Date(`${date}T${time || "09:00"}:00`).toISOString();
}

function initialPeriod() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  end.setHours(23, 59, 59, 999);
  return { startDate: toInputDate(start), endDate: toInputDate(end) };
}

function formatDateTime(value?: string) {
  if (!value) return "Sem horario";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatTime(value?: string) {
  if (!value) return "--:--";
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function capitalizeFirst(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const RULE_KIND_LABELS: Record<NotificationRuleKind, string> = {
  before_due: "Antes do prazo",
  after_due: "Depois do prazo",
  repeat_until_done: "Repetir ate concluir",
  daily_summary: "Resumo diario"
};

function formatMinutesSpan(minutes: number) {
  const abs = Math.abs(minutes);
  if (abs % 1440 === 0) return `${abs / 1440}d`;
  if (abs % 60 === 0) return `${abs / 60}h`;
  return `${abs}min`;
}

function ruleWhenLabel(rule: NotificationRule) {
  switch (rule.kind) {
    case "before_due":
      return rule.offsetMinutes !== undefined ? `${formatMinutesSpan(rule.offsetMinutes)} antes` : "-";
    case "after_due":
      return rule.offsetMinutes !== undefined ? `${formatMinutesSpan(rule.offsetMinutes)} depois` : "-";
    case "repeat_until_done": {
      const every = rule.repeatEveryMinutes !== undefined ? formatMinutesSpan(rule.repeatEveryMinutes) : "?";
      const start = rule.startAfterMinutes !== undefined ? formatMinutesSpan(rule.startAfterMinutes) : "0min";
      return `a cada ${every}, a partir de ${start}`;
    }
    case "daily_summary":
      return rule.timeOfDay ? `todo dia as ${rule.timeOfDay}` : "todo dia";
    default:
      return "-";
  }
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function itemDate(item: Item) {
  return item.dueAt || item.startsAt || "";
}

function buildDays(startDate: string, endDate: string) {
  const days: Date[] = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    days.push(new Date(day));
  }
  return days.slice(0, 42);
}

function applyPeriodPreset(preset: AgendaMode, anchor: Date = new Date()) {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);

  if (preset === "day") {
    end.setHours(23, 59, 59, 999);
  }
  if (preset === "week") {
    const dayOfWeek = start.getDay();
    start.setDate(start.getDate() - dayOfWeek);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  }
  if (preset === "month") {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
  }

  return { startDate: toInputDate(start), endDate: toInputDate(end) };
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  if (!authReady) {
    return <LoadingScreen />;
  }

  if (hasSupabaseAuth && !session) {
    return <LoginScreen />;
  }

  return <Dashboard session={session} />;
}

function Dashboard({ session }: { session: Session | null }) {
  const period = useMemo(initialPeriod, []);
  const [view, setView] = useState<View>("agenda");
  const [agendaMode, setAgendaMode] = useState<AgendaMode>("week");
  const [items, setItems] = useState<Item[]>([]);
  const [itemType, setItemType] = useState<ItemTypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("");
  const [priority, setPriority] = useState("");
  const [query, setQuery] = useState("");
  const [startDate, setStartDate] = useState(period.startDate);
  const [endDate, setEndDate] = useState(period.endDate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formType, setFormType] = useState<"task" | "event">("task");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(toInputDate(new Date()));
  const [time, setTime] = useState(toInputTime(new Date(Date.now() + 60 * 60 * 1000)));
  const [endTime, setEndTime] = useState(toInputTime(new Date(Date.now() + 2 * 60 * 60 * 1000)));
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [focusDate, setFocusDate] = useState(new Date());
  const [miniCalCursor, setMiniCalCursor] = useState(new Date());
  // Clique no mini-calendario: 1o clique seleciona um dia so; se o usuario
  // clicar em outro dia logo em seguida (sem soltar essa selecao pendente),
  // o segundo clique vira o fim do intervalo. Um 3o clique comeca de novo.
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [policies, setPolicies] = useState<NotificationPolicy[]>([]);
  const [policiesLoaded, setPoliciesLoaded] = useState(false);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [policyFilter, setPolicyFilter] = useState("");
  // Aba "Lista" tem seu proprio recorte de periodo, independente do periodo
  // da Agenda - "all" (padrao) busca tudo, sem filtro de data nenhum.
  const [listRange, setListRange] = useState<"all" | "today" | "week" | "month">("all");

  async function loadItems(overrideStart?: string, overrideEnd?: string, opts?: { noPeriod?: boolean }) {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ type: itemType });
    if (!opts?.noPeriod) {
      params.set("period_start", dateTimeIso(overrideStart ?? startDate, "00:00"));
      params.set("period_end", dateTimeIso(overrideEnd ?? endDate, "23:59"));
    }
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (query.trim()) params.set("q", query.trim());

    try {
      const result = await apiFetch(session, `/api/items?${params}`).then((res) => res.json());
      if (!result.ok) throw new Error(result.errors?.[0]?.message || "Erro ao buscar itens");
      setItems(result.data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  function loadListItems(range: typeof listRange) {
    if (range === "all") return loadItems(undefined, undefined, { noPeriod: true });
    const end = new Date();
    if (range === "week") end.setDate(end.getDate() + 7);
    if (range === "month") end.setMonth(end.getMonth() + 1);
    return loadItems(toInputDate(new Date()), toInputDate(end));
  }

  async function loadPolicies() {
    setPoliciesLoading(true);
    try {
      const result = await apiFetch(session, "/api/notification-policies").then((res) => res.json());
      if (!result.ok) throw new Error(result.errors?.[0]?.message || "Erro ao buscar automacoes");
      setPolicies(result.data.policies);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setPoliciesLoaded(true);
      setPoliciesLoading(false);
    }
  }

  async function createItem(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setError("");

    const endpoint = formType === "task" ? "/api/tasks" : "/api/events";
    const body =
      formType === "task"
        ? { title, priority: Number(priority || 2), dueAt: dateTimeIso(date, time), source: "front" }
        : { title, startsAt: dateTimeIso(date, time), endsAt: dateTimeIso(date, endTime), source: "front" };

    const result = await apiFetch(session, endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then((res) => res.json());

    if (!result.ok) {
      setError(result.errors?.[0]?.message || "Erro ao criar item");
      return;
    }
    setTitle("");
    await loadItems();
  }

  async function quickAddTask(taskTitle: string) {
    const now = new Date();
    const body = {
      title: taskTitle,
      priority: 2,
      dueAt: dateTimeIso(toInputDate(now), toInputTime(now)),
      source: "front"
    };
    const result = await apiFetch(session, "/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then((res) => res.json());
    if (!result.ok) {
      setError(result.errors?.[0]?.message || "Erro ao criar task");
      return;
    }
    await loadItems();
  }

  async function completeTask(id: string) {
    await apiFetch(session, `/api/tasks/${id}/complete`, { method: "PATCH" });
    await loadItems();
  }

  async function archiveTask(id: string) {
    await apiFetch(session, `/api/tasks/${id}/archive`, { method: "PATCH" });
    await loadItems();
  }

  function itemEndpoint(item: Item) {
    return item.itemType === "task" ? `/api/tasks/${item.id}` : `/api/events/${item.id}`;
  }

  async function patchItem(item: Item, body: Record<string, unknown>) {
    const result = await apiFetch(session, itemEndpoint(item), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then((res) => res.json());
    if (!result.ok) {
      setError(result.errors?.[0]?.message || "Erro ao atualizar item");
      return false;
    }
    await loadItems();
    return true;
  }

  async function editItemTitle(item: Item) {
    const novoTitulo = window.prompt("Novo titulo:", item.title);
    if (novoTitulo === null || !novoTitulo.trim() || novoTitulo.trim() === item.title) return;
    await patchItem(item, { title: novoTitulo.trim() });
  }

  async function editItemDescription(item: Item) {
    const novaDescricao = window.prompt("Descricao:", item.description || "");
    if (novaDescricao === null || novaDescricao === (item.description || "")) return;
    await patchItem(item, { description: novaDescricao.trim() });
  }

  async function toggleAlarm(item: Item) {
    const atual = item.alarmEnabled !== false;
    await patchItem(item, { alarmEnabled: !atual });
  }

  async function rescheduleItem(item: Item) {
    if (item.itemType === "task") {
      const atual = item.dueAt ? new Date(item.dueAt) : new Date();
      const novaData = window.prompt("Nova data do prazo (AAAA-MM-DD):", toInputDate(atual));
      if (!novaData) return;
      const novaHora = window.prompt("Novo horario (HH:MM):", toInputTime(atual));
      if (!novaHora) return;
      await patchItem(item, { dueAt: dateTimeIso(novaData, novaHora) });
      return;
    }

    const atualInicio = item.startsAt ? new Date(item.startsAt) : new Date();
    const atualFim = item.endsAt ? new Date(item.endsAt) : new Date(atualInicio.getTime() + 60 * 60 * 1000);
    const novaData = window.prompt("Nova data do evento (AAAA-MM-DD):", toInputDate(atualInicio));
    if (!novaData) return;
    const novaHoraInicio = window.prompt("Novo horario de inicio (HH:MM):", toInputTime(atualInicio));
    if (!novaHoraInicio) return;
    const novaHoraFim = window.prompt("Novo horario de fim (HH:MM):", toInputTime(atualFim));
    if (!novaHoraFim) return;
    await patchItem(item, {
      startsAt: dateTimeIso(novaData, novaHoraInicio),
      endsAt: dateTimeIso(novaData, novaHoraFim)
    });
  }

  async function cancelItem(item: Item) {
    if (!window.confirm(`Cancelar "${item.title}"?`)) return;
    await apiFetch(session, `${itemEndpoint(item)}/cancel`, { method: "PATCH" });
    await loadItems();
  }

  async function archiveItem(item: Item) {
    await apiFetch(session, `${itemEndpoint(item)}/archive`, { method: "PATCH" });
    await loadItems();
  }

  async function deleteItem(item: Item) {
    if (!window.confirm(`Apagar "${item.title}" para sempre? Essa acao nao pode ser desfeita.`)) return;
    await apiFetch(session, itemEndpoint(item), { method: "DELETE" });
    await loadItems();
  }

  function changeAgendaMode(nextMode: AgendaMode) {
    setRangeStart(null);
    setAgendaMode(nextMode);
    const nextPeriod = applyPeriodPreset(nextMode, focusDate);
    setStartDate(nextPeriod.startDate);
    setEndDate(nextPeriod.endDate);
    loadItems(nextPeriod.startDate, nextPeriod.endDate);
  }

  function navigateAgenda(step: number) {
    setRangeStart(null);
    const next = new Date(focusDate);
    if (agendaMode === "day") next.setDate(next.getDate() + step);
    else if (agendaMode === "month") {
      // Pin to day 1 before shifting months — otherwise e.g. Aug 31 + 1
      // month overflows past September (30 days) into October, skipping
      // the month entirely.
      next.setDate(1);
      next.setMonth(next.getMonth() + step);
    } else next.setDate(next.getDate() + step * 7);

    setFocusDate(next);
    setMiniCalCursor(next);
    const nextPeriod = applyPeriodPreset(agendaMode, next);
    setStartDate(nextPeriod.startDate);
    setEndDate(nextPeriod.endDate);
    loadItems(nextPeriod.startDate, nextPeriod.endDate);
  }

  function goToday() {
    setRangeStart(null);
    const now = new Date();
    setFocusDate(now);
    setMiniCalCursor(now);
    const nextPeriod = applyPeriodPreset(agendaMode, now);
    setStartDate(nextPeriod.startDate);
    setEndDate(nextPeriod.endDate);
    loadItems(nextPeriod.startDate, nextPeriod.endDate);
  }

  function selectMiniCalDay(day: Date) {
    if (rangeStart) {
      // Segundo clique: fecha o intervalo entre o dia guardado e esse.
      const start = rangeStart < day ? rangeStart : day;
      const end = rangeStart < day ? day : rangeStart;
      setRangeStart(null);
      setAgendaMode("week"); // "week" so reusa a grade de horas p/ N dias - nao fica preso a 7 dias
      setFocusDate(start);
      setMiniCalCursor(start);
      const startDateStr = toInputDate(start);
      const endDateStr = toInputDate(end);
      setStartDate(startDateStr);
      setEndDate(endDateStr);
      loadItems(startDateStr, endDateStr);
      return;
    }

    // Primeiro clique: seleciona o dia sozinho, mas deixa marcado como
    // possivel inicio de um intervalo caso o usuario clique em outro dia.
    setRangeStart(day);
    setAgendaMode("day");
    setFocusDate(day);
    setMiniCalCursor(day);
    const nextPeriod = applyPeriodPreset("day", day);
    setStartDate(nextPeriod.startDate);
    setEndDate(nextPeriod.endDate);
    loadItems(nextPeriod.startDate, nextPeriod.endDate);
  }

  function periodLabel() {
    if (agendaMode === "day") {
      return capitalizeFirst(focusDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }));
    }
    if (agendaMode === "week" && calendarDays.length !== 7) {
      const fmt = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      return `${fmt(calendarDays[0])} - ${fmt(calendarDays[calendarDays.length - 1])}`;
    }
    return capitalizeFirst(focusDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
  }

  useEffect(() => {
    if (view === "list") {
      loadListItems(listRange);
    } else if (view === "agenda" || view === "tasks") {
      loadItems();
    }
  }, [view, itemType, status, listRange]);

  useEffect(() => {
    if (view === "automations" && !policiesLoaded) {
      loadPolicies();
    }
  }, [view, policiesLoaded]);

  const today = new Date().toISOString().slice(0, 10);
  const tasks = items.filter((item) => item.itemType === "task");
  const events = items.filter((item) => item.itemType === "event");
  const pendingTasks = tasks.filter((item) => item.status === "pending" || item.status === "in_progress");
  const dueToday = tasks.filter((item) => item.dueAt?.slice(0, 10) === today && item.status !== "completed");
  const overdue = tasks.filter((item) => item.dueAt && new Date(item.dueAt) < new Date() && item.status !== "completed");
  const calendarDays = buildDays(startDate, endDate);

  const overdueIds = new Set(overdue.map((item) => item.id));
  const openTasks = tasks
    .filter((item) => item.status !== "completed" && item.status !== "archived" && !overdueIds.has(item.id))
    .sort((a, b) => Number(a.priority || 9) - Number(b.priority || 9));
  const completedTasks = tasks.filter((item) => item.status === "completed");

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <CalendarDays size={22} />
          <span>Agenda Motor</span>
        </div>
        <CreateButton
          onCreate={(type) => {
            setFormType(type);
            titleInputRef.current?.focus();
            titleInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        />
        <MiniCalendar
          cursor={miniCalCursor}
          onCursorChange={setMiniCalCursor}
          selectedDate={focusDate}
          rangeStart={rangeStart}
          onSelectDay={selectMiniCalDay}
        />
        <nav>
          <NavButton active={view === "agenda"} icon={<CalendarDays size={18} />} label="Agenda" onClick={() => setView("agenda")} />
          <NavButton active={view === "tasks"} icon={<ListChecks size={18} />} label="Tarefas" onClick={() => setView("tasks")} />
          <NavButton active={view === "list"} icon={<Table size={18} />} label="Lista" onClick={() => setView("list")} />
          <NavButton
            active={view === "automations"}
            icon={<Sparkles size={18} />}
            label="Automacoes"
            onClick={() => setView("automations")}
          />
          <NavButton active={view === "notifications"} icon={<BellRing size={18} />} label="Cobrancas" onClick={() => setView("notifications")} />
          <NavButton active={view === "settings"} icon={<Settings size={18} />} label="Ajustes" onClick={() => setView("settings")} />
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Motor conectado a API filtrada</p>
            <h1>
              {view === "agenda"
                ? "Modo agenda"
                : view === "tasks"
                  ? "Tarefas"
                  : view === "list"
                    ? "Lista"
                    : view === "automations"
                      ? "Automacoes"
                      : view === "notifications"
                        ? "Cobrancas"
                        : "Configuracoes"}
            </h1>
            {view === "agenda" ? (
              <div className="date-nav">
                <button type="button" className="pill-btn" onClick={goToday}>
                  Hoje
                </button>
                <button type="button" className="icon-button secondary" onClick={() => navigateAgenda(-1)}>
                  ‹
                </button>
                <button type="button" className="icon-button secondary" onClick={() => navigateAgenda(1)}>
                  ›
                </button>
                <span className="date-nav-label">{periodLabel()}</span>
              </div>
            ) : null}
          </div>
          <div className="top-actions">
            {view === "agenda" || view === "tasks" ? (
              <div className="view-toggle">
                <button type="button" className={view === "agenda" ? "selected" : ""} title="Agenda" onClick={() => setView("agenda")}>
                  <CalendarDays size={16} />
                </button>
                <button type="button" className={view === "tasks" ? "selected" : ""} title="Tarefas" onClick={() => setView("tasks")}>
                  <Check size={16} />
                </button>
              </div>
            ) : null}
            <span className="user-pill">
              <User size={16} />
              {session?.user.email || "Local"}
            </span>
            <button className="icon-button" title="Atualizar" onClick={() => loadItems()}>
              <RefreshCw size={18} />
            </button>
            {supabase ? (
              <button className="icon-button secondary" title="Sair" onClick={() => supabase?.auth.signOut()}>
                <LogOut size={18} />
              </button>
            ) : null}
          </div>
        </header>

        <section className="metrics" hidden={view === "agenda" || view === "tasks" || view === "automations"}>
          <Metric label="Pendentes" value={pendingTasks.length} />
          <Metric label="Vencidas" value={overdue.length} tone="danger" />
          <Metric label="Hoje" value={dueToday.length} tone="warning" />
          <Metric label="Eventos" value={events.length} tone="success" />
        </section>

        {error ? <p className="alert">{error}</p> : null}

        {view === "list" ? (
          <ItemsListView
            items={items}
            loading={loading}
            periodFilter={
              <div className="view-tabs">
                <button type="button" className={listRange === "all" ? "selected" : ""} onClick={() => setListRange("all")}>
                  Tudo
                </button>
                <button type="button" className={listRange === "today" ? "selected" : ""} onClick={() => setListRange("today")}>
                  Hoje
                </button>
                <button type="button" className={listRange === "week" ? "selected" : ""} onClick={() => setListRange("week")}>
                  Semana
                </button>
                <button type="button" className={listRange === "month" ? "selected" : ""} onClick={() => setListRange("month")}>
                  Mes
                </button>
              </div>
            }
            onComplete={completeTask}
            onEditTitle={editItemTitle}
            onEditDescription={editItemDescription}
            onToggleAlarm={toggleAlarm}
            onReschedule={rescheduleItem}
            onCancel={cancelItem}
            onArchive={archiveItem}
            onDelete={deleteItem}
          />
        ) : view === "automations" ? (
          <AutomationsView
            policies={policies}
            loading={policiesLoading}
            filter={policyFilter}
            onFilterChange={setPolicyFilter}
            onReload={loadPolicies}
          />
        ) : view === "notifications" || view === "settings" ? (
          <Placeholder view={view} />
        ) : (
          <section className="workspace">
            <form className="composer" onSubmit={createItem} hidden={view === "agenda"}>
              <div className="segment">
                <button type="button" className={formType === "task" ? "selected" : ""} onClick={() => setFormType("task")}>
                  Task
                </button>
                <button type="button" className={formType === "event" ? "selected" : ""} onClick={() => setFormType("event")}>
                  Evento
                </button>
              </div>
              <input
                ref={titleInputRef}
                className="title-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Titulo do item"
              />
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
              {formType === "event" ? <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /> : null}
              <button title="Criar">
                <Plus size={18} />
              </button>
            </form>

            {view === "agenda" ? (
              <section className={`agenda-panel ${agendaMode === "day" || agendaMode === "week" ? "hourgrid-active" : ""}`}>
                <div className="view-toolbar">
                  <div className="view-tabs">
                    <button type="button" className={agendaMode === "day" ? "selected" : ""} onClick={() => changeAgendaMode("day")}>
                      Dia
                    </button>
                    <button type="button" className={agendaMode === "week" ? "selected" : ""} onClick={() => changeAgendaMode("week")}>
                      Semana
                    </button>
                    <button type="button" className={agendaMode === "month" ? "selected" : ""} onClick={() => changeAgendaMode("month")}>
                      Mes
                    </button>
                  </div>
                  <span>{calendarDays.length} dias no recorte</span>
                </div>
                {agendaMode === "month" ? (
                  <MonthGrid days={calendarDays} items={items} />
                ) : (
                  <HourGrid days={calendarDays} items={items} />
                )}
              </section>
            ) : (
              <section className="task-columns">
                {loading ? <p className="empty">Buscando na API com os filtros aplicados...</p> : null}
                <TaskChecklist
                  title="Atrasadas"
                  items={overdue}
                  onComplete={completeTask}
                  onArchive={archiveTask}
                  onQuickAdd={quickAddTask}
                  empty="Nada atrasado."
                />
                <TaskChecklist
                  title="A fazer"
                  items={openTasks}
                  onComplete={completeTask}
                  onArchive={archiveTask}
                  onQuickAdd={quickAddTask}
                  empty="Nenhuma task pendente."
                />
                <TaskChecklist
                  title="Concluidas"
                  items={completedTasks}
                  onComplete={completeTask}
                  onArchive={archiveTask}
                  onQuickAdd={quickAddTask}
                  empty="Nada concluido ainda."
                />
              </section>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

async function apiFetch(session: Session | null, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  return fetch(`${apiUrl}${path}`, { ...init, headers });
}

function LoadingScreen() {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <CalendarDays size={28} />
        <h1>Carregando</h1>
      </section>
    </main>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("rafaelranieri.stm@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError("");
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) setError(loginError.message);
    setLoading(false);
  }

  return (
    <main className="auth-page">
      <form className="auth-panel" onSubmit={login}>
        <div className="brand auth-brand">
          <CalendarDays size={24} />
          <span>Agenda Motor</span>
        </div>
        <h1>Entrar</h1>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Senha
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p className="alert">{error}</p> : null}
        <button disabled={loading}>{loading ? "Entrando..." : "Entrar"}</button>
      </form>
    </main>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`nav ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "danger" | "warning" | "success" }) {
  return (
    <div className={`metric ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ItemRow({
  item,
  onComplete,
  onArchive,
  variant = "card"
}: {
  item: Item;
  onComplete: (id: string) => void;
  onArchive: (id: string) => void;
  variant?: "card" | "compact" | "row";
}) {
  const isTask = item.itemType === "task";
  const date = item.dueAt || item.startsAt;
  const overdue = isTask && item.status !== "completed" && date && new Date(date) < new Date();

  if (variant === "row") {
    return (
      <article className={`item-row row ${item.itemType} ${overdue ? "overdue" : ""}`}>
        <span className={`row-dot ${item.status}`} />
        <div className="row-main">
          <span className="kind">{isTask ? `#${item.number} P${item.priority}` : "Evento"}</span>
          <h2>{item.title}</h2>
        </div>
        <span className="row-date">
          {isTask ? formatDateTime(item.dueAt) : `${formatDateTime(item.startsAt)} - ${formatDateTime(item.endsAt)}`}
        </span>
        <span className={`status ${item.status}`}>{item.status}</span>
        <div className="item-actions">
          {isTask && item.status !== "completed" ? (
            <button className="icon-button complete" title="Concluir task" onClick={() => onComplete(item.id)}>
              <Check size={15} />
            </button>
          ) : null}
          {isTask && item.status !== "archived" ? (
            <button className="icon-button archive" title="Arquivar task" onClick={() => onArchive(item.id)}>
              <Archive size={15} />
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <article className={`item-row ${item.itemType} ${overdue ? "overdue" : ""} ${variant === "compact" ? "compact" : ""}`}>
      <div className="item-main">
        <span className="kind">{isTask ? `#${item.number} P${item.priority}` : "Evento"}</span>
        <h2>{item.title}</h2>
        <p>{isTask ? `Prazo ${formatDateTime(item.dueAt)}` : `${formatDateTime(item.startsAt)} ate ${formatDateTime(item.endsAt)}`}</p>
      </div>
      <div className="item-actions">
        <span className={`status ${item.status}`}>{item.status}</span>
        {isTask && item.status !== "completed" ? (
          <button className="icon-button complete" title="Concluir task" onClick={() => onComplete(item.id)}>
            <Check size={17} />
          </button>
        ) : null}
        {isTask && item.status !== "archived" ? (
          <button className="icon-button archive" title="Arquivar task" onClick={() => onArchive(item.id)}>
            <Archive size={17} />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function relativeOverdue(due: Date) {
  const diffMs = Date.now() - due.getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days >= 1) return `atrasada ${days}d`;
  const hours = Math.floor(diffMs / 3600000);
  if (hours >= 1) return `atrasada ${hours}h`;
  return "atrasada agora";
}

function TaskChecklist({
  title,
  items,
  onComplete,
  onArchive,
  onQuickAdd,
  empty
}: {
  title: string;
  items: Item[];
  onComplete: (id: string) => void;
  onArchive: (id: string) => void;
  onQuickAdd: (title: string) => void;
  empty: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  function submitDraft(event: React.FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (value) onQuickAdd(value);
    setDraft("");
    setAdding(false);
  }

  return (
    <div className="task-list-card">
      <h3>
        {title} <span className="task-list-count">{items.length}</span>
      </h3>
      {adding ? (
        <form className="task-quick-add" onSubmit={submitDraft}>
          <span className="task-checkbox" />
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (!draft.trim()) setAdding(false);
            }}
            placeholder="Titulo da tarefa"
          />
        </form>
      ) : (
        <button type="button" className="task-add-link" onClick={() => setAdding(true)}>
          <Plus size={14} />
          Adicionar uma tarefa
        </button>
      )}
      {items.length === 0 ? <p className="empty compact-empty">{empty}</p> : null}
      {items.map((item) => (
        <TaskCheckRow item={item} key={item.id} onComplete={onComplete} onArchive={onArchive} />
      ))}
    </div>
  );
}

function TaskCheckRow({
  item,
  onComplete,
  onArchive
}: {
  item: Item;
  onComplete: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const due = item.dueAt ? new Date(item.dueAt) : null;
  const overdue = Boolean(due) && item.status !== "completed" && due! < new Date();
  const completed = item.status === "completed";

  return (
    <div className={`task-check-row ${completed ? "completed" : ""}`}>
      <button
        type="button"
        className="task-checkbox"
        title={completed ? "Concluida" : "Marcar como concluida"}
        onClick={() => !completed && onComplete(item.id)}
      >
        {completed ? <Check size={12} /> : null}
      </button>
      <div className="task-check-body">
        <span className="task-check-title">{item.title}</span>
        {due ? (
          <span className={`task-check-badge ${overdue ? "overdue" : ""}`}>
            {overdue ? relativeOverdue(due) : formatDateTime(item.dueAt)}
          </span>
        ) : null}
      </div>
      <button className="icon-button archive small" title="Arquivar task" onClick={() => onArchive(item.id)}>
        <Archive size={13} />
      </button>
    </div>
  );
}

function EventChip({ item }: { item: Item }) {
  const isTask = item.itemType === "task";
  const overdue = isTask && item.status !== "completed" && item.dueAt && new Date(item.dueAt) < new Date();
  const time = isTask ? formatTime(item.dueAt) : formatTime(item.startsAt);
  const label = isTask ? `#${item.number} ${item.title}` : item.title;

  return (
    <div className={`event-chip ${item.itemType} ${overdue ? "overdue" : ""} ${item.status}`} title={label}>
      <span className="chip-time">{time}</span>
      <span className="chip-title">{label}</span>
    </div>
  );
}

function CreateButton({ onCreate }: { onCreate: (type: "task" | "event") => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="create-wrap">
      <button type="button" className="create-btn" onClick={() => setOpen((value) => !value)}>
        <Plus size={16} />
        Criar
      </button>
      {open ? (
        <div className="create-menu">
          <button
            type="button"
            onClick={() => {
              onCreate("event");
              setOpen(false);
            }}
          >
            Evento
          </button>
          <button
            type="button"
            onClick={() => {
              onCreate("task");
              setOpen(false);
            }}
          >
            Tarefa
          </button>
        </div>
      ) : null}
    </div>
  );
}

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

function MiniCalendar({
  cursor,
  onCursorChange,
  selectedDate,
  rangeStart,
  onSelectDay
}: {
  cursor: Date;
  onCursorChange: (next: Date) => void;
  selectedDate: Date;
  rangeStart: Date | null;
  onSelectDay: (day: Date) => void;
}) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const leading = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = dateKey(new Date());
  const selectedKey = dateKey(selectedDate);
  const rangeStartKey = rangeStart ? dateKey(rangeStart) : "";

  const cells: (Date | null)[] = [];
  for (let index = 0; index < leading; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));

  return (
    <div className="mini-cal">
      <div className="mini-cal-head">
        <span>{capitalizeFirst(cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }))}</span>
        <span className="mini-cal-nav">
          <button type="button" onClick={() => onCursorChange(new Date(year, month - 1, 1))}>
            ‹
          </button>
          <button type="button" onClick={() => onCursorChange(new Date(year, month + 1, 1))}>
            ›
          </button>
        </span>
      </div>
      <div className="mini-cal-grid">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label[0]}</span>
        ))}
        {cells.map((day, index) => {
          if (!day) return <span key={`blank-${index}`} />;
          const key = dateKey(day);
          const classes = [
            key === todayKey ? "today" : "",
            key === selectedKey ? "selected" : "",
            key === rangeStartKey ? "range-anchor" : ""
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button type="button" key={key} className={classes} onClick={() => onSelectDay(day)}>
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthGrid({ days, items }: { days: Date[]; items: Item[] }) {
  const todayKey = dateKey(new Date());
  const leadingCount = days.length ? days[0].getDay() : 0;
  const totalCells = Math.ceil((leadingCount + days.length) / 7) * 7;
  const trailingCount = totalCells - leadingCount - days.length;

  const leadingDays = Array.from({ length: leadingCount }, (_, index) => {
    const day = new Date(days[0]);
    day.setDate(day.getDate() - (leadingCount - index));
    return day;
  });
  const trailingDays = Array.from({ length: trailingCount }, (_, index) => {
    const day = new Date(days[days.length - 1]);
    day.setDate(day.getDate() + index + 1);
    return day;
  });
  const allDays = [...leadingDays, ...days, ...trailingDays];

  return (
    <div className="calendar-board">
      <div className="calendar-weekdays">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {allDays.map((day) => {
          const key = dateKey(day);
          const dayItems = items.filter((item) => itemDate(item).slice(0, 10) === key);
          const isToday = key === todayKey;
          // Just like Google's month grid: no muted/dimmed style for days
          // outside the current month — plain number, with the short month
          // name appended only on the 1st, so the switch is still clear.
          const label =
            day.getDate() === 1
              ? `${day.toLocaleDateString("pt-BR", { day: "2-digit" })} ${day.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}`
              : day.toLocaleDateString("pt-BR", { day: "2-digit" });
          return (
            <section className={`calendar-day ${isToday ? "today" : ""}`} key={key}>
              <header>
                <strong>{label}</strong>
              </header>
              <div className="day-slots">
                {dayItems.length === 0 ? <span className="slot-empty">Livre</span> : null}
                {dayItems.map((item) => (
                  <EventChip item={item} key={item.id} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const HOUR_ROW_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, index) => index);

function minutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function HourGrid({ days, items }: { days: Date[]; items: Item[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayKey = dateKey(new Date());
  const now = new Date();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 7 * HOUR_ROW_HEIGHT;
    }
  }, []);

  return (
    <div className="hour-grid-wrap">
      {days.length > 1 ? (
        <div className="hour-col-heads" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {days.map((day) => {
            const key = dateKey(day);
            return (
              <div className={`hour-col-head ${key === todayKey ? "today" : ""}`} key={key}>
                <span>{day.toLocaleDateString("pt-BR", { weekday: "short" })}</span>
                <strong>{day.toLocaleDateString("pt-BR", { day: "2-digit" })}</strong>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="hour-scroll" ref={scrollRef}>
        <div className="hour-grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="hour-labels">
            {HOURS.map((hour) => (
              <span key={hour} style={{ height: HOUR_ROW_HEIGHT }}>
                {hour === 0 ? "" : `${hour}:00`}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const key = dateKey(day);
            const dayItems = items.filter((item) => itemDate(item).slice(0, 10) === key);
            const dayEvents = dayItems.filter((item) => item.itemType === "event" && item.startsAt);
            const dayTasks = dayItems.filter((item) => item.itemType === "task" && item.dueAt);
            const isToday = key === todayKey;
            const nowTop = (minutesOfDay(now) / 60) * HOUR_ROW_HEIGHT;

            return (
              <div className="hour-col" key={key}>
                {HOURS.map((hour) => (
                  <div className="hour-cell" key={hour} style={{ height: HOUR_ROW_HEIGHT }} />
                ))}
                {dayEvents.map((item) => {
                  const start = new Date(item.startsAt!);
                  const end = item.endsAt ? new Date(item.endsAt) : new Date(start.getTime() + 30 * 60000);
                  const top = (minutesOfDay(start) / 60) * HOUR_ROW_HEIGHT;
                  const height = Math.max(((end.getTime() - start.getTime()) / 60000 / 60) * HOUR_ROW_HEIGHT, 22);
                  return (
                    <div className="hour-block lane-event" key={item.id} style={{ top, height }} title={item.title}>
                      <strong>{item.title}</strong>
                      <small>{formatTime(item.startsAt)}</small>
                    </div>
                  );
                })}
                {dayTasks.map((item) => {
                  const due = new Date(item.dueAt!);
                  const overdue = item.status !== "completed" && due < now;
                  const top = (minutesOfDay(due) / 60) * HOUR_ROW_HEIGHT;
                  return (
                    <div
                      className={`hour-block lane-task ${item.status} ${overdue ? "overdue" : ""}`}
                      key={item.id}
                      style={{ top, height: 30 }}
                      title={item.title}
                    >
                      <span className="ring" />
                      {item.title}
                    </div>
                  );
                })}
                {isToday ? <div className="now-line" style={{ top: nowTop }} /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ItemsListView({
  items,
  loading,
  periodFilter,
  onComplete,
  onEditTitle,
  onEditDescription,
  onToggleAlarm,
  onReschedule,
  onCancel,
  onArchive,
  onDelete
}: {
  items: Item[];
  loading: boolean;
  periodFilter: React.ReactNode;
  onComplete: (id: string) => void;
  onEditTitle: (item: Item) => void;
  onEditDescription: (item: Item) => void;
  onToggleAlarm: (item: Item) => void;
  onReschedule: (item: Item) => void;
  onCancel: (item: Item) => void;
  onArchive: (item: Item) => void;
  onDelete: (item: Item) => void;
}) {
  const rows = [...items].sort((a, b) => new Date(itemDate(a)).getTime() - new Date(itemDate(b)).getTime());

  return (
    <section className="sheet-panel">
      <div className="view-toolbar">
        {periodFilter}
        <span>
          {rows.length} item{rows.length === 1 ? "" : "s"} no recorte atual
        </span>
      </div>

      <div className="sheet-scroll">
        <table className="sheet-table">
          <thead>
            <tr>
              <th className="sheet-rownum">#</th>
              <th>Tipo</th>
              <th>Titulo</th>
              <th>Quando</th>
              <th>Status</th>
              <th>Prioridade</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="sheet-empty">
                  Buscando itens...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="sheet-empty">
                  Nenhum item encontrado com os filtros atuais.
                </td>
              </tr>
            ) : (
              rows.map((item, index) => {
                const isTask = item.itemType === "task";
                const overdue = Boolean(isTask && item.status !== "completed" && item.dueAt && new Date(item.dueAt) < new Date());
                return (
                  <tr key={item.id}>
                    <td className="sheet-rownum">{index + 1}</td>
                    <td>{isTask ? "tarefa" : "evento"}</td>
                    <td>
                      {isTask ? `#${item.number} ` : ""}
                      {item.title}
                    </td>
                    <td className={overdue ? "sheet-overdue" : ""}>
                      {isTask
                        ? formatDateTime(item.dueAt)
                        : `${formatDateTime(item.startsAt)} - ${formatDateTime(item.endsAt)}`}
                    </td>
                    <td>{item.status}</td>
                    <td>{isTask && item.priority ? `P${item.priority}` : "-"}</td>
                    <td>
                      {isTask && item.status !== "completed" ? (
                        <button type="button" className="sheet-action" onClick={() => onComplete(item.id)}>
                          concluir
                        </button>
                      ) : null}
                      {item.status !== "cancelled" ? (
                        <button type="button" className="sheet-action" onClick={() => onEditTitle(item)}>
                          editar
                        </button>
                      ) : null}
                      {item.status !== "cancelled" ? (
                        <button type="button" className="sheet-action" onClick={() => onEditDescription(item)}>
                          descricao
                        </button>
                      ) : null}
                      {item.status !== "cancelled" ? (
                        <button type="button" className="sheet-action" onClick={() => onToggleAlarm(item)}>
                          {item.alarmEnabled === false ? "reativar alarme" : "silenciar"}
                        </button>
                      ) : null}
                      {item.status !== "cancelled" ? (
                        <button type="button" className="sheet-action" onClick={() => onReschedule(item)}>
                          reagendar
                        </button>
                      ) : null}
                      {item.status !== "cancelled" ? (
                        <button type="button" className="sheet-action" onClick={() => onCancel(item)}>
                          cancelar
                        </button>
                      ) : null}
                      {item.status !== "archived" ? (
                        <button type="button" className="sheet-action" onClick={() => onArchive(item)}>
                          arquivar
                        </button>
                      ) : null}
                      <button type="button" className="sheet-action sheet-action-danger" onClick={() => onDelete(item)}>
                        apagar
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const RULE_KIND_ORDER: Record<NotificationRuleKind, number> = {
  before_due: 0,
  after_due: 1,
  repeat_until_done: 2,
  daily_summary: 3
};

function AutomationsView({
  policies,
  loading,
  filter,
  onFilterChange,
  onReload
}: {
  policies: NotificationPolicy[];
  loading: boolean;
  filter: string;
  onFilterChange: (policyId: string) => void;
  onReload: () => void;
}) {
  const rows = policies
    .filter((policy) => !filter || policy.id === filter)
    .flatMap((policy) => policy.rules.map((rule) => ({ policy, rule })))
    .sort((a, b) => a.policy.name.localeCompare(b.policy.name) || RULE_KIND_ORDER[a.rule.kind] - RULE_KIND_ORDER[b.rule.kind]);

  const totalRules = policies.reduce((sum, policy) => sum + policy.rules.length, 0);

  return (
    <section className="automations-panel">
      <div className="view-toolbar">
        <label className="automations-filter">
          Politica
          <select value={filter} onChange={(event) => onFilterChange(event.target.value)}>
            <option value="">Todas ({policies.length})</option>
            {policies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.name} ({policy.rules.length})
              </option>
            ))}
          </select>
        </label>
        <span>
          {totalRules} regra{totalRules === 1 ? "" : "s"} no total
        </span>
        <button type="button" className="icon-button secondary" title="Atualizar" onClick={onReload}>
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="sheet-scroll">
        <table className="sheet-table">
          <thead>
            <tr>
              <th className="sheet-rownum">#</th>
              <th>Politica</th>
              <th>Regra</th>
              <th>Quando</th>
              <th>Ativa</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="sheet-empty">
                  Carregando automacoes...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="sheet-empty">
                  Nenhuma regra de automacao encontrada.
                </td>
              </tr>
            ) : (
              rows.map(({ policy, rule }, index) => (
                <tr key={rule.id}>
                  <td className="sheet-rownum">{index + 1}</td>
                  <td>
                    {policy.name}
                    {policy.isDefault ? " (padrao)" : ""}
                  </td>
                  <td>{RULE_KIND_LABELS[rule.kind]}</td>
                  <td>{ruleWhenLabel(rule)}</td>
                  <td>{rule.enabled ? "sim" : "nao"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Placeholder({ view }: { view: View }) {
  return (
    <section className="placeholder">
      <h2>{view === "notifications" ? "Politicas e proximas cobrancas" : "Configuracoes do motor"}</h2>
      <p>
        Esta area ja esta reservada para a proxima etapa do MVP. Aqui entram presets de cobranca, webhooks do n8n,
        usuarios, workspace e preferencias de resumo diario.
      </p>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
