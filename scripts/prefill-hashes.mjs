#!/usr/bin/env node
/**
 * Pre-fill KV with import hashes from existing bank statement files.
 *
 * Usage:
 *   node scripts/prefill-hashes.mjs <chat_id>
 *
 * This generates a JSON file that can be uploaded via:
 *   wrangler kv:bulk put --namespace-id=193a0c3a909d43b89b2e2b71564037cd ./scripts/hashes-bulk.json
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { createHash } from 'crypto';

// Get chat ID from command line
const chatId = process.argv[2];
if (!chatId) {
  console.error('Usage: node scripts/prefill-hashes.mjs <chat_id>');
  console.error('Example: node scripts/prefill-hashes.mjs 123456789');
  process.exit(1);
}

// TTL in seconds (1 year)
const TTL_SECONDS = 365 * 24 * 60 * 60;

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
// Parsers (mirrors src/import/parsers.ts)
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
// Main script
// ============================================

const BANK_DIRS = [
  { dir: './bank_statement_examples/bbva', extensions: ['.xlsx'] },
  { dir: './bank_statement_examples/caixabank', extensions: ['.xls'] },
  { dir: './bank_statement_examples/imaginbank', extensions: ['.csv'] },
];

const kvEntries = [];
const seenHashes = new Set();

console.log(`\nPre-filling hashes for chat ID: ${chatId}\n`);

for (const { dir, extensions } of BANK_DIRS) {
  let files;
  try {
    files = readdirSync(dir).filter(f => extensions.some(ext => f.toLowerCase().endsWith(ext)));
  } catch {
    console.log(`⚠️  Directory not found: ${dir}`);
    continue;
  }

  for (const fileName of files) {
    const filePath = join(dir, fileName);
    console.log(`Processing: ${filePath}`);

    try {
      const fileBuffer = readFileSync(filePath);
      const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);

      const detection = detectBank(arrayBuffer, fileName);
      if (!detection) {
        console.log(`  ⚠️  Could not detect bank`);
        continue;
      }

      const { bank } = detection;
      const transactions = parseStatementFile(arrayBuffer, fileName, bank);
      console.log(`  ✅ ${bank}: ${transactions.length} transactions`);

      for (const tx of transactions) {
        const hash = generateImportHash(chatId, bank, tx.date, tx.amount, tx.description);

        // Skip if we've already seen this hash (dedup within files)
        if (seenHashes.has(hash)) continue;
        seenHashes.add(hash);

        const key = getKVKey(hash);
        const value = JSON.stringify({
          chatId,
          bankId: bank,
          date: tx.date,
          amount: tx.amount,
          description: tx.description,
          importedAt: new Date().toISOString(),
        });

        kvEntries.push({
          key,
          value,
          expiration_ttl: TTL_SECONDS,
        });
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
}

// Write bulk JSON file
const outputPath = './scripts/hashes-bulk.json';
writeFileSync(outputPath, JSON.stringify(kvEntries, null, 2));

console.log(`\n${'='.repeat(60)}`);
console.log(`Generated ${kvEntries.length} unique hash entries`);
console.log(`Output written to: ${outputPath}`);
console.log(`\nTo upload to KV, run:`);
console.log(`  npx wrangler kv bulk put ${outputPath} --namespace-id d48b2421bb2b4242a7ba7b3e7a7acd3a --remote`);
console.log(`${'='.repeat(60)}\n`);
