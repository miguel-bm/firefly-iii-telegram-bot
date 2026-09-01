import OpenAI from "openai";
import type { CreateTransactionInput, Env } from "../types.js";
import { FireflyClient, getCachedAssetAccountIds, getCachedAssetAccounts } from "../tools/firefly.js";
import { aggregateTransactions, formatAggregateResult, type GroupByOption } from "../query/aggregate.js";
import { buildChartConfig, generateQuickChartUrl } from "../tools/charts.js";

export async function executeTool(
    toolCall: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall,
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
            const input: CreateTransactionInput = {
                type: args.type ?? "withdrawal",
                date: args.date,
                amount: args.amount,
                description: args.description,
                category_name: args.category_name,
                source_account_id: args.source_account_id,
                destination_account_id: args.destination_account_id,
                tags: args.tags,
                notes: args.notes,
            };

            const created = await firefly.createTransaction(input, env);
            result = JSON.stringify({
                success: true,
                id: created.id,
                type: input.type,
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
                type?: "withdrawal" | "deposit" | "transfer";
                date?: string;
                amount?: number;
                description?: string;
                category_name?: string;
                source_id?: string;
                destination_id?: string;
                tags?: string[];
                notes?: string;
            } = {};

            if (args.type !== null) updates.type = args.type;
            if (args.date !== null) updates.date = args.date;
            if (args.amount !== null) updates.amount = args.amount;
            if (args.description !== null) updates.description = args.description;
            if (args.category_name !== null) updates.category_name = args.category_name;
            if (args.source_account_id !== null) updates.source_id = args.source_account_id;
            if (args.destination_account_id !== null) updates.destination_id = args.destination_account_id;
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
            if (args.has_no_category === true) queryParts.push(`has_no_category:true`);
            if (args.tag) queryParts.push(`tag_is:"${args.tag}"`);
            if (args.transaction_type) queryParts.push(`type:${args.transaction_type}`);
            if (args.text_contains) queryParts.push(`description_contains:"${args.text_contains}"`);
            if (args.account_id) queryParts.push(`account_id:${args.account_id}`);
            if (args.source_account_name) queryParts.push(`source_account_is:"${args.source_account_name}"`);
            if (args.destination_account_name) queryParts.push(`destination_account_is:"${args.destination_account_name}"`);
            if (args.amount_min) queryParts.push(`amount_more:${args.amount_min}`);
            if (args.amount_max) queryParts.push(`amount_less:${args.amount_max}`);

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
        } else if (toolCall.function.name === "firefly_get_transaction") {
            // Get single transaction details
            const tx = await firefly.getTransaction(args.transaction_id);
            result = JSON.stringify({
                id: tx.id,
                type: tx.type,
                date: tx.date,
                amount: tx.amount,
                description: tx.description,
                category: tx.category_name,
                source_id: tx.source_id,
                source_name: tx.source_name,
                destination_id: tx.destination_id,
                destination_name: tx.destination_name,
                tags: tx.tags,
                notes: tx.notes,
            }, null, 2);
        } else if (toolCall.function.name === "firefly_review_uncategorized") {
            // Get uncategorized transactions for review
            const queryParts: string[] = ["has_no_category:true"];
            if (args.date_from) queryParts.push(`date_after:${args.date_from}`);
            if (args.date_to) queryParts.push(`date_before:${args.date_to}`);
            if (args.account_id) queryParts.push(`account_id:${args.account_id}`);

            const limit = Math.min(args.limit ?? 10, 50);
            const query = queryParts.join(" ");
            const transactions = await firefly.searchTransactions(query, limit);

            // Format for review
            const txList = transactions.flatMap((t) =>
                t.attributes.transactions.map((split) => ({
                    id: t.id,
                    date: split.date,
                    amount: split.amount,
                    description: split.description,
                    type: split.type,
                    source: split.source_name,
                    destination: split.destination_name,
                    tags: split.tags,
                }))
            );

            result = JSON.stringify({
                count: txList.length,
                transactions: txList,
                message: txList.length > 0
                    ? (lang === "es"
                        ? `Encontré ${txList.length} transacciones sin categoría.`
                        : `Found ${txList.length} uncategorized transactions.`)
                    : (lang === "es"
                        ? "No hay transacciones sin categoría en el rango especificado."
                        : "No uncategorized transactions found in the specified range."),
            }, null, 2);
        } else if (toolCall.function.name === "firefly_convert_to_transfer") {
            // Convert expense to transfer
            // First get the existing transaction to find source account
            const existingTx = await firefly.getTransaction(args.transaction_id);

            if (existingTx.type !== "withdrawal") {
                result = JSON.stringify({
                    error: lang === "es"
                        ? `Esta transacción ya es de tipo "${existingTx.type}", no se puede convertir.`
                        : `This transaction is already of type "${existingTx.type}", cannot convert.`,
                });
            } else {
                // Update to transfer
                const updates: {
                    type: "transfer";
                    destination_id: string;
                    category_name?: string;
                } = {
                    type: "transfer",
                    destination_id: args.destination_account_id,
                };

                if (!args.keep_category) {
                    updates.category_name = ""; // Remove category
                }

                const updated = await firefly.updateTransaction(args.transaction_id, updates);
                result = JSON.stringify({
                    success: true,
                    id: updated.id,
                    description: updated.description,
                    message: lang === "es"
                        ? "Transacción convertida a transferencia."
                        : "Transaction converted to transfer.",
                });
            }
        } else if (toolCall.function.name === "firefly_bulk_categorize") {
            // Bulk categorize transactions
            const results: { id: string; success: boolean; error?: string }[] = [];

            for (const txId of args.transaction_ids) {
                try {
                    await firefly.updateTransaction(txId, { category_name: args.category_name });
                    results.push({ id: txId, success: true });
                } catch (err) {
                    results.push({
                        id: txId,
                        success: false,
                        error: err instanceof Error ? err.message : "Unknown error"
                    });
                }
            }

            const successCount = results.filter((r) => r.success).length;
            result = JSON.stringify({
                success: successCount === results.length,
                total: results.length,
                succeeded: successCount,
                failed: results.length - successCount,
                category: args.category_name,
                message: lang === "es"
                    ? `Categorizadas ${successCount} de ${results.length} transacciones como "${args.category_name}".`
                    : `Categorized ${successCount} of ${results.length} transactions as "${args.category_name}".`,
                details: results,
            }, null, 2);
        } else {
            result = JSON.stringify({ error: "Unknown tool" });
        }
    } catch (error) {
        result = JSON.stringify({
            error: error instanceof Error ? error.message : "Unknown error",
        });
    }

    return { result, chartUrl };
}
