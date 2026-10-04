import { contextBridge, ipcRenderer } from 'electron';

// Expose secure, explicit entry points to the React frontend window context
contextBridge.exposeInMainWorld('miraiSecureOS', {
  // A desktop feature telling React whether it's running inside Electron or a web browser
  isDesktop: true,
  
  // Triggers native native OS notifications
  sendSystemAlert: (message: string) => ipcRenderer.send('trigger-os-alert', message),
  
  // Request native hardware passkey/biometric validation hooks
  requestLocalBiometrics: () => ipcRenderer.invoke('verify-local-hardware-identity')
});
