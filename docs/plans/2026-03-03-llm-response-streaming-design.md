# LLM Response Streaming Design

## Problem

The bot currently waits for the full OpenAI response before sending anything to the user. For complex queries involving tool calls, this can mean several seconds of silence. The new Telegram Bot API 9.5 `sendMessageDraft` method allows streaming partial messages as animated drafts.

## Solution

Stream OpenAI responses to the user in real-time using `sendMessageDraft` via the `@grammyjs/stream` plugin. Show ephemeral tool status messages during tool execution that get replaced by the actual response.

## Streaming Protocol (DO <-> Webhook Handler)

The Durable Object returns a `ReadableStream` of newline-delimited JSON (NDJSON) events:

```
{"type":"tool","name":"firefly_query_transactions"}
{"type":"text","content":"Este mes "}
{"type":"text","content":"gastaste 247,50€..."}
{"type":"done","chartUrl":"https://..."}
```

Event types:
- `tool` — a tool is being executed (triggers ephemeral status message)
- `text` — a chunk of the LLM's text response
- `done` — stream complete, optionally carries chartUrl
- `error` — something went wrong

Why NDJSON over SSE: simpler to produce/consume, no EventSource needed, works naturally with ReadableStream on Workers.

## Stream Flow

```
User message
  |
  +-- DO starts OpenAI stream (iteration 1)
  |     +-- OpenAI returns tool_call -> yield {"type":"tool",...}
  |     +-- Execute tool, feed results back
  |     +-- Loop to iteration 2
  |
  +-- OpenAI streams text (iteration 2)
  |     +-- yield {"type":"text","content":"..."} per chunk
  |     +-- yield {"type":"done"}
  |
  +-- Webhook handler (consumer):
        +-- tool event -> yield status string (e.g. "Consultando transacciones...")
        +-- first text event -> replaces draft entirely with real text
        +-- more text events -> appended by stream plugin
        +-- done -> plugin calls sendMessage to finalize
```

The tool status is ephemeral: visible briefly as a draft, then replaced when real text arrives.

## Tool Status Labels

| Tool Name | Spanish | English |
|-----------|---------|---------|
| `firefly_create_transaction` | Registrando transaccion... | Creating transaction... |
| `firefly_delete_transaction` | Eliminando transaccion... | Deleting transaction... |
| `firefly_update_transaction` | Actualizando transaccion... | Updating transaction... |
| `firefly_query_transactions` | Consultando transacciones... | Querying transactions... |
| `generate_chart` | Generando grafico... | Generating chart... |
| `firefly_report_link` | Obteniendo enlace... | Getting report link... |
| `firefly_get_accounts` | Consultando cuentas... | Fetching accounts... |
| `firefly_get_account_history` | Consultando historial... | Fetching history... |

## Changes by File

### `package.json`
- Upgrade `grammy` to `^1.41.1`
- Add `@grammyjs/stream` and `@grammyjs/auto-retry`

### `src/types.ts`
- Add `StreamEvent` union type for the NDJSON protocol

### `src/agent.ts`
- New `runAgentTurnStream()` method:
  - Uses `openai.chat.completions.create({ stream: true })`
  - Processes stream: accumulates tool call deltas, yields StreamEvent objects
  - Tool calls complete -> execute tools, yield tool status, loop
  - Text deltas -> yield as text events
- New `"runAgentTurnStream"` action in `fetch()` handler returning ReadableStream response
- Keep existing `runAgentTurn()` for cron jobs

### `src/bot.ts`
- Add `StreamFlavor` to context type
- `processMessage` changes to use streaming: reads stream, pipes to `ctx.replyWithStream()`
- `AgentProxy` gets `runAgentTurnStream()` returning `ReadableStream`

### `src/index.ts`
- Streaming variant of `callAgent` that returns raw Response (stream body)
- Webhook handler's `getAgent` proxy implements `runAgentTurnStream()`
- Register `stream()` and `autoRetry()` middleware on bot
- Async generator that feeds `ctx.replyWithStream()`: reads NDJSON, maps tool events to status strings, passes text through

## What Stays the Same
- All tool execution logic in agent.ts
- Non-streaming `runAgentTurn()` path (used by cron)
- All webapp API routes
- Message history management

## Markdown Handling
The `@grammyjs/stream` plugin supports `parse_mode` on the final `sendMessage`. Drafts render as plain text, only the final message gets markdown formatting.
