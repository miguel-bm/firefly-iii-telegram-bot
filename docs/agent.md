# Chat agent

The bot uses **GPT-5.6 Luna** through the OpenAI **Responses API**, with explicit
`medium` reasoning. Do not move this back to Chat Completions: that endpoint
rejects Luna's function tools with reasoning enabled.

- `src/agent.ts`: Durable Object transport, bounded conversation history, busy/reset state.
- `src/agent/responses.ts`: one streamed tool loop for private and group chats.
- `src/agent/tools.ts`: strict Responses function schemas.
- `src/agent/tool-executor.ts`: Firefly/chart operations; returns tool results as strings.
- `src/agent/config.ts`: model name and existing bilingual prompts.

Private chats receive text/tool events as drafts. Group chats consume the same
loop and receive only the final answer. Both paths save the final user/assistant
pair, retaining `MAX_HISTORY_MESSAGES`; existing histories need no migration.

Within each turn, all response output (including encrypted reasoning) is replayed
alongside `function_call_output` items matched by `call_id`. `store: false` avoids
application-state storage in OpenAI. Between turns, only the existing plain-text
chat history is retained, not tool output or reasoning. The loop stops after ten
model requests and rejects failed, incomplete, or interrupted responses.

Search, review and detail share `transaction-view.ts`: explicit type, currency,
both account IDs/names, category, tags and notes. Expense reviews default to
withdrawals and filter every returned split; deposits/transfers require an explicit
type choice. A missing category is not evidence of a problem with a transfer.
The prompt requires fresh detail reads for disputed types and counterpart questions:
internal transfers already affect both accounts and need no separate deposit.
This pre-answer rule is model-directed, not a deterministic speech restriction;
the conversion tool independently checks current type and rejects non-withdrawals.

## Verification

`pnpm check` runs mocked regression tests, type-checking, and the web build.

For a real API check, run:

```sh
RUN_OPENAI_SMOKE=1 pnpm exec vitest run src/agent/responses.live.test.ts
RUN_OPENAI_SMOKE=1 pnpm exec vitest run src/agent/transaction-reasoning.live.test.ts
```

This opt-in test uses the key in `.dev.vars` and consumes API credits. It checks
a greeting and a synthetic account-tool round trip, including reasoning replay.
It never calls Firefly or sends Telegram messages. Normal test runs skip it.
The second test checks synthetic transfer/counterpart questions after misleading
assistant history, requires fresh detail calls, and rejects any write-tool attempt.
