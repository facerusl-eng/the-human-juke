import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function escapePowerShellLiteral(value) {
  return value.replace(/'/g, "''");
}

async function pickLatestExistingFile(filePaths) {
  const candidates = [];

  for (const candidatePath of filePaths) {
    try {
      const metadata = await stat(candidatePath);
      if (metadata.isFile()) {
        candidates.push({ filePath: candidatePath, modifiedAt: metadata.mtimeMs });
      }
    } catch {
      // File missing is expected in fresh environments.
    }
  }

  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  return candidates[0]?.filePath ?? null;
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('Desktop shortcut refresh skipped: Windows only.');
    return;
  }

  const tauriExePath = await pickLatestExistingFile([
    path.join(projectRoot, 'src-tauri', 'target', 'release', 'human_jukebox_tauri.exe'),
    path.join(projectRoot, 'src-tauri', 'target', 'debug', 'human_jukebox_tauri.exe'),
  ]);

  if (!tauriExePath) {
    console.warn('Desktop shortcut refresh skipped: no Tauri executable found yet.');
    return;
  }

  const desktopDirectory = path.join(process.env.USERPROFILE || os.homedir(), 'Desktop');
  const shortcutPaths = [
    path.join(desktopDirectory, 'Human Jukebox.lnk'),
    path.join(desktopDirectory, 'Human Jukebox Tauri.lnk'),
    path.join(desktopDirectory, 'HumanJukeboxWinUI - THIS ONE.lnk'),
    path.join(desktopDirectory, 'HumanJukeboxWinUI.lnk'),
  ];
  const iconPath = path.join(projectRoot, 'src-tauri', 'icons', 'icon.ico');
  const workingDirectory = path.dirname(tauriExePath);

  const shortcutPathList = shortcutPaths
    .map((shortcutPath) => `'${escapePowerShellLiteral(shortcutPath)}'`)
    .join(', ');

  const script = [
    `$shortcutPaths = @(${shortcutPathList})`,
    `$targetPath = '${escapePowerShellLiteral(tauriExePath)}'`,
    `$workingDirectory = '${escapePowerShellLiteral(workingDirectory)}'`,
    `$iconPath = '${escapePowerShellLiteral(iconPath)}'`,
    '$shell = New-Object -ComObject WScript.Shell',
    'foreach ($shortcutPath in $shortcutPaths) {',
    '  $shortcut = $shell.CreateShortcut($shortcutPath)',
    '  $shortcut.TargetPath = $targetPath',
    '  $shortcut.WorkingDirectory = $workingDirectory',
    "  $shortcut.Description = 'Human Jukebox'",
    '  if (Test-Path -LiteralPath $iconPath) { $shortcut.IconLocation = "$iconPath,0" }',
    '  $shortcut.Save()',
    '  Write-Output "Desktop shortcut updated: $shortcutPath -> $targetPath"',
    '}',
  ].join('; ');

  const powershellResult = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { stdio: 'inherit' },
  );

  if (powershellResult.status !== 0) {
    throw new Error(`Failed to update desktop shortcut (exit code: ${powershellResult.status ?? 'unknown'}).`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});