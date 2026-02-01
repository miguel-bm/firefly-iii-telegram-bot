// Bank identifiers
export type BankId = "bbva" | "caixabank" | "imaginbank";

// Parsed transaction from bank statement
export interface ParsedTransaction {
  date: string; // YYYY-MM-DD format
  description: string;
  amount: number; // Negative for expenses, positive for income
  notes?: string;
}

// Bank configuration
export interface BankConfig {
  id: BankId;
  name: string;
  defaultAccountId: string;
  dateFormat: string;
}

// Import result
export interface ImportResult {
  bank: BankId;
  bankName: string;
  totalParsed: number;
  created: number;
  duplicates: number;
  errors: ImportError[];
}

export interface ImportError {
  row: number;
  description: string;
  error: string;
}

// Detection result
export interface DetectionResult {
  bank: BankId;
  confidence: "high" | "medium" | "low";
}
