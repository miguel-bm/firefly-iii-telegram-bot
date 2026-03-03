# LLM Response Streaming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stream OpenAI LLM responses to Telegram in real-time using `sendMessageDraft`, with ephemeral tool status messages during tool execution.

**Architecture:** The Durable Object streams NDJSON events (tool status, text chunks, done/error) over HTTP via `ReadableStream`. The webhook handler consumes the stream and feeds an async generator to `@grammyjs/stream`'s `ctx.replyWithStream()`. Tool status is sent directly via `ctx.api.sendMessageDraft()` outside the stream plugin, then replaced when real text arrives.

**Tech Stack:** grammY v1.41+, `@grammyjs/stream`, `@grammyjs/auto-retry`, OpenAI streaming API

**Design doc:** `docs/plans/2026-03-03-llm-response-streaming-design.md`

---

### Task 1: Upgrade Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Upgrade grammy and install plugins**

```bash
pnpm add grammy@latest @grammyjs/stream @grammyjs/auto-retry
```

**Step 2: Verify install**

```bash
npx tsc --noEmit
```

Expected: PASS (no type errors from the upgrade alone, grammY maintains backwards compat)

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: upgrade grammy to latest, add stream and auto-retry plugins"
```

---

### Task 2: Add StreamEvent Type

**Files:**
- Modify: `src/types.ts`

**Step 1: Add the StreamEvent union type**

Add at the end of `src/types.ts`:

```typescript
// NDJSON streaming protocol between DO and webhook handler
export type StreamEvent =
    | { type: "tool"; name: string }
    | { type: "text"; content: string }
    | { type: "done"; chartUrl?: string }
    | { type: "error"; message: string };
```

**Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add StreamEvent type for NDJSON streaming protocol"
```

---

### Task 3: Extract Tool Execution into a Method

This is a refactor of `src/agent.ts` to extract the tool execution logic (currently ~400 lines inside `runAgentTurn`) into a reusable `executeTool()` method. Both `runAgentTurn()` and the new `runAgentTurnStream()` will call it.

**Files:**
- Modify: `src/agent.ts:834-1226` (tool execution block)

**Step 1: Add the `executeTool` private method**

Add this method to `ChatAgentDO`, just before `runAgentTurn()` (around line 754):

```typescript
private async executeTool(
    toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
    firefly: FireflyClient,
    env: Env,
    lang: string,
    currency: string,
): Promise<{ result: string; chartUrl?: string }> {
    let result: string;
    let chartUrl: string | undefined;

    try {
        const args = JSON.parse(toolCall.function.arguments);

        if (toolCall.function.name === "firefly_create_transaction") {
            // ... MOVE the entire body of each if/else branch here ...
```

Move the entire `try { const args = ... if/else chain ... } catch { ... }` block from lines 841-1218 into this method. The method returns `{ result, chartUrl }`.

Key changes when moving the code:
- `result` is declared at the top of the method (not inside the for loop)
- Any assignment to the outer `chartUrl` variable becomes setting the local `chartUrl`
- The `result` variable from the catch block is handled the same way

**Step 2: Update `runAgentTurn()` to use `executeTool()`**

Replace the tool execution for-loop (lines 835-1225) with:

```typescript
// Process tool calls
for (const toolCall of assistantMessage.tool_calls) {
    if (toolCall.type !== "function") continue;
    const { result, chartUrl: newChartUrl } = await this.executeTool(
        toolCall, firefly, env, lang, currency
    );
    if (newChartUrl) chartUrl = newChartUrl;
    messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
    });
}
```

**Step 3: Type check**

```bash
npx tsc --noEmit
```

Expected: PASS — this is a pure refactor, behavior is unchanged.

**Step 4: Commit**

```bash
git add src/agent.ts
git commit -m "refactor: extract executeTool method for reuse by streaming"
```

---

### Task 4: Add Streaming Agent Method and Fetch Handler

**Files:**
- Modify: `src/agent.ts`
- Modify: `src/types.ts` (import StreamEvent)

**Step 1: Add tool status labels**

Add after the `RESET_MESSAGES` constant (around line 687):

```typescript
const TOOL_STATUS_LABELS: Record<string, Record<string, string>> = {
    es: {
        firefly_create_transaction: "Registrando transacción...",
        firefly_delete_transaction: "Eliminando transacción...",
        firefly_update_transaction: "Actualizando transacción...",
        firefly_query_transactions: "Consultando transacciones...",
        generate_chart: "Generando gráfico...",
        firefly_report_link: "Obteniendo enlace...",
        firefly_get_accounts: "Consultando cuentas...",
        firefly_get_account_history: "Consultando historial...",
        firefly_get_transaction: "Obteniendo transacción...",
        firefly_review_uncategorized: "Revisando sin categoría...",
        firefly_convert_to_transfer: "Convirtiendo a transferencia...",
        firefly_bulk_categorize: "Categorizando transacciones...",
    },
    en: {
        firefly_create_transaction: "Creating transaction...",
        firefly_delete_transaction: "Deleting transaction...",
        firefly_update_transaction: "Updating transaction...",
        firefly_query_transactions: "Querying transactions...",
        generate_chart: "Generating chart...",
        firefly_report_link: "Getting report link...",
        firefly_get_accounts: "Fetching accounts...",
        firefly_get_account_history: "Fetching history...",
        firefly_get_transaction: "Fetching transaction...",
        firefly_review_uncategorized: "Reviewing uncategorized...",
        firefly_convert_to_transfer: "Converting to transfer...",
        firefly_bulk_categorize: "Categorizing transactions...",
    },
};
```

**Step 2: Add `runAgentTurnStream()` async generator method**

Add to `ChatAgentDO` class after `runAgentTurn()`:

```typescript
async *runAgentTurnStream(message: string, userName?: string): AsyncGenerator<StreamEvent> {
    const env = this.env;
    const lang = env.BOT_LANGUAGE ?? "es";
    const timezone = env.BOT_TIMEZONE ?? "Europe/Madrid";
    const maxHistory = parseInt(env.MAX_HISTORY_MESSAGES ?? "20", 10);

    this.setState({ ...this.state, isProcessing: true });

    let chartUrl: string | undefined;
    let finalResponse = "";

    try {
        const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
        const firefly = new FireflyClient(env);

        const [categories, tags, accounts] = await Promise.all([
            getCachedCategories(env),
            getCachedTags(env),
            getCachedAssetAccounts(env),
        ]);
        const categoryNames = categories.map((c) => c.name);
        const currency = this.state.defaultCurrency ?? env.DEFAULT_CURRENCY;
        const systemPrompt = SYSTEM_PROMPTS[lang](categoryNames, tags, accounts, currency, timezone);

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
        ];

        for (const historyMsg of this.state.messageHistory) {
            if (historyMsg.role === "user") {
                const prefix = historyMsg.userName ? `[${historyMsg.userName}]: ` : "";
                messages.push({ role: "user", content: prefix + historyMsg.content });
            } else {
                messages.push({ role: "assistant", content: historyMsg.content });
            }
        }

        const userPrefix = userName ? `[${userName}]: ` : "";
        messages.push({ role: "user", content: userPrefix + message });

        let iterations = 0;
        const maxIterations = 10;

        while (iterations < maxIterations) {
            iterations++;

            const stream = await openai.chat.completions.create({
                model: "gpt-5-mini",
                messages,
                tools: TOOLS,
                tool_choice: "auto",
                stream: true,
            });

            let fullContent = "";
            const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

            for await (const chunk of stream) {
                const choice = chunk.choices[0];
                if (!choice) continue;

                const delta = choice.delta;

                if (delta?.content) {
                    fullContent += delta.content;
                    yield { type: "text", content: delta.content };
                }

                if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const existing = toolCallAccumulator.get(tc.index);
                        if (!existing) {
                            toolCallAccumulator.set(tc.index, {
                                id: tc.id ?? "",
                                name: tc.function?.name ?? "",
                                arguments: tc.function?.arguments ?? "",
                            });
                        } else {
                            if (tc.id) existing.id = tc.id;
                            if (tc.function?.name) existing.name += tc.function.name;
                            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                        }
                    }
                }
            }

            // If we got tool calls, execute them and loop
            if (toolCallAccumulator.size > 0) {
                const toolCalls = [...toolCallAccumulator.values()].map((tc) => ({
                    id: tc.id,
                    type: "function" as const,
                    function: { name: tc.name, arguments: tc.arguments },
                }));

                messages.push({
                    role: "assistant",
                    content: fullContent || null,
                    tool_calls: toolCalls,
                });

                for (const toolCall of toolCalls) {
                    yield { type: "tool", name: toolCall.function.name };
                    const { result, chartUrl: newChartUrl } = await this.executeTool(
                        toolCall as OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
                        firefly, env, lang, currency
                    );
                    if (newChartUrl) chartUrl = newChartUrl;
                    messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
                }

                continue;
            }

            // No tool calls — this is the final response
            finalResponse = fullContent || (lang === "es" ? "Hecho." : "Done.");
            break;
        }

        if (!finalResponse) {
            const msg = lang === "es"
                ? "Alcancé el número máximo de pasos. Por favor, intenta una solicitud más simple."
                : "I reached the maximum number of steps. Please try a simpler request.";
            yield { type: "text", content: msg };
            finalResponse = msg;
        }

        yield { type: "done", chartUrl };

        // Update message history
        const userMsg: ChatMessage = { role: "user", content: message, userName, timestamp: Date.now() };
        const assistantMsg: ChatMessage = { role: "assistant", content: finalResponse, timestamp: Date.now() };
        const newHistory: ChatMessage[] = [
            ...this.state.messageHistory,
            userMsg,
            assistantMsg,
        ].slice(-maxHistory);

        this.setState({
            ...this.state,
            messageHistory: newHistory,
            isProcessing: false,
        });
    } catch (error) {
        this.setState({ ...this.state, isProcessing: false });
        yield { type: "error", message: error instanceof Error ? error.message : "Unknown error" };
    }
}
```

**Step 3: Add streaming action to `fetch()` handler**

In the `fetch()` method, add a new action handler before the `"runAgentTurn"` block:

```typescript
if (action === "runAgentTurnStream") {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const generator = this.runAgentTurnStream(body.message ?? "", body.userName);

    // Pipe generator to stream in the background (don't await — return Response immediately)
    (async () => {
        try {
            for await (const event of generator) {
                await writer.write(encoder.encode(JSON.stringify(event) + "\n"));
            }
        } catch (error) {
            const errorEvent = {
                type: "error",
                message: error instanceof Error ? error.message : "Unknown error",
            };
            await writer.write(encoder.encode(JSON.stringify(errorEvent) + "\n"));
        } finally {
            await writer.close();
        }
    })();

    return new Response(readable, {
        headers: { "Content-Type": "application/x-ndjson" },
    });
}
```

**Step 4: Update StreamEvent import**

Add `StreamEvent` to the import from `./types.js` at the top of agent.ts.

**Step 5: Type check**

```bash
npx tsc --noEmit
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/agent.ts src/types.ts
git commit -m "feat: add streaming agent method with NDJSON output and tool status events"
```

---

### Task 5: Update bot.ts for Streaming

**Files:**
- Modify: `src/bot.ts`

**Step 1: Update imports and types**

```typescript
import { type Context, type Api } from "grammy";
import { type StreamFlavor } from "@grammyjs/stream";
import type { Env, AgentResponse, StreamEvent } from "./types.js";
import { transcribeVoice } from "./tools/stt.js";

// Context type with stream support
export type StreamContext = StreamFlavor<Context>;
```

**Step 2: Update AgentProxy interface**

Add the streaming method:

```typescript
export interface AgentProxy {
    checkBusy(): Promise<string | null>;
    runAgentTurn(message: string, userName?: string): Promise<AgentResponse>;
    runAgentTurnStream(message: string, userName?: string): Promise<ReadableStream>;
}
```

**Step 3: Add tool status labels**

Add after the MESSAGES object:

```typescript
const TOOL_STATUS_LABELS: Record<string, Record<string, string>> = {
    es: {
        firefly_create_transaction: "Registrando transacción...",
        firefly_delete_transaction: "Eliminando transacción...",
        firefly_update_transaction: "Actualizando transacción...",
        firefly_query_transactions: "Consultando transacciones...",
        generate_chart: "Generando gráfico...",
        firefly_report_link: "Obteniendo enlace...",
        firefly_get_accounts: "Consultando cuentas...",
        firefly_get_account_history: "Consultando historial...",
        firefly_get_transaction: "Obteniendo transacción...",
        firefly_review_uncategorized: "Revisando sin categoría...",
        firefly_convert_to_transfer: "Convirtiendo a transferencia...",
        firefly_bulk_categorize: "Categorizando transacciones...",
    },
    en: {
        firefly_create_transaction: "Creating transaction...",
        firefly_delete_transaction: "Deleting transaction...",
        firefly_update_transaction: "Updating transaction...",
        firefly_query_transactions: "Querying transactions...",
        generate_chart: "Generating chart...",
        firefly_report_link: "Getting report link...",
        firefly_get_accounts: "Fetching accounts...",
        firefly_get_account_history: "Fetching history...",
        firefly_get_transaction: "Fetching transaction...",
        firefly_review_uncategorized: "Reviewing uncategorized...",
        firefly_convert_to_transfer: "Converting to transfer...",
        firefly_bulk_categorize: "Categorizing transactions...",
    },
};
```

**Step 4: Add NDJSON-to-text async generator**

This generator reads the NDJSON stream, sends tool status directly via `api.sendMessageDraft()`, and yields text chunks for the stream plugin:

```typescript
async function* ndjsonToText(
    body: ReadableStream,
    lang: string,
    api: Api,
    chatId: number,
): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                if (!line.trim()) continue;
                const event: StreamEvent = JSON.parse(line);

                if (event.type === "tool") {
                    const labels = TOOL_STATUS_LABELS[lang] ?? TOOL_STATUS_LABELS.es;
                    const label = labels[event.name] ?? event.name;
                    await api.sendMessageDraft(chatId, `⏳ ${label}`);
                } else if (event.type === "text") {
                    yield event.content;
                } else if (event.type === "error") {
                    yield event.message;
                }
                // "done" events: generator completes naturally, plugin finalizes
            }
        }
    } finally {
        reader.releaseLock();
    }
}
```

**Step 5: Update `processMessage` to use streaming**

Change the function signature and the response handling:

```typescript
export async function processMessage(
    ctx: StreamContext,
    env: Env,
    getAgent: (chatId: number) => Promise<AgentProxy>
): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const lang = env.BOT_LANGUAGE ?? "es";
    const msgs = getMessages(lang);
    const userName = getUserName(ctx);

    let text: string | undefined;

    // Handle voice messages (unchanged)
    if (ctx.message?.voice) {
        try {
            await ctx.replyWithChatAction("typing");
            text = await transcribeVoice(ctx.message.voice.file_id, env);
        } catch (error) {
            await ctx.reply(msgs.voiceError);
            return;
        }
    } else if (ctx.message?.audio) {
        try {
            await ctx.replyWithChatAction("typing");
            text = await transcribeVoice(ctx.message.audio.file_id, env);
        } catch (error) {
            await ctx.reply(msgs.audioError);
            return;
        }
    } else {
        text = ctx.message?.text;
    }

    if (!text) return;
    if (text.startsWith("/")) return;

    try {
        const agent = await getAgent(chatId);

        const busyMessage = await agent.checkBusy();
        if (busyMessage) {
            await ctx.reply(busyMessage);
            return;
        }

        const stream = await agent.runAgentTurnStream(text, userName);

        await ctx.replyWithStream(
            ndjsonToText(stream, lang, ctx.api, chatId),
            { parse_mode: "Markdown" },
        );
    } catch (error) {
        console.error("Agent error:", error);
        await ctx.reply(msgs.processingError);
    }
}
```

**Step 6: Type check**

```bash
npx tsc --noEmit
```

Expected: May have errors in `src/index.ts` since it references the old `processMessage` signature — that's fixed in Task 6.

**Step 7: Commit**

```bash
git add src/bot.ts
git commit -m "feat: update bot to use streaming with tool status drafts"
```

---

### Task 6: Wire Streaming in index.ts

**Files:**
- Modify: `src/index.ts`

**Step 1: Update imports**

```typescript
import { Bot } from "grammy";
import { stream } from "@grammyjs/stream";
import { autoRetry } from "@grammyjs/auto-retry";
import { processMessage, getMessages, type AgentProxy, type StreamContext } from "./bot.js";
```

**Step 2: Update bot creation and middleware**

In the webhook handler (around line 564), update the bot setup:

```typescript
const bot = new Bot<StreamContext>(env.TELEGRAM_BOT_TOKEN);
await bot.init();
bot.api.config.use(autoRetry());
bot.use(stream());
```

**Step 3: Add streaming callAgent function**

Add alongside the existing `callAgent` function:

```typescript
async function callAgentStream(
    env: Env,
    chatId: number,
    message: string,
    userName?: string,
): Promise<ReadableStream> {
    const agentId = env.CHAT_AGENT.idFromName(String(chatId));
    const stub = env.CHAT_AGENT.get(agentId);

    const response = await stub.fetch(
        new Request("http://agent/runAgentTurnStream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, userName }),
        })
    );

    if (!response.ok || !response.body) {
        throw new Error(`Agent stream failed: ${response.status}`);
    }

    return response.body;
}
```

**Step 4: Update the `getAgent` proxy in the webhook message handler**

In the `bot.on("message", ...)` handler, add `runAgentTurnStream` to the proxy:

```typescript
const getAgent = async (id: number): Promise<AgentProxy> => {
    return {
        checkBusy: async (): Promise<string | null> => {
            const response = await callAgent(env, id, "checkBusy");
            return response.result ?? null;
        },
        runAgentTurn: async (message: string, userName?: string) => {
            const response = await callAgent(env, id, "runAgentTurn", { message, userName });
            if (response.error) throw new Error(response.error);
            const agentResponse = response.result as { text: string; chartUrl?: string } | undefined;
            return {
                text: agentResponse?.text ?? "",
                chartUrl: agentResponse?.chartUrl,
            };
        },
        runAgentTurnStream: async (message: string, userName?: string) => {
            return callAgentStream(env, id, message, userName);
        },
    };
};
```

**Step 5: Type check**

```bash
npx tsc --noEmit
```

Expected: PASS — all types should align now.

**Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire streaming through webhook handler with stream and auto-retry plugins"
```

---

### Task 7: Verify and Manual Test

**Step 1: Full type check**

```bash
npx tsc --noEmit
```

Expected: PASS

**Step 2: Start dev server**

```bash
pnpm run dev
```

Expected: No startup errors.

**Step 3: Manual test via Telegram**

Test these scenarios:

1. **Simple text** (no tools): Send "Hola" — should stream the greeting text
2. **Single tool call**: Send "¿Cuánto gasté este mes?" — should show "⏳ Consultando transacciones..." then stream the answer
3. **Multiple tool calls**: Send "Muéstrame un gráfico de gastos por categoría este mes" — should show query status, then chart status, then stream the text with chart URL
4. **Transaction creation**: Send "15€ en Mercadona" — should show "⏳ Registrando transacción..." then stream confirmation

**Step 4: Commit any fixes and final commit**

```bash
git add -A
git commit -m "feat: LLM response streaming with ephemeral tool status messages"
```
