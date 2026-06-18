import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function escapePowerShellLiteral(value) {
  return value.replace(/'/g, "''");
}

/**
 * Find packaged Tauri executable.
 * Priority: Standalone release exe in target/release/ (not installers).
 * NEVER uses dev/debug builds or URLs.
 */
function findPackagedExe() {
  // Standalone release exe paths - this is the actual packaged app executable
  // This is what gets bundled by NSIS/MSI installers
  const standaloneExePaths = [
    path.join(projectRoot, 'src-tauri', 'target', 'release', 'human_jukebox_tauri.exe'),
    path.join(projectRoot, 'src-tauri', 'target', 'release', 'human-jukebox-tauri.exe'),
  ];

  // Check standalone release exe first (this is the packaged app, not the installer)
  for (const exePath of standaloneExePaths) {
    if (existsSync(exePath)) {
      const stats = statSync(exePath);
      if (stats.isFile()) {
        console.log(`Found packaged exe: ${exePath}`);
        return exePath;
      }
    }
  }

  // No packaged exe found
  return null;
}

function main() {
  if (process.platform !== 'win32') {
    console.log('Desktop shortcut refresh skipped: Windows only.');
    return;
  }

  // ONLY use packaged release exe - never dev/debug builds
  const tauriExePath = findPackagedExe();

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
  const powershellPath = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
  const devLauncherPath = path.join(projectRoot, 'launch-dev-browser.ps1');
  const devShortcutPath = path.join(desktopDirectory, 'Human Jukebox Dev.lnk');
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

  const devShortcutScript = [
    `$shortcutPath = '${escapePowerShellLiteral(devShortcutPath)}'`,
    `$targetPath = '${escapePowerShellLiteral(powershellPath)}'`,
    `$arguments = '-NoProfile -ExecutionPolicy Bypass -File "${escapePowerShellLiteral(devLauncherPath)}"'`,
    `$workingDirectory = '${escapePowerShellLiteral(projectRoot)}'`,
    `$iconPath = '${escapePowerShellLiteral(iconPath)}'`,
    '$shell = New-Object -ComObject WScript.Shell',
    '$shortcut = $shell.CreateShortcut($shortcutPath)',
    '$shortcut.TargetPath = $targetPath',
    '$shortcut.Arguments = $arguments',
    '$shortcut.WorkingDirectory = $workingDirectory',
    "$shortcut.Description = 'Human Jukebox Dev'",
    'if (Test-Path -LiteralPath $iconPath) { $shortcut.IconLocation = "$iconPath,0" }',
    '$shortcut.Save()',
    'Write-Output "Desktop shortcut updated: $shortcutPath -> $targetPath $arguments"',
  ].join('; ');

  const devShortcutResult = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', devShortcutScript],
    { stdio: 'inherit' },
  );

  if (devShortcutResult.status !== 0) {
    throw new Error(`Failed to update dev desktop shortcut (exit code: ${devShortcutResult.status ?? 'unknown'}).`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}