export const KEGG_PREVIEW_LIMIT = 20;

export const sanitizeKeggCell = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
};

const normalizeHeader = (header) => {
  return sanitizeKeggCell(header)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const findIndex = (normalizedHeaders, candidates) => {
  for (const candidate of candidates) {
    const target = normalizeHeader(candidate);
    if (!target) continue;
    const idx = normalizedHeaders.findIndex((header) => header === target);
    if (idx !== -1) {
      return idx;
    }
  }
  return -1;
};

const truncateText = (text, maxLength = 80) => {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
};

const formatNumericPrecision = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  const normalized = String(value).replace(/,/g, '').trim();
  if (normalized === '') {
    return '';
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return normalized;
  }
  return parsed.toFixed(8);
};

const formatScientificNotation = (value, digits = 3) => {
  if (value === null || value === undefined) {
    return '';
  }
  const normalized = String(value).replace(/,/g, '').trim();
  if (normalized === '') {
    return '';
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return normalized;
  }
  return parsed.toExponential(digits);
};

const COLUMN_CANDIDATES = {
  Pathway: ['term', 'pathway', 'pathway name', 'name', 'kegg pathway'],
  Overlap: ['overlap', 'overlap ratio', 'overlap count', 'hit ratio'],
  'Adjusted p-value': ['adjusted p value', 'adjusted p-value', 'adj p value', 'adj p-value', 'adj pvalue', 'adj pvalue', 'fdr', 'false discovery rate'],
  'Raw p-value': ['p value', 'p-value', 'raw p value', 'raw p-value', 'pvalue'],
  'Odds ratio': ['odds ratio', 'oddsratio', 'enrichment ratio', 'rich factor'],
  Genes: ['genes', 'gene', 'gene set', 'leading edge', 'leadingedge']
};

const NUMERIC_COLUMNS = new Set(['Overlap', 'Adjusted p-value', 'Raw p-value', 'Odds ratio']);
const SCIENTIFIC_COLUMNS = new Set(['Adjusted p-value', 'Raw p-value']);

export const buildKeggColumns = (table) => {
  const headers = Array.isArray(table?.headers) ? table.headers : [];
  const normalizedHeaders = headers.map(normalizeHeader);

  const columns = [
    {
      label: '#',
      getValue: (_row, rowIdx) => String(rowIdx + 1)
    }
  ];

  const resolveColumn = (label, formatter) => {
    const candidates = COLUMN_CANDIDATES[label] || [];
    const columnIndex = findIndex(normalizedHeaders, candidates);
    columns.push({
      label,
      getValue: (row) => {
        if (!Array.isArray(row) || columnIndex < 0 || columnIndex >= row.length) {
          return '';
        }
        const sanitized = sanitizeKeggCell(row[columnIndex]);
        const baseValue = formatter ? formatter(sanitized, row) : sanitized;
        if (!NUMERIC_COLUMNS.has(label)) {
          return baseValue;
        }
        if (SCIENTIFIC_COLUMNS.has(label)) {
          return formatScientificNotation(baseValue);
        }
        return formatNumericPrecision(baseValue);
      }
    });
  };

  resolveColumn('Pathway');
  resolveColumn('Overlap');
  resolveColumn('Adjusted p-value');
  resolveColumn('Raw p-value');
  resolveColumn('Odds ratio');
  resolveColumn('Genes', (value) => truncateText(value, 100));

  return columns;
};
