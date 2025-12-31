# Firefly III Telegram Bot

A personal Telegram bot for tracking expenses and querying finances using Firefly III.

## Features

- **Natural language transaction input**: "15€ at Mercadona for groceries"
- **Voice messages**: Send voice notes that get transcribed and processed
- **Smart categorization**: Uses your existing Firefly III categories
- **Query your finances**: "How much did I spend on food this month?"

## Setup

### Prerequisites

- [Firefly III](https://www.firefly-iii.org/) instance with API access
- Telegram Bot (create via [@BotFather](https://t.me/BotFather))
- OpenAI API key
- Cloudflare account with Workers enabled
- pnpm and wrangler CLI

### 1. Clone and install

```bash
pnpm install
```

### 2. Create KV namespace

```bash
wrangler kv namespace create CATEGORY_CACHE
```

Copy the `id` from the output and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CATEGORY_CACHE"
id = "your-namespace-id-here"
```

### 3. Set secrets

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
wrangler secret put TELEGRAM_ALLOWED_CHAT_ID
wrangler secret put FIREFLY_API_URL
wrangler secret put FIREFLY_API_TOKEN
wrangler secret put OPENAI_API_KEY
```

### 4. Configure defaults

Edit `wrangler.toml` to set:

```toml
[vars]
DEFAULT_CURRENCY = "EUR"  # Your preferred currency
DEFAULT_ACCOUNT_ID = "1"  # Your cash account ID from Firefly III
```

### 5. Deploy

```bash
pnpm run deploy
```

### 6. Set Telegram webhook

After deploying, set your Telegram webhook:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://firefly-telegram-bot.<your-subdomain>.workers.dev/telegram/webhook",
    "secret_token": "<YOUR_WEBHOOK_SECRET>"
  }'
```

## Local Development

1. Copy `.dev.vars.example` to `.dev.vars` and fill in your values
2. Run `pnpm run dev`

Note: For local development, you'll need to use a tunnel (like ngrok) to receive Telegram webhooks.

## Usage

Just send messages to your bot:

- **Add expenses**: "Coffee 3.50", "50€ groceries at Lidl"
- **Add income**: "Received 100€ salary"
- **Query spending**: "How much did I spend this month?", "Show spending by category"
- **Voice messages**: Send voice notes describing your transactions

## Architecture

- **Runtime**: Cloudflare Workers
- **Bot Framework**: grammY
- **Web Framework**: Hono
- **State**: Cloudflare Durable Objects (Agents)
- **LLM**: OpenAI GPT-4.1-mini with function calling
- **STT**: OpenAI gpt-4o-mini-transcribe
