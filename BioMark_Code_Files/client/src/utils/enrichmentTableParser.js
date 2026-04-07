export const parseDelimitedLine = (line, delimiter) => {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  values.push(current);
  return values;
};

export const parseEnrichmentCsvTable = (rawText) => {
  const normalizedText = String(rawText || '').replace(/^\uFEFF/, '').trim();
  if (!normalizedText) {
    return null;
  }

  const lines = normalizedText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return null;
  }

  const delimiter = [';', '\t', ','].find((del) => lines[0].includes(del)) || ',';
  const cleanCell = (value) => String(value || '').replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();

  const headers = parseDelimitedLine(lines[0], delimiter).map(cleanCell);
  const rows = lines.slice(1).map((line) => parseDelimitedLine(line, delimiter).map(cleanCell));

  if (headers.length === 0 || rows.length === 0) {
    return { headers, rows: [], delimiter };
  }

  return { headers, rows, delimiter };
};
