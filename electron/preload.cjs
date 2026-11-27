const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (cb) => {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('desktop', {
  version: () => ipcRenderer.invoke('app:version'),
  launchFile: () => ipcRenderer.invoke('file:launch'),
  openDialog: () => ipcRenderer.invoke('file:open-dialog'),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  saveFile: (path, content, eol) => ipcRenderer.invoke('file:save', path, content, eol),
  saveAsDialog: (suggestedName, content, eol) => ipcRenderer.invoke('file:save-as', suggestedName, content, eol),
  exportText: (suggestedName, content) => ipcRenderer.invoke('file:export', suggestedName, content),
  importStructure: () => ipcRenderer.invoke('structure:import'),
  exportStructure: (suggestedName, base64) => ipcRenderer.invoke('structure:export', suggestedName, base64),
  exportBdx: (suggestedName, base64) => ipcRenderer.invoke('structure:export-bdx', suggestedName, base64),
  exportFolder: (files) => ipcRenderer.invoke('file:export-folder', files),
  choose: (message, buttons) => ipcRenderer.invoke('app:choose', message, buttons),
  confirmDiscard: (name) => ipcRenderer.invoke('app:confirm-discard', name),
  setState: (state) => ipcRenderer.invoke('app:set-state', state),
  forceClose: () => ipcRenderer.invoke('app:force-close'),
  setLanguage: (lang) => ipcRenderer.invoke('app:set-language', lang),
  onMenu: listen('menu:action'),
  onOpenRecent: listen('menu:open-recent'),
  onSaveAndClose: listen('app:save-and-close'),
  onOpenExternal: listen('file:open-external'),
});
