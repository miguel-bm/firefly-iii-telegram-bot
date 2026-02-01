import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';

// Inline the detection and parsing logic for testing
// (since we can't easily import TypeScript directly)

// Detect bank from file content
function detectBank(buffer, fileName) {
  const ext = fileName.toLowerCase().split('.').pop();

  if (ext === 'csv') {
    const decoder = new TextDecoder('utf-8');
    const content = decoder.decode(buffer);
    const firstLines = content.split(/\r?\n/).slice(0, 5).join('\n');

    if (firstLines.includes('IBAN;') || firstLines.includes('CaixaBank')) {
      return { bank: 'imaginbank', confidence: 'high' };
    }
    if (firstLines.includes('Concepto;Fecha')) {
      return { bank: 'imaginbank', confidence: 'high' };
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
        return { bank: 'bbva', confidence: 'high' };
      }
      if (sheetName.startsWith('Movimientos_cuenta') || flatContent.includes('Movimientos de la cuenta')) {
        return { bank: 'caixabank', confidence: 'high' };
      }
    } catch (e) {
      console.error('Error detecting:', e);
    }
  }
  return null;
}

function getBankName(bankId) {
  return { bbva: 'BBVA', caixabank: 'CaixaBank', imaginbank: 'ImaginBank' }[bankId];
}

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
  // Check if it has EUR suffix (old format)
  if (trimmed.toUpperCase().endsWith('EUR')) {
    return parseEuropeanAmount(trimmed);
  }
  // New format - standard decimal notation
  return parseFloat(trimmed);
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
    const movimiento = String(row[3]);
    const importe = row[4];
    const observaciones = String(row[8] || '');

    let date;
    try { date = parseDateDMY(dateStr); } catch { continue; }

    const amount = typeof importe === 'number' ? importe : parseFloat(String(importe));
    if (isNaN(amount)) continue;

    transactions.push({
      date,
      description: concepto,
      amount,
      notes: [movimiento, observaciones].filter(Boolean).join(' - ') || undefined,
    });
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
    const masDatos = String(row[3] || '');
    const importe = row[4];

    let date;
    if (typeof fechaRaw === 'number') {
      date = excelDateToYMD(fechaRaw);
    } else {
      try { date = parseDateDMY(String(fechaRaw)); } catch { continue; }
    }

    const amount = typeof importe === 'number' ? importe : parseFloat(String(importe));
    if (isNaN(amount)) continue;

    transactions.push({ date, description: movimiento, amount, notes: masDatos || undefined });
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

const testFiles = [
  './bank_statement_examples/bbva/2026Y-01M-30D-19_13_15-Últimos movimientos.xlsx',
  './bank_statement_examples/caixabank/Movimientos_cuenta_0372439.xls',
  './bank_statement_examples/imaginbank/CaixaBank_digital_CaixaBankNow_2026130.csv',
  './bank_statement_examples/imaginbank/export_20251229.csv', // Old format with EUR suffix
];

for (const filePath of testFiles) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${filePath}`);
  console.log('='.repeat(60));

  try {
    const buffer = readFileSync(filePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const fileName = filePath.split('/').pop();

    // Detect bank
    const detection = detectBank(arrayBuffer, fileName);
    if (!detection) {
      console.log('❌ Could not detect bank');
      continue;
    }
    console.log(`✅ Detected bank: ${getBankName(detection.bank)} (confidence: ${detection.confidence})`);

    // Parse transactions
    const transactions = parseStatementFile(arrayBuffer, fileName, detection.bank);
    console.log(`✅ Parsed ${transactions.length} transactions`);

    // Show first 3 transactions
    console.log('\nFirst 3 transactions:');
    for (const tx of transactions.slice(0, 3)) {
      const sign = tx.amount >= 0 ? '+' : '';
      console.log(`  ${tx.date} | ${sign}${tx.amount.toFixed(2)} | ${tx.description.substring(0, 40)}`);
    }

    // Show summary
    const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);
    const deposits = transactions.filter(tx => tx.amount > 0);
    const withdrawals = transactions.filter(tx => tx.amount < 0);
    console.log(`\nSummary:`);
    console.log(`  Deposits: ${deposits.length} (total: +${deposits.reduce((s, t) => s + t.amount, 0).toFixed(2)})`);
    console.log(`  Withdrawals: ${withdrawals.length} (total: ${withdrawals.reduce((s, t) => s + t.amount, 0).toFixed(2)})`);
    console.log(`  Net: ${total.toFixed(2)}`);

  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
}
