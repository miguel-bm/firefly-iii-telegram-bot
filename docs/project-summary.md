# Firefly III Telegram Bot - Project Summary

## What Is This?

A personal Telegram bot that integrates with [Firefly III](https://www.firefly-iii.org/) (self-hosted personal finance manager) to track expenses via natural language. Users can send text or voice messages describing transactions, and the bot uses OpenAI to interpret them and create entries in Firefly III.

**Example interactions:**
- "15€ en Mercadona" → Creates a withdrawal transaction
- "¿Cuánto gasté en supermercados este mes?" → Queries and aggregates spending
- "Muéstrame un gráfico de gastos por categoría" → Generates a pie chart
- Voice message describing an expense → Transcribed and processed
- Upload bank statement (.xlsx, .xls, .csv) → Auto-imports transactions

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
                        │  │  - Charts (src/tools/charts.ts)         │ │
                        │  └─────────────────────────────────────────┘ │
                        │                                              │
                        │  ┌─────────────────────────────────────────┐ │
                        │  │  Cron Jobs (src/cron.ts)                │ │
                        │  │  - Monthly report (1st of month)        │ │
                        │  │  - Bank import reminder (daily)         │ │
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
| Charts | QuickChart.io (Chart.js rendering) |
| Finance Backend | Firefly III REST API |
| Package Manager | pnpm |

---

## File Structure

```
src/
├── index.ts              # Entry point: Hono app, webhook route, exports DO, cron handler
├── bot.ts                # grammY setup, command messages, processMessage()
├── agent.ts              # ChatAgentDO class - OpenAI agent with tools
├── cron.ts               # Scheduled jobs: monthly report, bank import reminder
├── types.ts              # TypeScript interfaces (Env, State, Firefly types)
├── tools/
│   ├── firefly.ts        # Firefly III API client (transactions, accounts, insights)
│   ├── stt.ts            # Voice transcription via OpenAI
│   └── charts.ts         # Chart generation via QuickChart.io
├── query/
│   └── aggregate.ts      # Local aggregation for transaction queries
└── import/
    ├── index.ts          # Module exports
    ├── types.ts          # Import types (BankId, ParsedTransaction, ImportResult)
    ├── detector.ts       # Auto-detect bank from file content
    ├── parsers.ts        # Excel/CSV parsers for BBVA, CaixaBank, ImaginBank
    └── importer.ts       # Main import logic + Firefly transaction creation
```

### Key Files Explained

#### `src/index.ts`
- Hono web app with routes:
  - `GET /healthz` - Health check
  - `POST /telegram/webhook` - Receives Telegram updates
- Validates webhook secret header and allowed chat ID
- Creates grammY bot instance, registers commands, handles messages
- Exports `ChatAgentDO` Durable Object class
- `scheduled()` handler dispatches cron jobs

#### `src/agent.ts`
- `ChatAgentDO` extends Cloudflare Agents SDK `Agent` class
- Maintains state: message history, processing flag, preferences
- `fetch()` method handles HTTP requests to the DO (RPC pattern)
- `runAgentTurn()` - Main agent loop with OpenAI function calling
- Eight tools defined:
  - `firefly_create_transaction` - Creates expenses/income
  - `firefly_delete_transaction` - Deletes a transaction (with confirmation)
  - `firefly_update_transaction` - Edits a transaction (with confirmation)
  - `firefly_query_transactions` - Searches and aggregates, optionally charts
  - `generate_chart` - Creates charts from manual data points
  - `firefly_report_link` - Returns Firefly III web report URL
  - `firefly_get_accounts` - Lists accounts with balances
  - `firefly_get_account_history` - Gets balance history over time
- Bilingual system prompts (Spanish/English)

#### `src/bot.ts`
- `processMessage()` - Handles text/voice messages, calls agent
- `getMessages()` - Returns localized UI strings
- `AgentProxy` interface for type-safe agent calls

#### `src/cron.ts`
- `handleMonthlyReport()` - Sends report link on 1st of month
- `handleBankImportReminder()` - Checks for external transactions, sends reminder if none
- `handleScheduled()` - Dispatcher for cron patterns

#### `src/tools/firefly.ts`
- `FireflyClient` class with methods:
  - `getCategories()`, `getTags()` - List categories/tags
  - `getAccounts()`, `getAssetAccounts()` - List accounts
  - `getAccountHistory()` - Balance history over time
  - `searchTransactions()` - Search with Firefly query syntax
  - `createTransaction()` - POST new transaction (auto-tagged "telegram-bot")
  - `updateTransaction()` - PUT to update transaction
  - `deleteTransaction()` - DELETE transaction
  - `getReportUrl()` - Build Firefly III report URL
- `getCachedCategories()`, `getCachedTags()`, etc. - KV-cached data (6h TTL)

#### `src/tools/charts.ts`
- `buildChartConfig()` - Creates Chart.js configuration
- `generateQuickChartUrl()` - Renders chart via QuickChart.io API

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
| `ENABLE_MONTHLY_REPORT` | Send monthly report on 1st of month | `"true"` |
| `BANK_IMPORT_REMINDER_DAYS` | Days without bank imports before reminder | `"10"` |

### Secrets (set via `wrangler secret put`)

| Secret | Description |
|--------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Random string for webhook verification |
| `TELEGRAM_ALLOWED_CHAT_ID` | Chat ID to restrict bot to (security) |
| `FIREFLY_API_URL` | Firefly III base URL |
| `FIREFLY_API_TOKEN` | Personal Access Token from Firefly |
| `OPENAI_API_KEY` | OpenAI API key |

### Cron Triggers

Defined in `wrangler.toml`:

```toml
[triggers]
crons = [
    "0 9 1 * *",   # Monthly report: 1st of month at 9:00 UTC
    "0 10 * * *"   # Daily bank import check: every day at 10:00 UTC
]
```

---

## Features Implemented

### ✅ Transaction Creation
- Natural language parsing ("15€ en Mercadona")
- Auto-categorization from available Firefly categories
- Typo correction and proper capitalization of merchant names
- Uses merchant name as `destination_name` in Firefly
- Auto-tagged with "telegram-bot" for tracking

### ✅ Transaction Editing & Deletion
- Delete transactions by ID (with confirmation)
- Update transaction fields (date, amount, description, category, tags, notes)
- Agent always asks for confirmation before destructive actions

### ✅ Transaction Queries
- Natural language queries ("¿Cuánto gasté este mes?")
- Aggregation: sum, count, average
- Grouping: by category, by month, by week, by day, by merchant, by tag
- Date range filtering
- Text search in descriptions
- Tag filtering

### ✅ Chart Generation
- Integrated into `firefly_query_transactions` via `chart_type` parameter
- Chart types: pie, bar, line, doughnut
- Auto-generated titles based on query parameters
- Uses QuickChart.io for rendering
- Example: "Muéstrame un gráfico de gastos por categoría este mes"

### ✅ Manual Charts
- `generate_chart` tool for custom data points
- Useful when combining data from multiple queries

### ✅ Report Links
- Direct links to Firefly III web reports
- Report types: default, budget, category, tag
- Includes asset account IDs for proper URL format

### ✅ Account Balances
- `firefly_get_accounts` - List accounts with current balances
- `firefly_get_account_history` - Balance over time with configurable period
- Can generate line/bar charts of balance evolution

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

### ✅ Scheduled Jobs (Cron)
- **Monthly report**: On 1st of month at 9:00 UTC, sends link to previous month's report
- **Bank import reminder**: Daily at 10:00 UTC, checks for external transactions; if none in N days, sends reminder

### ✅ Bank Statement Import
- Upload Excel (.xlsx, .xls) or CSV files directly to Telegram
- **Auto-detection** of bank by file content (no filename requirements):
  - BBVA: Excel with "Últimos movimientos" or "F.Valor" header
  - CaixaBank: Excel with "Movimientos de la cuenta" pattern
  - ImaginBank: CSV with "IBAN;Saldo" or "Concepto;Fecha" pattern
- **Automatic parsing** handles each bank's specific format:
  - BBVA: Data starts at row 5, column B
  - CaixaBank: Dates as Excel serial numbers
  - ImaginBank: Both old (EUR suffix) and new (standard decimal) formats
- Transactions created with tags: `bank-import`, `import-{bankId}`
- Returns summary: transactions found, created, duplicates skipped, errors

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

# Tail logs from deployed worker
wrangler tail --format=pretty
```

---

## Known Limitations / Future Work

- **No budget integration** - Budget ID field exists but not exposed in prompts
- **No receipt/image support** - Could add OCR for receipt photos
- **Single chat restriction** - Bot only responds in one allowed chat ID
- **No transfer support in prompts** - Transfers between accounts not prompted for
- **Chart data granularity** - Some complex time-series queries require multiple API calls

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

---

## Agent Tools Reference

| Tool | Description |
|------|-------------|
| `firefly_create_transaction` | Create expense/income with date, amount, description, category |
| `firefly_delete_transaction` | Delete a transaction by ID (requires confirmation) |
| `firefly_update_transaction` | Update transaction fields (requires confirmation) |
| `firefly_query_transactions` | Search, aggregate, and optionally chart transactions |
| `generate_chart` | Create chart from manual data points |
| `firefly_report_link` | Get URL to Firefly III web report |
| `firefly_get_accounts` | List accounts with balances |
| `firefly_get_account_history` | Get balance history for an account over time |