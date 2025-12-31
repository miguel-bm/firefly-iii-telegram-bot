import { Agent } from "agents";
import OpenAI from "openai";
import type {
    Env,
    ChatAgentState,
    ChatMessage,
    CreateTransactionInput,
    QueryTransactionsInput,
    AgentResponse,
} from "./types.js";
import { FireflyClient, getCachedCategories, getCachedAssetAccountIds } from "./tools/firefly.js";
import { aggregateTransactions, formatAggregateResult } from "./query/aggregate.js";
import { buildExpenseByCategoryChart } from "./tools/charts.js";

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "firefly_create_transaction",
            description:
                "Create a new transaction in Firefly III. Use this for recording expenses, income, or transfers. Default type is 'withdrawal' for expenses.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    date: {
                        type: "string",
                        description: "Transaction date in YYYY-MM-DD format. Use today if not specified.",
                    },
                    amount: {
                        type: "number",
                        description: "Transaction amount as a positive number.",
                    },
                    description: {
                        type: "string",
                        description: "Transaction description (merchant name or note).",
                    },
                    category_name: {
                        type: ["string", "null"],
                        description: "Category name. Should match existing categories when possible. Use null if unknown.",
                    },
                },
                required: ["date", "amount", "description", "category_name"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "firefly_query_transactions",
            description:
                "Search and aggregate transactions from Firefly III. Use for questions about spending, summaries, or finding specific transactions.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    date_from: {
                        type: ["string", "null"],
                        description: "Start date for search (YYYY-MM-DD). Use null for no lower bound.",
                    },
                    date_to: {
                        type: ["string", "null"],
                        description: "End date for search (YYYY-MM-DD). Use null for no upper bound.",
                    },
                    category_name: {
                        type: ["string", "null"],
                        description: "Filter by category name. Use null to include all categories.",
                    },
                    text_contains: {
                        type: ["string", "null"],
                        description: "Search text in transaction descriptions. Use null for no text filter.",
                    },
                    aggregate_kind: {
                        type: ["string", "null"],
                        enum: ["sum", "count", "avg", null],
                        description: "Type of aggregation to perform. Use null to return raw transactions.",
                    },
                    aggregate_group_by: {
                        type: ["string", "null"],
                        enum: ["category", "month", null],
                        description: "How to group the aggregation results. Use null for no grouping.",
                    },
                    limit: {
                        type: ["number", "null"],
                        description: "Maximum number of transactions to return. Use null for default (10).",
                    },
                },
                required: ["date_from", "date_to", "category_name", "text_contains", "aggregate_kind", "aggregate_group_by", "limit"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "firefly_generate_chart",
            description:
                "Generate a visual chart of financial data. Use when user asks for a graph, chart, or visual representation of their finances.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    chart_type: {
                        type: "string",
                        enum: ["pie", "bar", "doughnut"],
                        description: "Type of chart. Pie/doughnut for category breakdown, bar for comparisons.",
                    },
                    data_source: {
                        type: "string",
                        enum: ["expense_by_category", "income_by_category"],
                        description: "What data to visualize.",
                    },
                    date_from: {
                        type: "string",
                        description: "Start date (YYYY-MM-DD).",
                    },
                    date_to: {
                        type: "string",
                        description: "End date (YYYY-MM-DD).",
                    },
                    title: {
                        type: ["string", "null"],
                        description: "Chart title. Use null for auto-generated title.",
                    },
                },
                required: ["chart_type", "data_source", "date_from", "date_to", "title"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "firefly_report_link",
            description:
                "Get a link to a detailed Firefly III report. Use when the user asks for a complete report, or when the query is too complex for other tools.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    report_type: {
                        type: "string",
                        enum: ["default", "budget", "category", "tag"],
                        description: "Type of report. 'default' for general overview, others for specific breakdowns.",
                    },
                    date_from: {
                        type: "string",
                        description: "Start date (YYYY-MM-DD).",
                    },
                    date_to: {
                        type: "string",
                        description: "End date (YYYY-MM-DD).",
                    },
                },
                required: ["report_type", "date_from", "date_to"],
                additionalProperties: false,
            },
        },
    },
];

const SYSTEM_PROMPTS = {
    es: (categories: string[], currency: string, timezone: string) => {
        const now = new Date().toLocaleString("es-ES", { timeZone: timezone });
        const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD format
        return `Eres un asistente financiero para registrar gastos e ingresos en Firefly III.

Fecha y hora actual: ${now}
Fecha de hoy (para transacciones): ${today}
Moneda por defecto: ${currency}

Categorías disponibles: ${categories.join(", ")}

COMPORTAMIENTOS IMPORTANTES:
1. Interpreta los mensajes del usuario como solicitudes de transacciones por defecto. Por ejemplo, "103 en compras en Mercadona" debe interpretarse como una transacción de retiro/gasto.
2. Usa siempre la categoría apropiada de la lista disponible cuando sea posible.
3. Si no estás seguro de la categorización, pregunta al usuario para clarificar.
4. El usuario puede usar diferentes formatos para cantidades (ej: "10 euros", "€10", "10"). Interprétalos correctamente.
5. Si no se especifica fecha, usa la fecha de hoy.
6. Cada mensaje indica qué usuario está hablando.

REGLA CRÍTICA - SIEMPRE CONSULTAR PRIMERO:
- El historial de mensajes en tu contexto NO contiene datos completos de transacciones.
- SIEMPRE usa la herramienta firefly_query_transactions ANTES de responder preguntas sobre totales, sumas, cantidades gastadas, etc.
- NUNCA respondas sobre cantidades basándote solo en el historial de la conversación.
- Incluso si parece que ya tienes la información, DEBES usar la herramienta de consulta para obtener datos actualizados y completos.

FORMATO DE RESPUESTA - MUY IMPORTANTE:
- Sé CONCISO. No hagas preguntas de seguimiento como "¿Quieres consultar algo más?" o "¿Necesitas algo más?".
- Para transacciones creadas, usa EXACTAMENTE este formato:
  "Registrado un gasto de [importe]€ con concepto "[descripción]" en la categoría *[categoría]*."
- El nombre de la categoría debe estar en negrita usando asteriscos: *Categoría*
- Para consultas, responde solo con los datos solicitados, sin preguntas adicionales.

NOTA SOBRE TRANSACCIONES:
- El campo "description" es el nombre del comercio/destinatario (ej: "Mercadona", "Restaurante La Tasca").
- Este nombre también se usa como destino del gasto en Firefly III.
- IMPORTANTE: Corrige errores tipográficos y capitaliza correctamente los nombres de comercios.
  Ejemplos: "mercadona" → "Mercadona", "Mercadna" → "Mercadona", "lidl" → "Lidl", "amazon" → "Amazon".
- Usa tu conocimiento para identificar comercios conocidos y escribir sus nombres correctamente.

GRÁFICOS Y REPORTES:
- Si el usuario pide un gráfico, chart, o visualización, usa la herramienta firefly_generate_chart.
- Si el usuario pide un informe completo o detallado, o la consulta es muy compleja, usa firefly_report_link para dar un enlace.
- Cuando generes un gráfico, responde con: "📊 Aquí tienes el gráfico:" seguido del gráfico.
- Cuando des un enlace a informe, responde con: "🔗 [Ver informe completo](URL)"`;
    },
    en: (categories: string[], currency: string, timezone: string) => {
        const now = new Date().toLocaleString("en-US", { timeZone: timezone });
        const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD format
        return `You are a helpful financial assistant for tracking expenses and income in Firefly III.

Current date and time: ${now}
Today's date (for transactions): ${today}
Default currency: ${currency}

Available categories: ${categories.join(", ")}

IMPORTANT BEHAVIORS:
1. Interpret user messages as transaction requests by default. For example, "103 on groceries at Mercadona" should be interpreted as a withdrawal transaction.
2. Always use the appropriate category from the available list when possible.
3. If you're uncertain about categorization, ask the user to clarify.
4. For amounts, the user may use different formats (e.g., "10 euros", "€10", "10"). Parse these correctly.
5. If no date is specified, use today's date.
6. Each message indicates which user is speaking.

CRITICAL RULE - ALWAYS QUERY FIRST:
- The message history in your context does NOT contain complete transaction data.
- ALWAYS use the firefly_query_transactions tool BEFORE answering questions about totals, sums, amounts spent, etc.
- NEVER answer about amounts based only on conversation history.
- Even if it seems you already have the information, you MUST use the query tool to get updated and complete data.

RESPONSE FORMAT - VERY IMPORTANT:
- Be CONCISE. Do NOT ask follow-up questions like "Would you like anything else?" or "Need anything more?".
- For created transactions, use EXACTLY this format:
  "Recorded an expense of [amount]€ for "[description]" in category *[category]*."
- Category name must be bold using asterisks: *Category*
- For queries, respond only with the requested data, no additional questions.

NOTE ABOUT TRANSACTIONS:
- The "description" field is the merchant/recipient name (e.g., "Mercadona", "La Tasca Restaurant").
- This name is also used as the expense destination in Firefly III.
- IMPORTANT: Fix typos and properly capitalize merchant names.
  Examples: "mercadona" → "Mercadona", "Mercadna" → "Mercadona", "lidl" → "Lidl", "amazon" → "Amazon".
- Use your knowledge to identify well-known merchants and write their names correctly.

CHARTS AND REPORTS:
- If user asks for a graph, chart, or visualization, use the firefly_generate_chart tool.
- If user asks for a complete/detailed report, or the query is too complex, use firefly_report_link to provide a link.
- When generating a chart, respond with: "📊 Here's your chart:" followed by the chart.
- When providing a report link, respond with: "🔗 [View full report](URL)"`;
    },
};

const BUSY_MESSAGES = {
    es: "⏳ Espera un momento, todavía estoy procesando tu mensaje anterior...",
    en: "⏳ Please wait, I'm still processing your previous message...",
};

const RESET_MESSAGES = {
    es: "🔄 Historial de conversación borrado.",
    en: "🔄 Conversation history cleared.",
};

export class ChatAgentDO extends Agent<Env, ChatAgentState> {
    initialState: ChatAgentState = {
        chatId: 0,
        defaultAccountId: null,
        defaultCurrency: "EUR",
        lastMode: null,
        categorySnapshotVersion: null,
        messageHistory: [],
        isProcessing: false,
    };

    // Handle HTTP requests to the agent
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const action = url.pathname.replace("/", "");

        try {
            const body = request.method === "POST"
                ? await request.json() as { message?: string; userName?: string }
                : {};

            if (action === "checkBusy") {
                const result = this.checkBusy();
                return Response.json({ result });
            }

            if (action === "resetHistory") {
                const result = this.resetHistory();
                return Response.json({ result });
            }

            if (action === "runAgentTurn") {
                const result = await this.runAgentTurn(body.message ?? "", body.userName);
                return Response.json({ result });
            }

            return Response.json({ error: "Unknown action" }, { status: 404 });
        } catch (error) {
            console.error("Agent fetch error:", error);
            return Response.json(
                { error: error instanceof Error ? error.message : "Unknown error" },
                { status: 500 }
            );
        }
    }

    // Check if busy and return error message if so
    checkBusy(): string | null {
        if (this.state.isProcessing) {
            const lang = this.env.BOT_LANGUAGE ?? "es";
            return BUSY_MESSAGES[lang];
        }
        return null;
    }

    // Reset conversation history
    resetHistory(): string {
        this.setState({
            ...this.state,
            messageHistory: [],
        });
        const lang = this.env.BOT_LANGUAGE ?? "es";
        return RESET_MESSAGES[lang];
    }

    async runAgentTurn(message: string, userName?: string): Promise<AgentResponse> {
        const env = this.env;
        const lang = env.BOT_LANGUAGE ?? "es";
        const timezone = env.BOT_TIMEZONE ?? "Europe/Madrid";
        const maxHistory = parseInt(env.MAX_HISTORY_MESSAGES ?? "20", 10);

        // Set processing flag
        this.setState({ ...this.state, isProcessing: true });

        // Track chart URL if generated
        let chartUrl: string | undefined;

        try {
            const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
            const firefly = new FireflyClient(env);

            // Get categories for context
            const categories = await getCachedCategories(env);
            const categoryNames = categories.map((c) => c.name);

            const currency = this.state.defaultCurrency ?? env.DEFAULT_CURRENCY;

            // Build system prompt
            const systemPrompt = SYSTEM_PROMPTS[lang](categoryNames, currency, timezone);

            // Build messages with history
            const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
                { role: "system", content: systemPrompt },
            ];

            // Add message history
            for (const historyMsg of this.state.messageHistory) {
                if (historyMsg.role === "user") {
                    const prefix = historyMsg.userName ? `[${historyMsg.userName}]: ` : "";
                    messages.push({ role: "user", content: prefix + historyMsg.content });
                } else {
                    messages.push({ role: "assistant", content: historyMsg.content });
                }
            }

            // Add current message with user name
            const userPrefix = userName ? `[${userName}]: ` : "";
            messages.push({ role: "user", content: userPrefix + message });

            // Agent loop - keep calling until no more tool calls
            let iterations = 0;
            const maxIterations = 5;
            let finalResponse = "";

            while (iterations < maxIterations) {
                iterations++;

                const response = await openai.chat.completions.create({
                    model: "gpt-4.1-mini",
                    messages,
                    tools: TOOLS,
                    tool_choice: "auto",
                });

                const choice = response.choices[0];
                if (!choice?.message) {
                    finalResponse = lang === "es"
                        ? "No pude procesar esa solicitud."
                        : "I couldn't process that request.";
                    break;
                }

                const assistantMessage = choice.message;
                messages.push(assistantMessage);

                // If no tool calls, return the content
                if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
                    finalResponse = assistantMessage.content ?? (lang === "es" ? "Hecho." : "Done.");
                    break;
                }

                // Process tool calls
                for (const toolCall of assistantMessage.tool_calls) {
                    let result: string;

                    // Skip non-function tool calls
                    if (toolCall.type !== "function") continue;

                    try {
                        const args = JSON.parse(toolCall.function.arguments);

                        if (toolCall.function.name === "firefly_create_transaction") {
                            const input: CreateTransactionInput = {
                                type: args.type ?? "withdrawal",
                                date: args.date,
                                amount: args.amount,
                                currency: args.currency,
                                description: args.description,
                                category_name: args.category_name,
                                source_account_id: args.source_account_id,
                                notes: args.notes,
                            };

                            const created = await firefly.createTransaction(input, env);
                            result = JSON.stringify({
                                success: true,
                                id: created.id,
                                description: created.description,
                                amount: input.amount,
                                category: input.category_name,
                            });
                        } else if (toolCall.function.name === "firefly_query_transactions") {
                            // Build search query
                            const queryParts: string[] = [];

                            if (args.date_from) queryParts.push(`date_after:${args.date_from}`);
                            if (args.date_to) queryParts.push(`date_before:${args.date_to}`);
                            if (args.category_name) queryParts.push(`category_is:${args.category_name}`);
                            if (args.text_contains) queryParts.push(args.text_contains);

                            const query = queryParts.length > 0 ? queryParts.join(" ") : "*";
                            const transactions = await firefly.searchTransactions(query, args.limit ?? 10);

                            if (args.aggregate_kind) {
                                const aggregateInput: QueryTransactionsInput["aggregate"] = {
                                    kind: args.aggregate_kind,
                                    group_by: args.aggregate_group_by,
                                };
                                const aggregated = aggregateTransactions(transactions, aggregateInput);
                                result = formatAggregateResult(aggregated, currency);
                            } else {
                                // Return raw transaction list
                                const txList = transactions.flatMap((t) =>
                                    t.attributes.transactions.map((split) => ({
                                        date: split.date,
                                        amount: split.amount,
                                        description: split.description,
                                        category: split.category_name,
                                    }))
                                );
                                result = JSON.stringify(txList, null, 2);
                            }
                        } else if (toolCall.function.name === "firefly_generate_chart") {
                            // Generate chart
                            const chartType = args.chart_type as "pie" | "bar" | "doughnut";
                            const dataSource = args.data_source as string;

                            let entries;
                            let defaultTitle: string;

                            if (dataSource === "expense_by_category") {
                                entries = await firefly.getExpenseByCategory(args.date_from, args.date_to);
                                defaultTitle = lang === "es"
                                    ? `Gastos por categoría (${args.date_from} - ${args.date_to})`
                                    : `Expenses by category (${args.date_from} - ${args.date_to})`;
                            } else if (dataSource === "income_by_category") {
                                entries = await firefly.getIncomeByCategory(args.date_from, args.date_to);
                                defaultTitle = lang === "es"
                                    ? `Ingresos por categoría (${args.date_from} - ${args.date_to})`
                                    : `Income by category (${args.date_from} - ${args.date_to})`;
                            } else {
                                throw new Error(`Unknown data source: ${dataSource}`);
                            }

                            const title = args.title ?? defaultTitle;
                            const generatedChartUrl = buildExpenseByCategoryChart(entries, title, chartType);

                            // Store chart URL to include in response
                            chartUrl = generatedChartUrl;

                            // Return success to the LLM
                            result = JSON.stringify({
                                success: true,
                                chart_url: generatedChartUrl,
                                title,
                            });
                        } else if (toolCall.function.name === "firefly_report_link") {
                            // Get asset account IDs for report link
                            const accountIds = await getCachedAssetAccountIds(env);

                            // Generate report link with account IDs
                            const reportUrl = firefly.getReportUrl(
                                args.report_type,
                                accountIds,
                                args.date_from,
                                args.date_to
                            );

                            result = JSON.stringify({
                                success: true,
                                report_url: reportUrl,
                                report_type: args.report_type,
                            });
                        } else {
                            result = JSON.stringify({ error: "Unknown tool" });
                        }
                    } catch (error) {
                        result = JSON.stringify({
                            error: error instanceof Error ? error.message : "Unknown error",
                        });
                    }

                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: result,
                    });
                }
            }

            if (!finalResponse) {
                finalResponse = lang === "es"
                    ? "Alcancé el número máximo de pasos. Por favor, intenta una solicitud más simple."
                    : "I reached the maximum number of steps. Please try a simpler request.";
            }

            // Update message history
            const userMsg: ChatMessage = { role: "user", content: message, userName, timestamp: Date.now() };
            const assistantMsg: ChatMessage = { role: "assistant", content: finalResponse, timestamp: Date.now() };
            const newHistory: ChatMessage[] = [
                ...this.state.messageHistory,
                userMsg,
                assistantMsg,
            ].slice(-maxHistory); // Keep only last N messages

            this.setState({
                ...this.state,
                messageHistory: newHistory,
                isProcessing: false,
            });

            return { text: finalResponse, chartUrl };
        } catch (error) {
            // Clear processing flag on error
            this.setState({ ...this.state, isProcessing: false });
            throw error;
        }
    }
}
