# Porject Context - Firefly III Telegram Bot

Ingress (Workers + Hono)
	•	POST /telegram/webhook: receives Telegram updates, verifies webhook secret header + allowlisted group chat ID, then hands off to grammY webhook handler.
	•	GET /healthz: basic health.

Bot layer (grammY)
	•	Command path: /add, /spent, /report, /import, etc. run deterministic handlers.
	•	Natural-language path (no command): forward to an “agent loop” using OpenAI Responses API with function calling and Structured Outputs.  ￼

Cloudflare Agents:
	•	One Agent instance per chat (keyed by chat_id), holding only bot-state: e.g. default cash account ID, user preferences, last “mode”, cached category snapshot version, etc.
	•	Agents provide persisted state with setState, sync, and an embedded SQL store if you ever need it.  ￼

Finance backend (Firefly III API)
	•	Use Firefly endpoints for:
	•	Create transactions: POST /api/v1/transactions
	•	Query/search transactions: GET /api/v1/search/transactions
	•	Categories list: GET /api/v1/categories
	•	(Optional) summary: GET /api/v1/summary/basic for quick totals where it fits.  ￼

Voice
	•	Telegram voice/audio → download file → OpenAI audio/transcriptions with gpt-4o-mini-transcribe → send to agent as if it was a text message

Auth hardening (concrete, minimal)
  1.	Telegram webhook secret header
	•	When you call setWebhook, set a secret token; on every update Telegram includes X-Telegram-Bot-Api-Secret-Token and you verify it.
  2.	Allowlist the single group
	•	Check update.message.chat.id matches the configured group ID; otherwise ignore. This is to prevent the bot from being used in other groups, since it's a personal bot.

Configurations needed (env vars to be set by user):
- Default currency
- Default account ID for cash withdrawals

Secrets needed:
- Telegram bot token
- Firefly III authentication (See [How to use the API](how-to-use-firefly-iii-api.md)

Stack:
- TypeScript
- pnpm
- wrangler
- Cloudflare Agents
- OpenAI
- GrammY
- Hono

## Agent Tools

### Transaction creation (your first feature)

Tool: firefly_create_transaction
	•	Input schema (structured):
	•	type: fixed to "withdrawal" for expenses by default
	•	date, amount, currency (or default)
	•	description (merchant / note)
	•	category_name (string or null)
	•	source_account_id (default “Cash” asset account)
	•	optional: budget_id, tags[], notes
	•	Implementation:
	•	Map to Firefly POST /api/v1/transactions (see [Firefly API documentation](firefly-api.yaml))

Categorization strategy (cheap + robust)
	•	Keep a cached list of categories in KV (TTL, e.g. 6h) retrieved from GET /api/v1/categories.  ￼
	•	For “last few previous transactions as examples”, fetch a small set using:
	•	GET /api/v1/search/transactions with query text (merchant keywords) or a recent window, then feed only the relevant fields (description + category + amount) into the model context.  ￼
	•	In the system prompt, instruct: If uncertain ask a follow-up question to the user to help categorize the transaction.
	•	In the system prompt, instruct: Interpret user queries as being requests to create transactions by default (e.g. receiving "103 on groceries at Mercadona" should be interpreted as a transaction to be created to the default cash account in the default currency).


### Lightweight query engine (your second feature)

Tool: firefly_query_transactions
	•	Schema:
	•	date_from, date_to
	•	filters: category_name?, text_contains?, min_amount?, max_amount?
	•	aggregate: { kind: "sum"|"count"|"avg", group_by?: "category"|"month" }
	•	limit?
	•	Implementation options:
	1.	Use Firefly search endpoint directly (GET /api/v1/search/transactions) and aggregate in the Worker (fast to ship).  ￼
	2.	For some queries, prefer Firefly’s summary endpoint if it matches (less data transfer).  ￼

This keeps “ask something about transactions” cheap: most questions become one Firefly call + small local aggregation.


## OpenAI configuration (aligned with your choices)

LLM: gpt-4.1-mini
	•	Strong at tool calling, low latency, no explicit reasoning step (fits your “doesn’t need to be very smart”).
	•	Use function/tool calling with JSON schema tools.

STT: gpt-4o-mini-transcribe

Through Cloudflare Agents (https://developers.cloudflare.com/agents/?utm_content=agents.cloudflare.com)


Minimal code organization (practical)
	•	src/index.ts — Hono app + webhook route + grammY webhookCallback
	•	src/bot.ts — grammY bot, commands, default NL handler
	•	src/agent.ts — Cloudflare Agent class, state shape, “runAgentTurn()”
	•	src/tools/firefly.ts — Firefly client + tool implementations
	•	src/tools/stt.ts — Telegram file download + OpenAI transcription
	•	src/query/aggregate.ts — local aggregations/grouping for lightweight query engine
