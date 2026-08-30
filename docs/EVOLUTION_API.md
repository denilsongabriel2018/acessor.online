# Evolution API — referencia tecnica

Evolution API e o gateway de WhatsApp que o projeto usa (self-hosted). Aqui vai
so o que precisamos pra integrar via `HTTP Request` puro no n8n — **decisao
deliberada de nao usar o community node `n8n-nodes-evolution-api`**, pelo
mesmo motivo de nao usar o node oficial `OpenAI`: transparencia total do que
e enviado/recebido, sem depender de versao de node de terceiro.

Fontes: [docs.evolutionfoundation.com.br](https://docs.evolutionfoundation.com.br/),
[n8n-nodes-evolution-api no npm](https://www.npmjs.com/package/n8n-nodes-evolution-api).

## Instancia deste projeto

- Nome da instancia: `denilson`
- URL base: `https://api.assessoriatrafegando.com.br`
- Token (`apikey`): **nao fica em nenhum arquivo do projeto** — vive como
  variavel de ambiente / credencial no n8n (`Authorization`/`apikey` header),
  nunca em texto no codigo do workflow ou neste repositorio.

## Autenticacao

Toda chamada leva um header:
```
apikey: <TOKEN_DA_INSTANCIA>
```

## Enviar mensagem de texto

**Atencao**: a doc publica (e outras versoes da Evolution API) descrevem o
texto aninhado em `textMessage.text`, mas na pratica (testado nesta
instancia via curl) a API rejeita isso com
`"instance requires property \"text\""` — o campo `text` tem que estar
direto na raiz do body:

```
POST {URL_BASE}/message/sendText/{instanceName}
Headers: apikey: <TOKEN>
Body:
{
  "number": "5511999999999",
  "text": "sua mensagem aqui",
  "delay": 1200,          // opcional, ms de "digitando..." antes de enviar
  "linkPreview": true     // opcional
}
```

`number` e o telefone com DDI, sem `+` nem espacos (ex: `5511999999999`).

## Configurar o webhook (mensagens recebidas)

**Atencao**: a doc publica descreve o body sem o wrapper `webhook`, mas na
pratica (testado nesta instancia) a API exige os campos aninhados dentro de
uma chave `webhook`:

```
POST {URL_BASE}/webhook/set/{instanceName}
Headers: apikey: <TOKEN>
Body:
{
  "webhook": {
    "url": "https://sua-url-do-n8n.com/webhook/whatsapp-mensagem",
    "enabled": true,
    "webhookByEvents": false,
    "events": ["MESSAGES_UPSERT"]
  }
}
```

Pra conferir o que esta configurado agora: `GET {URL_BASE}/webhook/find/{instanceName}` (mesmo header `apikey`).

- `MESSAGES_UPSERT` = "chegou uma mensagem nova" — e o unico evento que
  interessa pro nosso fluxo de entrada.
- Com `webhook_by_events: false`, tudo cai na mesma URL (`url` acima). Se
  fosse `true`, o Evolution anexaria o nome do evento na URL
  (`.../webhook/messages-upsert`).
- So precisa chamar esse `POST` **uma vez** pra configurar (ou de novo se a
  URL do n8n mudar) — nao e algo que o workflow chama toda hora.

## Payload que chega no nosso webhook quando uma mensagem e recebida

A documentacao publica nao lista o schema completo do `MESSAGES_UPSERT`, mas
o formato real (Baileys/WhatsApp Web protocol, que e o que a Evolution API
usa por baixo) segue este padrao:

```json
{
  "instance": "denilson",
  "event": "messages.upsert",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": false,
      "id": "..."
    },
    "pushName": "Nome do contato",
    "message": {
      "conversation": "texto da mensagem, quando e mensagem de texto simples"
      // OU, se for resposta a algo, ou mensagem com formatacao:
      // "extendedTextMessage": { "text": "texto da mensagem" }
    },
    "messageTimestamp": 1735500000
  }
}
```

Pontos de atencao pra quando formos ler isso no node "Normalizar entrada" do
n8n:

- **Telefone**: `data.key.remoteJid`, mas vem com sufixo `@s.whatsapp.net` —
  precisa cortar isso pra ficar so o numero (`5511999999999`).
- **Texto da mensagem**: pode vir em `data.message.conversation` (mensagem
  simples) OU `data.message.extendedTextMessage.text` (mensagem com contexto,
  ex: resposta a outra mensagem) — o node precisa checar os dois.
- **Ignorar mensagens que a gente mesmo mandou**: `data.key.fromMe === true`
  significa que foi o proprio WhatsApp conectado que enviou (ex: nossa
  resposta), nao o usuario — se nao filtrar isso, o bot pode entrar em loop
  respondendo a si mesmo.
- **Grupos**: se `remoteJid` terminar em `@g.us` em vez de
  `@s.whatsapp.net`, e mensagem de grupo, nao de conversa individual — vale
  decidir se o bot deve responder em grupo ou ignorar.

Como a doc publica nao confirma esse schema 100% em detalhe, o certo e
**validar com uma mensagem de teste real** assim que o webhook estiver
configurado, antes de confiar cegamente nesse formato.

## Verificar se um numero tem WhatsApp

```
POST {URL_BASE}/chat/whatsappNumbers/{instanceName}
Headers: apikey: <TOKEN>
Body: { "numbers": ["5511999999999"] }
```

Util caso a gente queira validar um numero antes de tentar mandar mensagem
pra ele (nao usado ainda, mas documentado pra quando precisar).
