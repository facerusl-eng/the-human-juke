import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const rustMainPath = path.join(projectRoot, 'src-tauri', 'src', 'main.rs');
const tsShortcutEventsPath = path.join(projectRoot, 'src', 'lib', 'tauriShortcutEvents.ts');
const appTsxPath = path.join(projectRoot, 'src', 'App.tsx');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function extractRustShortcutEvent(text) {
  const match = text.match(/const\s+OPEN_MIRROR_SHORTCUT_EVENT\s*:\s*&str\s*=\s*"([^"]+)"\s*;/);
  return match ? match[1] : null;
}

function extractTsShortcutEvent(text) {
  const match = text.match(/export\s+const\s+TAURI_OPEN_MIRROR_SHORTCUT_EVENT\s*=\s*['\"]([^'\"]+)['\"]\s*;?/);
  return match ? match[1] : null;
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const rustMain = readText(rustMainPath);
  const tsShortcutEvents = readText(tsShortcutEventsPath);
  const appTsx = readText(appTsxPath);

  const rustEvent = extractRustShortcutEvent(rustMain);
  const tsEvent = extractTsShortcutEvent(tsShortcutEvents);

  ensure(Boolean(rustEvent), 'Could not find OPEN_MIRROR_SHORTCUT_EVENT in src-tauri/src/main.rs.');
  ensure(Boolean(tsEvent), 'Could not find TAURI_OPEN_MIRROR_SHORTCUT_EVENT in src/lib/tauriShortcutEvents.ts.');
  ensure(rustEvent === tsEvent, `Tauri shortcut event mismatch. Rust: ${rustEvent} | TS: ${tsEvent}`);

  ensure(
    appTsx.includes("import { TAURI_OPEN_MIRROR_SHORTCUT_EVENT } from './lib/tauriShortcutEvents'"),
    'App.tsx must import TAURI_OPEN_MIRROR_SHORTCUT_EVENT from src/lib/tauriShortcutEvents.ts.',
  );

  ensure(
    appTsx.includes('window.addEventListener(TAURI_OPEN_MIRROR_SHORTCUT_EVENT, handleMirrorShortcut)'),
    'App.tsx must register the Tauri mirror shortcut listener using TAURI_OPEN_MIRROR_SHORTCUT_EVENT.',
  );

  ensure(
    !appTsx.includes('human-jukebox-open-mirror-shortcut'),
    'Do not hardcode the mirror shortcut event in App.tsx. Use TAURI_OPEN_MIRROR_SHORTCUT_EVENT.',
  );

  console.log('Tauri shortcut contract verified.');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
