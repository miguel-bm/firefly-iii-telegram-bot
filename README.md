# Firefly III Telegram Bot

A personal Telegram bot for tracking expenses and querying your finances using [Firefly III](https://www.firefly-iii.org/). Chat naturally to log transactions, ask questions about your spending, generate charts, and import bank statements.

> **Note**: This bot connects directly to the Firefly III API. The [Firefly III Data Importer](https://docs.firefly-iii.org/how-to/data-importer/) is **not required**.

## Features

### Transaction Management
- **Natural language input**: Just say "15€ at Mercadona for groceries" or "Coffee 3.50"
- **Voice messages**: Send voice notes that get transcribed and processed automatically
- **Smart categorization**: Uses your existing Firefly III categories
- **Edit & delete**: Modify or remove transactions via conversation
- **Multi-currency support**: Configure your default currency

### Queries & Insights
- **Natural language queries**: "How much did I spend on food this month?"
- **Aggregations**: Sum, count, average by category, time period, merchant, or tag
- **Visual charts**: Generate pie, bar, and line charts of your spending
- **Report links**: Get direct links to Firefly III web reports
- **Account balances**: Query current balances and balance history over time

### Bank Statement Import
- **Auto-detection**: Upload Excel/CSV files and the bot detects your bank automatically
- **Duplicate prevention**: SHA-256 hashing prevents re-importing the same transactions
- **Supported banks**: BBVA, CaixaBank, ImaginBank (see [Adding Banks](#adding-new-bank-parsers))

### Web Dashboard (Telegram Mini App)
- **Account overview**: View all account balances at a glance
- **Spending charts**: Interactive doughnut charts by category
- **Transaction list**: Browse and search recent transactions
- **Custom date ranges**: Analyze any time period

### Automation
- **Monthly reports**: Automatic spending summary on the 1st of each month
- **Import reminders**: Configurable reminders when you haven't imported bank statements

## Requirements

- **Firefly III instance** with API access ([self-hosted](https://docs.firefly-iii.org/how-to/firefly-iii/installation/) or cloud)
- **Telegram Bot** (created via [@BotFather](https://t.me/BotFather))
- **OpenAI API key** (for natural language processing and voice transcription)
- **Cloudflare account** with Workers enabled (free tier works)

## Cloudflare Resources

Deploying this bot creates the following Cloudflare resources:

| Resource | Purpose |
|----------|---------|
| **Worker** | Main application runtime |
| **Durable Object** | Conversation state per chat (SQLite-backed) |
| **KV Namespace** (CATEGORY_CACHE) | Cached Firefly III categories (6h TTL) |
| **KV Namespace** (IMPORT_HASHES) | Import deduplication hashes (1 year TTL) |
| **Cron Triggers** | Monthly reports and import reminders |

## Setup

### 1. Create Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram
2. Send `/newbot` and follow the prompts
3. Save the **bot token** for later
4. (Optional) Set bot commands:
   ```
   /setcommands
   start - Welcome message
   help - Usage instructions
   reset - Clear conversation history
   dashboard - Open the web dashboard
   ```

### 2. Get Your Chat ID

Send a message to your bot, then visit:
```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
```
Find your `chat.id` in the response. This restricts the bot to only respond to you.

### 3. Create Firefly III API Token

1. Log into your Firefly III instance
2. Go to **Options** → **Profile** → **OAuth**
3. Create a new **Personal Access Token**
4. Save the token (it's only shown once)

### 4. Clone and Install

```bash
git clone https://github.com/yourusername/firefly-iii-telegram-bot.git
cd firefly-iii-telegram-bot
pnpm install
```

### 5. Create KV Namespaces

```bash
# Category cache
wrangler kv namespace create CATEGORY_CACHE

# Import hash deduplication
wrangler kv namespace create IMPORT_HASHES
```

Copy the `id` values from the output and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CATEGORY_CACHE"
id = "your-category-cache-id-here"

[[kv_namespaces]]
binding = "IMPORT_HASHES"
id = "your-import-hashes-id-here"
```

### 6. Configure Environment

Edit `wrangler.toml` to set your configuration:

```toml
[vars]
DEFAULT_CURRENCY = "EUR"              # Your currency code
DEFAULT_ACCOUNT_ID = "1"              # Your default cash/checking account ID from Firefly III
BOT_LANGUAGE = "en"                   # "es" for Spanish, "en" for English
BOT_TIMEZONE = "Europe/London"        # Your timezone
MAX_HISTORY_MESSAGES = "20"           # Conversation memory limit
ENABLE_MONTHLY_REPORT = "true"        # Send monthly report on 1st of month
BANK_IMPORT_REMINDER_DAYS = "10"      # Days without imports before reminder (0 to disable)
```

### 7. Set Secrets

```bash
wrangler secret put TELEGRAM_BOT_TOKEN        # Bot token from BotFather
wrangler secret put TELEGRAM_WEBHOOK_SECRET   # Random string (generate with: openssl rand -hex 32)
wrangler secret put TELEGRAM_ALLOWED_CHAT_ID  # Your chat ID (comma-separated for multiple users)
wrangler secret put FIREFLY_API_URL           # e.g., https://firefly.yourdomain.com
wrangler secret put FIREFLY_API_TOKEN         # Personal Access Token from Firefly III
wrangler secret put OPENAI_API_KEY            # OpenAI API key
```

### 8. Deploy

```bash
# Build the web dashboard
cd webapp && pnpm install && pnpm run build && cd ..

# Deploy to Cloudflare
pnpm run deploy
```

### 9. Set Telegram Webhook

After deployment, register your webhook with Telegram:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://firefly-telegram-bot.<your-subdomain>.workers.dev/telegram/webhook",
    "secret_token": "<YOUR_WEBHOOK_SECRET>"
  }'
```

### 10. (Optional) Set Up Web Dashboard

The dashboard is accessible via a menu button or the `/dashboard` command.

#### Option A: Menu Button (for private chats)

1. Open [@BotFather](https://t.me/BotFather)
2. Send `/mybots` → Select your bot → **Bot Settings** → **Menu Button**
3. Set the URL to your worker URL (e.g., `https://firefly-telegram-bot.workers.dev`)
4. Set the button text (e.g., "Dashboard")

#### Option B: Mini App Link (for /dashboard command)

1. Send `/newapp` to [@BotFather](https://t.me/BotFather)
2. Select your bot
3. Enter a title (e.g., "Dashboard")
4. Skip description and media (`/empty`)
5. Enter your worker URL as the webapp URL
6. Choose a short name (e.g., `dashboard`)
7. Set the resulting URL as a secret:
   ```bash
   wrangler secret put DASHBOARD_WEBAPP_URL
   # Enter: https://t.me/YourBotUsername/dashboard
   ```

## Usage

### Recording Transactions

Just describe transactions naturally:

```
15€ groceries at Lidl
Coffee 3.50
Received 2000€ salary
Transfer 500 from checking to savings
```

### Querying Data

```
How much did I spend this month?
Show spending by category last week
What's the average I spend at restaurants?
Find transactions at Amazon
```

### Charts & Reports

```
Show me a pie chart of expenses by category this month
Line chart of spending by week
Give me the report link for January
```

### Account Balances

```
What are my account balances?
Show my savings balance over the last 6 months
```

### Editing Transactions

```
Delete my last transaction at Starbucks
Change the category of my last expense to Entertainment
```

### Bank Imports

Simply upload an Excel (.xlsx, .xls) or CSV file from a supported bank. The bot will:
1. Auto-detect the bank from file content
2. Parse all transactions
3. Skip duplicates (already imported)
4. Create new transactions in Firefly III

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message with usage examples |
| `/help` | Detailed usage instructions |
| `/reset` | Clear conversation history |
| `/dashboard` | Open the web dashboard |

## Configuration Reference

### Environment Variables (`wrangler.toml`)

| Variable | Description | Default |
|----------|-------------|---------|
| `DEFAULT_CURRENCY` | Currency code for transactions | `EUR` |
| `DEFAULT_ACCOUNT_ID` | Firefly III account ID for expenses | Required |
| `BOT_LANGUAGE` | Bot language: `es` or `en` | `es` |
| `BOT_TIMEZONE` | Timezone for date handling | `Europe/Madrid` |
| `MAX_HISTORY_MESSAGES` | Messages to keep in memory | `20` |
| `ENABLE_MONTHLY_REPORT` | Send monthly spending report | `true` |
| `BANK_IMPORT_REMINDER_DAYS` | Days before import reminder | `10` |
| `IMPORT_HASH_TTL_DAYS` | Days to keep import hashes | `365` |

### Secrets (via `wrangler secret put`)

| Secret | Description |
|--------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Random string for webhook verification |
| `TELEGRAM_ALLOWED_CHAT_ID` | Allowed chat ID(s), comma-separated |
| `FIREFLY_API_URL` | Firefly III base URL |
| `FIREFLY_API_TOKEN` | Firefly III Personal Access Token |
| `OPENAI_API_KEY` | OpenAI API key |
| `DASHBOARD_WEBAPP_URL` | (Optional) Mini App URL for /dashboard |

## Extending the Bot

### Adding New Languages

1. Edit `src/bot.ts` and add your language to the `MESSAGES` object
2. Edit `src/agent.ts` and add system prompt translations
3. Update `wrangler.toml` to document the new language option

### Adding New Currencies

The bot uses whatever currency code you set in `DEFAULT_CURRENCY`. Firefly III handles multi-currency natively, so just:
1. Set `DEFAULT_CURRENCY` to your currency code (e.g., `USD`, `GBP`, `JPY`)
2. Ensure your Firefly III instance has the currency enabled

### Adding New Bank Parsers

1. **Add detection logic** in `src/import/detector.ts`:
   ```typescript
   // Add your bank ID to the BankId type in src/import/types.ts
   // Then add detection patterns in detectFromExcel() or detectFromCSV()
   ```

2. **Add parser** in `src/import/parsers.ts`:
   ```typescript
   export function parseYourBank(buffer: ArrayBuffer): ParsedTransaction[] {
     // Parse your bank's format
     // Return array of { date, description, amount, notes? }
   }
   ```

3. **Register the parser** in `parseStatementFile()` in `src/import/parsers.ts`

4. **Add bank account mapping** in `src/import/importer.ts`:
   ```typescript
   const BANK_ACCOUNTS: Record<BankId, string> = {
     // ... existing banks
     yourbank: "YOUR_FIREFLY_ACCOUNT_ID",
   };
   ```

> **Note**: Bank account IDs are currently hardcoded. For production use with multiple users, consider moving these to environment variables or a configuration system.

## Local Development

1. Copy `.dev.vars.example` to `.dev.vars` and fill in your values:
   ```bash
   cp .dev.vars.example .dev.vars
   ```

2. Start the development server:
   ```bash
   pnpm run dev
   ```

3. Use a tunnel (like [ngrok](https://ngrok.com/) or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/)) to receive webhooks:
   ```bash
   ngrok http 8787
   ```

4. Update your Telegram webhook to point to the tunnel URL.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│  Telegram   │────▶│   Hono      │────▶│  Durable Object │────▶│ Firefly III │
│  (webhook)  │     │  (routing)  │     │  (Agent + LLM)  │     │    (API)    │
└─────────────┘     └─────────────┘     └─────────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Import    │  (No LLM - direct parsing)
                    │   Module    │
                    └─────────────┘
```

- **Hono**: HTTP routing for webhook, API endpoints, and static files
- **grammY**: Telegram bot framework
- **Durable Objects**: Persistent conversation state with SQLite
- **OpenAI**: GPT-4.1-mini for natural language, Whisper for voice
- **QuickChart.io**: Chart image generation

## Limitations

- **Single-user focused**: Designed for personal use with restricted chat ID access
- **Hardcoded bank accounts**: Bank import account IDs need manual configuration
- **No receipt OCR**: Photos/images are not processed
- **Spanish/English only**: Two languages currently supported
- **Three banks only**: BBVA, CaixaBank, ImaginBank (contributions welcome!)

## Troubleshooting

### Bot doesn't respond
- Check that `TELEGRAM_ALLOWED_CHAT_ID` matches your chat ID
- Verify the webhook is set correctly: `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
- Check Cloudflare Workers logs: `wrangler tail`

### Transactions not created
- Verify `FIREFLY_API_URL` doesn't have a trailing slash
- Check that `FIREFLY_API_TOKEN` is valid (test in Firefly III API docs)
- Ensure `DEFAULT_ACCOUNT_ID` exists in your Firefly III instance

### Import duplicates not detected
- Duplicate detection uses SHA-256 hashes stored in KV
- Hashes expire after `IMPORT_HASH_TTL_DAYS` (default 365 days)
- Editing transactions in Firefly III doesn't affect duplicate detection

### Web dashboard shows "Unauthorized"
- The dashboard validates Telegram's `initData` signature
- Only works when opened through Telegram (not direct browser access)
- Check that `TELEGRAM_BOT_TOKEN` is correct

## Contributing

Contributions are welcome! Some areas that could use help:

- **New bank parsers**: Add support for banks in your country
- **New languages**: Translate bot messages and prompts
- **Features**: Receipt scanning, budget alerts, recurring transactions
- **Documentation**: Improve setup guides, add screenshots

Please open an issue first to discuss significant changes.

## License

[MIT](LICENSE)

## Acknowledgments

- [Firefly III](https://www.firefly-iii.org/) - The amazing self-hosted finance manager
- [grammY](https://grammy.dev/) - Excellent Telegram bot framework
- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless runtime
- [QuickChart.io](https://quickchart.io/) - Chart generation API
