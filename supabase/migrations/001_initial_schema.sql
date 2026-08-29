create extension if not exists "pgcrypto";

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  name text,
  email text,
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references public.app_users(id) on delete set null,
  external_user_id text not null,
  phone_number text,
  provider text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, external_user_id)
);

create table if not exists public.notification_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.notification_policies(id) on delete cascade,
  kind text not null check (kind in ('before_due', 'after_due', 'repeat_until_done', 'daily_summary')),
  offset_minutes integer,
  start_after_minutes integer,
  repeat_every_minutes integer,
  time_of_day text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  assigned_user_id uuid references public.app_users(id) on delete set null,
  number integer not null,
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  priority integer not null default 3 check (priority between 1 and 5),
  due_at timestamptz,
  completed_at timestamptz,
  source text not null default 'api',
  original_message text,
  notification_policy_id uuid references public.notification_policies(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, number)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  source text not null default 'api',
  original_message text,
  notification_policy_id uuid references public.notification_policies(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.scheduled_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  item_type text not null check (item_type in ('task', 'event')),
  item_id uuid not null,
  notification_kind text not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempt_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scheduled_notification_id uuid references public.scheduled_notifications(id) on delete set null,
  event_type text not null,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  response jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_command_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  user_external_id text,
  intent text,
  payload jsonb not null default '{}'::jsonb,
  api_response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tasks_workspace_due_idx on public.tasks (workspace_id, due_at);
create index if not exists tasks_workspace_status_priority_number_idx on public.tasks (workspace_id, status, priority, number);
create index if not exists events_workspace_starts_idx on public.events (workspace_id, starts_at);
create index if not exists events_workspace_status_starts_idx on public.events (workspace_id, status, starts_at);
create index if not exists scheduled_notifications_due_idx on public.scheduled_notifications (status, scheduled_for);

alter table public.workspaces enable row level security;
alter table public.app_users enable row level security;
alter table public.workspace_members enable row level security;
alter table public.whatsapp_connections enable row level security;
alter table public.notification_policies enable row level security;
alter table public.notification_rules enable row level security;
alter table public.tasks enable row level security;
alter table public.events enable row level security;
alter table public.scheduled_notifications enable row level security;
alter table public.notification_logs enable row level security;
alter table public.ai_command_logs enable row level security;

insert into public.workspaces (id, name)
values ('00000000-0000-4000-8000-000000000001', 'Workspace MVP')
on conflict (id) do nothing;

insert into public.notification_policies (id, workspace_id, name, is_default)
values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'Leve', false),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'Normal', true),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 'Intenso', false)
on conflict (id) do nothing;

insert into public.notification_rules (policy_id, kind, offset_minutes, start_after_minutes, repeat_every_minutes, time_of_day)
values
  ('00000000-0000-4000-8000-000000000101', 'before_due', -60, null, null, null),
  ('00000000-0000-4000-8000-000000000101', 'before_due', -10, null, null, null),
  ('00000000-0000-4000-8000-000000000101', 'after_due', 60, null, null, null),
  ('00000000-0000-4000-8000-000000000101', 'repeat_until_done', null, 60, 1440, null),
  ('00000000-0000-4000-8000-000000000102', 'before_due', -180, null, null, null),
  ('00000000-0000-4000-8000-000000000102', 'before_due', -60, null, null, null),
  ('00000000-0000-4000-8000-000000000102', 'before_due', -30, null, null, null),
  ('00000000-0000-4000-8000-000000000102', 'after_due', 60, null, null, null),
  ('00000000-0000-4000-8000-000000000102', 'after_due', 180, null, null, null),
  ('00000000-0000-4000-8000-000000000102', 'repeat_until_done', null, 180, 720, null),
  ('00000000-0000-4000-8000-000000000102', 'daily_summary', null, null, null, '08:30'),
  ('00000000-0000-4000-8000-000000000103', 'before_due', -600, null, null, null),
  ('00000000-0000-4000-8000-000000000103', 'before_due', -180, null, null, null),
  ('00000000-0000-4000-8000-000000000103', 'before_due', -60, null, null, null),
  ('00000000-0000-4000-8000-000000000103', 'before_due', -30, null, null, null),
  ('00000000-0000-4000-8000-000000000103', 'before_due', -5, null, null, null),
  ('00000000-0000-4000-8000-000000000103', 'before_due', -1, null, null, null),
  ('00000000-0000-4000-8000-000000000103', 'after_due', 60, null, null, null),
  ('00000000-0000-4000-8000-000000000103', 'after_due', 180, null, null, null),
  ('00000000-0000-4000-8000-000000000103', 'repeat_until_done', null, 180, 360, null)
on conflict do nothing;

