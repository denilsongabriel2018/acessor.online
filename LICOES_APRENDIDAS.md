# Licoes Aprendidas — Agenda Motor / Acessor

Registro do conhecimento adquirido construindo esse projeto (API + n8n + WhatsApp + web), pra usar como referencia em projetos futuros.

## 1. Ordem de trabalho mais rapida

**Backend primeiro, frontend depois — quase sempre.**

Motivo: o frontend e uma "vista" sobre o que o backend expoe. Construir a tela antes da API existir significa chutar formato de dado que vai mudar, retrabalho garantido. O backend da pra testar e validar com curl/script, sem precisar de UI — ciclo de iteracao muito mais rapido que clicar na tela toda hora.

Ordem que funcionou bem nesse projeto:
1. **Modelo de dados** (tabelas, tipos) — decisao que se propaga pra tudo, acertar cedo.
2. **Logica de negocio / endpoints**, testados localmente (aqui: `STORAGE_DRIVER=memory` + curl, sem precisar do Supabase nem de autenticacao real).
3. **A parte mais imprevisivel primeiro** — nesse projeto foi a integracao WhatsApp/n8n, que trouxe surpresas grandes (formato do payload da Evolution API, LID em vez de numero de telefone, como o `$fromAI` funciona de verdade). Descobrir essas pedras cedo evita redesenhar depois.
4. **Frontend por ultimo**, quando o contrato da API ja esta estavel.
5. **Deploy/infra** — ter um esqueleto cedo e ok, mas nao vale investir tempo refinando isso antes da logica estar provada.

Excecao: se o projeto EH a interface (prototipo visual, validar UX com usuario cedo), af pode fazer sentido inverter.

## 2. Forma mais rapida de lidar com problemas

- **Reproduzir no menor teste possivel.** Nesse projeto, testar via `curl` num servidor local em modo memoria pegou bugs em segundos — testar so pelo WhatsApp real (que passa por n8n, IA, Evolution API) levava minutos por tentativa e escondia em qual camada estava o erro.
- **Pegar o dado bruto antes de teorizar.** Varias vezes uma teoria plausivel (ex: "e um problema de aspas na descricao") atrasou a solucao real, que so apareceu quando pedi o request/response cru. Regra: ver o erro/dado real antes de propor a causa.
- **Reconhecer CLASSE de bug, nao so a instancia.** Quando "IA manda string vazia em vez de undefined" foi identificado como padrao (nao um bug isolado do campo X), a correcao (`emptyToUndefined`) foi aplicada de uma vez em todos os campos parecidos, evitando repetir o mesmo bug campo por campo.
- **Quando o mesmo tipo de erro persiste apesar de "corrigido", desconfiar da ferramenta/infra, nao so do codigo.** O bug do `$fromAI` parecia ser sobre aspas, depois sobre parenteses, e no fim era sobre o campo JSON Body estar no modo errado (Fixed vs Expression) — cada camada de sintoma escondia a causa raiz real, que so apareceu inspecionando o request de verdade saindo do n8n.
- **Perguntar quando genuinamente incerto, em vez de tentar e ver o que acontece.** Confirmar se um erro era de uma execucao antiga ou nova, se um dado colado era resolvido ou bruto, evitou varias rodadas de correcao em cima da suposicao errada.

## 3. Como criar uma API — perguntas pra se fazer

### Perguntas de design, antes de escrever codigo

- **Quem sao TODOS os consumidores?** Aqui teve 3: bot do WhatsApp (via n8n), site, e o proprio n8n de notificacoes. Cada um pode precisar de um formato diferente do MESMO dado (foi o motivo do filtro `detail: simple/advanced` — a IA nao precisa do mesmo tanto de campo que o site precisa pra editar). Liste os consumidores ANTES de desenhar o schema — evita descobrir um requisito de formato tarde e ter que quebrar contrato.
- **Onde fica a fonte de verdade?** Uma unica camada (`store.ts`, com driver de memoria e driver Supabase por baixo do mesmo contrato) que todo o resto passa por cima, em vez de cada consumidor reimplementar a logica. Rota HTTP so deve validar entrada, chamar essa camada, e formatar saida — nunca ter regra de negocio duplicada em dois lugares.
- **O que e opcional, e como cada chamador representa "nao especifiquei"?** Um humano preenchendo formulario manda `undefined` de verdade; uma IA fazendo function-calling quase sempre manda string vazia `""`. O schema precisa aceitar os dois formatos de "vazio" de forma defensiva.
- **Que identificador cada consumidor realmente precisa?** UUID interno serve pra joins/integridade; consumidor humano (usuario dizendo "tarefa 3" no WhatsApp) precisa de numero sequencial pequeno, nao UUID.
- **Onde tem efeito colateral, e ele e seguro de repetir?** (ex: completar tarefa, agendar notificacao — idempotencia importa quando a IA pode tentar de novo, seja por erro de rede ou por ela "confundir" e chamar a ferramenta duas vezes).
- **O que acontece quando uma integracao downstream ainda nao tem suporte pra um dado novo?** (ex: adicionar campo no backend antes de ter UI no site pra ele — precisa decidir se isso e aceitavel temporariamente ou se trava o rollout).

### Contrato de resposta — consistencia importa mais que parecer bonito

Toda resposta desse projeto segue o mesmo envelope, sempre, sucesso ou erro:
```json
{ "ok": true, "intent": "...", "data": {...}, "errors": [], "warnings": [], "meta": { "request_id": "...", "processed_at": "..." } }
```
Isso significa que quem consome (a IA, o site) nunca precisa checar "esse endpoint devolve direto o objeto ou dentro de uma chave?" — e sempre igual. `request_id` em toda resposta tambem virou essencial na pratica: quando um teste dava erro, conseguir citar o `request_id` no log do servidor foi o que permitiu achar rapido qual requisicao especifica falhou.

### Erros: pense em quem vai LER a mensagem

Erro de validacao (Zod) devolvido como texto puro concatenado funciona pra humano debugando no curl, mas pra uma IA reagir direito (ex: pedir de novo o campo certo) faz diferenca ter `path` (qual campo) separado da `message` (o que esperava) — foi assim que consegui diagnosticar os bugs de `$fromAI` rapido: o JSON estruturado do Zod (`path`, `code`, `values`) revelou o campo exato, o texto concatenado escondia isso.

### Autenticacao e limites — o minimo que evita dor de cabeca

- Rota que a IA/n8n chama: segredo compartilhado num header (`x-n8n-to-api-secret`), simples e suficiente pra um sistema fechado ponto-a-ponto.
- Rota que o navegador chama direto: normalmente precisa de token de usuario de verdade (aqui ficou como divida tecnica deliberada — documentada, nao esquecida, porque a rede ainda e fechada).
- Rate limit (`@fastify/rate-limit`) desde o dia 1, mesmo em projeto pequeno — barato de configurar, evita que um loop com bug em algum client vire incidente.

### Nomes por valor, IDs por indice — resolvendo os dois lados

Padrao usado varias vezes aqui: a IA/usuario fala por NOME (`"leve"`, `"intenso"`), o banco guarda por UUID. Em vez de expor o UUID pra IA (ilegivel, ela erra) ou trocar o banco pra usar nome como chave primaria (frágil se o nome mudar), a API resolve nome→id na entrada (`resolvePolicyId`) e devolve nome junto do id na saida (`withPolicyName`) — os dois mundos ficam desacoplados sem a IA nunca precisar saber que UUID existe.

### Evoluir sem quebrar quem ja consome

- Campo novo em request: sempre opcional com default sensato (`detail` no `list_items` — quem nao manda, continua recebendo o comportamento de sempre).
- Campo novo em response: adicionar, nunca remover ou renomear um campo que um consumidor ja depende (renomear quebra silenciosamente quem le por nome de campo, sem erro nenhum ate o dado sumir).
- Mudanca de comportamento (ex: formato de lista mais enxuto): decidir por ONDE a chamada entra (rota `/api/commands` vs `/api/items`) ou por um parametro explicito, nunca mudar o default de uma rota que outro consumidor ja depende sem avisar.

## 4. Licoes tecnicas especificas desse projeto

### Validacao de input vindo de IA (Zod)
- IA manda `""` onde um humano mandaria campo ausente → usar um preprocessor tipo `emptyToUndefined` de forma generalizada, nao campo a campo.
- IA manda lista como string separada por virgula (`"1,2"`) em vez de array de verdade → aceitar os dois formatos.
- IA manda booleano como string (`"true"/"false"`) → `z.coerce.boolean()` e enganoso (`Boolean("false") === true`!); fazer preprocessor comparando a string por igualdade.
- IA manda numero como string (`"1"`) em campo que exige number estrito → usar `z.coerce.number()` em vez de `z.number()` em qualquer campo que uma IA vai preencher.

### n8n — integracao com WhatsApp/IA
- Prefira `newCredential()` a valores literais em header — evita que o `update_workflow` (push via MCP) apague segredo hardcoded a cada publicacao.
- Mensagem de grupo no WhatsApp: quem mandou de verdade vem em `key.participant`, nao em `key.remoteJid` (que e o ID do proprio grupo). E o WhatsApp pode mandar esse participant como `...@lid` (ID opaco) em vez de numero de telefone — depende da conta/instancia, quebra qualquer allowlist baseada em numero.
- Campo "JSON Body" de um `httpRequestTool`, quando editado colando texto bruto (fora do MCP), precisa estar no modo certo: se for "Using JSON" (um campo so), a expressao tem que ser UMA so, `={{ JSON.stringify({...}) }}`, com `$fromAI()` chamado direto dentro do objeto — colar JSON com `={{ }}` por campo individual NAO funciona nesse modo (o n8n so avalia expressao se o campo INTEIRO estiver marcado como Expression).
- Descricao de campo de `$fromAI()` com aspas simples embutidas (`'task'`, `'leve'`) pode gerar `Unbalanced parentheses` no parser do n8n — evitar aspas dentro do texto da descricao.
- Code node que constroi um item novo do zero (`return [{ json: {...} }]`) quebra o rastreamento de `pairedItem` — referencias tipo `$('OutroNode').item` param de funcionar depois disso; trocar por `$('OutroNode').first()` quando so existe 1 item no fluxo.

### Design de API
- Comandos unificados por `item_type` (`get_item`/`update_item`/`archive_item`/`delete_item` aceitando "task" ou "event") em vez de duplicar 8 ferramentas quase identicas — menos superficie pra IA errar e pra manter.
- Enderecar por numero sequencial (nao UUID) pra tudo que um humano/IA vai citar em conversa.
- Notificacoes que vencem juntas (varios avisos atrasados de uma vez) devem ser deduplicadas — manter so o mais recente por item, nao mandar todos.
- Payload de listagem pesa proporcional a quantidade de itens — vale ter um modo "enxuto" pra quem so precisa resumir (IA) e completo pra quem precisa editar (site).

### Fluxo de teste que funcionou bem
- Servidor local em modo memoria (`STORAGE_DRIVER=memory`) + `curl` pro `/api/commands` — testa regra de negocio em segundos, sem depender de WhatsApp/n8n/Supabase.
- Script `.mjs` descartavel importando modulos internos direto (`import("./src/store.ts")`) pra testar coisas que nao tem rota HTTP (ex: logica do agendador de notificacao).
- Teste ponta-a-ponta real (criar item de verdade, esperar notificacao real chegar) antes de considerar uma feature "pronta" — pegou coisas que o teste local nao pegava (o `notification-agenda` do n8n, por exemplo).
