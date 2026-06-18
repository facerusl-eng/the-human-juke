import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function runCommand(command, args) {
  return new Promise((resolve) => {
    const childProcess = spawn(command, args, {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      shell: false,
    });

    childProcess.on('error', () => resolve(1));
    childProcess.on('close', (code) => resolve(code ?? 1));
  });
}

function quoteWindowsArgument(value) {
  if (!/[\s"&|<>^()]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

async function runShortcutRefresh() {
  const scriptPath = path.join(__dirname, 'refresh-desktop-shortcut.mjs');
  const statusCode = await runCommand(process.execPath, [scriptPath]);

  if (statusCode !== 0) {
    console.warn('Desktop shortcut refresh failed. Continuing with Tauri command.');
  }
}

async function runShortcutContractCheck() {
  const scriptPath = path.join(__dirname, 'verify-tauri-shortcuts.mjs');
  const statusCode = await runCommand(process.execPath, [scriptPath]);

  if (statusCode !== 0) {
    process.exit(statusCode);
  }
}

async function main() {
  await runShortcutContractCheck();

  const tauriArgs = process.argv.slice(2);
  const normalizedArgs = tauriArgs.length > 0 ? tauriArgs : ['dev'];
  // Only refresh shortcuts for 'build' - not for 'dev' (no packaged exe exists during dev)
  const isBuild = normalizedArgs.includes('build');

  if (isBuild) {
    // Pre-build shortcut refresh: try to update with existing packaged exe (if any)
    await runShortcutRefresh();
  }

  const tauriExitCode = process.platform === 'win32'
    ? await runCommand('cmd.exe', [
      '/d',
      '/s',
      '/c',
      ['npx', '--no-install', 'tauri', ...normalizedArgs]
        .map(quoteWindowsArgument)
        .join(' '),
    ])
    : await runCommand('npx', ['--no-install', 'tauri', ...normalizedArgs]);

  // Post-build shortcut refresh: always update after successful build
  // This ensures the shortcut points to the newly packaged exe
  if (isBuild && tauriExitCode === 0) {
    await runShortcutRefresh();
  }

  process.exit(tauriExitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});