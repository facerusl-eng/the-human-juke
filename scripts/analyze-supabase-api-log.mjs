import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = { file: '', top: 15 };

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--file' && argv[index + 1]) {
      args.file = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--top' && argv[index + 1]) {
      const nextTop = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(nextTop) && nextTop > 0) {
        args.top = nextTop;
      }
      index += 1;
    }
  }

  return args;
}

function printUsage() {
  console.log('Usage: node scripts/analyze-supabase-api-log.mjs --file <path-to-content.json> [--top 15]');
}

function safeReadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function incrementMapCount(map, key) {
  const current = map.get(key) ?? 0;
  map.set(key, current + 1);
}

function renderTop(title, map, topN) {
  console.log(`\n${title}`);
  const sorted = Array.from(map.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, topN);

  for (const [key, value] of sorted) {
    console.log(`${String(value).padStart(6, ' ')}  ${key}`);
  }

  if (sorted.length === 0) {
    console.log('  (no entries)');
  }
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.file) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const filePath = path.resolve(process.cwd(), args.file);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  const payload = safeReadJson(filePath);
  const rows = payload?.result?.result;

  if (!Array.isArray(rows)) {
    console.error('Unexpected JSON shape. Expected payload.result.result to be an array.');
    process.exitCode = 1;
    return;
  }

  const byPath = new Map();
  const byMethod = new Map();
  const byStatus = new Map();

  for (const row of rows) {
    const pathValue = typeof row.path === 'string' && row.path.length > 0 ? row.path : '(unknown)';
    const methodValue = typeof row.method === 'string' && row.method.length > 0 ? row.method : '(unknown)';
    const statusValue = row.status_code === null || row.status_code === undefined ? '(unknown)' : String(row.status_code);

    incrementMapCount(byPath, pathValue);
    incrementMapCount(byMethod, methodValue);
    incrementMapCount(byStatus, statusValue);
  }

  console.log(`Loaded ${rows.length} API log rows from ${filePath}`);
  renderTop('Top endpoints', byPath, args.top);
  renderTop('HTTP methods', byMethod, 10);
  renderTop('HTTP status codes', byStatus, 10);
}

main();
