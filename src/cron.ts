import type { Env } from "./types.js";
import { FireflyClient, getCachedAssetAccountIds } from "./tools/firefly.js";
import { daysAgoInTimeZone, previousMonthRange, todayInTimeZone } from "./lib/dates.js";
import { parseIdList } from "./webapp/auth.js";

// Send a message via Telegram Bot API
async function sendTelegramMessage(
    env: Env,
    chatId: string,
    message: string,
    parseMode: "Markdown" | "HTML" = "Markdown"
): Promise<void> {
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

async function sendToAllowedChats(env: Env, message: string): Promise<void> {
    await Promise.all(parseIdList(env.TELEGRAM_ALLOWED_CHAT_ID).map((chatId) =>
        sendTelegramMessage(env, chatId, message)
    ));
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
    const { start, end, monthName } = previousMonthRange(
        env.BOT_TIMEZONE,
        lang === "es" ? "es-ES" : "en-US",
    );

    // Get asset account IDs for the report link
    const accountIds = await getCachedAssetAccountIds(env);

    // Generate report URL
    const reportUrl = firefly.getReportUrl("default", accountIds, start, end);

    // Send message
    const message = lang === "es"
        ? `📊 *Informe mensual de ${monthName}*\n\n🔗 [Ver informe completo](${reportUrl})`
        : `📊 *Monthly report for ${monthName}*\n\n🔗 [View full report](${reportUrl})`;

    await sendToAllowedChats(env, message);
    console.log(`Sent monthly report for ${monthName}`);
}

// Handle daily bank import reminder
async function handleBankImportReminder(env: Env): Promise<void> {
    const reminderDays = parseInt(env.BANK_IMPORT_REMINDER_DAYS ?? "10", 10);
    if (!Number.isFinite(reminderDays) || reminderDays <= 0) return;
    const lang = env.BOT_LANGUAGE ?? "es";
    const firefly = new FireflyClient(env);

    // Calculate date range for checking
    const start = daysAgoInTimeZone(reminderDays, env.BOT_TIMEZONE);
    const end = todayInTimeZone(env.BOT_TIMEZONE);

    const lastImport = await env.IMPORT_HASHES.get("last-bank-import");
    const cutoff = Date.now() - reminderDays * 24 * 60 * 60 * 1000;
    if (lastImport && new Date(lastImport).getTime() >= cutoff) {
        console.log("Recent bank import recorded, no reminder needed");
        return;
    }

    // Compatibility fallback for imports created before the timestamp was introduced.
    const imports = await firefly.searchTransactions(
        `tag_is:"bank-import" date_after:${start} date_before:${end}`,
        1,
    );
    if (imports.length > 0) return;

    // No external transactions found - send reminder
    const message = lang === "es"
        ? `⚠️ *Recordatorio: Importar extractos bancarios*\n\nNo he detectado una importación bancaria en los últimos ${reminderDays} días.\n\nPuedes subir el extracto directamente a este chat.`
        : `⚠️ *Reminder: Import bank statements*\n\nI haven't detected a bank import in the last ${reminderDays} days.\n\nYou can upload the statement directly to this chat.`;

    await sendToAllowedChats(env, message);
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
