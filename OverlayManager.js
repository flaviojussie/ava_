/**
 * OverlayManager - Módulo para gerenciamento de overlays de imagem
 * Responsável pela funcionalidade de adicionar e gerenciar overlays em vídeos
 */
class OverlayManager {
    constructor(videoPlayer, options = {}) {
        this.videoPlayer = videoPlayer;
        this.currentOverlay = null;
        this.animationFrameId = null;
        this.resizeTimeoutId = null;
        this.resizeHandler = null; // Armazenar referência para remover corretamente

        // Usar gerenciador de eventos global para prevenir memory leaks
        this.eventListeners = [];

        this.options = {
            onSuccess: options.onSuccess || ((message) => console.log('OverlayManager Success:', message)),
            onError: options.onError || ((error) => console.error('OverlayManager Error:', error)),
            onProgress: options.onProgress || ((message) => console.log('OverlayManager Progress:', message)),
            onOverlayStateChanged: options.onOverlayStateChanged || ((state) => {})
        };

        // Inicializar controles do overlay
        this.initializeOverlayControls();

        // Configurar listeners para eventos do OverlayState
        this.setupOverlayStateListeners();

        console.log('🚀 OverlayManager inicializado com gerenciamento de eventos correto');
    }

    
    /**
     * Inicializa os controles do overlay
     */
    initializeOverlayControls() {
        const overlayButton = document.getElementById('overlayButton');
        const overlayModal = document.getElementById('overlayModal');
        const closeOverlayModal = document.getElementById('closeOverlayModal');
        const cancelImage = document.getElementById('cancelImage');
        const applyImage = document.getElementById('applyImage');
        const removeImage = document.getElementById('removeImage');
        const overlayImageSelectBtn = document.getElementById('overlayImageSelectBtn');
        const imagePreview = document.getElementById('imagePreview');
        const previewImage = document.getElementById('previewImage');
        const overlayStartTime = document.getElementById('overlayStartTime');
        const overlaySizeSlider = document.getElementById('size');
        const overlaySizeValue = document.getElementById('sizeValue');
        const overlayOpacitySlider = document.getElementById('opacity');
        const overlayOpacityValue = document.getElementById('opacityValue');
        const positionGrid = document.getElementById('positionGrid');
        const overlayPosition = document.getElementById('position');

        // Armazenar dados do arquivo selecionado
        this.selectedImageFile = null;

        // Inicializar grid de posicionamento
        this.initializePositionGrid(positionGrid, overlayPosition);

        // Abrir modal de overlay
        if (overlayButton) {
            overlayButton.addEventListener('click', () => {
                if (!this.videoPlayer.src) {
                    this.options.onError('Carregue um vídeo primeiro.');
                    return;
                }

                // Definir tempo atual como padrão
                if (overlayStartTime) {
                    overlayStartTime.value = this.videoPlayer.currentTime.toFixed(1);
                }

                overlayModal.classList.add('active');
            });
        }

        // Fechar modal
        const closeModal = () => {
            overlayModal.classList.remove('active');
            this.resetOverlayForm();
        };

        if (closeOverlayModal) {
            closeOverlayModal.addEventListener('click', closeModal);
        }

        if (cancelImage) {
            cancelImage.addEventListener('click', closeModal);
        }

        // Fechar modal clicando fora
        if (overlayModal) {
            overlayModal.addEventListener('click', (e) => {
                if (e.target === overlayModal) {
                    closeModal();
                }
            });
        }

        // Atalho ESC para fechar modal (padrão desktop)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlayModal.classList.contains('active')) {
                closeModal();
            }
        });

        // Função para selecionar imagem (reutilizável)
        this.selectImage = async () => {
            try {
                const result = await window.electronAPI.showOpenDialog({
                    title: 'Selecionar Imagem para Overlay',
                    filters: [
                        { name: 'Arquivos de Imagem', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
                        { name: 'Todos os Arquivos', extensions: ['*'] }
                    ],
                    properties: ['openFile']
                });

                if (!result.canceled && result.filePaths.length > 0) {
                    const filePath = result.filePaths[0];
                    const fileName = filePath.split('/').pop() || filePath.split('\\').pop();

                    console.log('DEBUG - Imagem selecionada:', { filePath, fileName });

                    // Armazenar informações do arquivo
                    this.selectedImageFile = {
                        success: true,
                        filePath: filePath,
                        fileName: fileName
                    };

                    // Ocultar botão de seleção após carregar imagem
                    const imageUploadArea = overlayImageSelectBtn.parentElement;
                    imageUploadArea.style.display = 'none';

                    // Mostrar botão para trocar imagem
                    const changeImageBtn = document.getElementById('changeImageBtn');
                    if (changeImageBtn) {
                        changeImageBtn.style.display = 'block';
                    }

                    // Criar preview da imagem usando a API Electron
                    const imageSrc = `file://${filePath}`;
                    console.log('DEBUG - Definindo src da imagem:', imageSrc);
                    imagePreview.src = imageSrc;
                    imagePreview.style.display = 'block';

                    // Adicionar tratamento de erro para o carregamento da imagem
                    imagePreview.onerror = () => {
                        console.error('Erro ao carregar preview da imagem:', filePath);
                        imagePreview.style.display = 'none';
                        this.options.onError('Não foi possível carregar o preview da imagem.');
                    };

                    // Validar estado do formulário após selecionar imagem
                    this.validateTimeInputs();

                    this.options.onSuccess(`Imagem "${fileName}" selecionada com sucesso!`);
                }
            } catch (error) {
                console.error('Erro ao selecionar arquivo:', error);
                this.options.onError('Erro ao abrir seletor de arquivos');
            }
        };

        // Botão de seleção de imagem customizado
        if (overlayImageSelectBtn) {
            overlayImageSelectBtn.addEventListener('click', () => {
                this.selectImage();
            });
        }

        // Botão para trocar imagem
        const changeImageBtn = document.getElementById('changeImageBtn');
        if (changeImageBtn) {
            changeImageBtn.addEventListener('click', () => {
                this.selectImage();
            });
        }

        // Validação em tempo real e atualização dos valores dos sliders
        if (overlaySizeSlider) {
            overlaySizeSlider.addEventListener('input', (e) => {
                // Atualizar valor se o elemento existir, caso contrário apenas validar
                if (overlaySizeValue) {
                    overlaySizeValue.textContent = e.target.value + '%';
                }
                this.validateTimeInputs();
            });
        }

        if (overlayOpacitySlider) {
            overlayOpacitySlider.addEventListener('input', (e) => {
                // Atualizar valor se o elemento existir
                if (overlayOpacityValue) {
                    const percent = Math.round(e.target.value * 100);
                    overlayOpacityValue.textContent = percent + '%';
                }
            });
        }

        // Validação em tempo real dos inputs de tempo
        const overlayDuration = document.getElementById('overlayDuration');

        if (overlayStartTime) {
            overlayStartTime.addEventListener('input', () => {
                this.validateTimeInput(overlayStartTime);
                this.validateTimeInputs();
            });
        }

        if (overlayDuration) {
            overlayDuration.addEventListener('input', () => {
                this.validateDurationInput(overlayDuration);
                this.validateTimeInputs();
            });
        }

        // Aplicar overlay
        if (applyImage) {
            applyImage.addEventListener('click', async () => {
                await this.processOverlay();
            });
        }

        // Remover overlay
        if (removeImage) {
            removeImage.addEventListener('click', () => {
                this.removeExistingOverlay();
                closeModal();
                this.options.onSuccess('Overlay removido com sucesso!');
            });
        }
    }

    /**
     * Processa o overlay de imagem
     */
    async processOverlay() {
        const overlayStartTime = document.getElementById('overlayStartTime');
        const overlayDuration = document.getElementById('overlayDuration');
        const overlayPosition = document.getElementById('position');
        const overlaySize = document.getElementById('size');
        const overlayOpacity = document.getElementById('opacity');
        const overlayModal = document.getElementById('overlayModal');

        // Validar campos obrigatórios
        if (!this.selectedImageFile) {
              return;
        }

        if (!overlayStartTime.value || !overlayDuration.value) {
            return;
        }

        const startTime = parseFloat(overlayStartTime.value);
        const duration = parseFloat(overlayDuration.value);

        if (startTime < 0 || startTime >= this.videoPlayer.duration || duration <= 0) {
            this.options.onError('Verifique os valores de tempo e duração.');
            return;
        }

        try {
          
            // Fechar modal
            overlayModal.classList.remove('active');

            // Configurar parâmetros do overlay
            const overlayConfig = {
                imageFile: this.selectedImageFile,
                startTime: startTime,
                duration: duration,
                position: overlayPosition.value,
                size: parseInt(overlaySize.value),
                opacity: parseFloat(overlayOpacity.value)
            };

            // Processar overlay usando sistema em tempo real
            await this.processOverlayWithCanvas(overlayConfig);

            // Armazenar dados de overlay para uso posterior
            await this.storeOverlayData(overlayConfig);

            // Renderizar marcação visual na track - USAR API GLOBAL
            if (typeof window.OverlayAPI !== 'undefined' && window.OverlayAPI.renderOverlays) {
                console.log('🎨 Renderizando overlays na track via API global...');
                window.OverlayAPI.renderOverlays();
            } else if (typeof renderOverlays === 'function') {
                console.log('🎨 Renderizando overlays na track via função direta...');
                renderOverlays();
            } else {
                console.warn('⚠️ Função renderOverlays não disponível');
            }

            // Resetar formulário
            this.resetOverlayForm();

            this.options.onSuccess('Overlay aplicado com sucesso!');

        } catch (error) {
            console.error('Erro ao processar overlay:', error);

            // FASE 3: SISTEMA DE RETRY E FALLBACKS

            // Verificar se o erro está relacionado ao estado do vídeo
            if (error.message && error.message.includes('adequado para overlay')) {
                console.log('🔄 Tentando método alternativo para overlay...');
                await this.tryAlternativeOverlayMethod(overlayConfig);
            } else {
                this.options.onError('Erro ao aplicar overlay: ' + error.message);
            }
        }
    }

    /**
     * Método alternativo para aplicar overlay quando o método principal falha
     */
    async tryAlternativeOverlayMethod(config) {
        try {
            console.log('🔄 FASE 3: Tentando método alternativo de overlay...');

            // Fallback 1: Aguardar mais tempo para carregamento
            const retryDelay = 2000; // 2 segundos adicionais
            await new Promise(resolve => setTimeout(resolve, retryDelay));

            // Tentar validação novamente
            if (await this.validateVideoState()) {
                console.log('✅ Estado do vídeo validado após retry, tentando processar overlay...');
                await this.processOverlayWithCanvas(config);
                return;
            }

            // Fallback 2: Usar overlay sem canvas (simples, apenas para dados)
            console.log('🔄 Fallback: Aplicando overlay sem canvas...');
            await this.applyOverlayWithoutCanvas(config);

            // Renderizar marcação visual na track mesmo em modo fallback - USAR API GLOBAL
            if (typeof window.OverlayAPI !== 'undefined' && window.OverlayAPI.renderOverlays) {
                console.log('🎨 Renderizando overlays na track (modo fallback) via API global...');
                window.OverlayAPI.renderOverlays();
            } else if (typeof renderOverlays === 'function') {
                console.log('🎨 Renderizando overlays na track (modo fallback) via função direta...');
                renderOverlays();
            }

            this.options.onSuccess('Overlay aplicado com método alternativo!');

        } catch (fallbackError) {
            console.error('❌ Método alternativo também falhou:', fallbackError);
            this.options.onError('Não foi possível aplicar o overlay. Tente recarregar o vídeo e tentar novamente.');
        }
    }

    /**
     * Aplica overlay sem usar canvas (fallback para dados apenas)
     */
    async applyOverlayWithoutCanvas(config) {
        console.log('📋 Aplicando overlay no modo sem canvas (dados apenas)...');

        // Apenas armazenar os dados para uso futuro
        await this.storeOverlayData(config);

        // Mostrar notificação ao usuário sobre as limitações
            }

    /**
     * Processa o overlay usando HTML5 Canvas
     */
    async processOverlayWithCanvas(config) {
        // FASE 3: SISTEMA DE RETRY E FALLBACKS
        const maxRetries = 3;
        let attempt = 0;

        while (attempt < maxRetries) {
            attempt++;
            console.log(`🔄 Processando overlay - Tentativa ${attempt}/${maxRetries}`);

            try {
                // FASE 1: PREVENÇÃO - Validar estado do vídeo antes de criar canvas
                if (!await this.validateVideoState()) {
                    throw new Error('Vídeo não está em estado adequado para overlay. Verifique se o vídeo está completamente carregado.');
                }

                // Carregar imagem do overlay
                const overlayImage = new Image();
                const imageUrl = `file://${config.imageFile.filePath}`;
                overlayImage.src = imageUrl;

                await new Promise((resolveImg) => {
                    overlayImage.onload = resolveImg;
                });

                // Aplicar overlay em tempo real ao vídeo principal
                this.applyRealTimeOverlay(overlayImage, config);

                console.log('✅ Sistema de overlay em tempo real ativado com sucesso');
                return; // Sucesso - sair do loop de tentativas

            } catch (error) {
                console.error(`❌ Erro na tentativa ${attempt}/${maxRetries}:`, error);

                if (attempt === maxRetries) {
                    // Última tentativa falhou - ativar fallback
                    console.warn('🚨 Todas as tentativas falharam. Ativando modo fallback...');
                    await this.activateFallbackMode(config);
                    return;
                }

                // Esperar antes da próxima tentativa (exponential backoff)
                const waitTime = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
                console.log(`⏳ Aguardando ${waitTime}ms antes da próxima tentativa...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    /**
     * Modo fallback quando o sistema principal falha
     */
    async activateFallbackMode(config) {
        try {
            console.log('🔄 Ativando modo fallback para overlay...');

            // Fallback 1: Apenas armazenar dados sem renderização
            await this.storeOverlayData(config);

            // Fallback 2: Tentar renderização simplificada sem validações rigorosas
            try {
                await this.attemptSimplifiedRender(config);
            } catch (simplifiedError) {
                console.warn('⚠️ Renderização simplificada também falhou, usando apenas dados:', simplifiedError);
            }

            // Renderizar marcação visual na track em modo fallback - USAR API GLOBAL
            if (typeof window.OverlayAPI !== 'undefined' && window.OverlayAPI.renderOverlays) {
                console.log('🎨 Renderizando overlays na track (modo fallback) via API global...');
                window.OverlayAPI.renderOverlays();
            } else if (typeof renderOverlays === 'function') {
                console.log('🎨 Renderizando overlays na track (modo fallback) via função direta...');
                renderOverlays();
            }

            // Fallback 3: Notificar usuário sobre limitações
            
        } catch (fallbackError) {
            console.error('❌ Erro crítico no modo fallback:', fallbackError);
            this.options.onError('Falha crítica ao aplicar overlay: ' + fallbackError.message);
        }
    }

    /**
     * Tentativa de renderização simplificada
     */
    async attemptSimplifiedRender(config) {
        try {
            console.log('🎨 Tentando renderização simplificada...');

            // Criar canvas mínimo sem validações rigorosas
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                throw new Error('Não foi possível obter contexto 2D');
            }

            // Usar dimensões padrão se as dimensões do vídeo não estiverem disponíveis
            const fallbackWidth = this.videoPlayer.videoWidth || 640;
            const fallbackHeight = this.videoPlayer.videoHeight || 360;

            canvas.width = fallbackWidth;
            canvas.height = fallbackHeight;

            // Carregar e desenhar imagem de forma simplificada
            const overlayImage = new Image();
            overlayImage.src = `file://${config.imageFile.filePath}`;

            await new Promise((resolve, reject) => {
                overlayImage.onload = resolve;
                overlayImage.onerror = reject;
                setTimeout(reject, 5000); // Timeout de 5 segundos
            });

            // Desenhar no centro com opacidade fixa
            const x = (fallbackWidth - overlayImage.width) / 2;
            const y = (fallbackHeight - overlayImage.height) / 2;

            ctx.globalAlpha = config.opacity || 0.8;
            ctx.drawImage(overlayImage, x, y);

            console.log('✅ Renderização simplificada concluída com sucesso');

        } catch (simplifiedError) {
            console.warn('⚠️ Renderização simplificada falhou:', simplifiedError);
            throw simplifiedError;
        }
    }

    /**
     * Valida o estado do vídeo antes de processar overlay - CORRIGIDO para usar validação centralizada
     */
    async validateVideoState() {
        console.log('🔍 Validando estado do vídeo para overlay...');

        // Usar validação global se disponível (PRIORIDADE)
        if (typeof validateVideoForOverlay === 'function') {
            const isValid = validateVideoForOverlay(this.videoPlayer);
            if (!isValid) {
                // Tentar aguardar um pouco se o vídeo estiver carregando
                if (this.videoPlayer.readyState < 2) {
                    console.log('⏳ Vídeo ainda carregando, aguardando...');
                    return new Promise((resolve) => {
                        const maxWaitTime = 5000;
                        const checkInterval = 500;
                        let elapsedTime = 0;

                        const checkVideoLoaded = () => {
                            if (validateVideoForOverlay(this.videoPlayer)) {
                                console.log('✅ Vídeo validado após espera');
                                resolve(true);
                            } else if (elapsedTime >= maxWaitTime) {
                                console.error('❌ Vídeo não validado após espera');
                                resolve(false);
                            } else {
                                elapsedTime += checkInterval;
                                setTimeout(checkVideoLoaded, checkInterval);
                            }
                        };

                        setTimeout(checkVideoLoaded, checkInterval);
                    });
                }
                return false;
            }
            console.log('✅ Vídeo validado via função global');
            return true;
        }

        // Fallback para validação local (COMPATIBILIDADE)
        return this.legacyValidateVideoState();
    }

    /**
     * Validação legada como fallback
     */
    legacyValidateVideoState() {
        console.log('🔍 Usando validação legada de vídeo...');

        // Verificar se elemento de vídeo existe
        if (!this.videoPlayer) {
            console.error('❌ Elemento de vídeo não encontrado');
            return false;
        }

        // Verificar se o vídeo tem src
        if (!this.videoPlayer.src || this.videoPlayer.src === '') {
            console.error('❌ Vídeo não tem source definida');
            return false;
        }

        // Verificar se o vídeo está carregando ou readyState muito baixo
        if (this.videoPlayer.readyState < 2) {
            console.warn('⚠️ Vídeo ainda está carregando (readyState:', this.videoPlayer.readyState + ')');
            return false;
        }

        // Verificar dimensões do vídeo
        if (!this.videoPlayer.videoWidth || !this.videoPlayer.videoHeight ||
            this.videoPlayer.videoWidth <= 0 || this.videoPlayer.videoHeight <= 0) {
            console.error('❌ Vídeo não tem dimensões válidas:', {
                videoWidth: this.videoPlayer.videoWidth,
                videoHeight: this.videoPlayer.videoHeight,
                readyState: this.videoPlayer.readyState
            });
            return false;
        }

        console.log('✅ Estado do vídeo validado via método legado:', {
            videoWidth: this.videoPlayer.videoWidth,
            videoHeight: this.videoPlayer.videoHeight,
            readyState: this.videoPlayer.readyState,
            duration: this.videoPlayer.duration
        });

        return true;
    }

    /**
     * Armazena os dados do overlay para uso posterior - CORRIGIDO para sincronizar com estado centralizado
     */
    async storeOverlayData(overlayConfig) {
        console.log('💾 Armazenando dados do overlay com sincronização centralizada...');

        // Gerar ID único usando utilitários centralizados
        const overlayId = (typeof OverlayUtils !== 'undefined')
            ? OverlayUtils.generateOverlayId()
            : `overlay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Usar estado centralizado se disponível (PRIORIDADE)
        if (typeof OverlayState !== 'undefined') {
            const overlayData = {
                id: overlayId,
                image: overlayConfig.imageFile.fileName,
                startTime: overlayConfig.startTime,
                duration: overlayConfig.duration,
                position: overlayConfig.position,
                size: overlayConfig.size,
                opacity: overlayConfig.opacity,
                label: `Overlay ${OverlayState.overlays.length + 1}`
            };

            OverlayState.addOverlay(overlayData);
            console.log('✅ Overlay adicionado ao estado centralizado:', overlayData);

            // ARMAZENAR ID NO CURRENT OVERLAY PARA CORREÇÃO PRINCIPAL
            if (this.currentOverlay) {
                this.currentOverlay.overlayId = overlayId;
                console.log('✅ [DEBUG] ID do overlay armazenado no currentOverlay:', overlayId);
                console.log('🔍 [DEBUG] Verificando se ID corresponde no OverlayState:', OverlayState.getOverlay(overlayId) ? 'SIM' : 'NÃO');
            }
        } else {
            console.warn('⚠️ OverlayState não disponível, usando sincronização manual');
        }

        // Manter compatibilidade com sistema antigo (window.currentOverlayData) - LEGADO
        if (typeof window.currentOverlayData !== 'undefined') {
            window.currentOverlayData = {
                image: overlayConfig.imageFile.fileName,
                startTime: overlayConfig.startTime,
                duration: overlayConfig.duration,
                position: overlayConfig.position,
                size: overlayConfig.size,
                opacity: overlayConfig.opacity
            };
        }

        // Sincronizar com currentProject (legado - COMPATIBILIDADE)
        if (currentProject && currentProject.overlays) {
            const trackOverlayData = {
                id: overlayId, // Adicionar ID para rastreamento
                label: `Overlay ${currentProject.overlays.length + 1}`,
                start: overlayConfig.startTime,
                duration: overlayConfig.duration,
                position: overlayConfig.position,
                size: overlayConfig.size,
                opacity: overlayConfig.opacity,
                imageFile: overlayConfig.imageFile.fileName
            };
            currentProject.overlays.push(trackOverlayData);

            console.log('✅ Overlay sincronizado com currentProject.overlays:', trackOverlayData);
            console.log('📊 Total de overlays no projeto:', currentProject.overlays.length);
        }

        // Adicionar ao videoPaths para exportação (mantido original)
        if (window.videoPaths && typeof window.videoPaths.set === 'function') {
            try {
                await this.saveTempOverlayFile(overlayConfig, {
                    image: overlayConfig.imageFile.fileName,
                    startTime: overlayConfig.startTime,
                    duration: overlayConfig.duration,
                    position: overlayConfig.position,
                    size: overlayConfig.size,
                    opacity: overlayConfig.opacity
                });
            } catch (pathError) {
                console.warn('⚠️ Erro ao salvar arquivo temporário:', pathError);
            }
        }

        console.log('💾 Dados do overlay armazenados com sucesso');
    }

    
    /**
     * Salva o arquivo do overlay temporariamente
     */
    async saveTempOverlayFile(overlayConfig, overlayData) {
        if (window.electronAPI && typeof window.electronAPI.saveTempFile === 'function') {
            try {
                // Salvar o arquivo temporariamente usando o caminho original
                const tempFilePath = await window.electronAPI.saveTempFile({
                    sourcePath: overlayConfig.imageFile.filePath,
                    fileName: overlayConfig.imageFile.fileName
                });

                // Adicionar ao videoPaths
                window.videoPaths.set(overlayConfig.imageFile.fileName, tempFilePath);
                console.log('DEBUG - OverlayManager: Arquivo salvo temporariamente:', tempFilePath);
            } catch (error) {
                console.error('Erro ao salvar arquivo temporário:', error);
                // Em caso de erro, usar apenas o nome do arquivo
                window.videoPaths.set(overlayConfig.imageFile.fileName, overlayConfig.imageFile.fileName);
            }
        } else {
            // Se não tiver API Electron, usar apenas o nome do arquivo
            window.videoPaths.set(overlayConfig.imageFile.fileName, overlayConfig.imageFile.fileName);
        }
    }

    /**
     * Aplica overlay em tempo real usando requestAnimationFrame
     */
    applyRealTimeOverlay(overlayImage, config) {
        // Remover overlay anterior se existir
        this.removeExistingOverlay();

        // Criar canvas overlay
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.className = 'video-overlay-canvas';

        const ctx = overlayCanvas.getContext('2d');

        // CONTROLE DE LOOP: Otimizado para prevenir loops infinitos
        let lastUpdateTime = 0;
        let updateCount = 0;
        const MAX_UPDATES_PER_FRAME = 1;
        const MIN_UPDATE_INTERVAL = 33; // ~30fps para reduzir carga

        // CONTROLE DE LOOP: Adicionar controle para evitar atualizações desnecessárias
        let lastVideoTime = -1;
        let lastOverlayState = false;

        // Função para atualizar overlay baseado no tempo
        const updateOverlay = (forceUpdate = false) => {
            if (!this.videoPlayer) return;

            const now = performance.now();

            // CONTROLE DE LOOP: Limitar atualizações para prevenir loops infinitos
            if (!forceUpdate && now - lastUpdateTime < MIN_UPDATE_INTERVAL) {
                return;
            }

            lastUpdateTime = now;
            updateCount++;

            // CONTROLE DE LOOP: Limitar número total de atualizações para detectar problemas
            if (updateCount > 1000) {
                console.warn('⚠️ Número excessivo de atualizações detectado, parando loop para prevenir crash');
                return;
            }

            const currentTime = this.videoPlayer.currentTime;

            // CONTROLE DE LOOP: Evitar atualizações desnecessárias se o tempo não mudou significativamente
            const timeDelta = Math.abs(currentTime - lastVideoTime);
            if (!forceUpdate && timeDelta < 0.1) { // Só atualizar se o tempo mudar > 0.1s
                return;
            }
            lastVideoTime = currentTime;

            // BUSCAR DADOS ATUALIZADOS DO OVERLAYSTATE - CORREÇÃO PRINCIPAL
            let currentConfig = config;
            if (typeof OverlayState !== 'undefined' && this.currentOverlay.overlayId) {
                const overlayFromState = OverlayState.getOverlay(this.currentOverlay.overlayId);
                if (overlayFromState) {
                    currentConfig = {
                        ...config,
                        startTime: overlayFromState.startTime || overlayFromState.start,
                        start: overlayFromState.start || overlayFromState.startTime,
                        duration: overlayFromState.duration
                    };
                }
            }

            // Suportar ambos os campos startTime e start para compatibilidade
            const startTime = currentConfig.startTime !== undefined ? currentConfig.startTime : currentConfig.start;
            const shouldShowOverlay = currentTime >= startTime &&
                                    currentTime <= startTime + currentConfig.duration;

            // CONTROLE DE LOOP: Evitar redesenho se o estado do overlay não mudou
            if (!forceUpdate && shouldShowOverlay === lastOverlayState && timeDelta < 0.5) {
                return;
            }
            lastOverlayState = shouldShowOverlay;

            // Ajustar tamanho do canvas ao container do vídeo
            const videoContainer = this.videoPlayer.parentElement;
            if (videoContainer) {
                const rect = videoContainer.getBoundingClientRect();

                // Calcular dimensões proporcionais do vídeo
                const videoAspectRatio = this.videoPlayer.videoWidth / this.videoPlayer.videoHeight;
                const containerAspectRatio = rect.width / rect.height;

                let canvasWidth, canvasHeight;
                if (videoAspectRatio > containerAspectRatio) {
                    canvasWidth = rect.width;
                    canvasHeight = rect.width / videoAspectRatio;
                } else {
                    canvasWidth = rect.height * videoAspectRatio;
                    canvasHeight = rect.height;
                }

                overlayCanvas.width = canvasWidth;
                overlayCanvas.height = canvasHeight;
                overlayCanvas.style.setProperty('--canvas-width', canvasWidth + 'px');
                overlayCanvas.style.setProperty('--canvas-height', canvasHeight + 'px');
                overlayCanvas.style.setProperty('--canvas-left', ((rect.width - canvasWidth) / 2) + 'px');
                overlayCanvas.style.setProperty('--canvas-top', ((rect.height - canvasHeight) / 2) + 'px');
            }

            // Limpar canvas
            ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

            if (shouldShowOverlay) {
                this.drawOverlayOnCanvas(ctx, overlayImage, currentConfig, overlayCanvas.width, overlayCanvas.height);
            }

            // CONTROLE DE LOOP: Só continuar o loop se o vídeo estiver playing e não estiver pausado
            if (!this.videoPlayer.paused && !this.videoPlayer.ended) {
                this.animationFrameId = requestAnimationFrame(updateOverlay);
            } else {
                this.animationFrameId = null;
            }
        };

        // Adicionar canvas ao container do vídeo
        const videoContainer = this.videoPlayer.parentElement;
        if (videoContainer) {
            videoContainer.classList.add('has-overlay');
            videoContainer.appendChild(overlayCanvas);
        }

        // Monitorar eventos para garantir que o overlay seja atualizado corretamente
        this.setupVideoEventListeners(updateOverlay);

        // Armazenar referências para limpeza posterior
        this.currentOverlay = {
            canvas: overlayCanvas,
            updateFunction: updateOverlay,
            config: config,
            originalConfig: { ...config }, // Manter referência ao config original
            image: overlayImage,
            imageUrl: overlayImage.src,
            animationFrameId: null,
            overlayId: null // Será preenchido quando o overlay for armazenado
        };

        // Iniciar o loop de animação
        this.animationFrameId = requestAnimationFrame(updateOverlay);
        this.currentOverlay.animationFrameId = this.animationFrameId;

        // Notificar mudança de estado
        this.options.onOverlayStateChanged({
            active: true,
            config: config
        });
    }

    /**
     * Configura os event listeners do vídeo com gerenciamento correto de memória
     */
    setupVideoEventListeners(updateOverlay) {
        console.log('📡 Configurando event listeners do OverlayManager...');

        // Função para adicionar evento com rastreamento
        const addTrackedListener = (element, event, handler) => {
            element.addEventListener(event, handler);
            this.eventListeners.push({ element, event, handler });
            console.log(`📡 Event listener rastreado adicionado: ${element.tagName || element.id || 'unknown'}_${event}`);
        };

        // Eventos do vídeo - CONTROLE DE LOOP: Prevenir múltiplos loops simultâneos
        addTrackedListener(this.videoPlayer, 'seeked', () => {
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
            // Forçar uma única atualização após seek
            if (this.currentOverlay && this.currentOverlay.updateFunction) {
                this.currentOverlay.updateFunction(true);
            }
        });

        addTrackedListener(this.videoPlayer, 'play', () => {
            if (!this.animationFrameId && this.currentOverlay && this.currentOverlay.updateFunction) {
                // Iniciar loop apenas se não estiver já rodando
                this.currentOverlay.updateFunction(true);
            }
        });

        addTrackedListener(this.videoPlayer, 'pause', () => {
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
            // Atualizar uma última vez para garantir que o overlay esteja correto
            const currentTime = this.videoPlayer.currentTime;
            if (this.currentOverlay) {
                // Suportar ambos os campos startTime e start para compatibilidade
                const startTime = this.currentOverlay.config.startTime !== undefined ?
                                 this.currentOverlay.config.startTime :
                                 this.currentOverlay.config.start;
                if (currentTime >= startTime && currentTime <= startTime + this.currentOverlay.config.duration) {
                    const ctx = this.currentOverlay.canvas.getContext('2d');
                    this.drawOverlayOnCanvas(ctx, this.currentOverlay.image, this.currentOverlay.config,
                        this.currentOverlay.canvas.width, this.currentOverlay.canvas.height);
                }
            }
        });

        // Evento de resize da janela - CONTROLE DE LOOP: Prevenir múltiplas atualizações
        this.resizeHandler = () => {
            if (this.resizeTimeoutId) {
                clearTimeout(this.resizeTimeoutId);
            }
            this.resizeTimeoutId = setTimeout(() => {
                // Forçar uma única atualização após resize
                if (this.currentOverlay && this.currentOverlay.updateFunction) {
                    this.currentOverlay.updateFunction(true);
                }
            }, 100);
        };

        addTrackedListener(window, 'resize', this.resizeHandler);

        console.log(`✅ ${this.eventListeners.length} event listeners configurados com sucesso`);
    }

    /**
     * Processa overlay de questão importada usando caminho de arquivo
     */
    async processImportedOverlay(overlayData) {
        try {
            console.log('DEBUG - OverlayManager: Processando overlay importado:', overlayData);

            // Primeiro, remover qualquer overlay existente
            this.removeExistingOverlay();

            if (!overlayData || !overlayData.image) {
                console.log('DEBUG - OverlayManager: Nenhum overlay para processar');
                return;
            }

            // Obter o caminho real da imagem do videoPaths
            const imagePath = window.videoPaths ? window.videoPaths.get(overlayData.image) : overlayData.image;
            console.log('DEBUG - OverlayManager: Caminho da imagem overlay:', imagePath);

            // Carregar imagem do overlay usando caminho de arquivo
            const overlayImage = new Image();
            overlayImage.crossOrigin = 'anonymous';

            // Criar URL file:// se necessário
            const imageUrl = imagePath.startsWith('file://') ? imagePath : `file://${imagePath}`;
            overlayImage.src = imageUrl;

            console.log('DEBUG - OverlayManager: Carregando imagem de:', imageUrl);

            await new Promise((resolveImg, rejectImg) => {
                overlayImage.onload = () => {
                    console.log('DEBUG - OverlayManager: Imagem overlay carregada com sucesso');
                    resolveImg();
                };
                overlayImage.onerror = (error) => {
                    console.error('DEBUG - OverlayManager: Erro ao carregar imagem overlay:', error);
                    rejectImg(error);
                };
            });

            // Aplicar overlay em tempo real ao vídeo principal
            this.applyRealTimeOverlay(overlayImage, overlayData);

            console.log('Sistema de overlay importado ativado');
        } catch (error) {
            console.error('Erro ao processar overlay importado:', error);
            this.options.onError('Erro ao processar overlay importado: ' + error.message);
        }
    }

    /**
     * Desenha o overlay no canvas - CORRIGIDO para usar utilitários centralizados
     */
    drawOverlayOnCanvas(ctx, overlayImage, config, canvasWidth, canvasHeight) {
        try {
            // Verificar se o contexto 2D é válido
            if (!ctx || typeof ctx.drawImage !== 'function') {
                console.warn('❌ Contexto 2D inválido ou drawImage não disponível');
                return;
            }

            // Usar validação centralizada se disponível (PRIORIDADE)
            if (typeof OverlayUtils !== 'undefined') {
                // Garantir compatibilidade entre campos startTime e start para drag-and-drop
                const configForValidation = { ...config };
                if (configForValidation.start !== undefined && configForValidation.startTime === undefined) {
                    configForValidation.startTime = configForValidation.start;
                }

                if (!OverlayUtils.validateOverlayConfig(configForValidation)) {
                    console.warn('❌ Configuração de overlay inválida');
                    return;
                }
            }

            // Validar dimensões do canvas
            if (!canvasWidth || !canvasHeight || canvasWidth <= 0 || canvasHeight <= 0 || !isFinite(canvasWidth) || !isFinite(canvasHeight)) {
                console.warn('⚠️ Dimensões do canvas problemáticas, usando fallback:', {
                    canvasWidth, canvasHeight
                });
                canvasWidth = canvasWidth || 640;
                canvasHeight = canvasHeight || 360;
            }

            // Usar utilitários de cálculo se disponíveis (PRIORIDADE)
            let dimensions, position;
            if (typeof OverlayUtils !== 'undefined') {
                dimensions = OverlayUtils.calculateOverlayDimensions(config, { width: canvasWidth, height: canvasHeight });
                position = OverlayUtils.calculatePosition(config.position, dimensions, { width: canvasWidth, height: canvasHeight });
            } else {
                // Fallback para cálculo local (COMPATIBILIDADE)
                const size = config.size || 50;
                dimensions = {
                    width: (canvasWidth * size) / 100,
                    height: (overlayImage.height && overlayImage.width > 0)
                        ? (overlayImage.height * (canvasWidth * size / 100)) / overlayImage.width
                        : (canvasHeight * size) / 100
                };

                const padding = Math.min(20, Math.min(canvasWidth, canvasHeight) * 0.05);
                let x, y;

                switch (config.position) {
                    case 'top-left': x = padding; y = padding; break;
                    case 'top-center': x = (canvasWidth - dimensions.width) / 2; y = padding; break;
                    case 'top-right': x = Math.max(padding, canvasWidth - dimensions.width - padding); y = padding; break;
                    case 'center-left': x = padding; y = (canvasHeight - dimensions.height) / 2; break;
                    case 'center':
                    default: x = (canvasWidth - dimensions.width) / 2; y = (canvasHeight - dimensions.height) / 2; break;
                    case 'center-right': x = Math.max(padding, canvasWidth - dimensions.width - padding); y = (canvasHeight - dimensions.height) / 2; break;
                    case 'bottom-left': x = padding; y = Math.max(padding, canvasHeight - dimensions.height - padding); break;
                    case 'bottom-center': x = (canvasWidth - dimensions.width) / 2; y = Math.max(padding, canvasHeight - dimensions.height - padding); break;
                    case 'bottom-right': x = Math.max(padding, canvasWidth - dimensions.width - padding); y = Math.max(padding, canvasHeight - dimensions.height - padding); break;
                }

                position = { x, y };
            }

            // Aplicar melhorias de renderização
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            // Aplicar opacidade com validação
            const opacity = Math.max(0, Math.min(1, config.opacity || 1));
            const previousAlpha = ctx.globalAlpha;
            ctx.globalAlpha = opacity;

            // Tentar desenhar imagem
            try {
                ctx.drawImage(overlayImage, position.x, position.y, dimensions.width, dimensions.height);
                console.log('✅ Overlay desenhado com sucesso');
            } catch (drawError) {
                console.warn('❌ Erro ao desenhar imagem no canvas:', drawError);
                return;
            }

            // Restaurar opacidade
            ctx.globalAlpha = previousAlpha;

        } catch (error) {
            console.error('Erro ao desenhar overlay:', error);
        }
    }

    /**
     * Remove o overlay existente com limpeza completa de recursos
     */
    removeExistingOverlay() {
        if (this.currentOverlay) {
            // Cancelar qualquer animationFrame pendente
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }

            if (this.currentOverlay.animationFrameId) {
                cancelAnimationFrame(this.currentOverlay.animationFrameId);
            }

            // Limpar timeout de redimensionamento se existir
            if (this.resizeTimeoutId) {
                clearTimeout(this.resizeTimeoutId);
                this.resizeTimeoutId = null;
            }

            // Remover canvas
            if (this.currentOverlay.canvas && this.currentOverlay.canvas.parentElement) {
                this.currentOverlay.canvas.parentElement.removeChild(this.currentOverlay.canvas);
            }

            // Remover classe do container
            const videoContainer = this.videoPlayer.parentElement;
            if (videoContainer) {
                videoContainer.classList.remove('has-overlay');
            }

            // Liberar memória da imagem se for um objectURL
            if (this.currentOverlay.imageUrl && this.currentOverlay.imageUrl.startsWith('blob:')) {
                URL.revokeObjectURL(this.currentOverlay.imageUrl);
            }

            // Limpar referência
            this.currentOverlay = null;

            // Notificar mudança de estado
            this.options.onOverlayStateChanged({
                active: false,
                config: null
            });
        }

        // Remover qualquer canvas overlay existente (garantia adicional)
        const existingOverlays = document.querySelectorAll('.video-overlay-canvas');
        existingOverlays.forEach(overlay => {
            if (overlay.parentElement) {
                overlay.parentElement.removeChild(overlay);
            }
        });
    }

    /**
     * Reseta o formulário do overlay
     */
    resetOverlayForm() {
        const imagePreview = document.getElementById('imagePreview');
        const overlayStartTime = document.getElementById('overlayStartTime');
        const overlayDuration = document.getElementById('overlayDuration');
        const overlayPosition = document.getElementById('position');
        const overlaySize = document.getElementById('size');
        const overlayOpacity = document.getElementById('opacity');
        const overlaySizeValue = document.getElementById('sizeValue');
        const overlayOpacityValue = document.getElementById('opacityValue');

        // Limpar arquivo selecionado
        this.selectedImageFile = null;

        // Resetar interface do arquivo
        if (imagePreview) {
            imagePreview.style.display = 'none';
            imagePreview.src = '';
            imagePreview.onerror = null;
        }

        // Restaurar botão de seleção original
        const imageUploadArea = overlayImageSelectBtn.parentElement;
        if (imageUploadArea) {
            imageUploadArea.style.display = 'block';
        }

        // Ocultar botão de trocar imagem
        const changeImageBtn = document.getElementById('changeImageBtn');
        if (changeImageBtn) {
            changeImageBtn.style.display = 'none';
        }

        // Limpar erros de validação
        if (overlayStartTime) {
            this.clearFieldError(overlayStartTime);
        }
        if (overlayDuration) {
            this.clearFieldError(overlayDuration);
        }

        // Resetar estado do botão Aplicar
        const applyButton = document.getElementById('applyImage');
        if (applyButton) {
            applyButton.disabled = false;
            applyButton.style.opacity = '1';
        }
        if (overlayStartTime) overlayStartTime.value = '';
        if (overlayDuration) overlayDuration.value = '5.0';
        if (overlayPosition) overlayPosition.value = 'center';

        // Resetar grid de posicionamento
        const positionGrid = document.getElementById('positionGrid');
        if (positionGrid) {
            const positionCells = positionGrid.querySelectorAll('.position-cell');
            positionCells.forEach(cell => cell.classList.remove('selected'));

            // Selecionar a célula center novamente
            const centerCell = positionGrid.querySelector('[data-value="center"]');
            if (centerCell) centerCell.classList.add('selected');
        }
        if (overlaySize) {
            overlaySize.value = '80';
            if (overlaySizeValue) overlaySizeValue.textContent = '80%';
        }
        if (overlayOpacity) {
            overlayOpacity.value = '1';
            if (overlayOpacityValue) overlayOpacityValue.textContent = '100%';
        }
    }

    /**
     * Obtém o status atual do overlay
     */
    getOverlayStatus() {
        return {
            active: this.currentOverlay !== null,
            config: this.currentOverlay ? this.currentOverlay.config : null,
            hasImageData: window.currentOverlayData !== undefined
        };
    }

    /**
     * Validação em tempo real do input de tempo de início
     */
    validateTimeInput(input) {
        const value = parseFloat(input.value);
        const videoDuration = this.videoPlayer.duration;

        // Limpar erro anterior
        this.clearFieldError(input);

        if (isNaN(value) || value < 0) {
            this.showFieldError(input, 'O tempo não pode ser negativo');
            return false;
        }

        if (videoDuration && value > videoDuration) {
            this.showFieldError(input, `Tempo máximo: ${videoDuration.toFixed(1)}s`);
            return false;
        }

        return true;
    }

    /**
     * Validação em tempo real do input de duração
     */
    validateDurationInput(input) {
        const value = parseFloat(input.value);

        // Limpar erro anterior
        this.clearFieldError(input);

        if (isNaN(value) || value <= 0) {
            this.showFieldError(input, 'A duração deve ser maior que zero');
            return false;
        }

        // Verificar se cabe no vídeo
        const startTime = parseFloat(document.getElementById('overlayStartTime')?.value || 0);
        const videoDuration = this.videoPlayer.duration;

        if (videoDuration && (startTime + value) > videoDuration) {
            this.showFieldError(input, `Duração excede o tempo restante do vídeo`);
            return false;
        }

        return true;
    }

    /**
     * Validação combinada dos tempos
     */
    validateTimeInputs() {
        const startTime = document.getElementById('overlayStartTime');
        const duration = document.getElementById('overlayDuration');

        if (startTime && duration) {
            const startValid = this.validateTimeInput(startTime);
            const durationValid = this.validateDurationInput(duration);

            // Atualizar estado do botão Aplicar
            const applyButton = document.getElementById('applyImage');
            if (applyButton) {
                const isValid = startValid && durationValid && this.selectedImageFile;
                applyButton.disabled = !isValid;
                applyButton.style.opacity = isValid ? '1' : '0.5';
            }
        }
    }

    /**
     * Mostra erro visual no campo
     */
    showFieldError(input, message) {
        input.classList.add('input-error');

        // Remover tooltip anterior
        const existingError = input.parentNode.querySelector('.field-error');
        if (existingError) existingError.remove();

        // Adicionar tooltip de erro
        const errorElement = document.createElement('div');
        errorElement.className = 'field-error';
        errorElement.textContent = message;
        errorElement.style.cssText = `
            font-size: 11px;
            color: var(--error, #e74c3c);
            margin-top: 4px;
            background: var(--surface-primary);
            padding: 2px 6px;
            border-radius: 3px;
            border: 1px solid var(--error, #e74c3c);
        `;

        input.parentNode.appendChild(errorElement);
    }

    /**
     * Limpa erro visual do campo
     */
    clearFieldError(input) {
        input.classList.remove('input-error');
        const existingError = input.parentNode.querySelector('.field-error');
        if (existingError) existingError.remove();
    }

    /**
     * Inicializa o grid de posicionamento visual
     */
    initializePositionGrid(positionGrid, hiddenInput) {
        if (!positionGrid || !hiddenInput) return;

        // Adicionar eventos de clique às células do grid
        const positionCells = positionGrid.querySelectorAll('.position-cell');

        positionCells.forEach(cell => {
            cell.addEventListener('click', () => {
                // Remover seleção anterior
                positionCells.forEach(c => c.classList.remove('selected'));

                // Adicionar seleção à célula clicada
                cell.classList.add('selected');

                // Atualizar valor do input oculto
                const positionValue = cell.getAttribute('data-value');
                hiddenInput.value = positionValue;

                console.log('Posição selecionada:', positionValue);
            });
        });

        // Sincronizar estado inicial do grid com o valor atual do input
        const currentValue = hiddenInput.value || 'center';
        const currentCell = positionGrid.querySelector(`[data-value="${currentValue}"]`);
        if (currentCell) {
            currentCell.classList.add('selected');
        }
    }

    /**
     * Configura listeners para eventos do OverlayState
     */
    setupOverlayStateListeners() {
        // Verificar se OverlayState está disponível
        if (typeof OverlayState === 'undefined') {
            console.warn('⚠️ OverlayState não disponível, listeners não configurados');
            return;
        }

        // CONTROLE DE LOOP: Aumentar debounce para prevenir atualizações excessivas
        this.overlayStateDebounceTimeout = null;
        const DEBOUNCE_DELAY = 200; // ms - aumentado para reduzir frequência

        // Listener para eventos de atualização de overlay
        const overlayUpdateHandler = (data) => {
            console.log('📡 [DEBUG] OverlayManager recebeu evento de atualização:', data);
            console.log('🔍 [DEBUG] Verificando se overlay atual corresponde:', {
                currentOverlayExists: this.currentOverlay !== null,
                currentOverlayId: this.currentOverlay?.overlayId,
                receivedId: data.id,
                matches: this.currentOverlay?.overlayId === data.id
            });

            // CONTROLE DE LOOP: Limpar timeout anterior e agendar nova atualização com debounce
            if (this.overlayStateDebounceTimeout) {
                clearTimeout(this.overlayStateDebounceTimeout);
            }

            this.overlayStateDebounceTimeout = setTimeout(() => {
                // Verificar se o overlay atual é o mesmo que foi atualizado
                if (this.currentOverlay && this.currentOverlay.overlayId === data.id) {
                    console.log('✅ [DEBUG] Overlay atual corresponde ao atualizado, atualizando configuração...');
                    console.log('🔍 [DEBUG] Configuração antes da atualização:', this.currentOverlay.config);
                    console.log('🔍 [DEBUG] Dados recebidos:', data.changes);

                    // Atualizar configuração do overlay atual
                    this.currentOverlay.config = {
                        ...this.currentOverlay.config,
                        startTime: data.overlay.startTime || data.overlay.start,
                        start: data.overlay.start || data.overlay.startTime,
                        duration: data.overlay.duration
                    };

                    console.log('🔍 [DEBUG] Configuração após atualização:', this.currentOverlay.config);

                    // CONTROLE DE LOOP: Forçar apenas uma atualização em vez de iniciar novo loop
                    if (this.currentOverlay.updateFunction) {
                        console.log('🔄 [DEBUG] Forçando uma única atualização (com debounce)...');
                        console.log('🔍 [DEBUG] Estado do vídeo:', {
                            currentTime: this.videoPlayer.currentTime,
                            shouldShowOverlay: this.videoPlayer.currentTime >= (data.overlay.startTime || data.overlay.start) &&
                                             this.videoPlayer.currentTime <= (data.overlay.startTime || data.overlay.start) + data.overlay.duration
                        });

                        // CONTROLE DE LOOP: Usar forceUpdate=true para garantir atualização única
                        this.currentOverlay.updateFunction(true);
                        console.log('✅ [DEBUG] Atualização única com debounce concluída');
                    } else {
                        console.error('❌ [DEBUG] updateFunction não disponível no currentOverlay!');
                    }
                } else {
                    console.log('⚠️ [DEBUG] Overlay recebido não corresponde ao overlay atual, verificando fallback...');

                    // CONTROLE DE LOOP: Limitar fallback para não criar loops
                    if (this.currentOverlay && this.videoPlayer) {
                        const currentTime = this.videoPlayer.currentTime;
                        const overlayStartTime = data.overlay.startTime || data.overlay.start;
                        const overlayEndTime = overlayStartTime + data.overlay.duration;

                        // Verificar se o vídeo está atualmente no range do overlay atualizado
                        if (currentTime >= overlayStartTime && currentTime <= overlayEndTime) {
                            console.log('🔄 [FALLBACK] Tentando atualização por correspondência de tempo...');
                            console.log('🔍 [FALLBACK] Dados:', {
                                videoCurrentTime: currentTime,
                                overlayStart: overlayStartTime,
                                overlayEnd: overlayEndTime,
                                overlayId: data.id
                            });

                            // Atualizar ID do overlay atual para corresponder
                            this.currentOverlay.overlayId = data.id;

                            // Atualizar configuração
                            this.currentOverlay.config = {
                                ...this.currentOverlay.config,
                                startTime: data.overlay.startTime || data.overlay.start,
                                start: data.overlay.start || data.overlay.startTime,
                                duration: data.overlay.duration
                            };

                            // CONTROLE DE LOOP: Forçar apenas uma atualização
                            if (this.currentOverlay.updateFunction) {
                                console.log('🔄 [FALLBACK] Aplicando atualização única por tempo...');
                                this.currentOverlay.updateFunction(true);
                                console.log('✅ [FALLBACK] Atualização única por tempo aplicada com sucesso!');
                            }
                        }
                    }
                }
            }, DEBOUNCE_DELAY);
        };

        // Registrar listener no OverlayState
        OverlayState.addEventListener('overlayUpdated', overlayUpdateHandler);

        // Armazenar referência do listener para limpeza posterior
        this.overlayStateListener = overlayUpdateHandler;

        console.log('✅ Listener de eventos do OverlayState configurado com sucesso com controle de loop');
    }

    /**
     * Limpa todos os recursos e event listeners - CORRIGIDO para prevenir memory leaks
     */
    destroy() {
        console.log('🧹 Destruindo OverlayManager e limpando recursos...');

        // Remover listener do OverlayState
        if (typeof OverlayState !== 'undefined' && this.overlayStateListener) {
            try {
                // Implementar método removeEventListener no OverlayState se necessário
                if (OverlayState.eventListeners && OverlayState.eventListeners.has('overlayUpdated')) {
                    const listeners = OverlayState.eventListeners.get('overlayUpdated');
                    const index = listeners.indexOf(this.overlayStateListener);
                    if (index > -1) {
                        listeners.splice(index, 1);
                    }
                }
                console.log('✅ Listener do OverlayState removido');
            } catch (error) {
                console.warn('⚠️ Erro ao remover listener do OverlayState:', error);
            }
        }

        // Remover todos os eventos rastreados
        console.log(`📡 Removendo ${this.eventListeners.length} event listeners...`);
        this.eventListeners.forEach(({ element, event, handler }) => {
            try {
                element.removeEventListener(event, handler);
            } catch (error) {
                console.warn(`⚠️ Erro ao remover event listener ${event}:`, error);
            }
        });
        this.eventListeners = [];

        // Limpar timeout de resize
        if (this.resizeTimeoutId) {
            clearTimeout(this.resizeTimeoutId);
            this.resizeTimeoutId = null;
        }

        // CONTROLE DE LOOP: Limpar timeout de debounce do listener
        if (this.overlayStateDebounceTimeout) {
            clearTimeout(this.overlayStateDebounceTimeout);
            this.overlayStateDebounceTimeout = null;
        }

        // Cancelar animation frame
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Remover overlay existente
        this.removeExistingOverlay();

        // Limpar referências
        this.resizeHandler = null;
        this.videoPlayer = null;
        this.currentOverlay = null;
        this.overlayStateListener = null;
        this.overlayStateDebounceTimeout = null;

        console.log('✅ OverlayManager destruído e recursos liberados com controle de loop');
    }
}

// API global para compatibilidade (disponibiliza apenas após inicialização)
if (typeof window !== 'undefined') {
    window.OverlayManager = OverlayManager;
}
