import { spawn } from 'node:child_process';

const DEV_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3001';
const STARTUP_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServices() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    const [devReady, apiReady] = await Promise.all([
      isReachable(DEV_URL),
      isReachable(API_URL),
    ]);

    if (devReady && apiReady) {
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for local dev services at ${DEV_URL} and ${API_URL}.`);
}

function startDevServer() {
  if (process.platform === 'win32') {
    const childProcess = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', 'npm', 'run', 'dev'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    childProcess.unref();
    return;
  }

  const childProcess = spawn('npm', ['run', 'dev'], {
    detached: true,
    stdio: 'ignore',
    shell: false,
  });

  childProcess.unref();
}

async function main() {
  const [devReady, apiReady] = await Promise.all([
    isReachable(DEV_URL),
    isReachable(API_URL),
  ]);

  if (!devReady || !apiReady) {
    startDevServer();
  }

  await waitForServices();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});