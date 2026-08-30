-- Liga/desliga o alarme de uma tarefa/evento sem perder o modo de aviso
-- configurado (Leve/Normal/Intenso continua guardado, so fica pausado).

alter table public.tasks add column if not exists alarm_enabled boolean not null default true;
alter table public.events add column if not exists alarm_enabled boolean not null default true;
