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
import { FireflyClient, getCachedCategories, getCachedAssetAccountIds, getCachedTags, getCachedAssetAccounts } from "./tools/firefly.js";
import { aggregateTransactions, formatAggregateResult, type GroupByOption } from "./query/aggregate.js";
import { buildChartConfig, generateQuickChartUrl } from "./tools/charts.js";

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
            name: "firefly_delete_transaction",
            description:
                "Delete a transaction from Firefly III. IMPORTANT: Always confirm with the user before calling this. First search for the transaction, show details, ask for confirmation, then delete.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    transaction_id: {
                        type: "string",
                        description: "The ID of the transaction to delete. Get this from firefly_query_transactions results.",
                    },
                },
                required: ["transaction_id"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "firefly_update_transaction",
            description:
                "Update an existing transaction in Firefly III. IMPORTANT: Always confirm changes with the user before calling this. Only include fields that need to be changed.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    transaction_id: {
                        type: "string",
                        description: "The ID of the transaction to update. Get this from firefly_query_transactions results.",
                    },
                    date: {
                        type: ["string", "null"],
                        description: "New date (YYYY-MM-DD). Use null to keep current.",
                    },
                    amount: {
                        type: ["number", "null"],
                        description: "New amount. Use null to keep current.",
                    },
                    description: {
                        type: ["string", "null"],
                        description: "New description/merchant name. Use null to keep current.",
                    },
                    category_name: {
                        type: ["string", "null"],
                        description: "New category name. Use null to keep current.",
                    },
                    tags: {
                        type: ["array", "null"],
                        items: { type: "string" },
                        description: "New tags array. Use null to keep current.",
                    },
                    notes: {
                        type: ["string", "null"],
                        description: "New notes. Use null to keep current.",
                    },
                },
                required: ["transaction_id", "date", "amount", "description", "category_name", "tags", "notes"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "firefly_query_transactions",
            description:
                "Search, aggregate, and optionally chart transactions from Firefly III. Use for questions about spending, summaries, finding transactions, or generating charts. Text search is substring matching (not fuzzy). Set chart_type to get a visual chart instead of text.",
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
                        description: "Filter by category name. Must match exactly from available categories. Use null to include all.",
                    },
                    text_contains: {
                        type: ["string", "null"],
                        description: "Substring search in transaction descriptions (case-insensitive, NOT fuzzy). Use null for no text filter.",
                    },
                    tag: {
                        type: ["string", "null"],
                        description: "Filter by tag name. Must match exactly from available tags. Use null to include all.",
                    },
                    transaction_type: {
                        type: ["string", "null"],
                        enum: ["withdrawal", "deposit", "transfer", null],
                        description: "Filter by transaction type. Use null to include all types.",
                    },
                    aggregate_kind: {
                        type: ["string", "null"],
                        enum: ["sum", "count", "avg", null],
                        description: "Type of aggregation to perform. Required if chart_type is set. Use null to return raw transactions.",
                    },
                    aggregate_group_by: {
                        type: ["string", "null"],
                        enum: ["category", "month", "week", "day", "merchant", "tag", null],
                        description: "How to group results. Required if chart_type is set. 'month'=YYYY-MM, 'week'=YYYY-Wnn, 'day'=YYYY-MM-DD, 'merchant'=destination name, 'tag'=by tag.",
                    },
                    chart_type: {
                        type: ["string", "null"],
                        enum: ["pie", "bar", "line", "doughnut", null],
                        description: "If set, returns a chart URL instead of text. Requires aggregate_kind and aggregate_group_by. Use pie/doughnut for category breakdown, bar for comparisons over time, line for trends.",
                    },
                    chart_title: {
                        type: ["string", "null"],
                        description: "Title for the chart. Use null for auto-generated title. Only used when chart_type is set.",
                    },
                    limit: {
                        type: ["number", "null"],
                        description: "Maximum transactions to fetch. Default 100. Use higher for comprehensive queries.",
                    },
                },
                required: ["date_from", "date_to", "category_name", "text_contains", "tag", "transaction_type", "aggregate_kind", "aggregate_group_by", "chart_type", "chart_title", "limit"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "generate_chart",
            description:
                "Generate a chart from manually provided data points. Use when you need to combine data from multiple queries, apply custom labels, or chart non-Firefly data. For single queries, prefer using firefly_query_transactions with chart_type instead.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    chart_type: {
                        type: "string",
                        enum: ["pie", "bar", "line", "doughnut"],
                        description: "Type of chart. Pie/doughnut for proportions, bar for comparisons, line for trends.",
                    },
                    title: {
                        type: "string",
                        description: "Chart title.",
                    },
                    data_points: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                label: { type: "string", description: "Label for this data point (e.g., category name, month)." },
                                value: { type: "number", description: "Numeric value for this data point." },
                            },
                            required: ["label", "value"],
                            additionalProperties: false,
                        },
                        description: "Array of data points to chart. Each point has a label and numeric value.",
                    },
                },
                required: ["chart_type", "title", "data_points"],
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
    {
        type: "function",
        function: {
            name: "firefly_get_accounts",
            description:
                "Get a list of accounts with their current balances. Use for questions about account balances, net worth, or to find account IDs for history queries.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    account_type: {
                        type: ["string", "null"],
                        enum: ["asset", "expense", "revenue", "liability", null],
                        description: "Filter by account type. Use 'asset' for bank accounts, savings, cash. Use null to get all types.",
                    },
                },
                required: ["account_type"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "firefly_get_account_history",
            description:
                "Get balance history for a specific account over time. Use for net worth trends, savings progress, or balance charts. Can return text or chart.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    account_id: {
                        type: "string",
                        description: "The account ID. Get this from firefly_get_accounts or use one from available accounts in context.",
                    },
                    date_from: {
                        type: "string",
                        description: "Start date (YYYY-MM-DD).",
                    },
                    date_to: {
                        type: "string",
                        description: "End date (YYYY-MM-DD).",
                    },
                    period: {
                        type: "string",
                        enum: ["1D", "1W", "1M", "1Y"],
                        description: "Data granularity: 1D=daily, 1W=weekly, 1M=monthly, 1Y=yearly. Use 1D for short ranges (weeks), 1W for months, 1M for years.",
                    },
                    chart_type: {
                        type: ["string", "null"],
                        enum: ["line", "bar", null],
                        description: "If set, returns a chart URL. 'line' for trends, 'bar' for comparisons. Use null for text data.",
                    },
                    chart_title: {
                        type: ["string", "null"],
                        description: "Title for the chart. Use null for auto-generated. Only used when chart_type is set.",
                    },
                },
                required: ["account_id", "date_from", "date_to", "period", "chart_type", "chart_title"],
                additionalProperties: false,
            },
        },
    },
];

const SYSTEM_PROMPTS = {
    es: (categories: string[], tags: string[], accounts: { id: string; name: string }[], currency: string, timezone: string) => {
        const now = new Date().toLocaleString("es-ES", { timeZone: timezone });
        const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD format
        const accountsList = accounts.map((a) => `${a.name} (id: ${a.id})`).join(", ");
        return `Eres un asistente financiero para registrar gastos e ingresos en Firefly III.

Fecha y hora actual: ${now}
Fecha de hoy (para transacciones): ${today}
Moneda por defecto: ${currency}

Categorías disponibles: ${categories.join(", ")}
Etiquetas (tags) disponibles: ${tags.length > 0 ? tags.join(", ") : "(ninguna)"}
Cuentas disponibles: ${accountsList}

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

EDITAR Y ELIMINAR TRANSACCIONES:
- Para eliminar o editar, primero busca la transacción con firefly_query_transactions.
- Los resultados incluyen el "id" de cada transacción, necesario para editar/eliminar.
- SIEMPRE pide confirmación explícita al usuario antes de eliminar o modificar.
- Muestra los detalles de la transacción y pregunta: "¿Confirmas que quieres [eliminar/modificar] esta transacción?"
- Solo ejecuta la acción si el usuario responde afirmativamente (sí, ok, confirmo, adelante, etc.).
- Para editar, usa firefly_update_transaction solo con los campos que cambian (deja null los demás).

GRÁFICOS Y REPORTES:
- Para gráficos de transacciones, usa firefly_query_transactions con chart_type (pie, bar, line, doughnut). Requiere aggregate_kind y aggregate_group_by.
- Ejemplo: gastos por categoría este mes → chart_type="pie", aggregate_kind="sum", aggregate_group_by="category"
- Ejemplo: tendencia de gastos por semana → chart_type="line", aggregate_kind="sum", aggregate_group_by="week"
- Para datos combinados o personalizados, usa generate_chart con data_points manuales.
- Si el usuario pide un informe completo o detallado, usa firefly_report_link para dar un enlace.
- Cuando generes un gráfico, responde con: "📊 Aquí tienes el gráfico:" seguido del gráfico.
- Cuando des un enlace a informe, responde con: "🔗 [Ver informe completo](URL)"

CUENTAS Y BALANCES:
- Para ver saldos actuales de cuentas, usa firefly_get_accounts.
- Para ver la evolución del saldo de una cuenta, usa firefly_get_account_history con el account_id de la lista de cuentas disponibles.
- Usa el parámetro period para la granularidad: 1D=diario, 1W=semanal, 1M=mensual, 1Y=anual.
- Puedes generar gráficos de balance con chart_type="line" o "bar".
- Ejemplo: "¿cómo ha evolucionado mi cuenta este mes?" → period="1D", chart_type="line"
- Ejemplo: "¿cómo ha evolucionado mi cuenta este año?" → period="1M", chart_type="line"`;
    },
    en: (categories: string[], tags: string[], accounts: { id: string; name: string }[], currency: string, timezone: string) => {
        const now = new Date().toLocaleString("en-US", { timeZone: timezone });
        const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD format
        const accountsList = accounts.map((a) => `${a.name} (id: ${a.id})`).join(", ");
        return `You are a helpful financial assistant for tracking expenses and income in Firefly III.

Current date and time: ${now}
Today's date (for transactions): ${today}
Default currency: ${currency}

Available categories: ${categories.join(", ")}
Available tags: ${tags.length > 0 ? tags.join(", ") : "(none)"}
Available accounts: ${accountsList}

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

EDIT AND DELETE TRANSACTIONS:
- To delete or edit, first search for the transaction with firefly_query_transactions.
- Results include the "id" of each transaction, needed for edit/delete operations.
- ALWAYS ask for explicit confirmation before deleting or modifying.
- Show transaction details and ask: "Do you confirm you want to [delete/modify] this transaction?"
- Only execute the action if the user responds affirmatively (yes, ok, confirm, go ahead, etc.).
- To edit, use firefly_update_transaction with only the fields that change (leave null for others).

CHARTS AND REPORTS:
- For transaction charts, use firefly_query_transactions with chart_type (pie, bar, line, doughnut). Requires aggregate_kind and aggregate_group_by.
- Example: expenses by category this month → chart_type="pie", aggregate_kind="sum", aggregate_group_by="category"
- Example: spending trend by week → chart_type="line", aggregate_kind="sum", aggregate_group_by="week"
- For combined or custom data, use generate_chart with manual data_points.
- If user asks for a complete/detailed report, use firefly_report_link to provide a link.
- When generating a chart, respond with: "📊 Here's your chart:" followed by the chart.
- When providing a report link, respond with: "🔗 [View full report](URL)"

ACCOUNTS AND BALANCES:
- To see current account balances, use firefly_get_accounts.
- To see account balance over time, use firefly_get_account_history with account_id from available accounts list.
- Use the period parameter for granularity: 1D=daily, 1W=weekly, 1M=monthly, 1Y=yearly.
- You can generate balance charts with chart_type="line" or "bar".
- Example: "how has my account evolved this month?" → period="1D", chart_type="line"
- Example: "how has my account evolved this year?" → period="1M", chart_type="line"`;
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

            // Get categories, tags, and accounts for context
            const [categories, tags, accounts] = await Promise.all([
                getCachedCategories(env),
                getCachedTags(env),
                getCachedAssetAccounts(env),
            ]);
            const categoryNames = categories.map((c) => c.name);

            const currency = this.state.defaultCurrency ?? env.DEFAULT_CURRENCY;

            // Build system prompt
            const systemPrompt = SYSTEM_PROMPTS[lang](categoryNames, tags, accounts, currency, timezone);

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
                        } else if (toolCall.function.name === "firefly_delete_transaction") {
                            await firefly.deleteTransaction(args.transaction_id);
                            result = JSON.stringify({
                                success: true,
                                deleted_id: args.transaction_id,
                            });
                        } else if (toolCall.function.name === "firefly_update_transaction") {
                            // Build updates object with only non-null values
                            const updates: {
                                date?: string;
                                amount?: number;
                                description?: string;
                                category_name?: string;
                                tags?: string[];
                                notes?: string;
                            } = {};

                            if (args.date !== null) updates.date = args.date;
                            if (args.amount !== null) updates.amount = args.amount;
                            if (args.description !== null) updates.description = args.description;
                            if (args.category_name !== null) updates.category_name = args.category_name;
                            if (args.tags !== null) updates.tags = args.tags;
                            if (args.notes !== null) updates.notes = args.notes;

                            const updated = await firefly.updateTransaction(args.transaction_id, updates);
                            result = JSON.stringify({
                                success: true,
                                id: updated.id,
                                description: updated.description,
                                updated_fields: Object.keys(updates),
                            });
                        } else if (toolCall.function.name === "firefly_query_transactions") {
                            // Build Firefly search query string
                            const queryParts: string[] = [];

                            if (args.date_from) queryParts.push(`date_after:${args.date_from}`);
                            if (args.date_to) queryParts.push(`date_before:${args.date_to}`);
                            if (args.category_name) queryParts.push(`category_is:"${args.category_name}"`);
                            if (args.tag) queryParts.push(`tag_is:"${args.tag}"`);
                            if (args.transaction_type) queryParts.push(`type:${args.transaction_type}`);
                            if (args.text_contains) queryParts.push(`description_contains:"${args.text_contains}"`);

                            const query = queryParts.length > 0 ? queryParts.join(" ") : "*";
                            const limit = args.limit ?? 100;
                            const transactions = await firefly.searchTransactions(query, limit);

                            const groupBy = args.aggregate_group_by as GroupByOption;

                            if (args.chart_type && args.aggregate_kind && groupBy) {
                                // Generate chart from aggregated data
                                const aggregateInput = {
                                    kind: args.aggregate_kind as "sum" | "count" | "avg",
                                    group_by: groupBy,
                                };
                                const aggregated = aggregateTransactions(transactions, aggregateInput);

                                if (!aggregated.grouped || Object.keys(aggregated.grouped).length === 0) {
                                    result = JSON.stringify({ error: "No data to chart for the specified criteria." });
                                } else {
                                    // Build chart data from grouped results
                                    const chartData = Object.entries(aggregated.grouped).map(([label, value]) => ({
                                        label,
                                        value: Math.abs(value),
                                    }));

                                    // Sort: time-based by key asc, others by value desc
                                    const isTimeBased = groupBy === "month" || groupBy === "week" || groupBy === "day";
                                    chartData.sort((a, b) =>
                                        isTimeBased ? a.label.localeCompare(b.label) : b.value - a.value
                                    );

                                    // Generate title if not provided
                                    const groupLabel = { category: "categoría", month: "mes", week: "semana", day: "día", merchant: "comercio", tag: "etiqueta" };
                                    const defaultTitle = lang === "es"
                                        ? `${args.aggregate_kind === "sum" ? "Gastos" : args.aggregate_kind === "count" ? "Transacciones" : "Promedio"} por ${groupLabel[groupBy] ?? groupBy}`
                                        : `${args.aggregate_kind === "sum" ? "Spending" : args.aggregate_kind === "count" ? "Transactions" : "Average"} by ${groupBy}`;
                                    const title = args.chart_title ?? defaultTitle;

                                    const chartType = args.chart_type as "pie" | "bar" | "line" | "doughnut";
                                    const config = buildChartConfig(chartType, title, chartData, currency);
                                    const generatedChartUrl = await generateQuickChartUrl(config);

                                    // Store chart URL
                                    chartUrl = generatedChartUrl;

                                    result = JSON.stringify({
                                        success: true,
                                        chart_url: generatedChartUrl,
                                        title,
                                        data_points: chartData.length,
                                    });
                                }
                            } else if (args.aggregate_kind) {
                                // Text aggregation
                                const aggregateInput = {
                                    kind: args.aggregate_kind as "sum" | "count" | "avg",
                                    group_by: groupBy,
                                };
                                const aggregated = aggregateTransactions(transactions, aggregateInput);
                                result = formatAggregateResult(aggregated, currency, groupBy);
                            } else {
                                // Return raw transaction list with IDs for edit/delete
                                const txList = transactions.flatMap((t) =>
                                    t.attributes.transactions.map((split) => ({
                                        id: t.id, // Transaction ID for edit/delete operations
                                        date: split.date,
                                        amount: split.amount,
                                        description: split.description,
                                        category: split.category_name,
                                        destination: split.destination_name,
                                        tags: split.tags,
                                    }))
                                );
                                result = JSON.stringify(txList, null, 2);
                            }
                        } else if (toolCall.function.name === "generate_chart") {
                            // Manual chart generation from provided data points
                            const chartType = args.chart_type as "pie" | "bar" | "line" | "doughnut";
                            const title = args.title as string;
                            const dataPoints = args.data_points as { label: string; value: number }[];

                            if (!dataPoints || dataPoints.length === 0) {
                                result = JSON.stringify({ error: "No data points provided." });
                            } else {
                                // Manual chart - no currency label (user provides raw data)
                                const config = buildChartConfig(chartType, title, dataPoints);
                                const generatedChartUrl = await generateQuickChartUrl(config);

                                // Store chart URL
                                chartUrl = generatedChartUrl;

                                result = JSON.stringify({
                                    success: true,
                                    chart_url: generatedChartUrl,
                                    title,
                                    data_points: dataPoints.length,
                                });
                            }
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
                        } else if (toolCall.function.name === "firefly_get_accounts") {
                            // Get accounts list
                            const accountType = args.account_type as "asset" | "expense" | "revenue" | "liability" | undefined;
                            const accounts = await firefly.getAccounts(accountType ?? undefined);

                            // Format for LLM
                            const accountList = accounts.map((a) => ({
                                id: a.id,
                                name: a.name,
                                type: a.type,
                                balance: `${a.current_balance.toFixed(2)} ${a.currency_code}`,
                            }));

                            result = JSON.stringify(accountList, null, 2);
                        } else if (toolCall.function.name === "firefly_get_account_history") {
                            // Get account balance history
                            const period = args.period as "1D" | "1W" | "1M" | "1Y";
                            const history = await firefly.getAccountHistory(
                                args.account_id,
                                args.date_from,
                                args.date_to,
                                period
                            );

                            if (history.length === 0) {
                                result = JSON.stringify({ error: "No history data found for this account and date range." });
                            } else if (args.chart_type) {
                                // Generate chart from history
                                const chartType = args.chart_type as "line" | "bar";
                                const chartData = history.map((p) => ({
                                    label: p.date,
                                    value: p.balance,
                                }));

                                // Get account name for title
                                const accounts = await getCachedAssetAccounts(env);
                                const account = accounts.find((a) => a.id === args.account_id);
                                const accountName = account?.name ?? `Account ${args.account_id}`;

                                const defaultTitle = lang === "es"
                                    ? `Balance de ${accountName} (${args.date_from} - ${args.date_to})`
                                    : `${accountName} Balance (${args.date_from} - ${args.date_to})`;
                                const title = args.chart_title ?? defaultTitle;

                                const config = buildChartConfig(chartType, title, chartData, currency);
                                const generatedChartUrl = await generateQuickChartUrl(config);

                                chartUrl = generatedChartUrl;

                                result = JSON.stringify({
                                    success: true,
                                    chart_url: generatedChartUrl,
                                    title,
                                    data_points: chartData.length,
                                });
                            } else {
                                // Return text data
                                const formatted = history.map((p) => `${p.date}: ${p.balance.toFixed(2)} ${currency}`);
                                result = formatted.join("\n");
                            }
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
