import type { Env } from "../types.js";
import type { BankId } from "./types.js";

export interface ImportTarget {
  bank: BankId;
  accountId: string;
  accountName: string;
}

export class ImportAccountError extends Error {
  constructor(
    message: string,
    private readonly spanishMessage: string,
  ) {
    super(message);
    this.name = "ImportAccountError";
  }

  localized(lang: "es" | "en"): string {
    return lang === "es" ? this.spanishMessage : this.message;
  }
}

const DEFAULT_ACCOUNT_NAMES: Record<BankId, string> = {
  bbva: "BBVA",
  caixabank: "CaixaBank",
  imaginbank: "ImaginBank",
};

function configuredValue(value: string | undefined, variableName: string): string {
  const configured = value?.trim();
  if (!configured) {
    throw new ImportAccountError(
      `Missing import configuration: ${variableName}`,
      `Falta la configuración de importación: ${variableName}`,
    );
  }
  return configured;
}

function targetForBank(bank: BankId, env: Env): ImportTarget {
  const accountIds: Record<BankId, string | undefined> = {
    bbva: env.BANK_ACCOUNT_ID_BBVA,
    caixabank: env.BANK_ACCOUNT_ID_CAIXABANK,
    imaginbank: env.BANK_ACCOUNT_ID_IMAGINBANK,
  };
  const accountNames: Record<BankId, string | undefined> = {
    bbva: env.BANK_ACCOUNT_NAME_BBVA,
    caixabank: env.BANK_ACCOUNT_NAME_CAIXABANK,
    imaginbank: env.BANK_ACCOUNT_NAME_IMAGINBANK,
  };

  return {
    bank,
    accountId: configuredValue(accountIds[bank], `BANK_ACCOUNT_ID_${bank.toUpperCase()}`),
    accountName: accountNames[bank]?.trim() || DEFAULT_ACCOUNT_NAMES[bank],
  };
}

export function getCaixaBankAccountSuffix(fileName: string): string | null {
  return fileName.match(/movimientos[_\s-]*cuenta[_\s-]*(\d+)/i)?.[1] ?? null;
}

export function resolveImportTarget(detectedBank: BankId, fileName: string, env: Env): ImportTarget {
  if (detectedBank !== "caixabank") return targetForBank(detectedBank, env);

  const fileSuffix = getCaixaBankAccountSuffix(fileName);
  if (!fileSuffix) {
    throw new ImportAccountError(
      "Could not identify the CaixaBank account from the filename. Keep the exported Movimientos_cuenta_<account> filename.",
      "No pude identificar la cuenta. Conserva el nombre original Movimientos_cuenta_<cuenta> al subir el archivo.",
    );
  }

  const mappings: Array<{ bank: BankId; suffix: string }> = [
    {
      bank: "caixabank",
      suffix: configuredValue(env.BANK_ACCOUNT_SUFFIX_CAIXABANK, "BANK_ACCOUNT_SUFFIX_CAIXABANK"),
    },
    {
      bank: "imaginbank",
      suffix: configuredValue(env.BANK_ACCOUNT_SUFFIX_IMAGINBANK, "BANK_ACCOUNT_SUFFIX_IMAGINBANK"),
    },
  ];
  const matches = mappings.filter(({ suffix }) => suffix === fileSuffix);

  if (matches.length !== 1) {
    throw new ImportAccountError(
      `Unknown or ambiguous CaixaBank account suffix: ${fileSuffix}`,
      `La cuenta CaixaBank terminada en ${fileSuffix} no está configurada; no se ha importado nada.`,
    );
  }

  return targetForBank(matches[0].bank, env);
}
