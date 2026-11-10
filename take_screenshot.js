const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    show: false,
    webPreferences: {
      offscreen: true
    }
  });

  console.log('[Screenshot] Loading http://localhost:3000 ...');
  await win.loadURL('http://localhost:3000');

  // Wait 1.5 seconds for styles and DOM
  await new Promise(r => setTimeout(r, 1500));

  console.log('[Screenshot] Capturing page buffer...');
  const image = await win.webContents.capturePage();
  const outputPath = path.join(__dirname, 'browser_preview_white.png');
  fs.writeFileSync(outputPath, image.toPNG());
  console.log(`[Screenshot] Saved browser screenshot to: ${outputPath} (${fs.statSync(outputPath).size} bytes)`);

  app.quit();
});
