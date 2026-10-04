import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;

function createMiraiWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    backgroundColor: '#09090B', // Starts on Stealth Black matching your dark mode specification
    show: false, // Hidden initially to prevent white flickering frames
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,  // 🛡️ Isolates JavaScript execution contexts to block malware
      nodeIntegration: false,   // 🛡️ Completely blocks Burp Suite/XSS malware from accessing native OS terminals
      sandbox: true            // 🛡️ Forces Chromium engine container sandboxing
    }
  });

  // Load the web application environment
  if (app.isPackaged) {
    // Production Mode: Load local built files statically (Option B)
    mainWindow.loadFile(path.join(__dirname, '../../web/dist/index.html'));
  } else {
    // Development Mode: Load local running Vite UI server port
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools(); // Launches developer tools instantly in development environments
  }

  // Once the window layouts render completely, display the window gracefully to the user
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ==================== SECURITY & INTERACTION CHANNELS ====================

// Handler for the system alerts exposed via the preload context bridge
ipcMain.on('trigger-os-alert', (event, message: string) => {
  if (mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Mirai Hub Security Engine',
      message: message,
      buttons: ['Acknowledged']
    });
  }
});

// Mock handler for Passkey / Local Hardware evaluation requests
ipcMain.handle('verify-local-hardware-identity', async () => {
  // In a real device setup, this hooks directly into the operating system keychain/biometric hardware prompt
  return true; 
});

// ==================== APP SYSTEM LIFECYCLES ====================

app.whenReady().then(() => {
  createMiraiWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMiraiWindow();
  });
});

// Shutdown operations across platform operating systems
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
