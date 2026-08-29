-- Configuracao mutavel de integracoes externas (Evolution API, n8n, e o que
-- vier depois). Tudo que pode mudar facil (dominio, nome de instancia,
-- caminho de webhook) fica aqui, nao hardcoded em codigo/workflow - trocar
-- de servidor vira um UPDATE, nao um redeploy.
create table if not exists public.integration_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('evolution_api', 'n8n')),
  base_url text not null,
  instance_name text,
  extra jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

alter table public.integration_settings enable row level security;

insert into public.integration_settings (workspace_id, provider, base_url, instance_name, extra)
values
  (
    '00000000-0000-4000-8000-000000000001',
    'evolution_api',
    'https://api.assessoriatrafegando.com.br',
    'denilson',
    '{}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    'n8n',
    'https://editor.assessoriatrafegando.com.br',
    null,
    '{"notificationWebhookPath": "/webhook/lembrete-vencido"}'::jsonb
  )
on conflict (workspace_id, provider) do nothing;
