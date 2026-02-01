# CLAUDE.md - Project Context for Claude Code

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
