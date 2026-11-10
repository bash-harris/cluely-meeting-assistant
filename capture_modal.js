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

  await win.loadURL('http://localhost:3000');
  await new Promise(r => setTimeout(r, 1200));

  // Open modal
  await win.webContents.executeJavaScript(`
    document.getElementById('test-matrix-modal').style.display = 'flex';
  `);
  await new Promise(r => setTimeout(r, 800));

  const image = await win.webContents.capturePage();
  const outputPath = path.join(__dirname, 'browser_preview_white_modal.png');
  fs.writeFileSync(outputPath, image.toPNG());
  app.quit();
});

