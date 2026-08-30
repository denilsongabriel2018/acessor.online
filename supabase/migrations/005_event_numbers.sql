-- Da aos eventos um numero sequencial por workspace, igual as tarefas ja
-- tem, pra dar pra referenciar um evento especifico via WhatsApp (excluir,
-- arquivar, editar, buscar) sem precisar do UUID interno.

alter table public.events add column if not exists number integer;

with numbered as (
  select id, row_number() over (partition by workspace_id order by created_at, id) as rn
  from public.events
  where number is null
)
update public.events e
set number = numbered.rn
from numbered
where e.id = numbered.id;

alter table public.events alter column number set not null;

alter table public.events
  add constraint events_workspace_number_unique unique (workspace_id, number);

create index if not exists events_workspace_number_idx on public.events (workspace_id, number);
