import type { Env } from "./types.js";
import { FireflyClient, getCachedAssetAccountIds } from "./tools/firefly.js";
import { daysAgoInTimeZone, previousMonthRange, shiftDate, todayInTimeZone } from "./lib/dates.js";
import { parseIdList } from "./webapp/auth.js";
import { getConfiguredImportTargets, type ImportTarget } from "./import/accounts.js";
import {
    getImportFreshness,
    isImportFresh,
    recordReminderSent,
    saveImportFreshness,
    wasReminderSentRecently,
    type ImportFreshness,
} from "./import/freshness.js";

// Send a message via Telegram Bot API
async function sendTelegramMessage(
    env: Env,
    chatId: string,
    message: string,
    parseMode?: "Markdown" | "HTML"
): Promise<void> {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text: message,
            ...(parseMode ? { parse_mode: parseMode } : {}),
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to send Telegram message: ${error}`);
    }
}

async function sendToAllowedChats(
    env: Env,
    message: string,
    parseMode?: "Markdown" | "HTML",
): Promise<void> {
    await Promise.all(parseIdList(env.TELEGRAM_ALLOWED_CHAT_ID).map((chatId) =>
        sendTelegramMessage(env, chatId, message, parseMode)
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

    await sendToAllowedChats(env, message, "Markdown");
    console.log(`Sent monthly report for ${monthName}`);
}

interface StaleImport {
    target: ImportTarget;
    freshness: ImportFreshness | null;
}

function localizedDate(isoDate: string, lang: "es" | "en", timeZone: string): string {
    return new Intl.DateTimeFormat(lang === "es" ? "es-ES" : "en-GB", {
        timeZone,
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(new Date(isoDate));
}

export function formatImportReminder(
    staleImports: StaleImport[],
    lang: "es" | "en",
    timeZone: string,
): string {
    const lines = staleImports.map(({ target, freshness }) => {
        if (!freshness) {
            return lang === "es"
                ? `• ${target.accountName}: sin importaciones registradas`
                : `• ${target.accountName}: no recorded imports`;
        }
        const uploadDate = localizedDate(freshness.uploadedAt, lang, timeZone);
        const movement = freshness.latestTransactionDate
            ? localizedDate(`${freshness.latestTransactionDate}T12:00:00Z`, lang, timeZone)
            : null;
        if (lang === "es") {
            return `• ${target.accountName}: última subida ${uploadDate}${movement ? `; último movimiento ${movement}` : ""}`;
        }
        return `• ${target.accountName}: last upload ${uploadDate}${movement ? `; latest transaction ${movement}` : ""}`;
    });

    return lang === "es"
        ? `⚠️ Extractos bancarios pendientes\n\n${lines.join("\n")}\n\nSube únicamente los extractos de estas cuentas.`
        : `⚠️ Bank statements pending\n\n${lines.join("\n")}\n\nUpload only the statements for these accounts.`;
}

async function migrateLegacyFreshness(
    env: Env,
    firefly: FireflyClient,
    target: ImportTarget,
    reminderDays: number,
    legacyUpload: string | null,
    now: Date,
): Promise<ImportFreshness | null> {
    const start = daysAgoInTimeZone(reminderDays, env.BOT_TIMEZONE, now);
    const end = shiftDate(todayInTimeZone(env.BOT_TIMEZONE, now), 1);
    const imports = await firefly.searchTransactions(
        `tag_is:"import-${target.bank}" account_id:${target.accountId} date_after:${start} date_before:${end}`,
        100,
    );
    if (imports.length === 0) return null;

    const dates = imports.flatMap(({ attributes }) =>
        attributes.transactions.map(({ date }) => date.slice(0, 10))
    ).sort();
    const latestTransactionDate = dates.at(-1) ?? null;
    const legacyTime = legacyUpload ? new Date(legacyUpload).getTime() : Number.NaN;
    const cutoff = now.getTime() - reminderDays * 86_400_000;
    const uploadedAt = Number.isFinite(legacyTime) && legacyTime >= cutoff
        ? new Date(legacyTime).toISOString()
        : latestTransactionDate ? `${latestTransactionDate}T12:00:00.000Z` : now.toISOString();
    const freshness: ImportFreshness = {
        bank: target.bank,
        accountId: target.accountId,
        uploadedAt,
        latestTransactionDate,
        totalParsed: imports.length,
    };
    await saveImportFreshness(env.IMPORT_HASHES, freshness, false);
    return freshness;
}

// Handle daily bank import reminder
async function handleBankImportReminder(env: Env): Promise<void> {
    const reminderDays = parseInt(env.BANK_IMPORT_REMINDER_DAYS ?? "10", 10);
    if (!Number.isFinite(reminderDays) || reminderDays <= 0) return;
    const repeatDays = parseInt(env.BANK_IMPORT_REMINDER_REPEAT_DAYS ?? "3", 10);
    const reminderRepeatDays = Number.isFinite(repeatDays) && repeatDays > 0 ? repeatDays : 3;
    const lang = env.BOT_LANGUAGE ?? "es";
    const firefly = new FireflyClient(env);
    const now = new Date();
    const targets = getConfiguredImportTargets(env);
    const legacyUpload = await env.IMPORT_HASHES.get("last-bank-import");
    const staleImports: StaleImport[] = [];

    for (const target of targets) {
        let freshness = await getImportFreshness(env.IMPORT_HASHES, target);
        if (!freshness) {
            freshness = await migrateLegacyFreshness(
                env, firefly, target, reminderDays, legacyUpload, now,
            );
        }
        if (isImportFresh(freshness, reminderDays, now)) continue;
        if (await wasReminderSentRecently(
            env.IMPORT_HASHES, target.bank, reminderRepeatDays, now,
        )) continue;
        staleImports.push({ target, freshness });
    }

    if (staleImports.length === 0) {
        console.log("No bank import reminders due");
        return;
    }

    await sendToAllowedChats(env, formatImportReminder(staleImports, lang, env.BOT_TIMEZONE));
    await recordReminderSent(env.IMPORT_HASHES, staleImports.map(({ target }) => target.bank), now);
    console.log(`Sent bank import reminder for ${staleImports.length} account(s)`);
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
