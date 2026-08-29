# Plano de Acao - App de Tasks e Agenda

## Objetivo

Criar um sistema multiusuario de tarefas e agenda, controlado principalmente por WhatsApp via n8n, com interpretacao por IA, API propria, Supabase como banco, painel web e automacoes de aviso/cobranca.

## Arquitetura

```text
WhatsApp -> n8n -> IA interpreta -> API do app -> Supabase
                                      |
                                      v
                              Scheduler de avisos
                                      |
                                      v
                              n8n -> IA resposta -> WhatsApp

Frontend -> API do app -> Supabase
```

O n8n cuida da conversa e integracoes. A API cuida das regras, dados, tarefas, eventos, prioridades, cobrancas e respostas estruturadas.

## Stack Recomendada

- Frontend: React + Vite
- Backend: Node.js + Fastify
- Banco: Supabase/PostgreSQL
- Validacao: Zod
- Auth: Supabase Auth
- Automacoes: scheduler no backend
- Workflow: n8n self-hosted
- IA: OpenAI API no n8n
- Infra: VPS + Docker Compose + Caddy ou Nginx

## Separacao Entre Tasks e Agenda

Task e algo que precisa ser concluido.

Exemplos:

- Enviar proposta
- Pagar boleto
- Fazer follow-up
- Revisar contrato

Evento de agenda e algo que acontece em um horario.

Exemplos:

- Reuniao
- Consulta
- Call
- Visita tecnica

Tasks tem numero, prioridade, status, prazo e politica de cobranca. Eventos tem inicio, fim, local opcional e politica de lembrete.

## Multiusuario Desde o Inicio

Mesmo que poucas pessoas usem no comeco, o sistema deve nascer multiusuario.

Tabelas base:

- users
- workspaces
- workspace_members
- tasks
- events
- notification_policies
- notification_rules
- scheduled_notifications
- notification_logs
- message_logs
- ai_command_logs
- whatsapp_connections
- integration_webhooks

Todas as tabelas principais devem ter `workspace_id`. Quando fizer sentido, tambem `user_id` ou `assigned_user_id`.

## Contrato n8n -> API

O n8n interpreta a mensagem e envia um comando estruturado para a API.

Exemplo:

```json
{
  "user_external_id": "5511999999999",
  "source": "whatsapp",
  "intent": "create_task",
  "item_type": "task",
  "title": "Enviar proposta para Joao",
  "due_at": "2026-08-30T10:00:00-03:00",
  "priority": 2,
  "original_message": "me lembra de enviar proposta para Joao amanha as 10 prioridade 2",
  "confidence": 0.94
}
```

A API nao deve aceitar `user_id` livre vindo do n8n. Ela deve resolver o usuario internamente a partir do WhatsApp ou identificador externo.

## Intents Iniciais

- create_task
- create_event
- complete_task
- reschedule_item
- cancel_item
- list_items
- update_notification_policy
- get_summary
- unknown

## Resposta API -> n8n

A API sempre deve retornar JSON estruturado.

```json
{
  "ok": true,
  "intent": "complete_task",
  "data": {
    "completed": [],
    "not_found": [],
    "still_pending_count": 4
  },
  "errors": [],
  "warnings": [],
  "meta": {
    "request_id": "uuid",
    "processed_at": "2026-08-29T10:30:00-03:00"
  }
}
```

O n8n recebe esse JSON e usa outra IA para gerar a mensagem final no WhatsApp.

## Consultas por Periodo

O sistema nao deve ficar preso a semana ou mes. Toda consulta deve aceitar periodo flexivel.

Exemplos:

- hoje
- amanha
- essa semana
- proximos 7 dias
- esse mes
- entre 10/09 e 20/09

Formato:

```json
{
  "intent": "list_items",
  "item_type": "task",
  "period": {
    "label": "proximos 7 dias",
    "start_at": "2026-08-29T00:00:00-03:00",
    "end_at": "2026-09-05T23:59:59-03:00"
  },
  "filters": {
    "status": "pending"
  }
}
```

## Politicas de Aviso e Cobranca

Nada deve ficar fixo no codigo. O sistema deve ter presets, mas permitir editar, remover e adicionar regras.

Presets iniciais:

### Leve

- 1h antes
- 10min antes
- 1h depois se atrasar
- repetir a cada 24h

### Normal

- 3h antes
- 1h antes
- 30min antes
- 1h depois
- 3h depois
- repetir a cada 12h

### Intenso

- 10h antes
- 3h antes
- 1h antes
- 30min antes
- 5min antes
- 1min antes
- 1h depois
- 3h depois
- repetir a cada 6h

Regras possiveis:

- before_due
- after_due
- repeat_until_done
- daily_summary

Exemplo de politica customizada:

```json
{
  "before_due_minutes": [180, 60, 30],
  "after_due_minutes": [60, 180],
  "repeat_until_done": {
    "enabled": true,
    "every_minutes": 720,
    "start_after_minutes": 180
  }
}
```

## Automacoes de Aviso

O app decide quando avisar. O n8n decide como escrever e enviar.

Fluxo:

```text
Scheduler -> busca notificacoes pendentes -> valida status -> chama webhook do n8n -> marca como enviada
```

Se for uma regra `repeat_until_done` e a tarefa ainda estiver pendente, o app cria a proxima notificacao.

## Resumo Diario

Por padrao, todo dia as 08:30 o usuario recebe um resumo.

O horario deve ser configuravel por usuario.

O resumo deve incluir:

- tarefas concluidas
- tarefas em atraso
- tarefas para entregar hoje
- tarefas do periodo configurado

## Frontend

O front deve ser um painel operacional.

Telas do MVP:

- Hoje
- Agenda
- Tarefas
- Cobrancas
- Configuracoes

Modo agenda:

- Dia
- Semana
- Lista

Cores:

- Roxo: task
- Verde: evento
- Vermelho discreto: atraso
- Cinza: concluido ou cancelado

## Google Agenda

Nao e obrigatorio no MVP.

O app deve ter calendario proprio. Google Agenda pode ser uma integracao opcional futura.

Para evitar retrabalho, criar a ideia de provider:

- internal_calendar
- google_calendar

O Supabase continua sendo a fonte da verdade.

## Seguranca Basica

Obrigatorio desde o inicio:

- HTTPS
- login no frontend
- Supabase RLS
- service_role somente no backend
- CORS restrito
- API key ou HMAC entre n8n e backend
- Zod em todos os payloads
- rate limit
- logs sem segredos
- n8n protegido por senha
- firewall na VPS

O frontend nunca pode ter:

- SUPABASE_SERVICE_ROLE_KEY
- OPENAI_API_KEY
- WHATSAPP_API_KEY
- N8N_API_KEY
- GOOGLE_CLIENT_SECRET

## VPS

Estrutura inicial:

```text
api
web
n8n
caddy
```

Supabase fica externo.

Dominios sugeridos:

- app.seudominio.com
- api.seudominio.com
- n8n.seudominio.com

VPS inicial sugerida:

- 2 vCPU
- 4 GB RAM
- 40 GB SSD
- Ubuntu 22.04 ou 24.04

## Ordem de Execucao

1. Criar documentacao base.
2. Criar schema no Supabase.
3. Criar backend com `/api/commands`.
4. Implementar tasks.
5. Implementar events.
6. Implementar politicas de aviso.
7. Implementar scheduler.
8. Criar workflow n8n de entrada.
9. Criar workflow n8n de avisos.
10. Criar frontend.
11. Fazer deploy na VPS.
12. Testar WhatsApp ponta a ponta.

## MVP

Primeira versao funcional:

- criar task por comando estruturado
- criar evento por comando estruturado
- listar por periodo
- concluir task por numero
- usar politica de aviso normal
- scheduler chamando n8n
- front com Hoje, Tarefas e Agenda

Depois:

- audio
- IA mais refinada
- politicas avancadas
- multiworkspace completo
- Google Agenda opcional
- relatorios

## O Que Vai Precisar

Contas:

- Supabase
- OpenAI API
- VPS
- dominio
- provedor WhatsApp API
- n8n self-hosted

Conhecimentos:

- Node.js basico
- React basico
- PostgreSQL basico
- Docker Compose basico
- n8n basico
- webhooks/API
- variaveis de ambiente

Ferramentas:

- VS Code
- Git/GitHub
- Postman ou Insomnia
- terminal SSH
- painel do Supabase

