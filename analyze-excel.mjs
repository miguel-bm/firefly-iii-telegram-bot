import XLSX from 'xlsx';

function analyzeExcel(filePath) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Analyzing: ${filePath}`);
  console.log('='.repeat(80));

  const workbook = XLSX.readFile(filePath);

  console.log(`\nSheets: ${workbook.SheetNames.join(', ')}`);

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');

    console.log(`\n--- Sheet: "${sheetName}" ---`);
    console.log(`Range: ${sheet['!ref']} (rows ${range.s.r + 1}-${range.e.r + 1}, cols ${String.fromCharCode(65 + range.s.c)}-${String.fromCharCode(65 + range.e.c)})`);

    // Print first 15 rows to understand structure
    console.log(`\nFirst 15 rows (showing non-empty cells):`);
    for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 14); row++) {
      const rowData = [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = sheet[cellRef];
        if (cell) {
          rowData.push(`${String.fromCharCode(65 + col)}${row + 1}:${JSON.stringify(cell.v).substring(0, 40)}`);
        }
      }
      if (rowData.length > 0) {
        console.log(`  Row ${row + 1}: ${rowData.join(' | ')}`);
      } else {
        console.log(`  Row ${row + 1}: (empty)`);
      }
    }

    // Also show as a simple table for the first 15 rows
    console.log(`\nAs table (first 15 rows):`);
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    for (let i = 0; i < Math.min(jsonData.length, 15); i++) {
      const row = jsonData[i];
      if (row.some(cell => cell !== '')) {
        console.log(`  ${i + 1}: [${row.map(c => String(c).substring(0, 25)).join(' | ')}]`);
      }
    }

    // Find where the actual data table might start (look for header patterns)
    console.log(`\nSearching for potential table headers...`);
    for (let i = 0; i < Math.min(jsonData.length, 20); i++) {
      const row = jsonData[i];
      const rowStr = row.join('|').toLowerCase();
      if (rowStr.includes('fecha') || rowStr.includes('concepto') || rowStr.includes('importe') || rowStr.includes('f.valor')) {
        console.log(`  Found potential header at row ${i + 1}: [${row.join(' | ')}]`);
      }
    }
  }
}

// Analyze both Excel files
const files = [
  './bank_statement_examples/bbva/2026Y-01M-30D-19_13_15-Últimos movimientos.xlsx',
  './bank_statement_examples/caixabank/Movimientos_cuenta_0372439.xls'
];

for (const file of files) {
  try {
    analyzeExcel(file);
  } catch (e) {
    console.error(`Error analyzing ${file}: ${e.message}`);
  }
}
