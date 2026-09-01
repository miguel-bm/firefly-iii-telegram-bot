import type { Bot } from "grammy";
import type { StreamContext } from "../bot.js";
import type { Env } from "../types.js";
import { parsePositiveInt, ValidationError } from "../webapp/validation.js";
import { getConfiguredImportTargets, ImportAccountError } from "./accounts.js";
import { assertStatementFile, readResponseWithLimit } from "./file.js";
import { formatImportResult, importBankStatement } from "./importer.js";
import {
  consumePendingImport,
  getPendingImport,
  importCallbackData,
  ownsPendingImport,
  parseImportCallback,
  savePendingImport,
} from "./pending.js";
import type { BankId } from "./types.js";

type Language = "es" | "en";

function messages(lang: Language) {
  return lang === "es" ? {
    choose: (count: number) => `He encontrado ${count} transacciones, pero no reconozco la cuenta. ¿A cuál pertenecen?\n\nNo se importará nada hasta que elijas.`,
    cancel: "Cancelar",
    cancelled: "Importación cancelada. No se ha creado nada.",
    expired: "Esta selección ha caducado. Vuelve a subir el archivo.",
    forbidden: "Solo la persona que subió el archivo puede elegir la cuenta.",
    importing: "Importando el archivo…",
    failed: "No se pudo importar el archivo.",
  } : {
    choose: (count: number) => `I found ${count} transactions, but I don't recognize the account. Which account do they belong to?\n\nNothing will be imported until you choose.`,
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

export function registerImportHandlers(bot: Bot<StreamContext>, env: Env, lang: Language): void {
  const text = messages(lang);

  bot.callbackQuery(/^bank-import:/, async (ctx) => {
    const parsed = parseImportCallback(ctx.callbackQuery.data);
    if (!parsed) {
      await ctx.answerCallbackQuery({ text: text.expired });
      return;
    }

    const stored = await getPendingImport(env.IMPORT_HASHES, parsed.token);
    if (!stored) {
      await ctx.answerCallbackQuery({ text: text.expired });
      return;
    }
    if (!ownsPendingImport(stored, String(ctx.chat?.id ?? ""), String(ctx.from.id))) {
      await ctx.answerCallbackQuery({ text: text.forbidden, show_alert: true });
      return;
    }

    const pending = await consumePendingImport(env.IMPORT_HASHES, parsed.token);
    if (!pending) {
      await ctx.answerCallbackQuery({ text: text.expired });
      return;
    }
    if (parsed.action === "cancel") {
      await ctx.answerCallbackQuery();
      await editStatus(ctx, text.cancelled);
      return;
    }

    await ctx.answerCallbackQuery({ text: text.importing });
    await editStatus(ctx, text.importing);
    try {
      const buffer = await downloadStatement(ctx.api, pending.fileId, pending.fileName, env);
      const result = await importBankStatement(buffer, pending.fileName, env, {
        chatId: pending.chatId,
        targetBank: parsed.action,
      });
      await editStatus(ctx, formatImportResult(result, lang));
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
      try {
        const result = await importBankStatement(buffer, fileName, env, {
          chatId: String(ctx.chat.id),
        });
        await ctx.reply(formatImportResult(result, lang));
      } catch (error) {
        if (!(error instanceof ImportAccountError) || !error.canChooseAccount) throw error;

        const preview = await importBankStatement(buffer, fileName, env, {
          chatId: String(ctx.chat.id),
          dryRun: true,
          targetBank: "caixabank",
        });
        const targets = getConfiguredImportTargets(env);
        const token = await savePendingImport(env.IMPORT_HASHES, {
          fileId: document.file_id,
          fileName,
          chatId: String(ctx.chat.id),
          userId: String(ctx.from.id),
        });
        const accountButtons = targets.map((target) => [{
          text: target.accountName,
          callback_data: importCallbackData(token, target.bank),
        }]);
        accountButtons.push([{ text: text.cancel, callback_data: importCallbackData(token, "cancel") }]);
        await ctx.reply(text.choose(preview.totalParsed), { reply_markup: { inline_keyboard: accountButtons } });
      }
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
