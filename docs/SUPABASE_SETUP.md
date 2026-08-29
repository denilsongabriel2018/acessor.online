# Supabase Setup

## Como aplicar o schema

1. Abra o projeto no Supabase.
2. Entre em SQL Editor.
3. Copie o conteudo de `supabase/migrations/001_initial_schema.sql`.
4. Execute o SQL.
5. No `.env`, troque:

```env
STORAGE_DRIVER=supabase
```

Enquanto `STORAGE_DRIVER=memory`, o app roda localmente sem persistir os dados.

## Aplicar pela CLI

O caminho mais direto e preencher no `.env`:

```env
SUPABASE_DB_URL=
```

Esse valor fica em:

```text
Supabase > Project Settings > Database > Connection string
```

Depois rode:

```bash
supabase db push --db-url "$SUPABASE_DB_URL" --include-all
```

## Regras importantes

- `SUPABASE_SERVICE_ROLE_KEY` fica somente no backend.
- `SUPABASE_ANON_KEY` pode ser usada no frontend apenas com RLS ativo.
- O workspace inicial do MVP e `00000000-0000-4000-8000-000000000001`.
- O backend usa filtros antes de consultar/listar dados. O frontend nao deve carregar tudo para filtrar localmente.
