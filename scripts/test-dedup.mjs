#!/usr/bin/env node
/**
 * Test that duplicate detection works by verifying hashes in KV match
 * what would be generated during import.
 *
 * Usage:
 *   node scripts/test-dedup.mjs <chat_id>
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

// Get chat ID from command line
const chatId = process.argv[2];
if (!chatId) {
  console.error('Usage: node scripts/test-dedup.mjs <chat_id>');
  process.exit(1);
}

// ============================================
// Hash generation (mirrors src/import/hash.ts)
// ============================================

function normalizeDescription(description) {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 50);
}

function normalizeAmount(amount) {
  return Math.abs(amount).toFixed(2);
}

function createSignature(chatId, bankId, date, amount, description) {
  const normalizedDesc = normalizeDescription(description);
  const normalizedAmount = normalizeAmount(amount);
  return `${chatId}|${bankId}|${date}|${normalizedAmount}|${normalizedDesc}`;
}

function sha256(message) {
  return createHash('sha256').update(message).digest('hex');
}

function generateImportHash(chatId, bankId, date, amount, description) {
  const signature = createSignature(chatId, bankId, date, amount, description);
  return sha256(signature);
}

function getKVKey(hash) {
  return `import-hash:${hash}`;
}

// ============================================
// Parsers (same as prefill script)
// ============================================

function parseDateDMY(dateStr) {
  const [day, month, year] = dateStr.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function excelDateToYMD(serial) {
  const utcDays = Math.floor(serial - 25569);
  const date = new Date(utcDays * 86400 * 1000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function parseEuropeanAmount(value) {
  let cleaned = value.replace(/EUR$/i, '').trim();
  cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned);
}

function parseImaginBankAmount(value) {
  const trimmed = value.trim();
  if (trimmed.toUpperCase().endsWith('EUR')) {
    return parseEuropeanAmount(trimmed);
  }
  return parseFloat(trimmed);
}

function detectBank(buffer, fileName) {
  const ext = fileName.toLowerCase().split('.').pop();

  if (ext === 'csv') {
    const decoder = new TextDecoder('utf-8');
    const content = decoder.decode(buffer);
    const firstLines = content.split(/\r?\n/).slice(0, 5).join('\n');

    if (firstLines.includes('IBAN;') || firstLines.includes('CaixaBank')) {
      return { bank: 'imaginbank' };
    }
    if (firstLines.includes('Concepto;Fecha')) {
      return { bank: 'imaginbank' };
    }
    return null;
  }

  if (ext === 'xlsx' || ext === 'xls') {
    try {
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', range: 'A1:J10' });
      const flatContent = data.flat().map(v => String(v)).join(' ');

      if (sheetName.includes('Informe BBVA') || flatContent.includes('Últimos movimientos') || flatContent.includes('F.Valor')) {
        return { bank: 'bbva' };
      }
      if (sheetName.startsWith('Movimientos_cuenta') || flatContent.includes('Movimientos de la cuenta')) {
        return { bank: 'caixabank' };
      }
    } catch (e) {
      console.error('Error detecting:', e);
    }
  }
  return null;
}

function parseBBVA(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', range: 'B1:J1000' });
  const transactions = [];

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(data.length, 10); i++) {
    if (data[i] && String(data[i][0]).includes('F.Valor')) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex === -1) throw new Error('No header found');

  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    const dateStr = String(row[0]);
    const concepto = String(row[2]);
    const importe = row[4];

    let date;
    try { date = parseDateDMY(dateStr); } catch { continue; }

    const amount = typeof importe === 'number' ? importe : parseFloat(String(importe));
    if (isNaN(amount)) continue;

    transactions.push({ date, description: concepto, amount });
  }
  return transactions;
}

function parseCaixaBank(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const transactions = [];

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(data.length, 10); i++) {
    if (data[i] && String(data[i][0]) === 'Fecha' && String(data[i][2]) === 'Movimiento') {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex === -1) throw new Error('No header found');

  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    const fechaRaw = row[0];
    const movimiento = String(row[2]);
    const importe = row[4];

    let date;
    if (typeof fechaRaw === 'number') {
      date = excelDateToYMD(fechaRaw);
    } else {
      try { date = parseDateDMY(String(fechaRaw)); } catch { continue; }
    }

    const amount = typeof importe === 'number' ? importe : parseFloat(String(importe));
    if (isNaN(amount)) continue;

    transactions.push({ date, description: movimiento, amount });
  }
  return transactions;
}

function parseImaginBank(buffer) {
  const decoder = new TextDecoder('utf-8');
  const content = decoder.decode(buffer);
  const lines = content.split(/\r?\n/);
  const transactions = [];

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (lines[i].startsWith('Concepto;Fecha')) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex === -1) throw new Error('No header found');

  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';')) continue;

    const parts = line.split(';');
    if (parts.length < 3) continue;

    const concepto = parts[0];
    const fechaStr = parts[1];
    const importeStr = parts[2];

    if (!concepto || !fechaStr || !importeStr) continue;

    let date;
    try { date = parseDateDMY(fechaStr); } catch { continue; }

    const amount = parseImaginBankAmount(importeStr);
    if (isNaN(amount)) continue;

    transactions.push({ date, description: concepto, amount });
  }
  return transactions;
}

function parseStatementFile(buffer, fileName, bank) {
  if (bank === 'imaginbank') return parseImaginBank(buffer);
  if (bank === 'bbva') return parseBBVA(buffer);
  if (bank === 'caixabank') return parseCaixaBank(buffer);
  throw new Error(`Unknown bank: ${bank}`);
}

// ============================================
// Main test
// ============================================

const IMPORT_HASHES_NAMESPACE_ID = 'd48b2421bb2b4242a7ba7b3e7a7acd3a';

const testFiles = [
  { path: './bank_statement_examples/bbva/2026Y-01M-30D-19_13_15-Últimos movimientos.xlsx', bank: 'bbva' },
  { path: './bank_statement_examples/caixabank/Movimientos_cuenta_0372439.xls', bank: 'caixabank' },
  { path: './bank_statement_examples/imaginbank/CaixaBank_digital_CaixaBankNow_2026130.csv', bank: 'imaginbank' },
];

console.log(`\n${'='.repeat(70)}`);
console.log(`Testing duplicate detection for chat ID: ${chatId}`);
console.log(`${'='.repeat(70)}\n`);

// Fetch all existing hashes from KV
console.log('Fetching existing hashes from IMPORT_HASHES KV...');
const kvListOutput = execSync(
  `npx wrangler kv key list --namespace-id ${IMPORT_HASHES_NAMESPACE_ID} --remote --prefix "import-hash:"`,
  { encoding: 'utf-8' }
);
const existingKeys = new Set(JSON.parse(kvListOutput).map(k => k.name));
console.log(`Found ${existingKeys.size} hashes in KV\n`);

let totalTransactions = 0;
let totalDuplicatesDetected = 0;
let totalMissing = 0;

for (const { path: filePath, bank: expectedBank } of testFiles) {
  console.log(`${'─'.repeat(70)}`);
  console.log(`Testing: ${filePath}`);

  try {
    const fileBuffer = readFileSync(filePath);
    const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
    const fileName = filePath.split('/').pop();

    const detection = detectBank(arrayBuffer, fileName);
    if (!detection) {
      console.log(`  ⚠️  Could not detect bank`);
      continue;
    }

    const { bank } = detection;
    const transactions = parseStatementFile(arrayBuffer, fileName, bank);
    console.log(`  Bank: ${bank}, Transactions: ${transactions.length}`);

    let duplicates = 0;
    let missing = 0;
    const missingExamples = [];

    for (const tx of transactions) {
      const hash = generateImportHash(chatId, bank, tx.date, tx.amount, tx.description);
      const kvKey = getKVKey(hash);

      if (existingKeys.has(kvKey)) {
        duplicates++;
      } else {
        missing++;
        if (missingExamples.length < 3) {
          missingExamples.push({ ...tx, hash: hash.substring(0, 16) + '...' });
        }
      }
    }

    totalTransactions += transactions.length;
    totalDuplicatesDetected += duplicates;
    totalMissing += missing;

    if (duplicates === transactions.length) {
      console.log(`  ✅ All ${transactions.length} transactions would be detected as DUPLICATES`);
    } else if (missing > 0) {
      console.log(`  ⚠️  ${duplicates}/${transactions.length} duplicates, ${missing} MISSING from KV`);
      console.log(`  Missing examples:`);
      for (const ex of missingExamples) {
        console.log(`    - ${ex.date} | ${ex.amount} | ${ex.description.substring(0, 30)}... (${ex.hash})`);
      }
    }

  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
  }
}

console.log(`\n${'='.repeat(70)}`);
console.log(`SUMMARY`);
console.log(`${'='.repeat(70)}`);
console.log(`Total transactions tested: ${totalTransactions}`);
console.log(`Would be detected as duplicates: ${totalDuplicatesDetected}`);
console.log(`Missing from KV (would be created): ${totalMissing}`);

if (totalMissing === 0 && totalDuplicatesDetected === totalTransactions) {
  console.log(`\n✅ SUCCESS: All transactions would be correctly detected as duplicates!`);
} else {
  console.log(`\n⚠️  WARNING: ${totalMissing} transactions are missing from KV`);
}
console.log();
