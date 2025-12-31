import type { Env } from "./types.js";
import { FireflyClient, getCachedAssetAccountIds } from "./tools/firefly.js";

// Send a message via Telegram Bot API
async function sendTelegramMessage(
    env: Env,
    message: string,
    parseMode: "Markdown" | "HTML" = "Markdown"
): Promise<void> {
    const chatId = env.TELEGRAM_ALLOWED_CHAT_ID;
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: parseMode,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        console.error("Failed to send Telegram message:", error);
    }
}

// Get the previous month's date range
function getPreviousMonthRange(timezone: string): { start: string; end: string; monthName: string } {
    const now = new Date();
    // Get first day of current month
    const firstOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // Last day of previous month
    const lastOfPrevMonth = new Date(firstOfCurrentMonth.getTime() - 1);
    // First day of previous month
    const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);

    const start = firstOfPrevMonth.toISOString().slice(0, 10);
    const end = lastOfPrevMonth.toISOString().slice(0, 10);

    // Get month name in the configured language
    const monthName = firstOfPrevMonth.toLocaleDateString(timezone.includes("Madrid") ? "es-ES" : "en-US", {
        month: "long",
        year: "numeric",
    });

    return { start, end, monthName };
}

// Handle monthly report cron (1st of month)
async function handleMonthlyReport(env: Env): Promise<void> {
    if (env.ENABLE_MONTHLY_REPORT !== "true") {
        console.log("Monthly report disabled, skipping");
        return;
    }

    const lang = env.BOT_LANGUAGE ?? "es";
    const firefly = new FireflyClient(env);

    // Get previous month date range
    const { start, end, monthName } = getPreviousMonthRange(env.BOT_TIMEZONE);

    // Get asset account IDs for the report link
    const accountIds = await getCachedAssetAccountIds(env);

    // Generate report URL
    const reportUrl = firefly.getReportUrl("default", accountIds, start, end);

    // Send message
    const message = lang === "es"
        ? `📊 *Informe mensual de ${monthName}*\n\n🔗 [Ver informe completo](${reportUrl})`
        : `📊 *Monthly report for ${monthName}*\n\n🔗 [View full report](${reportUrl})`;

    await sendTelegramMessage(env, message);
    console.log(`Sent monthly report for ${monthName}`);
}

// Handle daily bank import reminder
async function handleBankImportReminder(env: Env): Promise<void> {
    const reminderDays = parseInt(env.BANK_IMPORT_REMINDER_DAYS ?? "10", 10);
    const lang = env.BOT_LANGUAGE ?? "es";
    const firefly = new FireflyClient(env);

    // Calculate date range for checking
    const now = new Date();
    const startDate = new Date(now.getTime() - reminderDays * 24 * 60 * 60 * 1000);
    const start = startDate.toISOString().slice(0, 10);
    const end = now.toISOString().slice(0, 10);

    // Search for transactions in the date range that are NOT tagged with "telegram-bot"
    // We search for all transactions then filter out the bot-created ones
    const query = `date_after:${start} date_before:${end}`;
    const transactions = await firefly.searchTransactions(query, 100);

    // Filter out transactions created by this bot (tagged with "telegram-bot")
    const externalTransactions = transactions.filter((tx) => {
        const splits = tx.attributes.transactions;
        // Check if any split has the telegram-bot tag
        return !splits.some((split) => {
            const tags = (split as { tags?: string[] }).tags ?? [];
            return tags.includes("telegram-bot");
        });
    });

    // If there are external transactions, no reminder needed
    if (externalTransactions.length > 0) {
        console.log(`Found ${externalTransactions.length} external transactions in last ${reminderDays} days, no reminder needed`);
        return;
    }

    // No external transactions found - send reminder
    const message = lang === "es"
        ? `⚠️ *Recordatorio: Importar extractos bancarios*\n\nNo he detectado transacciones importadas desde el banco en los últimos ${reminderDays} días.\n\n¿Has subido tus extractos con Data Importer?`
        : `⚠️ *Reminder: Import bank statements*\n\nI haven't detected any bank-imported transactions in the last ${reminderDays} days.\n\nHave you uploaded your statements with Data Importer?`;

    await sendTelegramMessage(env, message);
    console.log(`Sent bank import reminder (no external transactions in ${reminderDays} days)`);
}

// Main cron handler
export async function handleScheduled(
    event: ScheduledEvent,
    env: Env
): Promise<void> {
    const cronTime = event.cron;
    console.log(`Cron triggered: ${cronTime}`);

    try {
        // Monthly report: 1st of month at 9:00 UTC
        if (cronTime === "0 9 1 * *") {
            await handleMonthlyReport(env);
        }
        // Daily bank import check: every day at 10:00 UTC
        else if (cronTime === "0 10 * * *") {
            await handleBankImportReminder(env);
        }
        else {
            console.log(`Unknown cron pattern: ${cronTime}`);
        }
    } catch (error) {
        console.error("Cron job failed:", error);
    }
}

