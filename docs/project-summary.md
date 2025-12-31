# Firefly III Telegram Bot - Project Summary

## What Is This?

A personal Telegram bot that integrates with [Firefly III](https://www.firefly-iii.org/) (self-hosted personal finance manager) to track expenses via natural language. Users can send text or voice messages describing transactions, and the bot uses OpenAI to interpret them and create entries in Firefly III.

**Example interactions:**
- "15€ en Mercadona" → Creates a withdrawal transaction
- "¿Cuánto gasté en supermercados este mes?" → Queries and aggregates spending
- Voice message describing an expense → Transcribed and processed

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────────────┐
│  Telegram       │     │  Cloudflare Workers                          │
│  (webhook)      │────▶│  ┌─────────────────────────────────────────┐ │
└─────────────────┘     │  │  Hono (src/index.ts)                    │ │
                        │  │  - POST /telegram/webhook               │ │
                        │  │  - GET /healthz                         │ │
                        │  └──────────────┬──────────────────────────┘ │
                        │                 │                            │
                        │  ┌──────────────▼──────────────────────────┐ │
                        │  │  grammY Bot (src/bot.ts)                │ │
                        │  │  - Command handlers (/start, /help,     │ │
                        │  │    /reset)                              │ │
                        │  │  - Message routing                      │ │
                        │  └──────────────┬──────────────────────────┘ │
                        │                 │                            │
                        │  ┌──────────────▼──────────────────────────┐ │
                        │  │  Durable Object Agent (src/agent.ts)    │ │
                        │  │  - OpenAI function calling              │ │
                        │  │  - Message history (memory)             │ │
                        │  │  - Concurrent request blocking          │ │
                        │  └──────────────┬──────────────────────────┘ │
                        │                 │                            │
                        │  ┌──────────────▼──────────────────────────┐ │
                        │  │  Tools                                  │ │
                        │  │  - Firefly API (src/tools/firefly.ts)   │ │
                        │  │  - Voice STT (src/tools/stt.ts)         │ │
                        │  └─────────────────────────────────────────┘ │
                        └──────────────────────────────────────────────┘
                                          │
                                          ▼
                        ┌─────────────────────────────────────────────┐
                        │  Firefly III API                            │
                        │  (https://firefly.miscellanics.com)         │
                        └─────────────────────────────────────────────┘
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Cloudflare Workers |
| Web Framework | Hono |
| Bot Framework | grammY |
| State Management | Cloudflare Durable Objects (Agents SDK) |
| Cache | Cloudflare KV |
| LLM | OpenAI GPT-4.1-mini (function calling) |
| Speech-to-Text | OpenAI gpt-4o-mini-transcribe |
| Finance Backend | Firefly III REST API |
| Package Manager | pnpm |

---

## File Structure

```
src/
├── index.ts              # Entry point: Hono app, webhook route, exports DO
├── bot.ts                # grammY setup, command messages, processMessage()
├── agent.ts              # ChatAgentDO class - OpenAI agent with tools
├── types.ts              # TypeScript interfaces (Env, State, Firefly types)
├── tools/
│   ├── firefly.ts        # Firefly III API client (transactions, insights)
│   ├── stt.ts            # Voice transcription via OpenAI
│   └── charts.ts         # Chart generation via QuickChart.io
└── query/
    └── aggregate.ts      # Local aggregation for transaction queries
```

### Key Files Explained

#### `src/index.ts`
- Hono web app with two routes:
  - `GET /healthz` - Health check
  - `POST /telegram/webhook` - Receives Telegram updates
- Validates webhook secret header and allowed chat ID
- Creates grammY bot instance, registers commands, handles messages
- Exports `ChatAgentDO` Durable Object class

#### `src/agent.ts`
- `ChatAgentDO` extends Cloudflare Agents SDK `Agent` class
- Maintains state: message history, processing flag, preferences
- `fetch()` method handles HTTP requests to the DO (RPC pattern)
- `runAgentTurn()` - Main agent loop with OpenAI function calling
- Two tools defined:
  - `firefly_create_transaction` - Creates expenses/income
  - `firefly_query_transactions` - Searches and aggregates transactions
- Bilingual system prompts (Spanish/English)

#### `src/bot.ts`
- `processMessage()` - Handles text/voice messages, calls agent
- `getMessages()` - Returns localized UI strings
- `AgentProxy` interface for type-safe agent calls

#### `src/tools/firefly.ts`
- `FireflyClient` class with methods:
  - `getCategories()` - List all categories
  - `searchTransactions()` - Search with Firefly query syntax
  - `createTransaction()` - POST new transaction
- `getCachedCategories()` - KV-cached category list (6h TTL)

#### `src/tools/stt.ts`
- `transcribeVoice()` - Downloads Telegram voice file, sends to OpenAI transcription

---

## Configuration

### Environment Variables (wrangler.toml `[vars]`)

| Variable | Description | Example |
|----------|-------------|---------|
| `DEFAULT_CURRENCY` | Currency code for transactions | `"EUR"` |
| `DEFAULT_ACCOUNT_ID` | Firefly account ID for cash withdrawals | `"151"` |
| `BOT_LANGUAGE` | Bot language (`"es"` or `"en"`) | `"es"` |
| `BOT_TIMEZONE` | Timezone for date handling | `"Europe/Madrid"` |
| `MAX_HISTORY_MESSAGES` | Message memory limit | `"20"` |

### Secrets (set via `wrangler secret put`)

| Secret | Description |
|--------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Random string for webhook verification |
| `TELEGRAM_ALLOWED_CHAT_ID` | Chat ID to restrict bot to (security) |
| `FIREFLY_API_URL` | Firefly III base URL |
| `FIREFLY_API_TOKEN` | Personal Access Token from Firefly |
| `OPENAI_API_KEY` | OpenAI API key |

---

## Features Implemented

### ✅ Transaction Creation
- Natural language parsing ("15€ en Mercadona")
- Auto-categorization from available Firefly categories
- Typo correction and proper capitalization of merchant names
- Uses merchant name as `destination_name` in Firefly

### ✅ Transaction Queries
- Natural language queries ("¿Cuánto gasté este mes?")
- Aggregation: sum, count, average
- Grouping: by category, by month
- Date range filtering

### ✅ Voice Messages
- Telegram voice/audio → OpenAI transcription → processed as text

### ✅ Conversation Memory
- Persists last N messages per chat (configurable)
- `/reset` command clears history

### ✅ Multi-user Support
- Tracks which user sent each message in group chats
- Agent can address users by name

### ✅ Concurrent Request Blocking
- If user sends message while processing, returns "please wait" message

### ✅ Bilingual (Spanish/English)
- System prompts and UI messages in configured language

### ✅ Chart Generation
- Visual charts sent as images in Telegram
- Uses QuickChart.io to render Chart.js configs
- Supported chart types: pie, bar, doughnut
- Data sources: expense by category, income by category
- Example: "Muéstrame un gráfico de gastos por categoría de este mes"

### ✅ Report Links
- Provides direct links to Firefly III web reports
- Report types: default, budget, category, tag
- Example: "Dame el enlace al informe de este mes"

---

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | Usage instructions |
| `/reset` | Clear conversation history |

---

## Deployment

```bash
# Install dependencies
pnpm install

# Deploy to Cloudflare
pnpm run deploy

# Set Telegram webhook (after first deploy)
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://firefly-telegram-bot.domu.workers.dev/telegram/webhook",
    "secret_token": "<WEBHOOK_SECRET>"
  }'
```

---

## Development

```bash
# Local dev (requires .dev.vars file with secrets)
pnpm run dev

# Type check
pnpm exec tsc --noEmit

# Generate Cloudflare types
pnpm run types
```

---

## Known Limitations / Future Work

- **No edit/delete transactions** - Only creation supported currently
- **No budget integration** - Budget ID field exists but not exposed in prompts
- **No receipt/image support** - Could add OCR for receipt photos
- **Single chat restriction** - Bot only responds in one allowed chat ID
- **No transfer support in prompts** - Transfers between accounts not prompted for

---

## Response Format

Transaction confirmations follow this exact format:
```
Registrado un gasto de 20.51€ con concepto "Mercadona" en la categoría *Supermercado*.
```

Category names are **bold** (Markdown `*Category*`).

---

## Durable Object Migrations

The project uses SQLite-backed Durable Objects. Migration history in `wrangler.toml`:
- `v1`: Created `ChatAgent` (legacy, non-SQLite)
- `v2`: Created `ChatAgentDO` (SQLite-backed, current)

The legacy `ChatAgent` class is exported as an empty stub for migration compatibility.

