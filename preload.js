// preload.js
const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs'); // Mantido para compatibilidade se outras partes usarem
const path = require('path'); // Mantido para compatibilidade
// AdmZip não é necessário no preload se a extração principal é feita no main.js
// const AdmZip = require('adm-zip'); 

// Expor APIs do Electron para o renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Diálogos
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
    showPromptDialog: (message, defaultValue) => ipcRenderer.invoke('show-prompt-dialog', message, defaultValue),
    showNotification: (options) => ipcRenderer.invoke('show-notification', options),
    
    // Operações de arquivo
    extractAvaProject: (filePath, password) => ipcRenderer.invoke('extract-avaproject', filePath, password),
    checkFileExists: (filePath) => ipcRenderer.invoke('check-file-exists', filePath),
    readDir: (dirPath) => ipcRenderer.invoke('read-dir', dirPath),
    exportVideos: (options) => ipcRenderer.invoke('export-videos', options),
    exportTest: (options) => ipcRenderer.invoke('export-test', options),
    saveProject: (projectData) => ipcRenderer.invoke('save-project', projectData),
    openProject: (filePath) => ipcRenderer.invoke('open-project', filePath),
    saveFile: (options) => ipcRenderer.invoke('save-file', options),
    saveTempFile: (options) => ipcRenderer.invoke('save-temp-file', options),
    
    // Controle da aplicação
    quitApp: () => ipcRenderer.send('quit-app'),
    minimizeApp: () => ipcRenderer.send('minimize-app'),
    maximizeApp: () => ipcRenderer.send('maximize-app'),

    // Controle de janela (para titlebar customizado)
    minimizeWindow: () => ipcRenderer.send('minimize-app'),
    maximizeWindow: () => ipcRenderer.send('maximize-app'),
    unmaximizeWindow: () => ipcRenderer.send('unmaximize-app'),
    closeWindow: () => ipcRenderer.send('quit-app'),
    
    // Informações da plataforma
    platform: process.platform,
    pathJoin: (...paths) => path.join(...paths),
    
    // Vídeo
    saveRecordedVideo: (options) => ipcRenderer.invoke('save-recorded-video', options),
    trimVideo: (params) => ipcRenderer.invoke('trim-video', params),
    // addImageOverlay foi removido - agora usando apenas o método Canvas
    saveTempFile: (params) => ipcRenderer.invoke('save-temp-file', params),
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    
    // Processador de vídeo
    videoProcessor: {
        process: (options) => ipcRenderer.invoke('process-video', options)
    },

    // Ferramentas de desenvolvimento
    toggleDevTools: () => ipcRenderer.send('toggle-dev-tools'),

    // Registro de erros
    logError: (type, message, stack) => ipcRenderer.invoke('log-error', {type, message, stack}),
    
    // Controle de fechamento
    confirmClose: (shouldClose) => ipcRenderer.send('confirm-close-response', shouldClose),
    
    // Window state listeners
    onWindowMaximize: (callback) => ipcRenderer.on('window-maximize', callback),
    onWindowUnmaximize: (callback) => ipcRenderer.on('window-unmaximize', callback),

    // Progress Modal IPC
    onShowProgressModal: (callback) => ipcRenderer.on('show-progress-modal', callback),
    onUpdateProgress: (callback) => ipcRenderer.on('update-progress', callback),
    onHideProgressModal: (callback) => ipcRenderer.on('hide-progress-modal', callback),

    // Atalhos do menu
    onNewProject: (callback) => ipcRenderer.on('new-project', callback),
    onSaveProject: (callback) => ipcRenderer.on('save-project-triggered', callback),
    onOpenProject: (callback) => ipcRenderer.on('open-project-triggered', callback),
    onExportProject: (callback) => ipcRenderer.on('export-project-triggered', callback)
});