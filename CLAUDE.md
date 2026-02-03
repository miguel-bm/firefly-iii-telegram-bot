# CLAUDE.md - Project Context for Claude Code

> For end-user documentation, setup instructions, and contribution guidelines, see [README.md](README.md).

## Project Overview

Telegram bot for [Firefly III](https://www.firefly-iii.org/) personal finance tracking. Natural language expense logging, queries, charts, and bank statement imports.

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Bot**: grammY (Telegram) + Hono (HTTP)
- **State**: Cloudflare Durable Objects (Agents SDK)
- **LLM**: OpenAI GPT-4.1-mini (function calling)
- **Package Manager**: pnpm

## Key Commands

```bash
pnpm run dev      # Local development
pnpm run deploy   # Deploy to Cloudflare
npx tsc --noEmit  # Type check
```

## Architecture

```
Telegram → Hono webhook → grammY bot → Durable Object Agent → Firefly III API
                              ↓
                    Document uploads → Import module (no LLM)
```

## File Structure

```
src/
├── index.ts          # Entry: Hono routes, webhook, document handler, cron
├── bot.ts            # grammY setup, message processing
├── agent.ts          # ChatAgentDO: OpenAI agent with 8 tools
├── types.ts          # TypeScript interfaces
├── cron.ts           # Scheduled jobs (monthly report, import reminder)
├── tools/
│   ├── firefly.ts    # Firefly III API client
│   ├── stt.ts        # Voice transcription (OpenAI)
│   └── charts.ts     # Chart generation (QuickChart.io)
├── query/
│   └── aggregate.ts  # Transaction aggregation
└── import/
    ├── types.ts      # Import types
    ├── detector.ts   # Bank auto-detection
    ├── parsers.ts    # Excel/CSV parsers (BBVA, CaixaBank, ImaginBank)
    └── importer.ts   # Import orchestration
```

## Agent Tools (src/agent.ts)

| Tool | Purpose |
|------|---------|
| `firefly_create_transaction` | Create expense/income |
| `firefly_delete_transaction` | Delete (requires confirmation) |
| `firefly_update_transaction` | Edit (requires confirmation) |
| `firefly_query_transactions` | Search, aggregate, chart |
| `generate_chart` | Manual chart from data points |
| `firefly_report_link` | Get Firefly web report URL |
| `firefly_get_accounts` | List accounts with balances |
| `firefly_get_account_history` | Balance over time |

## Bank Import (src/import/)

Supported banks (auto-detected by content):
- **BBVA**: Excel (.xlsx), data at B5+, header "F.Valor"
- **CaixaBank**: Excel (.xls), dates as serial numbers
- **ImaginBank**: CSV (semicolon), handles both EUR suffix and standard decimal

Account IDs hardcoded in `importer.ts:16-20` - may need env vars.

## Environment Variables

### Config (wrangler.toml)
- `DEFAULT_CURRENCY`, `DEFAULT_ACCOUNT_ID`, `BOT_LANGUAGE` (es|en), `BOT_TIMEZONE`

### Secrets (wrangler secret put)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_CHAT_ID`
- `FIREFLY_API_URL`, `FIREFLY_API_TOKEN`, `OPENAI_API_KEY`
- `DASHBOARD_WEBAPP_URL` - Direct Mini App link (e.g., `https://t.me/BotUsername/dashboard`)

## Conventions

- Bilingual: Spanish (default) and English
- Transaction confirmations: `Registrado un gasto de X€ con concepto "Y" en la categoría *Z*.`
- All bot-created transactions tagged with `telegram-bot`
- Import transactions tagged with `bank-import` + `import-{bankId}`

## Testing

```bash
# Test import parsers
node test-import.mjs

# Bank statement examples in bank_statement_examples/
```

## Cron Jobs

- `0 9 1 * *` - Monthly report (1st of month)
- `0 10 * * *` - Bank import reminder (daily check)


## Telegram Web App
 
### Overview
 
The Web App provides a dashboard UI inside Telegram with:
- Account balances summary
- Expense breakdown chart (doughnut, last 30 days)
- Recent transactions table with category icons
 
### API Routes (src/index.ts)
 
| Route | Purpose |
|-------|---------|
| `GET /api/transactions` | Recent transactions (query: `limit`, `type`) |
| `GET /api/expenses/by-category` | Expense summary (query: `days`) |
| `GET /api/accounts` | Asset account balances |
 
All API routes require `X-Telegram-Init-Data` header with valid Telegram WebApp initData.
 
### Authentication
 
The webapp uses Telegram's cryptographic authentication:
1. Telegram sends `initData` (signed with bot token)
2. Worker validates HMAC-SHA256 signature
3. User ID checked against `TELEGRAM_ALLOWED_CHAT_ID`
 
### BotFather Setup
 
To enable the Web App, configure it with BotFather:
 
```
1. Open @BotFather in Telegram
2. Send /mybots → Select your bot
3. Bot Settings → Menu Button
4. Configure Menu Button:
   - URL: https://your-worker.workers.dev (your deployed worker URL)
   - Title: "Dashboard" (or whatever you prefer)
 
Alternative: Use /setmenubutton command directly:
1. Send /setmenubutton to @BotFather
2. Select your bot
3. Enter the URL: https://your-worker.workers.dev
4. Enter button text: Dashboard
```
 
After setup, users will see a "Dashboard" button next to the message input in your bot's chat. Tapping it opens the Web App.

**Note:** The menu button doesn't work in group chats. Use `/dashboard` command instead.

### Mini App Setup (for /dashboard command)

The `/dashboard` command requires a Mini App link. Set it up via BotFather:

```
1. Send /newapp to @BotFather
2. Select your bot
3. Enter title: Dashboard
4. Enter description (or /empty)
5. Upload a 640x360 photo (or /empty)
6. Upload a GIF demo (or /empty)
7. Enter webapp URL: https://your-worker.workers.dev
8. Choose short name: dashboard
```

This creates a link like `https://t.me/YourBotUsername/dashboard`. Set this as `DASHBOARD_WEBAPP_URL` in wrangler.toml.
 
### Development
 
For local development of the webapp:
 
```bash
# Terminal 1: Run the worker (API backend)
pnpm run dev
 
# Terminal 2: Run the webapp dev server
cd webapp && pnpm run dev
```
 
Note: Local webapp development requires mocking Telegram's initData or temporarily disabling validation.
 
### Deployment
 
```bash
# 1. Build the webapp
cd webapp && pnpm run build
 
# 2. Deploy everything (worker + static assets)
cd .. && pnpm run deploy
```
 
The `[assets]` config in wrangler.toml serves `webapp/dist/` as static files.

## Claude behaviour

- Always keep CLAUDE.md up to date with your changes and additions to the project if relevant.
