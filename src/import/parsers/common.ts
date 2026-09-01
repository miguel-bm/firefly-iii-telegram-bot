export function parseDateDMY(dateStr: string): string {
  const [day, month, year] = dateStr.split("/");
  if (!day || !month || !year) throw new Error("Invalid date");
  const normalized = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) throw new Error("Invalid date");
  return normalized;
}

export function excelDateToYMD(serial: number): string {
  const date = new Date(Math.floor(serial - 25569) * 86400 * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseEuropeanAmount(value: string): number {
  return parseFloat(value.replace(/EUR$/i, "").trim().replace(/\./g, "").replace(",", "."));
}

export function parseDelimitedLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === ";" && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}
