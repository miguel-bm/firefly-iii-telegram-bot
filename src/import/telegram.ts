import type { Bot } from "grammy";
import type { StreamContext } from "../bot.js";
import type { Env } from "../types.js";
import { parsePositiveInt, ValidationError } from "../webapp/validation.js";
import { getConfiguredImportTargets, ImportAccountError } from "./accounts.js";
import { assertStatementFile, readResponseWithLimit } from "./file.js";
import { formatImportResult } from "./importer.js";
import { runBankImport } from "./service.js";
import { StatementDateError } from "./parsers/csv-values.js";
import { ContributionChoiceError } from "./transfers.js";
import {
  applyImportChoice,
  claimPendingImport,
  importCallbackData,
  parseImportCallback,
  savePendingImport,
  type PendingImport,
} from "./pending.js";
type Language = "es" | "en";

function messages(lang: Language) {
  return lang === "es" ? {
    cancel: "Cancelar",
    cancelled: "Importación cancelada. No se ha creado nada.",
    expired: "Esta selección ha caducado. Vuelve a subir el archivo.",
    forbidden: "Solo la persona que subió el archivo puede elegir la cuenta.",
    importing: "Importando el archivo…",
    failed: "No se pudo importar el archivo.",
  } : {
    cancel: "Cancel",
    cancelled: "Import cancelled. Nothing was created.",
    expired: "This selection has expired. Please upload the file again.",
    forbidden: "Only the person who uploaded the file can choose the account.",
    importing: "Importing the file…",
    failed: "The file could not be imported.",
  };
}

function maxImportBytes(env: Env): number {
  return parsePositiveInt(env.MAX_IMPORT_FILE_BYTES, 5 * 1024 * 1024, 20 * 1024 * 1024);
}

async function downloadStatement(
  api: StreamContext["api"],
  fileId: string,
  fileName: string,
  env: Env,
): Promise<ArrayBuffer> {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error("Telegram did not return a file path");
  const response = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
  if (!response.ok) throw new Error(`Failed to download file: ${response.status}`);
  const buffer = await readResponseWithLimit(response, maxImportBytes(env));
  assertStatementFile(buffer, fileName);
  return buffer;
}

function importErrorMessage(error: unknown, lang: Language): string {
  if (error instanceof StatementDateError && lang === "es") {
    return "❌ El archivo contiene fechas inválidas o formatos mezclados. No se ha importado nada.";
  }
  const detail = error instanceof ValidationError
    ? error.message
    : messages(lang).failed;
  return lang === "es" ? `❌ Error importando archivo: ${detail}` : `❌ Error importing file: ${detail}`;
}

async function editStatus(ctx: StreamContext, message: string): Promise<void> {
  try {
    await ctx.editMessageText(message);
  } catch (error) {
    console.warn("Could not edit import status message:", error);
  }
}

async function processImport(
  ctx: StreamContext, pending: PendingImport, buffer: ArrayBuffer, env: Env, lang: Language, edit = false,
): Promise<void> {
  try {
    const result = await runBankImport(buffer, pending.fileName, env, pending);
    if (edit) await editStatus(ctx, formatImportResult(result, lang));
    else await ctx.reply(formatImportResult(result, lang));
  } catch (error) {
    const dateChoice = error instanceof StatementDateError && error.ambiguous;
    const accountChoice = error instanceof ImportAccountError && error.canChooseAccount;
    const contributionChoice = error instanceof ContributionChoiceError;
    if (!dateChoice && !accountChoice && !contributionChoice) throw error;
    const token = await savePendingImport(env.BANK_IMPORTS,
      contributionChoice ? { ...pending, contributionIndex: error.index } : pending);
    const buttons = dateChoice
      ? [
        [{ text: lang === "es" ? "Día/mes: 01/07 = 1 julio" : "Day/month: 01/07 = 1 July", callback_data: importCallbackData(token, "dmy") }],
        [{ text: lang === "es" ? "Mes/día: 01/07 = 7 enero" : "Month/day: 01/07 = 7 January", callback_data: importCallbackData(token, "mdy") }],
      ]
      : contributionChoice ? [
        [{ text: lang === "es" ? "Sí, es la aportación del hogar" : "Yes, household contribution", callback_data: importCallbackData(token, "household") }],
        [{ text: lang === "es" ? "No, es otro traspaso" : "No, another transfer", callback_data: importCallbackData(token, "regular") }],
      ] : getConfiguredImportTargets(env).map(target => [{ text: target.accountName, callback_data: importCallbackData(token, target.bank) }]);
    buttons.push([{ text: messages(lang).cancel, callback_data: importCallbackData(token, "cancel") }]);
    const text = dateChoice
      ? (lang === "es" ? "Las fechas del CSV son ambiguas. ¿Qué formato usa el archivo? No se ha importado nada."
        : "The CSV dates are ambiguous. Which format does the file use? Nothing was imported.")
      : contributionChoice ? (lang === "es" ? `Traspaso de 850 € de Imagin del ${error.date} (movimiento ${error.index + 1}). ¿Es la aportación mensual al hogar? No se ha importado nada.`
        : `€850 Imagin transfer on ${error.date} (transaction ${error.index + 1}). Is it the monthly household contribution? Nothing was imported.`)
      : (lang === "es" ? "¿A qué cuenta pertenece el archivo? No se ha importado nada."
        : "Which account does this file belong to? Nothing was imported.");
    if (edit) await editStatus(ctx, text);
    await ctx.reply(text, { reply_markup: { inline_keyboard: buttons } });
  }
}

export function registerImportHandlers(bot: Bot<StreamContext>, env: Env, lang: Language): void {
  const text = messages(lang);

  bot.callbackQuery(/^bank-import:/, async (ctx) => {
    const parsed = parseImportCallback(ctx.callbackQuery.data);
    if (!parsed) {
      await ctx.answerCallbackQuery({ text: text.expired });
      return;
    }

    const claimed = await claimPendingImport(env.BANK_IMPORTS, parsed.token,
      String(ctx.chat?.id ?? ""), String(ctx.from.id));
    if (!claimed.pending && !claimed.forbidden) {
      await ctx.answerCallbackQuery({ text: text.expired });
      return;
    }
    if (claimed.forbidden) {
      await ctx.answerCallbackQuery({ text: text.forbidden, show_alert: true });
      return;
    }

    const pending = claimed.pending!;
    if (parsed.action === "cancel") {
      await ctx.answerCallbackQuery();
      await editStatus(ctx, text.cancelled);
      return;
    }

    await ctx.answerCallbackQuery({ text: text.importing });
    await editStatus(ctx, text.importing);
    try {
      const buffer = await downloadStatement(ctx.api, pending.fileId, pending.fileName, env);
      await processImport(ctx, applyImportChoice(pending, parsed.action), buffer, env, lang, true);
    } catch (error) {
      console.error("Pending import error:", error);
      await editStatus(ctx, importErrorMessage(error, lang));
    }
  });

  bot.on("message:document", async (ctx) => {
    const document = ctx.message.document;
    const fileName = document.file_name ?? "unknown";
    const extension = fileName.toLowerCase().split(".").pop();
    if (!["csv", "xls", "xlsx"].includes(extension ?? "")) return;

    try {
      await ctx.replyWithChatAction("typing");
      const maxBytes = maxImportBytes(env);
      if (document.file_size && document.file_size > maxBytes) {
        throw new ValidationError(`File exceeds the ${maxBytes}-byte upload limit`);
      }
      const buffer = await downloadStatement(ctx.api, document.file_id, fileName, env);
      await processImport(ctx, {
        fileId: document.file_id, fileName, chatId: String(ctx.chat.id), userId: String(ctx.from.id),
      }, buffer, env, lang);
    } catch (error) {
      console.error("Import error:", error);
      if (error instanceof ImportAccountError) {
        await ctx.reply(error.localized(lang));
        return;
      }
      await ctx.reply(importErrorMessage(error, lang));
    }
  });
}
