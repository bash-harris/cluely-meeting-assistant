/**
 * Electron Clean-Environment Process Launcher
 * Ensures ELECTRON_RUN_AS_NODE is stripped so Electron initializes the native GUI runtime
 * with full window management, transparent overlay, and OS audio capture support.
 */

const { spawn } = require('child_process');
const path = require('path');
const electronPath = require('electron');

const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;

const appPath = path.resolve(__dirname, '..');
const args = [appPath, ...process.argv.slice(2)];

console.log('[Launcher] Spawning Cluely Stealth Overlay with clean GUI environment...');
console.log('[Launcher] Electron binary:', electronPath);

const child = spawn(electronPath, args, {
  env: cleanEnv,
  stdio: 'inherit',
  windowsHide: false
});

child.on('error', (err) => {
  console.error('[Launcher] Failed to start Electron:', err);
  process.exit(1);
});

child.on('close', (code) => {
  console.log(`[Launcher] Electron process exited with code ${code}`);
  process.exit(code || 0);
});

