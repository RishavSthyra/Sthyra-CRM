const MAX_IMPORT_ROWS = 1_000;
const MAX_IMPORT_COLUMNS = 50;

export type TransferRow = Record<string, string>;

export function parseCsv(input: string): TransferRow[] {
  if (input.length > 5_000_000) throw new Error("CSV cannot exceed 5 MB");
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted value");
  if (field || record.length) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }
  const nonEmpty = records.filter((row) => row.some((value) => value.trim()));
  if (nonEmpty.length < 2) return [];
  const headers = nonEmpty[0].map((header) =>
    header.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
  );
  if (headers.length > MAX_IMPORT_COLUMNS) {
    throw new Error(`CSV cannot exceed ${MAX_IMPORT_COLUMNS} columns`);
  }
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length) {
    throw new Error("CSV headers must be unique and non-empty");
  }
  const data = nonEmpty.slice(1);
  if (data.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import cannot exceed ${MAX_IMPORT_ROWS} rows`);
  }
  return data.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])),
  );
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  // Prevent spreadsheet formula execution when a CSV is opened in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function serializeCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\r\n");
}

export function normalizeImportValue(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}
