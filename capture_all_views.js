const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      offscreen: true
    }
  });

  console.log('[Screenshot] Loading http://localhost:3000 ...');
  await win.loadURL('http://localhost:3000');

  // 1. Wait for turns to arrive and AI card to appear
  await new Promise(r => setTimeout(r, 4500));

  console.log('[Screenshot] Capturing Feed + AI Assist Card...');
  let img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'browser_ai_assist.png'), img.toPNG());

  // 2. Open Test Matrix modal
  console.log('[Screenshot] Opening Test Matrix modal...');
  await win.webContents.executeJavaScript(`
    document.getElementById('test-matrix-modal').style.display = 'flex';
    document.getElementById('btn-run-all-tests').click();
  `);

  await new Promise(r => setTimeout(r, 2000));

  console.log('[Screenshot] Capturing Test Matrix View...');
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'browser_test_matrix.png'), img.toPNG());

  console.log('[Screenshot] All screenshots captured successfully.');
  app.quit();
});

