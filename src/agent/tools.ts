import OpenAI from "openai";

export const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "firefly_create_transaction",
            description:
                "Create a new transaction in Firefly III. Use for expenses (withdrawal), income (deposit), or transfers between accounts. Default type is 'withdrawal' for expenses.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    type: {
                        type: ["string", "null"],
                        enum: ["withdrawal", "deposit", "transfer", null],
                        description: "Transaction type. 'withdrawal' for expenses (default), 'deposit' for income, 'transfer' for moving money between asset accounts. Use null for withdrawal.",
                    },
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
                        description: "Transaction description (merchant name for withdrawals, payer for deposits, or transfer note).",
                    },
                    category_name: {
                        type: ["string", "null"],
                        description: "Category name. Should match existing categories when possible. Use null if unknown. Not typically used for transfers.",
                    },
                    source_account_id: {
                        type: ["string", "null"],
                        description: "Source account ID. For withdrawals: your asset account (defaults to DEFAULT_ACCOUNT_ID). For transfers: the 'from' asset account. For deposits: null. Get IDs from firefly_get_accounts.",
                    },
                    destination_account_id: {
                        type: ["string", "null"],
                        description: "Destination account ID. For transfers: the 'to' asset account. For deposits: your asset account (defaults to DEFAULT_ACCOUNT_ID). For withdrawals: null. Get IDs from firefly_get_accounts.",
                    },
                    tags: {
                        type: ["array", "null"],
                        items: { type: "string" },
                        description: "Array of tags to apply. Use null for default (telegram-bot tag will always be added).",
                    },
                    notes: {
                        type: ["string", "null"],
                        description: "Additional notes for the transaction.",
                    },
                },
                required: ["type", "date", "amount", "description", "category_name", "source_account_id", "destination_account_id", "tags", "notes"],
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
                "Update an existing transaction in Firefly III. Can change type (e.g., withdrawal to transfer), accounts, and all other fields. IMPORTANT: Always confirm changes with the user before calling this.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    transaction_id: {
                        type: "string",
                        description: "The ID of the transaction to update. Get this from firefly_query_transactions results.",
                    },
                    type: {
                        type: ["string", "null"],
                        enum: ["withdrawal", "deposit", "transfer", null],
                        description: "New transaction type. Use to convert expense to transfer. Use null to keep current.",
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
                        description: "New category name. Use null to keep current. Use empty string to remove category.",
                    },
                    source_account_id: {
                        type: ["string", "null"],
                        description: "New source account ID. Required when converting to transfer. Use null to keep current.",
                    },
                    destination_account_id: {
                        type: ["string", "null"],
                        description: "New destination account ID. Required when converting to transfer. Use null to keep current.",
                    },
                    tags: {
                        type: ["array", "null"],
                        items: { type: "string" },
                        description: "New tags array (replaces existing). Use null to keep current.",
                    },
                    notes: {
                        type: ["string", "null"],
                        description: "New notes. Use null to keep current.",
                    },
                },
                required: ["transaction_id", "type", "date", "amount", "description", "category_name", "source_account_id", "destination_account_id", "tags", "notes"],
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
                    has_no_category: {
                        type: ["boolean", "null"],
                        description: "If true, only return transactions WITHOUT a category (uncategorized). Use for categorization review workflow. Use null to ignore this filter.",
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
                    account_id: {
                        type: ["string", "null"],
                        description: "Filter by account ID (matches source OR destination). Use null for all accounts.",
                    },
                    source_account_name: {
                        type: ["string", "null"],
                        description: "Filter by source account name. Useful for finding expenses from specific account. Use null to ignore.",
                    },
                    destination_account_name: {
                        type: ["string", "null"],
                        description: "Filter by destination account name. Useful for finding transfers to specific account. Use null to ignore.",
                    },
                    amount_min: {
                        type: ["number", "null"],
                        description: "Minimum amount filter. Use null for no minimum.",
                    },
                    amount_max: {
                        type: ["number", "null"],
                        description: "Maximum amount filter. Use null for no maximum.",
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
                required: ["date_from", "date_to", "category_name", "has_no_category", "text_contains", "tag", "transaction_type", "account_id", "source_account_name", "destination_account_name", "amount_min", "amount_max", "aggregate_kind", "aggregate_group_by", "chart_type", "chart_title", "limit"],
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
    {
        type: "function",
        function: {
            name: "firefly_get_transaction",
            description:
                "Get complete details of a single transaction by ID. Use before editing or deleting to show user what will be affected. Returns all fields including type, accounts, category, tags.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    transaction_id: {
                        type: "string",
                        description: "The transaction ID to fetch.",
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
            name: "firefly_review_uncategorized",
            description:
                "Get a batch of uncategorized transactions for review. Returns transactions without categories, ordered by date descending. Use this to help user categorize transactions interactively.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    date_from: {
                        type: ["string", "null"],
                        description: "Start date (YYYY-MM-DD). Use null for no lower bound.",
                    },
                    date_to: {
                        type: ["string", "null"],
                        description: "End date (YYYY-MM-DD). Use null for no upper bound.",
                    },
                    account_id: {
                        type: ["string", "null"],
                        description: "Limit to specific account ID. Use null for all accounts.",
                    },
                    limit: {
                        type: "number",
                        description: "Maximum transactions to return. Default 10, max 50.",
                    },
                },
                required: ["date_from", "date_to", "account_id", "limit"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "firefly_convert_to_transfer",
            description:
                "Convert an existing withdrawal (expense) to a transfer between two asset accounts. Use when user says an expense was actually a transfer to another account (e.g., savings, investment). IMPORTANT: Always confirm with user first.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    transaction_id: {
                        type: "string",
                        description: "The ID of the withdrawal transaction to convert.",
                    },
                    destination_account_id: {
                        type: "string",
                        description: "The destination asset account ID (where the money went to). Get from firefly_get_accounts.",
                    },
                    keep_category: {
                        type: "boolean",
                        description: "If true, keep the existing category. If false, remove category (transfers typically don't have categories).",
                    },
                },
                required: ["transaction_id", "destination_account_id", "keep_category"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "firefly_bulk_categorize",
            description:
                "Assign a category to multiple transactions at once. Use after reviewing uncategorized transactions. IMPORTANT: Always list the transactions and confirm with user before calling.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    transaction_ids: {
                        type: "array",
                        items: { type: "string" },
                        description: "Array of transaction IDs to categorize.",
                    },
                    category_name: {
                        type: "string",
                        description: "Category name to assign. Must match an existing category.",
                    },
                },
                required: ["transaction_ids", "category_name"],
                additionalProperties: false,
            },
        },
    },
];
