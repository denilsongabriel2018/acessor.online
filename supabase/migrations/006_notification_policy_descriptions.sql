alter table public.notification_policies add column if not exists description text;

update public.notification_policies set description =
  'Poucos avisos: 1h e 10min antes do prazo; se passar, avisa 1h depois e insiste a cada 24h ate voce concluir.'
where id = '00000000-0000-4000-8000-000000000101';

update public.notification_policies set description =
  'Equilibrio: avisa 3h, 1h e 30min antes do prazo; se passar, avisa 1h e 3h depois e insiste a cada 12h ate concluir; tambem manda um resumo diario as 8h30.'
where id = '00000000-0000-4000-8000-000000000102';

update public.notification_policies set description =
  'Maxima insistencia: avisa 10h, 3h, 1h, 30min, 5min e 1min antes do prazo; se passar, avisa 1h e 3h depois e insiste a cada 6h ate voce concluir.'
where id = '00000000-0000-4000-8000-000000000103';
