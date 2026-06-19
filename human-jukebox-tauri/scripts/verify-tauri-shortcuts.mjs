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

  // Mirror window is now opened directly from Rust using WebviewWindowBuilder::new
  // with an initialization_script to navigate to the mirror hash route.
  // The old DOM-event bridge (OPEN_MIRROR_SHORTCUT_EVENT) is no longer used for Ctrl+M.
  ensure(
    rustMain.includes('WebviewWindowBuilder::new'),
    'main.rs must create the mirror window using WebviewWindowBuilder::new.',
  );

  ensure(
    rustMain.includes('initialization_script'),
    'main.rs mirror window must use initialization_script to navigate to the mirror route.',
  );

  console.log('Tauri shortcut contract verified.');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
