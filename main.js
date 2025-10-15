// main.js
const { app, BrowserWindow, ipcMain, Notification, dialog, screen, session } = require('electron');
const path = require('path');
const AdmZip = require('adm-zip');
const extract = require('extract-zip'); // Adicionado para extração otimizada
const fs = require('fs');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg'); // Novo
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; // Novo
const ffprobePath = require('@ffprobe-installer/ffprobe').path; // Novo

ffmpeg.setFfmpegPath(ffmpegPath); // Configura o caminho do FFmpeg
ffmpeg.setFfprobePath(ffprobePath); // Configura o caminho do FFprobe

// Conjunto para rastrear diretórios de extração
let extractionDirectories = new Set();

// Diretório base para projetos temporários
const PROJECTS_TEMP_DIR_BASE = path.join(os.tmpdir(), 'AVALibras');
const PROCESSED_VIDEOS_DIR = path.join(PROJECTS_TEMP_DIR_BASE, 'ProcessedVideos'); // Diretório para vídeos processados

// Função para garantir diretório de vídeos processados
function ensureProcessedVideosDir() {
  if (!fs.existsSync(PROCESSED_VIDEOS_DIR)) {
    fs.mkdirSync(PROCESSED_VIDEOS_DIR, { recursive: true });
  }
  return PROCESSED_VIDEOS_DIR;
}

// Função para garantir diretório temporário do projeto
function ensureProjectTempDir(projectName) {
  const sanitizedProjectName = projectName.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const projectParentDir = path.join(PROJECTS_TEMP_DIR_BASE, sanitizedProjectName);
  const projectVideoDir = path.join(projectParentDir, 'videos');
  if (!fs.existsSync(projectVideoDir)) {
    fs.mkdirSync(projectVideoDir, { recursive: true });
  }
  extractionDirectories.add(projectParentDir); // Adiciona o diretório pai para limpeza
  return projectVideoDir;
}

// Handler para salvar vídeo gravado
ipcMain.handle('save-recorded-video', async (event, { videoBuffer, fileName, projectName }) => {
  if (!projectName) {
    throw new Error('Nome da prova não fornecido para salvar vídeo gravado.');
  }
  try {
    const projectVideoDir = ensureProjectTempDir(projectName);
    const tempFilePath = path.join(projectVideoDir, fileName);
    await fs.promises.writeFile(tempFilePath, Buffer.from(videoBuffer));
    return tempFilePath;
  } catch (error) {
    console.error('Falha ao salvar vídeo gravado temporariamente:', error);
    throw error;
  }
});


// Salvar arquivo temporário para processamento
ipcMain.handle('save-temp-file', async (event, { buffer, extension }) => {
    try {
        // Garantir que o diretório de vídeos processados exista
        const processedVideosDir = ensureProcessedVideosDir();
        // Garantir que o diretório temporário exista
        const tempDir = path.join(processedVideosDir, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Gerar nome de arquivo único
        const fileName = `temp_${Date.now()}${extension || '.mp4'}`;
        const filePath = path.join(tempDir, fileName);
        
        // Salvar o buffer como arquivo
        fs.writeFileSync(filePath, Buffer.from(buffer));
        
        // Configurar limpeza automática após 1 hora
        setTimeout(() => {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`Arquivo temporário removido: ${filePath}`);
                }
            } catch (err) {
                console.error(`Erro ao remover arquivo temporário: ${filePath}`, err);
            }
        }, 60 * 60 * 1000); // 1 hora
        
        return filePath;
    } catch (error) {
        console.error('Erro ao salvar arquivo temporário:', error);
        return null;
    }
});

// Registrar erros do cliente para análise
ipcMain.handle('log-error', async (event, { type, message, stack }) => {
    try {
        const logDir = path.join(app.getPath('userData'), 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        const logFile = path.join(logDir, 'app-errors.log');
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] [${type}] ${message}\n${stack || ''}\n\n`;
        
        fs.appendFileSync(logFile, logEntry);
        console.error(`Erro registrado: ${type} - ${message}`);
        return true;
    } catch (error) {
        console.error('Erro ao registrar erro:', error);
        return false;
    }
});

// Função para limpar arquivos temporários
async function cleanupExtractedFiles() {
  console.log(`[${new Date().toISOString()}] Iniciando limpeza de arquivos temporários...`);
  const directoriesToDelete = [...extractionDirectories];
  extractionDirectories.clear();

  const deletionPromises = directoriesToDelete.map(dir => {
    return fs.promises.rm(dir, { recursive: true, force: true })
      .then(() => console.log(`[${new Date().toISOString()}] Diretório temporário limpo: ${dir}`))
      .catch(error => console.error(`[${new Date().toISOString()}] Erro ao limpar diretório: ${dir}`, error));
  });

  // Also clean the main processed videos dir
  deletionPromises.push(
    fs.promises.rm(PROCESSED_VIDEOS_DIR, { recursive: true, force: true })
      .then(() => console.log(`[${new Date().toISOString()}] Diretório de vídeos processados limpo: ${PROCESSED_VIDEOS_DIR}`))
      .catch(error => {
        // Ignore error if directory doesn't exist, but log others
        if (error.code !== 'ENOENT') {
          console.error(`[${new Date().toISOString()}] Erro ao limpar diretório de vídeos processados: ${PROCESSED_VIDEOS_DIR}`, error);
        }
      })
  );

  await Promise.all(deletionPromises);
  console.log(`[${new Date().toISOString()}] Limpeza de arquivos temporários concluída.`);
}

let mainWindow; // Variável global para a janela principal

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    icon: path.join(__dirname, 'source/img/icone.png'),
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: false,
      preload: path.resolve(__dirname, 'preload.js'),
      devTools: true, // Manter true para depuração, false para produção
      webSecurity: false // Considerar implicações de segurança
    },
    autoHideMenuBar: true,
    resizable: true,
    minimizable: true,
    fullscreenable: true
  });

  let isTogglingFullScreen = false;

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-maximize');
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-unmaximize');
  });

  mainWindow.on('leave-full-screen', () => {
    if (!isTogglingFullScreen && mainWindow.isFullScreen()) {
      isTogglingFullScreen = true;
      mainWindow.setFullScreen(false);
      setTimeout(() => (isTogglingFullScreen = false), 500);
    }
  });
  
  // Interceptar tentativa de fechamento da janela
  mainWindow.on('close', (event) => {
    event.preventDefault();
    showCloseConfirmDialog();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control) {
        switch (input.key.toLowerCase()) {
            case 'n':
                event.preventDefault();
                mainWindow.webContents.send('new-project');
                break;
            case 's':
                event.preventDefault();
                mainWindow.webContents.send('save-project-triggered');
                break;
            case 'o':
                event.preventDefault();
                mainWindow.webContents.send('open-project-triggered');
                break;
            case 'e':
                event.preventDefault();
                mainWindow.webContents.send('export-project-triggered');
                break;
            case 'q':
                event.preventDefault();
                showCloseConfirmDialog();
                break;
            case 't':
                if (!mainWindow.isFullScreen()) {
                    mainWindow.setFullScreen(true);
                }
                event.preventDefault();
                break;
            case 'x':
                if (mainWindow.isFullScreen()) {
                    mainWindow.setFullScreen(false);
                }
                event.preventDefault();
                break;
            case 'm':
                mainWindow.minimize();
                event.preventDefault();
                break;
            case 'i':
                if (input.shift) {
                    mainWindow.webContents.openDevTools();
                }
                event.preventDefault();
                break;
        }
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // Removido o onHeadersReceived para CSP, pois webSecurity: false já relaxa isso.
    // Se webSecurity for true, o CSP correto precisará ser definido.
    mainWindow.webContents.insertCSS(`
      .electron-app-info { display: none !important; }
    `);
  });

  mainWindow.loadFile('index.html');
}

// Função para mostrar diálogo de confirmação de fechamento
function showCloseConfirmDialog() {
  // Enviar mensagem para o renderer process para mostrar modal
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(`
      showConfirmModal({ 
        title: 'Confirmar Fechamento', 
        message: 'Tem certeza que deseja fechar o programa?' 
      })
        .then(result => {
          window.electronAPI.confirmClose(result);
        });
    `);
  }
}

app.whenReady().then(() => {
  ensureProcessedVideosDir(); // Garante que o diretório existe na inicialização
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'camera', 'microphone', 'videoInput', 'audioInput'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      console.warn(`Permissão negada para: ${permission}`);
      callback(false);
    }
  });
  createWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Variável para controlar se o fechamento foi confirmado
let isQuitting = false;

app.on('window-all-closed', function () {
  cleanupExtractedFiles();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();
    showCloseConfirmDialog();
  } else {
    cleanupExtractedFiles();
  }
});

// Handler para resposta do diálogo de confirmação (mantido para compatibilidade)
ipcMain.on('confirm-close-response', async (event, shouldClose) => {
  if (shouldClose) {
    isQuitting = true;
    
    // Fechar a janela principal imediatamente para dar feedback visual
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
    
    // Executar limpeza em background e fechar a aplicação
    try {
      await cleanupExtractedFiles();
    } catch (error) {
      console.error('Erro durante limpeza:', error);
    } finally {
      app.quit();
    }
  }
});


ipcMain.handle('show-open-dialog', async (event, options) => {
  return await dialog.showOpenDialog(options);
});

ipcMain.on('show-message', (event, {message, type = 'info'}) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    dialog.showMessageBox(win, {
        type: type,
        buttons: ['OK'],
        defaultId: 0,
        title: 'AvaLIBRAS',
        message: message
    });
  } else {
     new Notification({ title: 'AvaLIBRAS', body: message }).show();
  }
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  return await dialog.showSaveDialog(options);
});

ipcMain.on('quit-app', () => {
  showCloseConfirmDialog();
});

ipcMain.on('minimize-app', () => {
  BrowserWindow.getFocusedWindow()?.minimize();
});

ipcMain.on('maximize-app', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});

ipcMain.on('unmaximize-app', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win?.isMaximized()) {
    win.unmaximize();
  }
});

ipcMain.on('toggle-dev-tools', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools();
    } else {
      win.webContents.openDevTools();
    }
  }
});

ipcMain.handle('show-notification', (event, { title, body, type = 'info' }) => {
  const notification = new Notification({
    title: title || 'Notificação',
    body,
    icon: path.join(__dirname, 'source/img/icone.png')
  });
  notification.show();
  // Não podemos mais ouvir 'click' e 'close' diretamente no objeto Notification no main process
  // A interação com notificações deve ser gerenciada de forma diferente se necessário
  // ou delegada ao renderer se possível, ou removida se não crucial.
});

ipcMain.handle('show-prompt-dialog', async (event, { title, message }) => {
  // Enviar mensagem para o renderer process para mostrar modal de prompt
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.webContents.executeJavaScript(`
      showPromptModal('${title}', '${message}', 'password');
    `);
  }
  return '';
});


ipcMain.handle('read-dir', async (event, dirPath) => {
  try {
    return fs.readdirSync(dirPath);
  } catch (error) {
    console.error('Erro ao ler diretório:', error);
    return [];
  }
});

ipcMain.handle('check-file-exists', async (event, filePath) => {
  try {
    return fs.existsSync(filePath);
  } catch (error) {
    console.error('Erro ao verificar arquivo:', error);
    return false;
  }
});

ipcMain.handle('save-project', async (event, projectData) => {
    try {
        const jsonContent = {
            version: "2.0",
            metadata: {
                name: projectData.nomeProva,
                type: projectData.tipo || "Múltipla Escolha",
                questions: projectData.questions?.length || 0,
                created: new Date().toISOString(),
                modified: new Date().toISOString()
            },
            questions: projectData.questions,
            videoPaths: Object.fromEntries(projectData.videoPaths || []),
            settings: {
                autosave: true,
                lastAccessed: new Date().toISOString()
            }
        };
        return JSON.stringify(jsonContent, null, 2);
    } catch (error) {
        console.error('Erro ao salvar projeto:', error);
        throw error;
    }
});

ipcMain.handle('open-project', async (event, filePath) => {
    try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const projectData = JSON.parse(content);

        // Validar arquivos de mídia
        const missingFiles = [];
        projectData.questions.forEach((q, i) => {
            if (q.video && !fs.existsSync(q.video)) {
                missingFiles.push(`Questão ${i+1}: ${q.video}`);
            }
        });

        return { projectData, missingFiles };
    } catch (error) {
        console.error('Erro ao abrir projeto:', error);
        throw error;
    }
});

ipcMain.handle('export-test', async (event, { nomeProva, questions, videoPaths: videoPathsObj, password }) => {
  const operationText = password ? 'Exportando a Videoprova...' : 'Salvando o Projeto...';

  console.log('Questions received in main.js:', JSON.stringify(questions, null, 2));
  
  // Converter o objeto videoPaths recebido de volta para um Map
  const videoPaths = new Map(Object.entries(videoPathsObj || {}));
  console.log('VideoPaths convertido para Map:', [...videoPaths.entries()]);

  try {
    mainWindow.webContents.send('show-progress-modal', operationText);

    const zip = new AdmZip();
    
    // Constante para o método STORE (sem compressão)
    const STORE_METHOD = 0;
    // Constante para o método DEFLATE (com compressão padrão) - AdmZip usa por padrão
    // const DEFLATE_METHOD = 8; // Não é necessário definir se for usar o padrão para videos.js
    
    await Promise.all(questions.map(async (question, index) => {
      let actualVideoPath = videoPaths.get(question.video) || question.video;
      if (actualVideoPath.startsWith('file://')) {
          actualVideoPath = actualVideoPath.replace(/^file:\/\//, '');
      }
      // Para Windows, normalizar caminhos se eles vierem com /C: -> C:
      if (process.platform === 'win32' && actualVideoPath.match(/^\/[A-Za-z]:/)) {
        actualVideoPath = actualVideoPath.substring(1);
      }


      if (!actualVideoPath || !fs.existsSync(actualVideoPath)) {
        console.warn(`Vídeo não encontrado ou caminho inválido para questão ${index + 1}: ${actualVideoPath || question.video}`);
        return; 
      }
      try {
        const videoData = await fs.promises.readFile(actualVideoPath);
        // Garantir que o vídeo seja sempre exportado como Q_XX.mp4
        const videoFileNameInZip = `Q_${(index + 1).toString().padStart(2, '0')}.mp4`;
        
        // Adiciona o arquivo de vídeo
        zip.addFile(videoFileNameInZip, videoData);
        // Obtém a entrada e define o método de compressão para STORE (0)
        const videoEntry = zip.getEntry(videoFileNameInZip);
        if (videoEntry) {
            videoEntry.header.method = STORE_METHOD; // <--- MODIFICAÇÃO AQUI
        }
        question.video = videoFileNameInZip;
        
        // Processar imagem de overlay se existir
        console.log(`DEBUG - Questão ${index + 1} tem overlay:`, question.overlay);
        if (question.overlay && question.overlay.image) {
          console.log(`DEBUG - Processando imagem de overlay: ${question.overlay.image}`);
          let actualImagePath = videoPaths.get(question.overlay.image) || question.overlay.image;
          console.log(`DEBUG - Caminho da imagem após verificar videoPaths: ${actualImagePath}`);
          if (actualImagePath.startsWith('file://')) {
            actualImagePath = actualImagePath.replace(/^file:\/\//, '');
            console.log(`DEBUG - Caminho após remover file://: ${actualImagePath}`);
          }
          if (process.platform === 'win32' && actualImagePath.match(/^\/[A-Za-z]:/)) {
            actualImagePath = actualImagePath.substring(1);
            console.log(`DEBUG - Caminho após normalizar para Windows: ${actualImagePath}`);
          }
          
          console.log(`DEBUG - Verificando se o arquivo existe: ${actualImagePath}`);
          if (actualImagePath && fs.existsSync(actualImagePath)) {
            console.log(`DEBUG - Arquivo de overlay encontrado: ${actualImagePath}`);
            try {
              const imageData = await fs.promises.readFile(actualImagePath);
              // Sempre usar a extensão .png para as imagens de overlay, independente da extensão original
              const imageFileNameInZip = `Q_${(index + 1).toString().padStart(2, '0')}.png`;
              console.log(`DEBUG - Adicionando imagem ao zip como: ${imageFileNameInZip}`);

              // Adiciona o arquivo de imagem
              zip.addFile(imageFileNameInZip, imageData);
              // Obtém a entrada e define o método de compressão para STORE (0)
              const imageEntry = zip.getEntry(imageFileNameInZip);
              if (imageEntry) {
                  imageEntry.header.method = STORE_METHOD; // <--- MODIFICAÇÃO AQUI
              }
              question.overlay.image = imageFileNameInZip;
              console.log(`DEBUG - Nome da imagem atualizado no objeto question: ${question.overlay.image}`);
            } catch (imageError) {
              console.warn(`Erro ao processar imagem de overlay para questão ${index + 1}:`, imageError);
            }
          } else {
            console.error(`DEBUG - ERRO: Arquivo de overlay não encontrado: ${actualImagePath}`);
            console.error(`DEBUG - Caminho original da imagem: ${question.overlay.image}`);
            console.error(`DEBUG - videoPaths contém esta imagem: ${videoPaths.has(question.overlay.image)}`);
            if (videoPaths.has(question.overlay.image)) {
              console.error(`DEBUG - Valor em videoPaths: ${videoPaths.get(question.overlay.image)}`);
            }
            // Continuar sem a imagem se houver erro
          }
        } else {
          console.warn(`Imagem de overlay não encontrada para questão ${index + 1}: ${question.overlay ? question.overlay.image : 'sem overlay'}`);
        }
      } catch (readError) {
        console.error(`Erro ao ler o arquivo de vídeo ${actualVideoPath}:`, readError);
        throw new Error(`Falha ao processar vídeo da questão ${index + 1} (${path.basename(actualVideoPath)})`);
      }
    }));

    const scriptContent = `var nomeProva = ${JSON.stringify(nomeProva)};\nvar questions = ${JSON.stringify(questions, null, 2)};`;
    zip.addFile('videos.js', Buffer.from(scriptContent));

    let zipBuffer;
    if (password && password.trim() !== "") {
        zipBuffer = zip.toBuffer(undefined, password); // AdmZip espera primeiro argumento como path, segundo como senha
    } else {
        zipBuffer = zip.toBuffer(); 
    }
    
    return zipBuffer;

  } catch (error) {
    console.error('Erro durante a operação de zip:', error);
    throw error;
  } finally {
    mainWindow.webContents.send('hide-progress-modal');
  }
});

ipcMain.handle('save-file', async (event, { filePath, data }) => {
  try {
    await fs.promises.writeFile(filePath, data);
    return true;
  } catch (error) {
    console.error('Erro ao salvar arquivo:', error);
    throw error;
  }
});

ipcMain.handle('show-message-box', async (event, options) => {
  return await dialog.showMessageBox(options);
});

ipcMain.handle('extract-avaproject', async (event, filePath) => {
  let outputDir; 

  try {
    mainWindow.webContents.send('show-progress-modal', 'Extraindo a Videoprova...');
    
    const tempDirBase = PROJECTS_TEMP_DIR_BASE; 
    const zipFileName = path.basename(filePath, path.extname(filePath));
    const sanitizedProjectName = zipFileName.replace(/[^a-zA-Z0-9_.-]/g, '_'); //
    outputDir = path.join(tempDirBase, sanitizedProjectName); 
    
    console.log(`[${new Date().toISOString()}] Diretório de saída para extração: ${outputDir}`); //

    if (fs.existsSync(outputDir)) {
        console.log(`[${new Date().toISOString()}] Limpando diretório de destino existente: ${outputDir}`);
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true }); 

    extractionDirectories.add(outputDir);

    // Usando extract-zip para melhor performance
    await extract(filePath, { dir: outputDir });

    // Após a extração, ler o videos.js
    const videosJsPath = path.join(outputDir, 'videos.js');
    let videosJsContent = null;
    if (fs.existsSync(videosJsPath)) {
      videosJsContent = fs.readFileSync(videosJsPath, 'utf-8');
    } else {
      throw new Error(`Arquivo videos.js não encontrado no projeto importado em: ${videosJsPath}`);
    }

    console.log(`[${new Date().toISOString()}] Extração concluída com sucesso em: ${outputDir}`); //
    
    return { success: true, outputDir: outputDir, provaNome: sanitizedProjectName, content: videosJsContent }; //

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro ao extrair o zip:`, error); //
    if (filePath) console.error(`[${new Date().toISOString()}] Caminho do arquivo: ${filePath}`); //
    if (outputDir) console.error(`[${new Date().toISOString()}] Tentativa de diretório de destino: ${outputDir}`); //
    return { success: false, error: error.message, content: null }; //
  } finally {
      mainWindow.webContents.send('hide-progress-modal');
  }
});


// Handler para remover trecho selecionado e unir as partes
ipcMain.handle('trim-video', async (event, params) => {
    try {
        const { inputPath, startTime, endTime } = params;
        
        mainWindow.webContents.send('show-progress-modal', 'Removendo trecho selecionado...');
        
        if (!inputPath || !fs.existsSync(inputPath)) {
            throw new Error('Arquivo de entrada não encontrado');
        }
        
        const videoInfo = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(inputPath, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata);
            });
        });
        
        const totalDuration = videoInfo.format.duration;
        const tempDir = os.tmpdir();
        const timestamp = Date.now();
        const outputPath = path.join(tempDir, `edited_video_${timestamp}.mp4`);
        
        console.log(`Removendo trecho: ${startTime}s - ${endTime}s`);
        console.log(`Duração total: ${totalDuration}s`);
        
        return new Promise((resolve, reject) => {
            let command;
            
            if (startTime > 0 && endTime < totalDuration) {
                command = ffmpeg(inputPath)
                    .outputOptions([
                        '-filter_complex',
                        `[0:v]split=2[v1][v2];[0:a]asplit=2[a1][a2];[v1]trim=0:${startTime},setpts=PTS-STARTPTS[part1v];[v2]trim=${endTime}:${totalDuration},setpts=PTS-STARTPTS[part2v];[a1]atrim=0:${startTime},asetpts=PTS-STARTPTS[part1a];[a2]atrim=${endTime}:${totalDuration},asetpts=PTS-STARTPTS[part2a];[part1v][part2v]concat=n=2:v=1:a=0[outv];[part1a][part2a]concat=n=2:v=0:a=1[outa]`,
                        '-map', '[outv]',
                        '-map', '[outa]',
                        '-c:v', 'libx264',
                        '-c:a', 'aac'
                    ]);
            } else if (startTime === 0) {
                command = ffmpeg(inputPath)
                    .seekInput(endTime)
                    .outputOptions([
                        '-c:v', 'libx264',
                        '-c:a', 'aac'
                    ]);
            } else if (endTime >= totalDuration) {
                command = ffmpeg(inputPath)
                    .duration(startTime)
                    .outputOptions([
                        '-c:v', 'libx264',
                        '-c:a', 'aac'
                    ]);
            } else {
                reject(new Error('Configuração de tempo inválida'));
                return;
            }
            
            command
                .outputOptions([
                    '-preset', 'veryfast',
                    '-crf', '23',
                    '-avoid_negative_ts', 'make_zero',
                    '-fflags', '+genpts'
                ])
                .output(outputPath)
                .on('progress', (progress) => {
                    const percent = progress.percent || 0;
                    mainWindow.webContents.send('update-progress', { percent, text: `Removendo trecho... ${Math.round(percent)}%` });
                })
                .on('end', () => {
                    mainWindow.webContents.send('hide-progress-modal');
                    console.log('Trecho removido com sucesso!');
                    resolve({ 
                        success: true, 
                        outputPath: outputPath,
                        autoLoad: true,
                        exitEditor: true
                    });
                })
                .on('error', (err) => {
                    mainWindow.webContents.send('hide-progress-modal');
                    reject(new Error(`Erro ao remover trecho: ${err.message}`));
                });
            
            command.run();
        });
        
    } catch (error) {
        console.error('Erro ao cortar vídeo:', error);
        mainWindow.webContents.send('hide-progress-modal');
        return { success: false, error: error.message };
    }
});


 
 // Processar vídeo
 ipcMain.handle('process-video', async (event, args) => {
  // Compatibilidade com ambos os parâmetros: operation (antigo) e action (novo)
  const operation = args.action || args.operation;
  const { inputPath, startTime, duration, outputFormat } = args;
  const processedVideosDir = ensureProcessedVideosDir();
  
  // Determinar o caminho de saída com base no formato solicitado
  const fileExt = outputFormat ? `.${outputFormat}` : (path.extname(inputPath) || '.mp4');
  const outputFileName = `processed_${operation}_${Date.now()}${fileExt}`;
  const outputPath = path.join(processedVideosDir, outputFileName);
  
  try {
    if (operation === 'cut') {
      mainWindow.webContents.send('show-progress-modal', 'Cortando vídeo...');
      return new Promise((resolve, reject) => {
        if (!fs.existsSync(inputPath)) {
          mainWindow.webContents.send('hide-progress-modal');
          reject({ success: false, error: `Arquivo de entrada não encontrado: ${inputPath}` });
          return;
        }
        
        console.log(`Processando vídeo: ${inputPath}`);
        console.log(`Parâmetros: startTime=${startTime}, duration=${duration}, outputPath=${outputPath}`);
        
        const ffmpegCommand = ffmpeg(inputPath)
          .setStartTime(startTime)
          .setDuration(duration)
          .outputOptions('-c', 'copy')
          .save(outputPath);
        
        ffmpegCommand.on('start', (commandLine) => {
          console.log('Comando FFmpeg:', commandLine);
        });
        
        ffmpegCommand.on('end', () => {
          mainWindow.webContents.send('hide-progress-modal');
          console.log('Corte finalizado. Novo arquivo:', outputPath);
          resolve({ success: true, outputPath: outputPath });
        });
        
        ffmpegCommand.on('error', (err) => {
          mainWindow.webContents.send('hide-progress-modal');
          console.error('Erro no FFmpeg (corte):', err);
          reject({ success: false, error: err.message });
        });
        
        ffmpegCommand.on('progress', (progress) => {
          const percent = progress.percent ? Math.round(progress.percent) : 0;
          console.log(`Progresso do corte FFmpeg: ${percent}%`);
          mainWindow.webContents.send('update-progress', { text: `Processando vídeo... ${percent}%`, percent });
        });
      });
    } else if (operation === 'removeAndJoin') {
      mainWindow.webContents.send('show-progress-modal', 'Processando vídeo (removendo trecho)...');
      const { inputPath, cutStartTime, cutEndTime, videoDuration } = args;
      
      const tempDir = ensureProcessedVideosDir();
      const outputFileName = `removed_${Date.now()}${path.extname(inputPath) || '.mp4'}`;
      const finalOutputPath = path.join(tempDir, outputFileName);

      const segment1Path = path.join(tempDir, `segment1_temp_${Date.now()}.mp4`);
      const segment2Path = path.join(tempDir, `segment2_temp_${Date.now()}.mp4`);
      const listFilePath = path.join(tempDir, `concat_list_${Date.now()}.txt`);
      
      let segmentsToConcat = [];

      return new Promise(async (resolve, reject) => {
          try {
              if (cutStartTime > 0.01) {
                  await new Promise((res, rej) => {
                      ffmpeg(inputPath)
                          .setStartTime(0)
                          .setDuration(cutStartTime)
                          .outputOptions('-c', 'copy')
                          .save(segment1Path)
                          .on('end', () => { segmentsToConcat.push(segment1Path); res(); })
                          .on('error', rej);
                  });
              }

              if (cutEndTime < videoDuration - 0.01) {
                  await new Promise((res, rej) => {
                      ffmpeg(inputPath)
                          .setStartTime(cutEndTime)
                          .outputOptions('-c', 'copy')
                          .save(segment2Path)
                          .on('end', () => { segmentsToConcat.push(segment2Path); res(); })
                          .on('error', rej);
                  });
              }

              if (segmentsToConcat.length === 0) {
                  mainWindow.webContents.send('hide-progress-modal');
                  resolve({ success: true, path: null });
                  return;
              } else if (segmentsToConcat.length === 1) {
                  fs.renameSync(segmentsToConcat[0], finalOutputPath);
                  mainWindow.webContents.send('hide-progress-modal');
                  resolve({ success: true, path: finalOutputPath });
                  return;
              } else {
                  const concatListContent = segmentsToConcat.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
                  fs.writeFileSync(listFilePath, concatListContent);

                  await new Promise((res, rej) => {
                      ffmpeg()
                          .input(listFilePath)
                          .inputOptions(['-f', 'concat', '-safe', '0'])
                          .outputOptions('-c', 'copy')
                          .save(finalOutputPath)
                          .on('end', res)
                          .on('error', rej);
                  });
              }

              segmentsToConcat.forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
              if (fs.existsSync(listFilePath)) fs.unlinkSync(listFilePath);

              mainWindow.webContents.send('hide-progress-modal');
              resolve({ success: true, path: finalOutputPath });

          } catch (err) {
              mainWindow.webContents.send('hide-progress-modal');
              segmentsToConcat.forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
              if (fs.existsSync(segment1Path) && !segmentsToConcat.includes(segment1Path)) fs.unlinkSync(segment1Path);
              if (fs.existsSync(segment2Path) && !segmentsToConcat.includes(segment2Path)) fs.unlinkSync(segment2Path);
              if (fs.existsSync(listFilePath)) fs.unlinkSync(listFilePath);
              console.error('Erro no processo de remoção de trecho (FFmpeg):', err);
              reject({ success: false, error: err.message });
          }
      });
    } else if (operation === 'join') {
      mainWindow.webContents.send('show-progress-modal', 'Unindo vídeos...');
      const { inputPaths } = args;
      
      if (!inputPaths || !Array.isArray(inputPaths) || inputPaths.length < 2) {
        mainWindow.webContents.send('hide-progress-modal');
        return Promise.reject({ success: false, error: 'É necessário fornecer pelo menos dois vídeos para unir.' });
      }
      
      for (const filePath of inputPaths) {
        if (!fs.existsSync(filePath)) {
          mainWindow.webContents.send('hide-progress-modal');
          return Promise.reject({ success: false, error: `Arquivo não encontrado: ${filePath}` });
        }
      }
      
      const tempDir = ensureProcessedVideosDir();
      const listFilePath = path.join(tempDir, `concat_list_${Date.now()}.txt`);
      const outputFileName = `joined_${Date.now()}${path.extname(inputPaths[0]) || '.mp4'}`;
      const outputPath = path.join(tempDir, outputFileName);
      
      const concatListContent = inputPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
      fs.writeFileSync(listFilePath, concatListContent);
      
      return new Promise((resolve, reject) => {
        ffmpeg()
          .input(listFilePath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions('-c', 'copy')
          .save(outputPath)
          .on('progress', (progress) => {
            console.log(`Progresso da união: ${progress.percent}%`);
          })
          .on('end', () => {
            if (fs.existsSync(listFilePath)) fs.unlinkSync(listFilePath);
            mainWindow.webContents.send('hide-progress-modal');
            console.log('União de vídeos concluída com sucesso:', outputPath);
            resolve({ success: true, path: outputPath });
          })
          .on('error', (err) => {
            if (fs.existsSync(listFilePath)) fs.unlinkSync(listFilePath);
            mainWindow.webContents.send('hide-progress-modal');
            console.error('Erro ao unir vídeos com FFmpeg:', err);
            reject({ success: false, error: err.message });
          });
      });
    } else {
      mainWindow.webContents.send('hide-progress-modal');
      return Promise.reject({ success: false, error: 'Operação de vídeo desconhecida.' });
    }
  } catch (error) {
      mainWindow.webContents.send('hide-progress-modal');
      console.error('Erro geral no processamento de vídeo:', error);
      return { success: false, error: error.message };
  }
});

// Handler para adicionar overlay de imagem
// A função add-image-overlay foi removida pois foi substituída pelo método Canvas
// que aplica overlays de forma não-destrutiva diretamente no renderer process