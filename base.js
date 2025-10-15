/**
 * =================================================================================
 * base.js - Controlador de Front-end para o Criador AvaLIBRAS v2.0
 * =================================================================================
 *
 * Responsabilidades:
 * - Gerenciamento do estado da aplicação (projeto atual, questões, etc.).
 * - Manipulação dinâmica do DOM para refletir o estado atual.
 * - Vinculação de eventos da UI (menus, botões, timeline) a funções lógicas.
 * - Comunicação com o backend (processo principal do Electron) via `window.electronAPI`.
 *
 */

// ===== SISTEMA CENTRALIZADO DE OVERLAY - CORREÇÕES CRÍTICAS =====
// Adicionado para resolver problemas de estado, sincronização e memory leaks

const OverlayState = {
    overlays: [],
    activeOverlay: null,
    videoState: {
        isReady: false,
        duration: 0,
        currentTime: 0
    },

    // Sistema de eventos para mudanças de estado
    eventListeners: new Map(),

    // Adicionar listener para eventos de mudança
    addEventListener(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
        console.log(`📡 Event listener adicionado ao OverlayState: ${event}`);
    },

    // Remover listener de eventos
    removeEventListener(event, callback) {
        if (this.eventListeners.has(event)) {
            const listeners = this.eventListeners.get(event);
            const index = listeners.indexOf(callback);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        }
    },

    // Emitir eventos para notificar mudanças
    emit(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`❌ Erro no listener de evento ${event}:`, error);
                }
            });
            console.log(`📢 Evento emitido pelo OverlayState: ${event}`, data);
        }
    },

    // Métodos para gerenciar estado
    addOverlay(overlay) {
        // Garantir que o overlay tenha um ID único
        if (!overlay.id) {
            overlay.id = (typeof OverlayUtils !== 'undefined')
                ? OverlayUtils.generateOverlayId()
                : `overlay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            console.log('🆔 ID gerado automaticamente para overlay:', overlay.id);
        }

        this.overlays.push(overlay);
        this.syncWithProject();
        console.log('✅ Overlay adicionado ao estado centralizado:', overlay);
    },

    removeOverlay(id) {
        this.overlays = this.overlays.filter(o => o.id !== id);
        this.syncWithProject();
        console.log('🗑️ Overlay removido do estado centralizado:', id);
    },

    updateOverlay(id, data) {
        console.log(`🔍 [DEBUG] OverlayState.updateOverlay chamado para ID: ${id}`, data);
        const overlay = this.overlays.find(o => o.id === id);
        if (overlay) {
            const oldData = { ...overlay };
            Object.assign(overlay, data);
            this.syncWithProject();
            console.log('✏️ [DEBUG] Overlay atualizado no estado centralizado:', id, data);
            console.log(`🔍 [DEBUG] Estado atual do overlay após atualização:`, overlay);

            // Emitir evento de mudança para notificar outros sistemas
            console.log(`📢 [DEBUG] Emitindo evento 'overlayUpdated' com dados:`, {
                id: id,
                overlay: overlay,
                oldData: oldData,
                changes: data,
                listenersCount: this.eventListeners.get('overlayUpdated')?.length || 0
            });

            this.emit('overlayUpdated', {
                id: id,
                overlay: overlay,
                oldData: oldData,
                changes: data
            });
        } else {
            console.warn(`⚠️ [DEBUG] Overlay com ID ${id} não encontrado em OverlayState.overlays:`, this.overlays.map(o => o.id));
        }
    },

    getOverlay(id) {
        return this.overlays.find(o => o.id === id);
    },

    getAllOverlays() {
        return [...this.overlays];
    },

    setActiveOverlay(overlay) {
        this.activeOverlay = overlay;
    },

    getActiveOverlay() {
        return this.activeOverlay;
    },

    // Otimização: sincronização eficiente com projeto atual
    syncWithProject() {
        if (!currentProject || !currentProject.overlays) {
            return;
        }

        // OTIMIZAÇÃO: Atualizar apenas overlays modificados em vez de recriar array
        const startTime = performance.now();

        // Mapear overlays atuais por ID para lookup eficiente
        const currentOverlaysMap = new Map(currentProject.overlays.map(o => [o.id, o]));

        // Atualizar ou adicionar overlays
        this.overlays.forEach(overlay => {
            const projectOverlay = currentOverlaysMap.get(overlay.id);
            const overlayData = {
                id: overlay.id,
                label: overlay.label || `Overlay ${overlay.id}`,
                start: overlay.startTime,
                duration: overlay.duration,
                position: overlay.position,
                size: overlay.size,
                opacity: overlay.opacity,
                imageFile: overlay.image
            };

            if (projectOverlay) {
                // Atualizar overlay existente se houver mudanças
                Object.assign(projectOverlay, overlayData);
                currentOverlaysMap.delete(overlay.id);
            } else {
                // Adicionar novo overlay
                currentProject.overlays.push(overlayData);
            }
        });

        // Remover overlays que não existem mais no OverlayState
        const removedIds = Array.from(currentOverlaysMap.keys());
        if (removedIds.length > 0) {
            currentProject.overlays = currentProject.overlays.filter(o => !removedIds.includes(o.id));
        }

        const endTime = performance.now();
        console.log(`⚡ SyncWithProject otimizado: ${endTime - startTime.toFixed(2)}ms, ${this.overlays.length} overlays, ${removedIds.length} removidos`);
    },

    // Sincronização de estado do vídeo
    updateVideoState(videoPlayer) {
        if (videoPlayer) {
            this.videoState.isReady = videoPlayer.readyState >= 2;
            this.videoState.duration = videoPlayer.duration || 0;
            this.videoState.currentTime = videoPlayer.currentTime || 0;
        }
    },

    // Limpar estado
    clear() {
        this.overlays = [];
        this.activeOverlay = null;
        this.videoState = {
            isReady: false,
            duration: 0,
            currentTime: 0
        };
        console.log('🧹 Estado de overlays limpo');
    }
};

// Gerenciador de eventos integrado para prevenir memory leaks
const OverlayEventManager = {
    listeners: new Map(),

    add(element, event, handler, options = {}) {
        const key = this.generateKey(element, event);
        this.remove(element, event);

        element.addEventListener(event, handler, options);
        this.listeners.set(key, { element, event, handler, options });
        console.log(`📡 Event listener adicionado: ${key}`);
    },

    remove(element, event) {
        const key = this.generateKey(element, event);
        const listener = this.listeners.get(key);

        if (listener) {
            listener.element.removeEventListener(listener.event, listener.handler, listener.options);
            this.listeners.delete(key);
            console.log(`📡 Event listener removido: ${key}`);
        }
    },

    removeAll() {
        console.log(`🧹 Removendo ${this.listeners.size} event listeners...`);
        this.listeners.forEach((listener) => {
            listener.element.removeEventListener(listener.event, listener.handler, listener.options);
        });
        this.listeners.clear();
    },

    generateKey(element, event) {
        const elementId = element.id || element.className || element.tagName;
        return `${elementId}_${event}`;
    },

    // Debug: listar listeners ativos
    listListeners() {
        console.log('📋 Event listeners ativos:', Array.from(this.listeners.keys()));
    }
};

// Funções utilitárias integradas para overlay
const OverlayUtils = {
    validateOverlayConfig(config) {
        if (!config) {
            console.warn('❌ Config de overlay undefined');
            return false;
        }

        if (!config.imageFile) {
            console.warn('❌ Config de overlay sem imageFile');
            return false;
        }

        // Suportar ambos os campos: startTime (novos) e start (legado/drag-and-drop)
        const startTime = config.startTime !== undefined ? config.startTime : config.start;
        if (startTime === undefined || startTime === null || startTime < 0) {
            console.warn('❌ Config de overlay com startTime inválido:', startTime, '(config:', config, ')');
            return false;
        }

        if (!config.duration || config.duration <= 0) {
            console.warn('❌ Config de overlay com duration inválido:', config.duration);
            return false;
        }

        if (!config.position) {
            console.warn('❌ Config de overlay sem position');
            return false;
        }

        console.log('✅ Config de overlay validada com sucesso');
        return true;
    },

    validateVideoState(videoPlayer) {
        if (!videoPlayer) {
            console.warn('❌ Elemento de vídeo não encontrado');
            return false;
        }

        if (!videoPlayer.src) {
            console.warn('❌ Vídeo não tem source definida');
            return false;
        }

        if (videoPlayer.readyState < 2) {
            console.warn('⚠️ Vídeo ainda está carregando (readyState:', videoPlayer.readyState + ')');
            return false;
        }

        if (!videoPlayer.videoWidth || !videoPlayer.videoHeight ||
            videoPlayer.videoWidth <= 0 || videoPlayer.videoHeight <= 0) {
            console.warn('❌ Vídeo não tem dimensões válidas:', {
                videoWidth: videoPlayer.videoWidth,
                videoHeight: videoPlayer.videoHeight
            });
            return false;
        }

        if (!videoPlayer.duration || !isFinite(videoPlayer.duration)) {
            console.warn('❌ Vídeo não tem duração válida:', videoPlayer.duration);
            return false;
        }

        console.log('✅ Estado do vídeo validado para overlay');
        return true;
    },

    calculateOverlayDimensions(config, canvasSize) {
        const size = config.size || 50;
        const overlayWidth = (canvasSize.width * size) / 100;

        let overlayHeight;
        if (config.imageHeight && config.imageWidth) {
            overlayHeight = (config.imageHeight * overlayWidth) / config.imageWidth;
        } else {
            overlayHeight = (canvasSize.height * size) / 100;
        }

        console.log('📐 Dimensões calculadas:', { width: overlayWidth, height: overlayHeight });
        return { width: overlayWidth, height: overlayHeight };
    },

    calculatePosition(position, size, containerSize) {
        const padding = Math.min(20, Math.min(containerSize.width, containerSize.height) * 0.05);
        let x, y;

        switch (position) {
            case 'top-left':
                x = padding;
                y = padding;
                break;
            case 'top-center':
                x = (containerSize.width - size.width) / 2;
                y = padding;
                break;
            case 'top-right':
                x = Math.max(padding, containerSize.width - size.width - padding);
                y = padding;
                break;
            case 'center-left':
                x = padding;
                y = (containerSize.height - size.height) / 2;
                break;
            case 'center':
            default:
                x = (containerSize.width - size.width) / 2;
                y = (containerSize.height - size.height) / 2;
                break;
            case 'center-right':
                x = Math.max(padding, containerSize.width - size.width - padding);
                y = (containerSize.height - size.height) / 2;
                break;
            case 'bottom-left':
                x = padding;
                y = Math.max(padding, containerSize.height - size.height - padding);
                break;
            case 'bottom-center':
                x = (containerSize.width - size.width) / 2;
                y = Math.max(padding, containerSize.height - size.height - padding);
                break;
            case 'bottom-right':
                x = Math.max(padding, containerSize.width - size.width - padding);
                y = Math.max(padding, containerSize.height - size.height - padding);
                break;
        }

        console.log('🎯 Posição calculada:', { x, y, position });
        return { x, y };
    },

    generateOverlayId() {
        return `overlay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },

    formatTime(seconds) {
        if (!seconds || !isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    formatTimeWithMilliseconds(seconds) {
        if (!seconds || !isFinite(seconds)) return '0:00.000';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }
};

// API Global para garantir disponibilidade no escopo global
window.OverlayAPI = {
    renderOverlays: () => {
        if (typeof renderOverlays === 'function') {
            renderOverlays();
        } else {
            console.warn('⚠️ Função renderOverlays não disponível');
        }
    },

    validateVideoState: (videoPlayer) => OverlayUtils.validateVideoState(videoPlayer),

    updateTimeline: () => {
        if (typeof renderOverlays === 'function') {
            renderOverlays();
        }
    },

    formatTime: (seconds) => OverlayUtils.formatTime(seconds),

    // Acesso direto ao estado
    getOverlayState: () => OverlayState,
    getOverlayUtils: () => OverlayUtils,
    getEventManager: () => OverlayEventManager
};

// Garantir que as funções e objetos estejam disponíveis globalmente
window.OverlayState = OverlayState;
window.OverlayUtils = OverlayUtils;
window.OverlayEventManager = OverlayEventManager;

// =====================================================================
// SISTEMA DE ESTADOS VISUAIS CONSOLIDADO - FASE 2
// =====================================================================

const VisualStateManager = {
    // Estado centralizado para todos os elementos visuais
    state: {
        // Estados do playhead (agulha)
        playhead: {
            position: 0, // percentual (0-100)
            display: 'block',
            isDragging: false,
            isHidden: false,
            cursor: 'grab'
        },

        // Estados da barra de progresso
        progress: {
            width: 0, // percentual (0-100)
            display: 'block',
            isHidden: false
        },

        // Estados de seleção
        selection: {
            left: 0, // percentual (0-100)
            width: 0, // percentual (0-100)
            display: 'none',
            isActive: false,
            isSelectionMode: false,
            isMoving: false,
            startHandleVisible: false, // ADICIONADO
            endHandleVisible: false    // ADICIONADO
        },

        // Estados da timeline
        timeline: {
            cursor: 'default',
            isSelecting: false
        },

        // Estados de marcadores e overlays
        markers: new Map(), // key: id, value: { position, selected, dragging, disabled }
        overlays: new Map(), // key: id, value: { left, width, active, dragging, disabled }

        // Estados globais
        body: {
            cursor: 'default'
        },

        // Cache de elementos DOM
        elements: {
            playhead: null,
            progress: null,
            selectionArea: null,
            timelineTrack: null,
            body: document.body
        },

        // Performance flags
        transitionEnabled: true,
        batchUpdatePending: false,

        // Dirty checking system
        dirtyFlags: {
            playhead: false,
            progress: false,
            selection: false,
            timeline: false,
            body: false,
            markers: false,
            overlays: false
        },
        lastAppliedState: {},

        // Performance monitoring
        performance: {
            updateCount: 0,
            skippedUpdates: 0,
            lastUpdateTime: 0,
            startTime: Date.now()
        },

        // Controle de estado para evitar loops infinitos
        _isApplyingState: false
    },

    // Utilitário para debouncing de eventos
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // Inicializar o StateManager
    init() {
        console.log('🎯 Inicializando VisualStateManager...');

        // Cache de elementos DOM
        this.cacheElements();

        // Configurar observadores de mutação para performance
        // setupMutationObserver() foi removido - funcionalidade consolidada em setupCacheInvalidation()

        // Inicializar sistema de vídeo otimizado (consolidar listeners timeupdate)
        this.initOptimizedVideoSync();

        // Aplicar estado inicial
        this.applyState();

        console.log('✅ VisualStateManager inicializado com sucesso');
    },

    // Cache dos elementos DOM usados frequentemente com estratégia de fallback robusta
    cacheElements() {
        // Prevenir chamadas excessivas (proteção contra loops)
        if (this.isCaching) {
            return;
        }

        this.isCaching = true;

        // Definição de seletores com fallbacks para cada elemento
        const elementSelectors = {
            playhead: ['.playhead'],
            progress: ['.timeline-progress'],
            timelineTrack: ['.timeline-track'],
            timelineSelection: ['.timeline-selection', '#timelineSelection'],
            selectionArea: ['.selection-area', '#selectionArea'],
            selectionStart: ['.selection-start', '#selectionStart'],
            selectionEnd: ['.selection-end', '#selectionEnd'],
            currentTimeElement: ['.current-time', '#currentTime'],
            durationElement: ['.duration', '#duration'],
            playheadTimeTooltip: ['.playhead-time-tooltip', '#playheadTimeTooltip']
        };

        // Cache com estratégia de fallback
        Object.entries(elementSelectors).forEach(([key, selectors]) => {
            let element = null;

            // Tentar cada seletor em ordem
            for (const selector of selectors) {
                element = document.querySelector(selector);
                if (element) {
                    this.state.elements[key] = element;
                    break; // Usar primeiro elemento encontrado
                }
            }

            // Log detalhado para depuração
            if (!element) {
                this.logWarn(`Elemento ${key} não encontrado`, { selectors });
            }
        });

        // Log de status do cache
        const cacheStatus = {};
        Object.keys(this.state.elements).forEach(key => {
            cacheStatus[key] = this.state.elements[key] ? '✅' : '❌';
        });

        this.logInfo('Cache de elementos DOM atualizado', cacheStatus);

        // Verificar elementos críticos
        const criticalElements = ['selectionArea', 'selectionStart', 'selectionEnd'];
        const missingCritical = criticalElements.filter(key => !this.state.elements[key]);

        if (missingCritical.length > 0) {
            this.logWarn('Elementos críticos não encontrados', { missing: missingCritical });
        }

        // Setup de cache invalidation para mudanças DOM
        this.setupCacheInvalidation();

        // Resetar flag de proteção contra loops
        this.isCaching = false;
    },

    // Setup de invalidação de cache quando DOM mudar
    setupCacheInvalidation() {
        if (typeof MutationObserver !== 'undefined' && !this.state.cacheInvalidationObserver) {
            this.state.cacheInvalidationObserver = new MutationObserver((mutations) => {
                let shouldRecache = false;

                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList') {
                        // Verificar se elementos importantes foram adicionados/removidos
                        const target = mutation.target;
                        if (target.classList?.contains('timeline') ||
                            target.classList?.contains('timeline-track') ||
                            target.id === 'timelineSelection') {
                            shouldRecache = true;
                        }
                    }
                });

                if (shouldRecache) {
                    // Debounce o recache para não sobrecarregar
                    this.debouncedRecache();
                }
            });

            this.state.cacheInvalidationObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: false,
                characterData: false
            });
        }
    },

    // Recache debounced para performance
    debouncedRecache: function() {
        if (this.recacheTimeout) {
            clearTimeout(this.recacheTimeout);
        }

        this.recacheTimeout = setTimeout(() => {
            // Verificar se realmente precisa recachear antes de executar
            const currentElementsCount = Object.keys(this.state.elements).length;
            this.cacheElements();
            const newElementsCount = Object.keys(this.state.elements).length;

            // Só logar se houver mudança real nos elementos
            if (currentElementsCount !== newElementsCount) {
                this.logInfo('Cache recarregado devido a mudanças no DOM', {
                    timestamp: Date.now(),
                    elementsCount: newElementsCount
                });
            }
        }, 200); // Aumentado de 100ms para 200ms para reduzir frequência
    },

    // Método principal para atualizar estado com dirty checking e performance
    setState(updates, batch = false) {
        // Verificar se já estamos processando (evitar loops infinitos)
        if (this._isApplyingState) {
            console.warn('⚠️ VisualStateManager já está aplicando estado - ignorando chamada recursiva');
            return;
        }

        const hasChanges = this.detectChanges(updates);

        if (!hasChanges) {
            this.state.performance.skippedUpdates++;
            return; // Pular update se não houver mudanças reais
        }

        // Atualizar estado
        this.updateState(updates);

        // Batch update para performance
        if (batch) {
            this.scheduleBatchUpdate();
        } else {
            this.applyState();
        }

        // Debugging controlado - reduzir frequência de logs
        if (this.state.performance.updateCount % 10 === 0) {
            this.logStateChange(updates);
        }
    },

    // Detectar mudanças reais no estado
    detectChanges(updates) {
        let hasChanges = false;

        // Verificar cada seção para mudanças reais
        if (updates.playhead) {
            const current = this.state.playhead;
            const incoming = updates.playhead;
            const changed = this.hasObjectChanged(current, incoming);
            this.state.dirtyFlags.playhead = changed;
            hasChanges = changed || hasChanges;
        }

        if (updates.progress) {
            const current = this.state.progress;
            const incoming = updates.progress;
            const changed = this.hasObjectChanged(current, incoming);
            this.state.dirtyFlags.progress = changed;
            hasChanges = changed || hasChanges;
        }

        if (updates.selection) {
            const current = this.state.selection;
            const incoming = updates.selection;
            const changed = this.hasObjectChanged(current, incoming);
            this.state.dirtyFlags.selection = changed;
            hasChanges = changed || hasChanges;
        }

        if (updates.timeline) {
            const current = this.state.timeline;
            const incoming = updates.timeline;
            const changed = this.hasObjectChanged(current, incoming);
            this.state.dirtyFlags.timeline = changed;
            hasChanges = changed || hasChanges;
        }

        if (updates.body) {
            const current = this.state.body;
            const incoming = updates.body;
            const changed = this.hasObjectChanged(current, incoming);
            this.state.dirtyFlags.body = changed;
            hasChanges = changed || hasChanges;
        }

        if (updates.markers) {
            this.state.dirtyFlags.markers = true;
            hasChanges = true;
        }

        if (updates.overlays) {
            this.state.dirtyFlags.overlays = true;
            hasChanges = true;
        }

        return hasChanges;
    },

    // Verificar se objeto realmente mudou
    hasObjectChanged(current, incoming) {
        if (!current || !incoming) return true;

        const keys = Object.keys(incoming);
        for (const key of keys) {
            if (current[key] !== incoming[key]) {
                return true;
            }
        }
        return false;
    },

    // Agendar update em batch
    scheduleBatchUpdate() {
        if (this.state.batchUpdatePending) {
            return; // Skip se batch já agendado
        }

        this.state.batchUpdatePending = true;

        requestAnimationFrame(() => {
            this.applyState();
            this.state.batchUpdatePending = false;
            this.state.performance.updateCount++;
            this.state.performance.lastUpdateTime = Date.now();
        });
    },

    // Resetar dirty flags após aplicar estado
    resetDirtyFlags() {
        Object.keys(this.state.dirtyFlags).forEach(key => {
            this.state.dirtyFlags[key] = false;
        });
    },

    // Atualizar valores do estado
    updateState(updates) {
        if (updates.playhead) {
            Object.assign(this.state.playhead, updates.playhead);
        }
        if (updates.progress) {
            Object.assign(this.state.progress, updates.progress);
        }
        if (updates.selection) {
            Object.assign(this.state.selection, updates.selection);
        }
        if (updates.timeline) {
            Object.assign(this.state.timeline, updates.timeline);
        }
        if (updates.body) {
            Object.assign(this.state.body, updates.body);
        }
        if (updates.markers) {
            updates.markers.forEach((data, id) => {
                this.state.markers.set(id, { ...this.state.markers.get(id), ...data });
            });
        }
        if (updates.overlays) {
            updates.overlays.forEach((data, id) => {
                this.state.overlays.set(id, { ...this.state.overlays.get(id), ...data });
            });
        }
    },

    // Aplicar estado ao DOM com dirty checking e prevenção de loops
    applyState() {
        // Prevenir recursão infinita
        if (this._isApplyingState) {
            console.warn('⚠️ applyState() já em execução - ignorando chamada recursiva');
            return;
        }

        this._isApplyingState = true;

        try {
            // Incrementar contador de performance
            this.state.performance.updateCount++;
            this.state.performance.lastUpdateTime = Date.now();

            // Atualizar apenas seções modificadas
            if (this.state.dirtyFlags.playhead) {
                this.applyPlayheadState();
            }
            if (this.state.dirtyFlags.progress) {
                this.applyProgressState();
            }
            if (this.state.dirtyFlags.selection) {
                this.applySelectionState();
            }
            if (this.state.dirtyFlags.timeline) {
                this.applyTimelineState();
            }
            if (this.state.dirtyFlags.body) {
                this.applyBodyState();
            }
            if (this.state.dirtyFlags.markers) {
                this.applyMarkerStates();
            }
            if (this.state.dirtyFlags.overlays) {
                this.applyOverlayStates();
            }

            // Resetar dirty flags após aplicar
            this.resetDirtyFlags();
        } finally {
            // Sempre liberar o flag no final
            this._isApplyingState = false;
        }
    },

    // Aplicar estado do playhead
    applyPlayheadState() {
        // 🔍 DIAGNÓSTICO: Verificar se applyPlayheadState está sendo chamado
        console.log('🎯 VSM: applyPlayheadState chamado!');

        const { playhead, elements } = this.state;
        const playheadEl = elements.playhead;

        if (!playheadEl) {
            console.log('❌ VSM: Elemento playhead não encontrado no DOM');
            return;
        }

        console.log('📍 VSM: Atualizando playhead', {
            position: playhead.position + '%',
            display: playhead.display,
            elementFound: !!playheadEl
        });

        // Atualizar CSS custom properties para performance
        this.setCSSProperty('--playhead-position', `${playhead.position}%`);
        this.setCSSProperty('--playhead-display', playhead.display);

        console.log('✅ VSM: Variável CSS atualizada', {
            '--playhead-position': `${playhead.position}%`,
            '--playhead-display': playhead.display
        });

        // Atualizar classes para estados
        this.toggleClass(playheadEl, 'dragging', playhead.isDragging);
        this.toggleClass(playheadEl, 'hidden', playhead.isHidden);
        this.toggleClass(playheadEl, 'hover', playhead.cursor === 'grab' && !playhead.isDragging);
        this.toggleClass(playheadEl, 'grabbing', playhead.cursor === 'grabbing');

        // REMOVIDO: Estilos inline - agora controlados por CSS custom properties
    },

    // Aplicar estado da barra de progresso
    applyProgressState() {
        const { progress, elements } = this.state;
        const progressEl = elements.progress;

        if (!progressEl) return;

        // Usar CSS custom properties para performance
        this.setCSSProperty('--progress-width', `${progress.width}%`);
        this.setCSSProperty('--progress-display', progress.display);
        this.toggleClass(progressEl, 'hidden', progress.isHidden);

        // REMOVIDO: Estilo inline - agora controlado por CSS custom properties
    },

    // Aplicar estado de seleção com cache e performance otimizada
    applySelectionState() {
        let { selection, elements } = this.state;
        let selectionEl = elements.selectionArea;

        // Cache para evitar buscas repetitivas no DOM
        if (!selectionEl) {
            selectionEl = document.querySelector('.selection-area') || document.getElementById('selectionArea');
            if (selectionEl) {
                elements.selectionArea = selectionEl;
                // Log apenas na primeira vez que encontrar
                if (!this._selectionElementCached) {
                    console.log('🔄 Elemento selectionArea encontrado e cacheado:', selectionEl);
                    this._selectionElementCached = true;
                }
            } else {
                if (!this._selectionElementErrorLogged) {
                    console.error('❌ Elemento selectionArea não encontrado!');
                    this._selectionElementErrorLogged = true;
                }
                return;
            }
        }

        // Reduzir logs - apenas logar a cada N chamadas
        const shouldLog = this.state.performance.updateCount % 50 === 0;
        if (shouldLog) {
            this.logDebug('Aplicando estado de seleção', {
                left: `${selection.left}%`,
                width: `${selection.width}%`,
                display: selection.display,
                isActive: selection.isActive,
                updateCount: this.state.performance.updateCount
            });
        }

        // Aplicar variáveis CSS (sempre, pois são essenciais para a visualização)
        this.setCSSProperty('--selection-left', `${selection.left}%`);
        this.setCSSProperty('--selection-width', `${selection.width}%`);
        this.setCSSProperty('--selection-display', selection.display);

        // CRÍTICO: Gerenciar o container pai .timeline-selection para torná-lo visível
        let timelineSelectionEl = elements.timelineSelection;
        if (!timelineSelectionEl) {
            timelineSelectionEl = document.querySelector('.timeline-selection') || document.getElementById('timelineSelection');
            if (timelineSelectionEl) {
                elements.timelineSelection = timelineSelectionEl;
                if (!this._timelineSelectionElementCached) {
                    console.log('🔄 Elemento timelineSelection encontrado e cacheado:', timelineSelectionEl);
                    this._timelineSelectionElementCached = true;
                }
            }
        }

        if (timelineSelectionEl) {
            // Aplicar classe .active ao container pai para torná-lo visível
            this.toggleClass(timelineSelectionEl, 'active', selection.isActive);
            this.toggleClass(timelineSelectionEl, 'moving', selection.isMoving);

            if (shouldLog) {
                console.log(`✅ Container timelineSelection: ${selection.isActive ? 'visível' : 'invisível'}`);
            }
        } else if (!this._timelineSelectionWarningLogged) {
            console.warn('⚠️ Elemento timelineSelection (container pai) não encontrado!');
            this._timelineSelectionWarningLogged = true;
        }

        this.toggleClass(selectionEl, 'active', selection.isActive);
        this.toggleClass(selectionEl, 'moving', selection.isMoving);

        // Cache para handles também
        if (!elements.selectionStart) {
            elements.selectionStart = selectionEl.querySelector('.selection-start') || document.getElementById('selectionStart');
        }
        if (!elements.selectionEnd) {
            elements.selectionEnd = selectionEl.querySelector('.selection-end') || document.getElementById('selectionEnd');
        }

        const startHandle = elements.selectionStart;
        const endHandle = elements.selectionEnd;

        // Log detalhado apenas quando necessário
        if (shouldLog && (!startHandle || !endHandle)) {
            console.log('🔍 Status dos handles:', {
                startHandle: !!startHandle,
                endHandle: !!endHandle
            });
        }

        if (startHandle) {
            this.toggleClass(startHandle, 'visible', selection.startHandleVisible);
            if (shouldLog) {
                console.log(`✅ Handle inicial: ${selection.startHandleVisible ? 'visível' : 'invisível'}`);
            }
        } else if (!this._startHandleWarningLogged) {
            console.warn('⚠️ Handle inicial não encontrado!');
            this._startHandleWarningLogged = true;
        }

        if (endHandle) {
            this.toggleClass(endHandle, 'visible', selection.endHandleVisible);
            if (shouldLog) {
                console.log(`✅ Handle final: ${selection.endHandleVisible ? 'visível' : 'invisível'}`);
            }
        } else if (!this._endHandleWarningLogged) {
            console.warn('⚠️ Handle final não encontrado!');
            this._endHandleWarningLogged = true;
        }
    },

    // Aplicar estado da timeline
    applyTimelineState() {
        const { timeline, elements } = this.state;
        const timelineEl = elements.timelineTrack;

        if (!timelineEl) return;

        // Atualizar data attribute para estados interativos
        document.body.setAttribute('data-interaction-state', timeline.interactionState || 'idle');

        this.setCSSProperty('--cursor-state', timeline.cursor);
        this.toggleClass(timelineEl, 'selecting', timeline.isSelecting);
        this.toggleClass(timelineEl, 'selection-mode', timeline.isSelectionMode);
    },

    // Aplicar estado do corpo
    applyBodyState() {
        const { body, elements } = this.state;
        const bodyEl = elements.body;

        if (!bodyEl) return;

        // Remover todas as classes de cursor primeiro
        bodyEl.classList.remove('cursor-grabbing', 'cursor-ew-resize', 'cursor-col-resize', 'cursor-row-resize');

        // Adicionar classe de cursor apropriada
        if (body.cursor !== 'default') {
            bodyEl.classList.add(`cursor-${body.cursor}`);
        }
    },

    // Aplicar estados de marcadores
    applyMarkerStates() {
        this.state.markers.forEach((markerData, id) => {
            const markerEl = document.querySelector(`[data-marker-id="${id}"]`) ||
                           document.getElementById(`marker-${id}`);

            if (!markerEl) return;

            this.toggleClass(markerEl, 'selected', markerData.selected);
            this.toggleClass(markerEl, 'dragging', markerData.dragging);
            this.toggleClass(markerEl, 'disabled', markerData.disabled);
        });
    },

    // Aplicar estados de overlays
    applyOverlayStates() {
        this.state.overlays.forEach((overlayData, id) => {
            const overlayEl = document.querySelector(`[data-overlay-id="${id}"]`) ||
                           document.getElementById(`overlay-${id}`);

            if (!overlayEl) return;

            this.setCSSProperty('--overlay-left', `${overlayData.left}%`);
            this.setCSSProperty('--overlay-width', `${overlayData.width}%`);

            this.toggleClass(overlayEl, 'active', overlayData.active);
            this.toggleClass(overlayEl, 'dragging', overlayData.dragging);
            this.toggleClass(overlayEl, 'disabled', overlayData.disabled);
        });
    },

    // Utilitário para definir CSS custom properties com cache
    setCSSProperty(property, value, force = false) {
        const currentValue = this.state.lastAppliedState[property];

        // Pular se o valor não mudou (a menos que force seja true)
        if (!force && currentValue === value) {
            return;
        }

        const root = document.documentElement;
        if (root && root.style && root.style.setProperty) {
            root.style.setProperty(property, value);
            this.state.lastAppliedState[property] = value;

            // Log controlado para variáveis CSS críticas
            if (property.startsWith('--selection') || property.startsWith('--playhead')) {
                console.log(`🎨 CSS: ${property} = ${value}`);
                this.logDebug(`CSS Variável atualizada: ${property} = ${value}`);
            }
        } else {
            this.logError('root.style.setProperty não disponível', { property, value });
        }
    },

    // Utilitário para toggle de classes
    toggleClass(element, className, force) {
        if (!element) return;

        if (force === undefined) {
            element.classList.toggle(className);
        } else if (force) {
            element.classList.add(className);
        } else {
            element.classList.remove(className);
        }
    },

    // Limpar estado e prevenir memory leaks
    cleanup() {
        this.logInfo('Limpando VisualStateManager...', {
            cleanupTimestamp: Date.now()
        });

        // Limpar event listeners de vídeo
        const videoPlayer = document.getElementById('videoPlayer');
        if (videoPlayer && this.throttledTimeUpdate) {
            videoPlayer.removeEventListener('timeupdate', this.throttledTimeUpdate);
            this.throttledTimeUpdate = null;
        }

        // Limpar mutation observers
        if (this.state.mutationObserver) {
            this.state.mutationObserver.disconnect();
        }

        // Limpar cache de elementos
        Object.keys(this.state.elements).forEach(key => {
            this.state.elements[key] = null;
        });

        // Limpar maps
        this.state.markers.clear();
        this.state.overlays.clear();

        // Resetar estado para prevenir memory leaks
        this.state.batchUpdatePending = false;
        this.resetDirtyFlags();
        this.state.lastAppliedState = {};

        // Log final de performance
        const perf = this.getPerformanceStats();
        this.logInfo('Performance final', perf);

        console.log('✅ VisualStateManager limpo');
    },

    // Obter estatísticas de performance
    getPerformanceStats() {
        const now = Date.now();
        const uptime = now - this.state.performance.startTime;
        const efficiency = this.state.performance.updateCount > 0
            ? ((this.state.performance.skippedUpdates /
               (this.state.performance.updateCount + this.state.performance.skippedUpdates)) * 100).toFixed(2)
            : 0;

        return {
            totalUpdates: this.state.performance.updateCount,
            skippedUpdates: this.state.performance.skippedUpdates,
            efficiency: `${efficiency}%`,
            uptime: `${(uptime / 1000).toFixed(2)}s`,
            updatesPerSecond: this.state.performance.updateCount > 0
                ? (this.state.performance.updateCount / (uptime / 1000)).toFixed(2)
                : 0
        };
    },

    // Sistema de logging controlado com níveis
    logStateChange(updates, level = 'ERROR') {
        // Verificação de segurança para evitar undefined errors
        if (!updates || typeof updates !== 'object') {
            return;
        }

        const logLevels = {
            ERROR: 0,
            WARN: 1,
            INFO: 2,
            DEBUG: 3
        };

        // Verificar nível de logging atual
        const currentLevel = (typeof window !== 'undefined' && window.DEBUG_MODE)
            ? logLevels.DEBUG
            : logLevels.ERROR;

        // Reduzir verbosidade para updates de playhead frequentes
        if (updates.playhead && !updates.playhead.isDragging) {
            // Updates normais de playhead são muito frequentes, loggar apenas DEBUG
            if (logLevels.DEBUG > currentLevel) {
                return; // Não logar playhead normal em modo ERROR/WARN/INFO
            }
            level = 'DEBUG'; // Forçar nível DEBUG para playhead normal
        }

        // Apenas logar se o nível for apropriado
        if (logLevels[level] <= currentLevel) {
            // Adicionar contexto de performance para updates frequentes (reduzido para performance)
            const perfContext = this.state.performance.updateCount > 500
                ? `[${this.state.performance.updateCount} updates, ${this.state.performance.skippedUpdates} skipped]`
                : '';

            console.log(`🎨 State [${level}]${perfContext}:`, updates);
        }
    },

    // Métodos utilitários para diferentes níveis de log
    logError(message, data) {
        if (data !== undefined) {
            this.logStateChange(data, 'ERROR');
        }
        console.error('❌ ERROR:', message, data || {});
    },

    logWarn(message, data) {
        if (data !== undefined) {
            this.logStateChange(data, 'WARN');
        }
        console.warn('⚠️ WARN:', message, data || {});
    },

    logInfo(message, data) {
        if (data !== undefined) {
            this.logStateChange(data, 'INFO');
        }
        console.info('ℹ️ INFO:', message, data || {});
    },

    logDebug(message, data) {
        // Logs DEBUG apenas quando explicitamente ativado
        if (typeof window !== 'undefined' && window.DEBUG_MODE) {
            if (data !== undefined) {
                this.logStateChange(data, 'DEBUG');
            }
            console.debug('🐛 DEBUG:', message, data || {});
        }
    },

    // REMOVIDO: setupMutationObserver duplicado
    // Esta funcionalidade foi consolidada em setupCacheInvalidation() que possui debounce
    // para evitar loops infinitos de cacheElements()
    // setupMutationObserver() foi removido para prevenir conflitos

    // Performance: Batch multiple updates
    batchUpdate(updates) {
        this.setState(updates, true);
    },

    // Performance: Desabilitar transições durante operações intensivas
    setTransitionEnabled(enabled) {
        this.state.transitionEnabled = enabled;

        const root = document.documentElement;
        root.style.setProperty('--state-transition', enabled ?
            'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)' : 'none');
    },

    // Utilitários de performance para eventos de alta frequência
    throttle: (func, delay) => {
        let timeoutId;
        let lastExecTime = 0;
        return function (...args) {
            const currentTime = Date.now();

            if (currentTime - lastExecTime > delay) {
                func.apply(this, args);
                lastExecTime = currentTime;
            } else {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    func.apply(this, args);
                    lastExecTime = Date.now();
                }, delay - (currentTime - lastExecTime));
            }
        };
    },

    debounce: (func, delay) => {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    },

    // Referência para o throttled handler (para poder remover depois)
    throttledTimeUpdate: null,

    // Handler unificado para timeupdate
    handleVideoTimeUpdate(event) {
        // 🔍 DIAGNÓSTICO: Verificar se o evento está chegando
        console.log('✅ VSM: handleVideoTimeUpdate disparado!', {
            currentTime: event.target.currentTime,
            duration: event.target.duration
        });

        const videoPlayer = event.target;
        if (!videoPlayer || !videoPlayer.duration) {
            console.log('❌ VSM: Video player ou duration não disponível');
            return;
        }

        const currentTimePercent = (videoPlayer.currentTime / videoPlayer.duration) * 100;

        console.log('📊 VSM: Calculando percentual', {
            currentTime: videoPlayer.currentTime,
            duration: videoPlayer.duration,
            percentage: currentTimePercent.toFixed(2) + '%'
        });

        // Batch todas as atualizações juntas com nível de log apropriado
        this.setState({
            playhead: {
                position: currentTimePercent,
                isDragging: false // Reset dragging state during normal playback
            },
            progress: {
                width: currentTimePercent
            },
            timeline: {
                currentTime: currentTimePercent
            }
        }, true); // Usar batch para performance

        // Log de playhead apenas em modo DEBUG
        this.logDebug('Playhead update', {
            currentTime: videoPlayer.currentTime,
            percentage: currentTimePercent.toFixed(2)
        });
    },

    // Inicializar sistema de vídeo otimizado
    initOptimizedVideoSync() {
        const videoPlayer = document.getElementById('videoPlayer');
        if (!videoPlayer) {
            this.logWarn('Video player não encontrado para initOptimizedVideoSync');
            return;
        }

        // Remover listeners existentes para previnir conflitos
        this.removeExistingTimeUpdateListeners();

        // Criar handler throttled
        this.throttledTimeUpdate = this.throttle((event) => {
            this.handleVideoTimeUpdate(event);
        }, 33); // ~30fps máximo para performance

        // Adicionar único listener otimizado
        videoPlayer.addEventListener('timeupdate', this.throttledTimeUpdate, { passive: true });

        // Outros event listeners permanecem os mesmos
        videoPlayer.addEventListener('loadedmetadata', () => {
            this.logInfo('Vídeo carregado', { duration: videoPlayer.duration });
            if (typeof updateTimelineDuration === 'function') {
                updateTimelineDuration();
            }
        }, { passive: true });

        videoPlayer.addEventListener('loadeddata', () => {
            if (typeof updateTimelineDuration === 'function') {
                updateTimelineDuration();
            }
        }, { passive: true });
        videoPlayer.addEventListener('loadstart', () => {
            this.logInfo('Iniciando carregamento do vídeo', {
                event: 'loadstart',
                videoElement: !!videoPlayer
            });
        }, { passive: true });

        this.logInfo('Sistema de vídeo otimizado inicializado', {
            videoPlayerFound: !!videoPlayer,
            throttlingEnabled: !!this.throttledTimeUpdate,
            features: ['throttling', 'batching', 'dirtyChecking']
        });
    },

    // Remover listeners timeupdate existentes para evitar conflitos
    removeExistingTimeUpdateListeners() {
        const videoPlayer = document.getElementById('videoPlayer');
        if (!videoPlayer) return;

        // Remover listeners antigos se existirem
        if (this.throttledTimeUpdate) {
            videoPlayer.removeEventListener('timeupdate', this.throttledTimeUpdate);
        }

        // REMOVIDO: Lista de listeners legados - syncTimelineWithVideo() foi completamente removida
        // O sistema moderno (VisualStateManager.initOptimizedVideoSync) gerencia todos os listeners
        this.logInfo('Sistema moderno ativo - não há listeners legados para remover');

        this.logInfo('Sistema moderno iniciado - sem conflitos de listeners', {
            videoPlayerFound: !!videoPlayer,
            modernSystemActive: true
        });
    }
};

// API global para o StateManager
window.VisualStateManager = VisualStateManager;

console.log('🎯 Sistema de estados visuais consolidado inicializado');

// Adicionar método de diagnóstico global para testes
window.VisualStateManagerDiagnostics = {
    // Verificar se o sistema está funcionando corretamente
    runHealthCheck() {
        console.log('🔍 Iniciando diagnóstico do VisualStateManager...');

        const vm = VisualStateManager;
        const results = {
            stateManager: !!vm,
            dirtyChecking: !!vm.state.dirtyFlags,
            performance: !!vm.state.performance,
            throttledHandler: !!vm.throttledTimeUpdate,
            cacheElements: Object.keys(vm.state.elements).length,
            lastAppliedStateSize: Object.keys(vm.state.lastAppliedState).length
        };

        console.log('📊 Resultados do diagnóstico:', results);
        return results;
    },

    // Simular seleção para teste
    testSelectionDisplay() {
        console.log('🧪 Testando exibição de seleção...');

        // Simular uma seleção
        VisualStateManager.setState({
            selection: {
                display: 'block',
                left: 25,
                width: 30,
                isActive: true,
                isPartial: false,
                startHandleVisible: true,
                endHandleVisible: true
            }
        });

        // Verificar se as variáveis CSS foram aplicadas
        const root = document.documentElement;
        const selectionLeft = root.style.getPropertyValue('--selection-left');
        const selectionWidth = root.style.getPropertyValue('--selection-width');
        const selectionDisplay = root.style.getPropertyValue('--selection-display');

        console.log('✅ Variáveis CSS aplicadas:', {
            left: selectionLeft,
            width: selectionWidth,
            display: selectionDisplay
        });

        return {
            cssApplied: !!(selectionLeft && selectionWidth && selectionDisplay),
            values: { left: selectionLeft, width: selectionWidth, display: selectionDisplay }
        };
    },

    // Limpar seleção de teste
    clearTestSelection() {
        console.log('🧹 Limpando seleção de teste...');

        VisualStateManager.setState({
            selection: {
                display: 'none',
                width: 0,
                isActive: false,
                isPartial: false,
                startHandleVisible: false,
                endHandleVisible: false
            }
        });
    },

    // Obter estatísticas de performance
    getPerformanceReport() {
        if (!VisualStateManager.getPerformanceStats) {
            return { error: 'Método de performance não disponível' };
        }

        const stats = VisualStateManager.getPerformanceStats();
        console.log('📈 Relatório de Performance:', stats);
        return stats;
    }
};

// Executar diagnóstico automático após inicialização
setTimeout(() => {
    if (window.VisualStateManagerDiagnostics) {
        window.VisualStateManagerDiagnostics.runHealthCheck();
    }
}, 1000);

// ---------------------------------------------------------------------------------
// 1. GERENCIAMENTO DE ESTADO CENTRALIZADO
// ---------------------------------------------------------------------------------

let currentProject = {
    name: "Projeto sem Título",
    type: "multiple_choice",
    totalAlternatives: 4,
    questions: [],
    isDirty: false,
    // Overlays serão adicionados dinamicamente pelo usuário
    overlays: []
};

// Sistema de projetos recentes
let recentProjects = JSON.parse(localStorage.getItem('avalibras_recent_projects') || '[]');
const MAX_RECENT_PROJECTS = 5;

let activeQuestionIndex = -1;
let currentVideoURL = null; // URL (blob ou file) do vídeo atualmente no player
let tempCorrectAnswer = null; // Gabarito temporário para modo de criação

let videoPaths = new Map(); 

// ---------------------------------------------------------------------------------
// 2. CLASSES DE GERENCIAMENTO
// ---------------------------------------------------------------------------------

class QuestionManager {
    constructor(project) {
        this.project = project;
    }

    _getNextQuestionNumber() {
        if (this.project.questions.length === 0) return 1;
        const maxIndex = Math.max(...this.project.questions.map(q => q.originalIndex));
        return maxIndex + 1;
    }

    addQuestion(videoUrl, markers, correctAnswer) {
        if (this.project.questions.length >= 90) {
            throw new Error("O limite de 90 questões por projeto foi atingido.");
        }
        this.validateQuestion({ video: videoUrl, markers, correctAnswer });
        const questionNumber = this._getNextQuestionNumber();

        const newQuestion = {
            label: `Questão ${questionNumber.toString().padStart(2, "0")}`,
            small_label: questionNumber.toString().padStart(2, "0"),
            video: videoUrl,
            markers: this.normalizeMarkers(markers),
            correctAnswer: correctAnswer,
            originalIndex: questionNumber,
            overlay: null 
        };

        this.project.questions.push(newQuestion);
        this.project.isDirty = true;
        return newQuestion;
    }

    updateQuestion(originalIndex, updatedData) {
        const questionToUpdate = this.project.questions.find(q => q.originalIndex === originalIndex);
        if (questionToUpdate) {
            this.validateQuestion(updatedData);
            Object.assign(questionToUpdate, {
                ...updatedData,
                markers: this.normalizeMarkers(updatedData.markers)
            });
            this.project.isDirty = true;
            return questionToUpdate;
        }
        return null;
    }

    deleteQuestion(originalIndex) {
        const indexToDelete = this.project.questions.findIndex(q => q.originalIndex === originalIndex);
        if (indexToDelete > -1) {
            this.project.questions.splice(indexToDelete, 1);
            this.project.isDirty = true;
            return true;
        }
        return false;
    }

    validateQuestion(question) {
        if (!question.video) throw new Error("Vídeo é obrigatório.");
        if (!question.markers) throw new Error("Marcadores são obrigatórios.");
        if (!question.correctAnswer) throw new Error("Gabarito é obrigatório.");

        const expectedAlternatives = Array.from({ length: this.project.totalAlternatives }, (_, i) => String.fromCharCode(65 + i));
        for (const marker of expectedAlternatives) {
            if (question.markers[marker] === undefined || isNaN(question.markers[marker])) {
                throw new Error(`Marcador para alternativa ${marker} é inválido ou ausente.`);
            }
        }
    }

    normalizeMarkers(markers) {
        return Object.fromEntries(
            Object.entries(markers).map(([key, value]) => [key, parseFloat(parseFloat(value).toFixed(2))])
        );
    }
}

class VideoEditor {
    constructor(videoPlayer, timelineElement) {
        this.videoPlayer = videoPlayer;
        this.timeline = timelineElement;
        this.startTime = 0;
        this.endTime = 0;
        this.isSelecting = false;
        this.isDraggingHandle = null; // Can be 'start' or 'end'
        // REMOVIDO: isScrubbing - mouse colado eliminado

        this.selectionElement = null;
        this.startHandle = null;
        this.endHandle = null;
        this.startTooltip = null;
        this.endTooltip = null;

        // CONTROLE SIMPLES DE CLIQUE DUPLO
        this.lastClickTime = 0;
        this.lastClickPosition = { x: 0, y: 0 };
        this.maxPositionDiff = 10; // pixels de diferença máxima

        // INICIAR DETECTOR DE CLIQUE
        this.initElectronDetector();

        this.init();
    }

    init() {
        // MELHORADO: Busca robusta com múltiplos fallbacks
        this.selectionElement =
            document.getElementById('selectionArea') ||
            document.querySelector('.selection-area');

        this.startHandle =
            document.getElementById('selectionStart') ||
            document.querySelector('.selection-start');

        this.endHandle =
            document.getElementById('selectionEnd') ||
            document.querySelector('.selection-end');

        // Verificação detalhada com logs específicos
        if (!this.selectionElement) {
            console.error('❌ Elemento selectionArea não encontrado (nem por ID nem por classe)');
        } else {
            console.log('✅ Elemento selectionArea encontrado:', this.selectionElement);
        }

        if (!this.startHandle) {
            console.error('❌ Elemento selectionStart não encontrado (nem por ID nem por classe)');
        } else {
            console.log('✅ Elemento selectionStart encontrado:', this.startHandle);
        }

        if (!this.endHandle) {
            console.error('❌ Elemento selectionEnd não encontrado (nem por ID nem por classe)');
        } else {
            console.log('✅ Elemento selectionEnd encontrado:', this.endHandle);
        }

        // Ensure elements exist
        if (!this.selectionElement || !this.startHandle || !this.endHandle) {
            console.error('❌ Falha crítica: Elementos essenciais de seleção não encontrados no HTML');
            console.error('🔍 Verifique se a estrutura HTML está correta');
            return;
        }

        // Get tooltips from HTML com fallback
        this.startTooltip =
            this.startHandle.querySelector('.selection-handle-tooltip') ||
            this.startHandle.querySelector('[class*="tooltip"]');

        this.endTooltip =
            this.endHandle.querySelector('.selection-handle-tooltip') ||
            this.endHandle.querySelector('[class*="tooltip"]');

        console.log('✅ Sistema de seleção inicializado com todos os elementos:', {
            selectionElement: this.selectionElement,
            startHandle: this.startHandle,
            endHandle: this.endHandle,
            startTooltip: this.startTooltip,
            endTooltip: this.endTooltip
        });

        // Main timeline selection events
        this.timeline.addEventListener('mousedown', this.startSelection.bind(this));

        // REMOVIDO: dblclick nativo para evitar conflito com Plano C (Electron)
        // Apenas o detector específico do Electron será usado
        
        // Handle dragging events
        this.startHandle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.isDraggingHandle = 'start';
        });
        this.endHandle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.isDraggingHandle = 'end';
        });

        // REMOVIDO: Listeners globais do constructor para evitar mouse colado
        // Agora são adicionados dinamicamente em startSelection e removidos em endSelection

        // ADICIONAR: Listeners específicos para arrastar agulha (playhead)
        this.setupPlayheadDragging();

        // MELHORIA: Configurar atalhos de teclado para seleção
        this.setupSelectionKeyboardShortcuts();

        // PROFISSIONAL: Configurar ponteiros contextuais automáticos
        this.setupContextualCursors();
    }

    startSelection(e) {
        console.log('🖱️ Clique na timeline! target:', e.target.className, 'modo seleção:', this.isSelectionModeActive);

        // VERIFICAR SE PODE PROCESSAR CLIQUE
        if (!this.canProcessClick(e)) {
            console.log('❌ Clique não pode ser processado');
            return;
        }

        // USAR DETECTOR DE DUPLO CLIQUE
        if (this.electronClickDetector) {
            this.electronClickDetector.detect(e);
        } else {
            console.log('❌ Detector não disponível, usando clique simples');
            this.seekToClickPosition(e);
        }
    }

    canProcessClick(e) {
        // Ignorar se clicou em handles da seleção
        if (e.target === this.startHandle || e.target === this.endHandle) {
            console.log('❌ Clique no handle - ignorando');
            return false;
        }

        // Ignorar se clicou na agulha
        if (e.target.closest('.playhead') || e.target.closest('.playhead-hit-area')) {
            console.log('❌ Clique na agulha - ignorando');
            return false;
        }

        // Ignorar se clicou em marcadores/overlays
        if (e.target.closest('.marker-item') || e.target.closest('.overlay-segment')) {
            console.log('❌ Clique em marcador - ignorando');
            return false;
        }

        // Permitir apenas cliques na área da timeline
        const allowedTargets = ['.timeline-track', '.timeline-progress', '.timeline-bar'];
        const isAllowedTarget = allowedTargets.some(selector =>
            e.target.classList.contains(selector.replace('.', '')) ||
            e.target.closest(selector)
        );

        if (!isAllowedTarget) {
            console.log('❌ Clique fora da timeline - ignorando');
            return false;
        }

        return true;
    }

    // MÉTODO SIMPLES DE NAVEGAÇÃO POR CLIQUE
    seekToClickPosition(e) {
        if (!this.videoPlayer.duration) return;

        // VERIFICAÇÃO 1: Se estiver em modo seleção, ignorar clique simples
        if (this.isSelectionModeActive) {
            console.log('📌 Clique ignorado - modo seleção ativo');
            return;
        }

        // VERIFICAÇÃO 2: Se a agulha estiver oculta (modo seleção), não fazer nada
        const playhead = this.timeline.querySelector('.playhead');
        if (!playhead || playhead.style.display === 'none' || playhead.style.visibility === 'hidden') {
            console.log('📌 Clique ignorado - agulha está oculta');
            return;
        }

        const rect = this.timeline.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickPercent = (clickX / rect.width) * 100;
        const newTime = (clickPercent / 100) * this.videoPlayer.duration;

        // Navegar para posição clicada
        this.videoPlayer.currentTime = newTime;

        // Pausar durante navegação
        if (!this.videoPlayer.paused) {
            this.videoPlayer.pause();
        }

        console.log('📍 Navegou para posição com agulha ativa');
    }

    // MÉTODO PRINCIPAL DE SELEÇÃO (SIMPLES E DIRETO)
    performSelection(e) {
        if (!this.videoPlayer.duration || !isFinite(this.videoPlayer.duration)) return;

        // LIMPAR seleção anterior se existir
        this.clearExistingSelection();

        // Ativar modo seleção
        this.setSelectionMode(true, { trigger: 'double_click' });

        // MARCAR INÍCIO da seleção no ponto clicado
        const rect = this.timeline.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = (x / rect.width);

        this.startTime = percentage * this.videoPlayer.duration;
        this.endTime = null; // Fim ainda não definido

        // Mostrar marcação do início usando VisualStateManager
        VisualStateManager.setState({
            selection: {
                display: 'block'
            }
        });
        this.updateUI();

        console.log(`🎯 INÍCIO marcado em ${formatTime(this.startTime, false)} - Aguardando clique para marcar o FIM`);

        // NÃO adicionar listeners de arrasto - não vamos mais usar arrasto contínuo
        // A seleção do fim será por clique único
    }

    // MÉTODO PARA MARCAR O FIM DA SELEÇÃO
    markSelectionEnd(e) {
        if (!this.isSelectionModeActive || this.startTime === null) return;

        // Calcular posição do clique
        const rect = this.timeline.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = (x / rect.width);
        const clickTime = percentage * this.videoPlayer.duration;

        // Garantir que o fim seja depois do início
        this.endTime = Math.max(this.startTime, clickTime);

        // Atualizar UI para mostrar a seleção completa
        this.updateUI();

        // Tornar handles interativos para ajuste fino
        this.makeHandlesInteractive();

        
        console.log(`🎯 FIM marcado em ${formatTime(this.endTime, false)} - Seleção pronta para cortar`);
        console.log(`📏 Trecho selecionado: ${this.formatDuration(this.endTime - this.startTime)}`);

        // Manter modo seleção ativo para permitir ajustes ou clicar no botão cortar
        // NÃO desativar o modo seleção aqui
    }

    clearExistingSelection() {
        // Remover listeners antigos
        document.removeEventListener('mousemove', this.handleSelectionDrag.bind(this));
        document.removeEventListener('mouseup', this.finishSelection.bind(this));
    }

    // MÉTODO DE ARRASTO DURANTE SELEÇÃO
    handleSelectionDrag(e) {
        if (!this.isSelectionModeActive) return;

        const rect = this.timeline.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const percentage = x / rect.width;
        const time = percentage * this.videoPlayer.duration;

        // Simples: atualizar o fim da seleção durante arrasto
        this.endTime = Math.max(this.startTime, time); // Não permite voltar antes do início

        this.updateUI();
    }

    // MÉTODO DE FINALIZAÇÃO DA SELEÇÃO
    finishSelection() {
        if (!this.isSelectionModeActive) return;

        // Remover listeners de arrasto
        this.clearExistingSelection();

        // Garantir ordem correta
        if (this.startTime > this.endTime) {
            [this.startTime, this.endTime] = [this.endTime, this.startTime];
        }

        // NÃO DESATIVAR modo seleção aqui - manter ativo para confirmação/cancelamento
        // this.setSelectionMode(false, { trigger: 'selection_complete' }); // REMOVIDO

        // Mostrar seleção completa
        this.showSelectionComplete();

        console.log(`✅ Seleção definida: ${this.startTime.toFixed(2)}s - ${this.endTime.toFixed(2)}s (aguardando confirmação)`);
        console.log('📍 Modo seleção MANTIDO aguardando Enter (confirmar) ou ESC (cancelar)');
    }

    showSelectionComplete() {
        
        // Garantir que handles estejam visíveis e interativos
        this.makeHandlesInteractive();
    }

    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // MÉTODO PARA TORNAR HANDLES INTERATIVOS
    makeHandlesInteractive() {
        const setupHandle = (handle, type) => {
            if (!handle) return;

            handle.style.cursor = 'ew-resize';
            handle.style.pointerEvents = 'auto';
            handle.style.zIndex = '1000';
            // A opacidade agora é controlada pela classe .visible em updateUI

            // Clonar para remover listeners antigos e ATUALIZAR A REFERÊNCIA
            const newHandle = handle.cloneNode(true);
            handle.parentNode.replaceChild(newHandle, handle);

            if (type === 'start') {
                this.startHandle = newHandle;
            } else {
                this.endHandle = newHandle;
            }

            // Adicionar novo listener simples
            newHandle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.startHandleAdjustment(type, e);
            });
        };

        setupHandle(this.startHandle, 'start');
        setupHandle(this.endHandle, 'end');

        // Configurar movimento do trecho completo na área central
        this.setupSelectionMovement();
    }

    // MÉTODO PARA MOVER O TRECHO COMPLETO
    setupSelectionMovement() {
        if (!this.selectionElement || this.startTime === null || this.endTime === null) return;

        // Adicionar listener à área central da seleção (não aos handles)
        this.selectionElement.addEventListener('mousedown', (e) => {
            // Ignorar se clicou nos handles
            if (e.target === this.startHandle || e.target === this.endHandle) return;

            e.stopPropagation();
            e.preventDefault();

            console.log('🚀 Iniciando movimento do trecho completo');

            // Adicionar classe visual para movimento
            this.selectionElement.classList.add('moving');

            const duration = this.endTime - this.startTime;
            const rect = this.timeline.getBoundingClientRect();
            const startX = e.clientX - rect.left;
            const startPercentage = startX / rect.width;
            const startOffsetTime = startPercentage * this.videoPlayer.duration - this.startTime;

            const moveHandler = (moveEvent) => {
                const currentX = moveEvent.clientX - rect.left;
                const currentPercentage = currentX / rect.width;
                const currentMiddleTime = currentPercentage * this.videoPlayer.duration;

                // Calcular nova posição mantendo a duração
                const newStartTime = currentMiddleTime - startOffsetTime;
                const newEndTime = newStartTime + duration;

                // Garantir que permaneça dentro dos limites do vídeo
                if (newStartTime >= 0 && newEndTime <= this.videoPlayer.duration) {
                    this.startTime = newStartTime;
                    this.endTime = newEndTime;
                    this.updateUI();
                }

                // Mudar cursor durante movimento usando VisualStateManager
                VisualStateManager.setState({
                    timeline: {
                        interactionState: 'moving_selection'
                    }
                });
            };

            const stopHandler = () => {
                document.removeEventListener('mousemove', moveHandler);
                document.removeEventListener('mouseup', stopHandler);

                // Restaurar cursores e remover feedback visual usando VisualStateManager
                VisualStateManager.setState({
                    timeline: {
                        interactionState: 'idle'
                    }
                });
                this.selectionElement.classList.remove('moving');

                console.log(`✅ Movimento finalizado: ${formatTime(this.startTime, false)} - ${formatTime(this.endTime, false)}`);
            };

            document.addEventListener('mousemove', moveHandler);
            document.addEventListener('mouseup', stopHandler);
        });

        // Configurar cursor da área central usando VisualStateManager
        VisualStateManager.setState({
            selection: {
                cursor: 'move'
            }
        });
    }

    startHandleAdjustment(type, e) {
        console.log(`🎯 Ajustando handle: ${type}`);

        const dragHandler = (moveEvent) => {
            const rect = this.timeline.getBoundingClientRect();
            const x = Math.max(0, Math.min(moveEvent.clientX - rect.left, rect.width));
            const percentage = x / rect.width;
            const time = percentage * this.videoPlayer.duration;

            if (type === 'start') {
                // Garantir que endTime existe antes de usar
                const minEndTime = this.endTime ? this.endTime - 0.1 : time + 0.1;
                this.startTime = Math.min(time, minEndTime);
            } else {
                // Garantir que startTime existe antes de usar
                const maxStartTime = this.startTime ? this.startTime + 0.1 : time - 0.1;
                this.endTime = Math.max(time, maxStartTime);
            }

            this.updateUI();
        };

        const stopHandler = () => {
            document.removeEventListener('mousemove', dragHandler);
            document.removeEventListener('mouseup', stopHandler);
            console.log(`✅ Ajuste finalizado: ${this.formatDuration(this.endTime - this.startTime)}`);
        };

        document.addEventListener('mousemove', dragHandler);
        document.addEventListener('mouseup', stopHandler);
    }

    updateUI() {
        const duration = this.videoPlayer.duration;
        if (!duration) {
            console.warn('⚠️ updateUI() chamado sem duração do vídeo');
            return;
        }

        console.log('🔄 updateUI() chamado:', {
            startTime: this.startTime,
            endTime: this.endTime,
            duration: duration
        });

        // Se o fim ainda não foi definido, mostrar apenas o ponto de início
        if (this.endTime === null) {
            const leftPercent = (this.startTime / duration) * 100;

            console.log('📍 Atualizando UI - seleção parcial (apenas início):', {
                leftPercent: leftPercent.toFixed(2),
                startTime: this.startTime.toFixed(2)
            });

            VisualStateManager.setState({
                selection: {
                    display: 'block',
                    left: leftPercent,
                    width: 1, // Linha fina para marcar o início
                    isActive: true,
                    isPartial: true,
                    startHandleVisible: true, // ATUALIZADO
                    endHandleVisible: false   // ATUALIZADO
                }
            });

            if (this.startTooltip) {
                this.startTooltip.textContent = formatTime(this.startTime, false);
                this.startTooltip.classList.add('visible');
            }
            if (this.endTooltip) {
                this.endTooltip.classList.remove('visible');
            }
        } else {
            // Seleção completa com início e fim
            const left = Math.min(this.startTime, this.endTime);
            const right = Math.max(this.startTime, this.endTime);

            const leftPercent = (left / duration) * 100;
            const widthPercent = ((right - left) / duration) * 100;
            const areHandlesVisible = widthPercent > 0;

            console.log('📍 Atualizando UI - seleção completa:', {
                leftPercent: leftPercent.toFixed(2),
                widthPercent: widthPercent.toFixed(2),
                areHandlesVisible: areHandlesVisible,
                startTime: this.startTime.toFixed(2),
                endTime: this.endTime.toFixed(2)
            });

            VisualStateManager.setState({
                selection: {
                    display: 'block',
                    left: leftPercent,
                    width: widthPercent,
                    isActive: true,
                    isPartial: false,
                    startHandleVisible: areHandlesVisible, // ATUALIZADO
                    endHandleVisible: areHandlesVisible    // ATUALIZADO
                }
            });

            this.startTooltip.textContent = formatTime(this.startTime, false);
            this.endTooltip.textContent = formatTime(this.endTime, false);

            // Usar toggle para simplificar
            this.startTooltip.classList.toggle('visible', areHandlesVisible);
            this.endTooltip.classList.toggle('visible', areHandlesVisible);
        }
    }

    clearSelection() {
        this.startTime = 0;
        this.endTime = 0;

        // Usar VisualStateManager para limpar seleção e handles
        VisualStateManager.setState({
            selection: {
                display: 'none',
                width: 0,
                isActive: false,
                isPartial: false,
                startHandleVisible: false, // ATUALIZADO
                endHandleVisible: false    // ATUALIZADO
            }
        });

        if (this.startTooltip && this.endTooltip) {
            this.startTooltip.classList.remove('visible');
            this.endTooltip.classList.remove('visible');
        }
    }

    // Método para validação de seleção (do VideoCutter)
    validateSelection() {
        if (this.startTime === null || this.endTime === null) {
            showNotification('Selecione um trecho na timeline primeiro (clique duplo).', 'error');
            return false;
        }

        if (this.startTime >= this.endTime) {
            showNotification('O tempo de início deve ser menor que o tempo de fim.', 'error');
            return false;
        }

        if (this.startTime < 0 || this.endTime > this.videoPlayer.duration) {
            showNotification('O intervalo selecionado está fora dos limites do vídeo.', 'error');
            return false;
        }

        // Validar duração mínima
        const minSelectionDuration = 0.5; // 0.5 segundos
        if (this.endTime - this.startTime < minSelectionDuration) {
            showNotification(`Selecione um trecho maior que ${minSelectionDuration} segundos.`, 'error');
            return false;
        }

        return true;
    }

    // Método para obter blob do vídeo (do VideoCutter)
    async getVideoBlob() {
        return new Promise((resolve) => {
            if (this.videoPlayer.src.startsWith('blob:')) {
                fetch(this.videoPlayer.src)
                    .then(response => response.blob())
                    .then(resolve)
                    .catch(() => resolve(null));
            } else {
                resolve(null);
            }
        });
    }

    // Método para mostrar diálogo de salvar (do VideoCutter)
    async showSaveDialog(outputPath) {
        const saveOptions = {
            title: 'Salvar vídeo cortado',
            defaultPath: `video_cortado_${Date.now()}.mp4`,
            filters: [
                { name: 'Vídeos MP4', extensions: ['mp4'] },
                { name: 'Todos os arquivos', extensions: ['*'] }
            ]
        };

        const savePath = await window.electronAPI.showSaveDialog(saveOptions);
        if (savePath && !savePath.canceled) {
            try {
                // Ler o arquivo processado e salvá-lo no local escolhido
                const response = await fetch(`file://${outputPath}`);
                const blob = await response.blob();
                const arrayBuffer = await blob.arrayBuffer();

                // Salvar usando a API do Electron
                await window.electronAPI.saveFile({
                    filePath: savePath.filePath,
                    data: Buffer.from(arrayBuffer)
                });

                showNotification('Vídeo salvo com sucesso!', 'success');
            } catch (copyError) {
                console.error('Erro ao salvar arquivo:', copyError);
                showNotification('Erro ao salvar o arquivo.', 'error');
            }
        }
    }

    // Método para carregar vídeo processado (do VideoCutter)
    async loadProcessedVideo(outputPath, exitEditor = false) {
        try {
            // Criar URL do arquivo para o player
            const fileUrl = `file://${outputPath.replace(/\\\\/g, '/')}`;

            // Carregar o novo vídeo no player
            this.videoPlayer.src = fileUrl;
            this.videoPlayer.load();

            // Aguardar o vídeo carregar e resetar os controles
            this.videoPlayer.onloadedmetadata = () => {
                console.log('Novo vídeo carregado:', fileUrl);

                // Resetar tempos de início e fim
                this.startTime = 0;
                this.endTime = this.videoPlayer.duration;

                // RESTAURAR elementos da timeline após processamento
                this.showPlayheadAgain();
                this.showProgressAgain();
                console.log('🔄 Elementos restaurados após processamento');

                showNotification('Vídeo carregado automaticamente!', 'success');

                // Sair do modo editor se solicitado
                if (exitEditor) {
                    this.exitEditorMode();
                }
            };

        } catch (loadError) {
            console.error('Erro ao carregar vídeo automaticamente:', loadError);
            showNotification('Vídeo cortado, mas erro ao carregar automaticamente.', 'error');
        }
    }

    // REMOVIDO: handleDoubleClick (Plano B) - substituído pelo detector específico do Electron (Plano C)

    // INICIALIZAR DETECTOR ESPECÍFICO DO ELECTRON (PLANO C)
    initElectronDetector() {
        console.log('⚡ ELECTRON: Inicializando detector específico do desktop');

        // MELHORIA: Delay adaptativo baseado no sistema e performance
        this.setupAdaptiveClickDelay();

        // Implementar detector específico para Electron - SEM MOUSE COLADO
        this.electronClickDetector = {
            clicks: 0,
            lastClickTime: 0,
            timer: null,
            pendingEvent: null,

            detect: (e) => {
                console.log('⚡ ELECTRON: Detectando clique... clicks:', this.electronClickDetector.clicks + 1);

                const currentTime = Date.now();

                // Salvar evento para uso posterior
                this.electronClickDetector.pendingEvent = e;

                // Incrementar contador
                this.electronClickDetector.clicks++;
                this.electronClickDetector.lastClickTime = currentTime;

                // LIMPAR TIMER ANTERIOR
                if (this.electronClickDetector.timer) {
                    clearTimeout(this.electronClickDetector.timer);
                }

                // CONFIGURAR TIMER PARA DECISÃO
                this.electronClickDetector.timer = setTimeout(() => {
                    if (this.electronClickDetector.clicks === 2) {
                        console.log('🎯 Duplo clique detectado!');
                        this.performSelection(this.electronClickDetector.pendingEvent);
                    } else {
                        // VERIFICAÇÃO: Se estiver em modo seleção, usar clique para marcar o FIM
                        if (this.isSelectionModeActive) {
                            console.log('📍 Clique para marcar FIM da seleção');
                            this.markSelectionEnd(this.electronClickDetector.pendingEvent);
                        } else {
                            console.log('📍 Clique simples detectado');
                            this.seekToClickPosition(this.electronClickDetector.pendingEvent);
                        }
                    }

                    // RESETAR DETECTOR
                    this.electronClickDetector.clicks = 0;
                    this.electronClickDetector.pendingEvent = null;
                }, this.doubleClickDelay);
            }
        };

        console.log('⚡ ELECTRON: Detector inicializado com delay adaptativo:', this.doubleClickDelay, 'ms');
    }

    setupPlayheadDragging() {
        // Encontrar o elemento playhead na timeline
        const playhead = this.timeline.querySelector('.playhead');
        if (!playhead) {
            console.log('⚠️ Playhead não encontrado - arrastar agulha não ativado');
            return;
        }

        // Estado para controlar arrastar da agulha
        this.isDraggingPlayhead = false;

        // Mouse down na agulha - iniciar arrastar (SALVAR HANDLER para poder remover/restaurar)
        this.playheadMouseDownHandler = (e) => {
            e.stopPropagation(); // Impedir que timeline receba o evento
            e.preventDefault();

            // VERIFICAÇÃO DUPLA: Não permitir arrastar agulha durante seleção
            if (this.isSelectionModeActive) {
                console.log('❌ Agulha desativada durante modo seleção');
                return;
            }

            // VERIFICAÇÃO EXTRA: Agulha deve estar visível
            if (playhead.style.display === 'none' || playhead.style.visibility === 'hidden') {
                console.log('❌ Agulha está oculta - não pode ser arrastada');
                return;
            }

            console.log('🎯 Arrastar agulha iniciado');
            this.isDraggingPlayhead = true;

            // Adicionar listeners globais temporários
            this.playheadMouseMoveHandler = this.handlePlayheadDrag.bind(this);
            this.playheadMouseUpHandler = this.endPlayheadDrag.bind(this);

            document.addEventListener('mousemove', this.playheadMouseMoveHandler);
            document.addEventListener('mouseup', this.playheadMouseUpHandler);
        };

        playhead.addEventListener('mousedown', this.playheadMouseDownHandler);
        this.playheadMouseDownHandlerRemoved = false; // Controle de estado

        console.log('✅ Arrastar agulha ativado com sucesso');
    }

    // MÉTODOS DE DELAY ADAPTATIVO

    setupAdaptiveClickDelay() {
        // Delay padrão otimizado para UX
        this.doubleClickDelay = 200; // Reduzido para melhor responsividade

        // Tentar usar API do Electron se disponível
        if (window.electronAPI && typeof window.electronAPI.getSystemDoubleClickTime === 'function') {
            try {
                // Obter delay do sistema de forma assíncrona
                window.electronAPI.getSystemDoubleClickTime().then(systemDelay => {
                    if (systemDelay && systemDelay > 0) {
                        // Aplicar fator de otimização (75% do delay do sistema para melhor UX)
                        this.doubleClickDelay = Math.max(150, Math.min(400, systemDelay * 0.75));
                        console.log('⚡ ELECTRON: Delay adaptativo otimizado:', this.doubleClickDelay, 'ms (sistema:', systemDelay, 'ms)');
                    } else {
                        console.log('⚡ ELECTRON: Usando delay otimizado padrão:', this.doubleClickDelay, 'ms');
                    }
                }).catch(error => {
                    console.log('⚡ ELECTRON: Erro ao obter delay do sistema, usando padrão otimizado:', error);
                });
            } catch (error) {
                console.log('⚡ ELECTRON: API de delay não disponível, usando padrão otimizado');
            }
        } else {
            // Calcular delay baseado na performance do dispositivo
            this.calculatePerformanceBasedDelay();
        }

        // Detectar mudanças de acessibilidade do sistema
        this.detectAccessibilitySettings();
    }

    calculatePerformanceBasedDelay() {
        // Medir performance do dispositivo
        const start = performance.now();
        let iterations = 0;
        const maxIterations = 100000;

        while (iterations < maxIterations && performance.now() - start < 1) {
            iterations++;
        }

        const opsPerMs = iterations / (performance.now() - start);

        // Ajustar delay baseado na performance
        if (opsPerMs > 50000) {
            // Dispositivo rápido - delay menor
            this.doubleClickDelay = 150;
            console.log('⚡ ELECTRON: Dispositivo rápido detectado, delay:', this.doubleClickDelay, 'ms');
        } else if (opsPerMs > 20000) {
            // Dispositivo médio - delay padrão
            this.doubleClickDelay = 200;
            console.log('⚡ ELECTRON: Dispositivo médio detectado, delay:', this.doubleClickDelay, 'ms');
        } else {
            // Dispositivo mais lento - delay maior para evitar falsos positivos
            this.doubleClickDelay = 300;
            console.log('⚡ ELECTRON: Dispositivo mais lento detectado, delay:', this.doubleClickDelay, 'ms');
        }
    }

    detectAccessibilitySettings() {
        // Verificar preferências de acessibilidade que possam afetar duplo clique
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            this.doubleClickDelay += 100; // Aumentar delay para usuários com sensibilidade
            console.log('⚡ ELECTRON: Preferência de reduzido movimento detectada, delay aumentado:', this.doubleClickDelay, 'ms');
        }

        // Verificar se há preferências de ponteiro fino (indicando precisão)
        if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
            // Usuário com mouse preciso - pode usar delay menor
            this.doubleClickDelay = Math.max(150, this.doubleClickDelay - 50);
            console.log('⚡ ELECTRON: Ponteiro fino detectado, delay otimizado:', this.doubleClickDelay, 'ms');
        }
    }

    handlePlayheadDrag(e) {
        if (!this.isDraggingPlayhead) return;

        // Calcular nova posição na timeline
        const rect = this.timeline.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const percentage = (x / rect.width) * 100;
        const newTime = (percentage / 100) * this.videoPlayer.duration;

        // Atualizar posição do vídeo e da agulha
        if (this.videoPlayer.duration && isFinite(this.videoPlayer.duration)) {
            this.videoPlayer.currentTime = newTime;

            // Atualizar posição visual da agulha imediatamente
            const playhead = this.timeline.querySelector('.playhead');
            if (playhead) {
                playhead.style.left = `${percentage}%`;
            }
        }
    }

    endPlayheadDrag() {
        if (!this.isDraggingPlayhead) return;

        console.log('🎯 Arrastar agulha finalizado');

        // Remover listeners globais
        document.removeEventListener('mousemove', this.playheadMouseMoveHandler);
        document.removeEventListener('mouseup', this.playheadMouseUpHandler);

        this.playheadMouseMoveHandler = null;
        this.playheadMouseUpHandler = null;

        // Simplesmente finalizar arrasto
        this.isDraggingPlayhead = false;
    }

    // MÉTODO DE ATALHOS DE TECLADO

    setupSelectionKeyboardShortcuts() {
        this.keyboardHandler = (e) => {
            // Ignorar se estiver em campos de input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // ESC: Cancelar seleção (modo editor)
            if (e.key === 'Escape') {
                console.log('🔍 ESC pressionado - isSelectionModeActive:', this.isSelectionModeActive);
                if (this.isSelectionModeActive) {
                    e.preventDefault();
                    console.log('🔍 Executando cancelSelection()...');
                    this.cancelSelection();
                    return;
                }
            }

            // Enter: Confirmar seleção e cortar (modo editor)
            if (e.key === 'Enter' && this.isSelectionModeActive) {
                e.preventDefault();
                this.cut(); // Cortar diretamente quando em modo seleção
                return;
            }

            // Delete: Limpar seleção existente
            if (e.key === 'Delete' && !this.isSelecting && this.startTime !== null && this.endTime !== null) {
                e.preventDefault();
                this.clearSelection();
                return;
            }
        };

        document.addEventListener('keydown', this.keyboardHandler);
    }

    cancelSelection() {
        if (!this.isSelecting) return;

        console.log('❌ Seleção cancelada pelo usuário (ESC)');
        
        // Forçar fim da seleção sem validação
        this.isSelecting = false;
        this.isDraggingHandle = null;
        // Usar VisualStateManager para resetar estado
        VisualStateManager.setState({
            timeline: {
                interactionState: 'idle'
            }
        });

        // ESSENCIAL: Nenhuma limpeza complexa necessária

        // Remover listeners
        document.removeEventListener('mousemove', this.updateSelection.bind(this));
        document.removeEventListener('mouseup', this.endSelection.bind(this));

        // Limpar seleção visual usando VisualStateManager
        VisualStateManager.setState({
            selection: {
                display: 'none',
                width: 0,
                isActive: false,
                isPartial: false,
                startHandleVisible: false,
                endHandleVisible: false
            }
        });

        this.startTime = 0;
        this.endTime = 0;

        // Restaurar elementos da timeline após cancelamento
        this.showPlayheadAgain();
        this.showProgressAgain();
        console.log('🔄 Elementos restaurados após cancelamento (isSelecting)');
    }

    confirmSelection() {
        if (!this.isSelecting) return;

        console.log('✅ Seleção confirmada pelo usuário (Enter)');

        // Validar e finalizar seleção
        if (this.validateSelection()) {
            this.endSelection();
        }
    }

    clearSelection() {
        console.log('🗑️ Seleção limpa (Delete)');

        this.startTime = null;
        this.endTime = null;
        // Limpar seleção visual usando VisualStateManager
        VisualStateManager.setState({
            selection: {
                display: 'none',
                width: 0,
                isActive: false,
                isPartial: false,
                startHandleVisible: false,
                endHandleVisible: false
            }
        });

        // Apenas chamar updateUI se houver vídeo disponível
        if (this.videoPlayer && this.videoPlayer.duration) {
            this.updateUI();
        }

            }

    // SISTEMA SIMPLES DE SELEÇÃO (SEM INDICADORES VISUAIS)

    setSelectionMode(isActive, context = {}) {
        this.isSelectionModeActive = isActive;

        if (isActive) {
            console.log('🎯 Modo seleção ATIVADO', context);

            // Atualizar ponteiros para modo seleção
            this.updateCursorsForMode(true);

            // OCULTAR COMPLETAMENTE a agulha E barra de progresso durante seleção
            this.hidePlayheadCompletely();
            this.hideProgressCompletely();
        } else {
            console.log('✅ Modo seleção DESATIVADO', context);

            // Atualizar ponteiros para modo normal
            this.updateCursorsForMode(false);

            // RESTAURAR a agulha E barra de progresso ao sair do modo seleção
            this.showPlayheadAgain();
            this.showProgressAgain();
        }
    }

    // MÉTODOS DE CONTROLE DA AGULHA (PLAYHEAD)

    hidePlayheadCompletely() {
        const playhead = this.timeline.querySelector('.playhead');
        if (playhead) {
            // Salvar estado original
            this.playheadOriginalDisplay = playhead.style.display;
            this.playheadOriginalOpacity = playhead.style.opacity;
            this.playheadOriginalVisibility = playhead.style.visibility;

            // Ocultar completamente
            playhead.style.display = 'none';
            playhead.style.opacity = '0';
            playhead.style.visibility = 'hidden';
            playhead.style.pointerEvents = 'none';

            console.log('📍 Agulha oculta completamente');
        }

        // Também ocultar área de hit da agulha se existir
        const hitArea = this.timeline.querySelector('.playhead-hit-area');
        if (hitArea) {
            hitArea.style.display = 'none';
            hitArea.style.pointerEvents = 'none';
        }

        // REMOVER EVENT LISTENER da agulha para impedir arrastar
        this.removePlayheadDragListeners();
    }

    // MÉTODOS DE CONTROLE DA BARRA DE PROGRESSO

    hideProgressCompletely() {
        const progressBar = this.timeline.querySelector('.timeline-progress');
        if (progressBar) {
            // Salvar estado original
            this.progressOriginalDisplay = progressBar.style.display;
            this.progressOriginalOpacity = progressBar.style.opacity;
            this.progressOriginalVisibility = progressBar.style.visibility;

            // Ocultar completamente
            progressBar.style.display = 'none';
            progressBar.style.opacity = '0';
            progressBar.style.visibility = 'hidden';
            progressBar.style.pointerEvents = 'none';

            console.log('📊 Barra de progresso oculta completamente');
        }
    }

    showPlayheadAgain() {
        const playhead = this.timeline.querySelector('.playhead');
        if (playhead) {
            // Restaurar estado original
            playhead.style.display = this.playheadOriginalDisplay || '';
            playhead.style.opacity = this.playheadOriginalOpacity || '';
            playhead.style.visibility = this.playheadOriginalVisibility || '';
            playhead.style.pointerEvents = 'auto';

            console.log('📍 Agulha restaurada');
        }

        // Restaurar área de hit da agulha se existir
        const hitArea = this.timeline.querySelector('.playhead-hit-area');
        if (hitArea) {
            hitArea.style.display = '';
            hitArea.style.pointerEvents = 'auto';
        }

        // RESTAURAR EVENT LISTENER da agulha
        this.restorePlayheadDragListeners();
    }

    showProgressAgain() {
        const progressBar = this.timeline.querySelector('.timeline-progress');
        if (progressBar) {
            // Restaurar estado original
            progressBar.style.display = this.progressOriginalDisplay || '';
            progressBar.style.opacity = this.progressOriginalOpacity || '';
            progressBar.style.visibility = this.progressOriginalVisibility || '';
            progressBar.style.pointerEvents = 'auto';

            console.log('📊 Barra de progresso restaurada');
        }
    }

    // MÉTODOS PARA CONTROLE DE EVENT LISTENERS DA AGULHA

    removePlayheadDragListeners() {
        const playhead = this.timeline.querySelector('.playhead');
        if (playhead && this.playheadMouseDownHandler) {
            playhead.removeEventListener('mousedown', this.playheadMouseDownHandler);
            this.playheadMouseDownHandlerRemoved = true;
            console.log('🔇 Event listener da agulha removido');
        }
    }

    restorePlayheadDragListeners() {
        const playhead = this.timeline.querySelector('.playhead');
        if (playhead && this.playheadMouseDownHandlerRemoved && this.playheadMouseDownHandler) {
            playhead.addEventListener('mousedown', this.playheadMouseDownHandler);
            this.playheadMouseDownHandlerRemoved = false;
            console.log('🔊 Event listener da agulha restaurado');
        }
    }

    // SISTEMA PROFISSIONAL DE PONTEIROS CONTEXTUAIS

    setupContextualCursors() {
        console.log('🎯 Configurando ponteiros contextuais automáticos...');

        this.setupTimelineCursors();
        this.setupPlayheadCursors();
        this.setupSelectionHandleCursors();
        this.setupMarkerCursors();
        this.setupResizeHandleCursors();

        console.log('✅ Ponteiros contextuais configurados');
    }

    setupTimelineCursors() {
        const timelineTrack = this.timeline;

        // Estado normal: cursor padrão
        timelineTrack.addEventListener('mouseenter', () => {
            if (!this.isSelectionModeActive) {
                VisualStateManager.setState({
                    timeline: {
                        interactionState: 'idle'
                    }
                });
            }
        });

        // Mouse entrando na timeline em modo seleção (com debouncing)
        const debouncedMouseMoveHandler = VisualStateManager.debounce((e) => {
            if (this.isSelectionModeActive) {
                VisualStateManager.setState({
                    timeline: {
                        interactionState: 'selecting_cut'
                    }
                }, true); // Usar batch para melhor performance
            } else {
                // Verificar se está sobre a área de clique único vs arraste
                const rect = timelineTrack.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const isOverClickableArea = this.isOverClickableArea(x);

                const state = isOverClickableArea ? 'hovering_timeline' : 'idle';
                VisualStateManager.setState({
                    timeline: {
                        interactionState: state
                    }
                }, true); // Usar batch para melhor performance
            }
        }, 16); // ~60fps

        timelineTrack.addEventListener('mousemove', debouncedMouseMoveHandler);
    }

    setupPlayheadCursors() {
        const playhead = this.timeline.querySelector('.playhead');
        if (!playhead) return;

        // Mouse sobre a agulha (modo normal)
        playhead.addEventListener('mouseenter', () => {
            if (!this.isSelectionModeActive && !this.isDraggingPlayhead) {
                VisualStateManager.setState({
                    playhead: {
                        cursor: 'grab'
                    }
                });
            }
        });

        // Iniciando arraste da agulha
        playhead.addEventListener('mousedown', () => {
            if (!this.isSelectionModeActive) {
                VisualStateManager.setState({
                    playhead: {
                        cursor: 'grabbing'
                    },
                    timeline: {
                        interactionState: 'dragging_playhead'
                    }
                });
            }
        });

        // Mouse saindo da agulha
        playhead.addEventListener('mouseleave', () => {
            if (!this.isDraggingPlayhead) {
                VisualStateManager.setState({
                    playhead: {
                        cursor: ''
                    }
                });
                if (!this.isSelectionModeActive) {
                    VisualStateManager.setState({
                        timeline: {
                            interactionState: 'idle'
                        }
                    });
                }
            }
        });
    }

    setupSelectionHandleCursors() {
        // Handles de seleção (início e fim)
        const setupHandleCursor = (handleSelector) => {
            const handle = document.querySelector(handleSelector);
            if (!handle) return;

            handle.addEventListener('mouseenter', () => {
                VisualStateManager.setState({
                    timeline: {
                        interactionState: 'resizing_selection'
                    }
                });
            });

            handle.addEventListener('mousedown', () => {
                VisualStateManager.setState({
                    timeline: {
                        interactionState: 'resizing_selection_active'
                    }
                });
            });

            handle.addEventListener('mouseup', () => {
                VisualStateManager.setState({
                    timeline: {
                        interactionState: 'resizing_selection'
                    }
                });
            });
        };

        setupHandleCursor('.selection-handle-start');
        setupHandleCursor('.selection-handle-end');
    }

    setupMarkerCursors() {
        // Marcadores na timeline
        const setupMarkerCursor = (marker) => {
            marker.addEventListener('mouseenter', () => {
                VisualStateManager.setState({
                    timeline: {
                        interactionState: 'hovering_marker'
                    }
                });
            });

            marker.addEventListener('mousedown', () => {
                VisualStateManager.setState({
                    timeline: {
                        interactionState: 'dragging_marker'
                    }
                });
            });

            marker.addEventListener('mouseup', () => {
                VisualStateManager.setState({
                    timeline: {
                        interactionState: 'hovering_marker'
                    }
                });
            });
        };

        // Aplicar a marcadores existentes
        document.querySelectorAll('.marker-item').forEach(setupMarkerCursor);

        // Observer para novos marcadores
        const markerObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.classList && node.classList.contains('marker-item')) {
                        setupMarkerCursor(node);
                    }
                });
            });
        });

        const markersTrack = document.querySelector('.markers-track');
        if (markersTrack) {
            markerObserver.observe(markersTrack, { childList: true });
        }
    }

    setupResizeHandleCursors() {
        // Handles de redimensionamento (sidebar, painéis)
        const resizeHandles = document.querySelectorAll('.resize-handle, .panel-details-resize-handle');

        resizeHandles.forEach(handle => {
            handle.addEventListener('mouseenter', () => {
                if (handle.classList.contains('panel-details-resize-handle')) {
                    handle.style.cursor = 'row-resize';
                } else {
                    handle.style.cursor = 'col-resize';
                }
            });

            handle.addEventListener('mousedown', () => {
                if (handle.classList.contains('panel-details-resize-handle')) {
                    document.body.style.cursor = 'row-resize';
                } else {
                    document.body.style.cursor = 'col-resize';
                }
            });
        });
    }

    isOverClickableArea(x) {
        // Verificar se o mouse está sobre áreas clicáveis específicas
        const playhead = this.timeline.querySelector('.playhead');
        if (playhead) {
            const playheadRect = playhead.getBoundingClientRect();
            const timelineRect = this.timeline.getBoundingClientRect();
            const playheadX = playheadRect.left - timelineRect.left;

            // Se estiver muito próximo da agulha, mostrar pointer
            if (Math.abs(x - playheadX) < 10) {
                return true;
            }
        }

        return false;
    }

    updateCursorsForMode(isSelectionMode) {
        // Usar VisualStateManager para controle de cursor
        const state = isSelectionMode ? 'selecting_cut' : 'idle';
        VisualStateManager.setState({
            timeline: {
                interactionState: state
            }
        });
    }

    // MÉTODO DE ATALHOS DE TECLADO (ESSENCIAL)

    setupSelectionKeyboardShortcuts() {
        this.keyboardHandler = (e) => {
            // Ignorar se estiver em campos de input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // ESC: Cancelar seleção (modo editor)
            if (e.key === 'Escape') {
                console.log('🔍 ESC pressionado - isSelectionModeActive:', this.isSelectionModeActive);
                if (this.isSelectionModeActive) {
                    e.preventDefault();
                    console.log('🔍 Executando cancelSelection()...');
                    this.cancelSelection();
                    return;
                }
            }

            // Enter: Confirmar seleção e cortar (modo editor)
            if (e.key === 'Enter' && this.isSelectionModeActive) {
                e.preventDefault();
                this.cut(); // Cortar diretamente quando em modo seleção
                return;
            }

            // Delete: Limpar seleção existente
            if (e.key === 'Delete' && !this.isSelecting && this.startTime !== null && this.endTime !== null) {
                e.preventDefault();
                this.clearSelection();
                return;
            }
        };

        document.addEventListener('keydown', this.keyboardHandler);
    }

    cancelSelection() {
        if (!this.isSelectionModeActive) return;

        console.log('❌ Seleção cancelada pelo usuário (ESC)');
        
        // Remover listeners
        document.removeEventListener('mousemove', this.handleSelectionDrag.bind(this));
        document.removeEventListener('mouseup', this.finishSelection.bind(this));

        // Limpar seleção visual
        // Limpar seleção visual usando VisualStateManager
        VisualStateManager.setState({
            selection: {
                display: 'none',
                width: 0,
                isActive: false,
                isPartial: false,
                startHandleVisible: false,
                endHandleVisible: false
            }
        });
        this.startTime = 0;
        this.endTime = 0;

        // Desativar modo seleção (isso já restaurará agulha e barra de progresso)
        this.setSelectionMode(false, { trigger: 'cancelled' });

        console.log('🔄 Elementos restaurados após cancelamento');
    }

    confirmSelection() {
        if (!this.isSelecting) return;

        console.log('✅ Seleção confirmada pelo usuário (Enter)');
        this.endSelection(); // Simplificado - usa validação básica já em endSelection
    }

    clearSelection() {
        console.log('🗑️ Seleção limpa (Delete)');

        this.startTime = null;
        this.endTime = null;
        // Limpar seleção visual usando VisualStateManager
        VisualStateManager.setState({
            selection: {
                display: 'none',
                width: 0,
                isActive: false,
                isPartial: false,
                startHandleVisible: false,
                endHandleVisible: false
            }
        });

        // Apenas chamar updateUI se houver vídeo disponível
        if (this.videoPlayer && this.videoPlayer.duration) {
            this.updateUI();
        }

            }

    // MÉTODOS ESSENCIAIS APENAS

    // Método para sair do modo editor (do VideoCutter)
    exitEditorMode() {
        try {
            const editorControls = document.getElementById('editorControls');
            const playerControls = document.getElementById('playerControls');
            const editorToggleBtn = document.getElementById('editorToggleBtn');

            if (editorControls && playerControls && editorToggleBtn) {
                // Ocultar controles do editor e mostrar controles do player
                editorControls.style.display = 'none';
                playerControls.style.display = 'flex';

                // Atualizar ícone do botão toggle
                const icon = editorToggleBtn.querySelector('i');
                if (icon) {
                    icon.classList.remove('fa-film');
                    icon.classList.add('fa-edit');
                    editorToggleBtn.setAttribute('aria-label', 'Alternar modo editor');
                }

                console.log('Modo editor desativado automaticamente');
            }
        } catch (error) {
            console.error('Erro ao sair do modo editor:', error);
        }
    }

    async cut() {
        if (!this.validateSelection()) {
            return;
        }

        // Ocultar elementos da timeline durante processamento
        this.hidePlayheadCompletely();
        this.hideProgressCompletely();
        console.log('🔄 Elementos ocultos para processamento de corte');

        // Obter o caminho do arquivo de vídeo
        let inputPath = videoPaths.get(currentVideoURL);

        // Se não encontrar caminho no mapa, tentar com blob
        if (!inputPath && currentVideoURL && currentVideoURL.startsWith('blob:')) {
            const videoBlob = await this.getVideoBlob();
            if (!videoBlob) {
                showNotification('Não foi possível obter o blob do vídeo', 'error');
                return;
            }

            const arrayBuffer = await videoBlob.arrayBuffer();
            const tempFileResult = await window.electronAPI.saveTempFile({
                buffer: arrayBuffer,
                extension: '.mp4'
            });

            if (!tempFileResult) {
                showNotification('Não foi possível salvar arquivo temporário', 'error');
                return;
            }

            inputPath = tempFileResult;
        }

        if (!inputPath) {
            showNotification("Não foi possível encontrar o caminho do vídeo original.", "error");
            return;
        }

                try {
            const result = await window.electronAPI.trimVideo({
                inputPath: inputPath,
                startTime: this.startTime,
                endTime: this.endTime
            });

            if (result.success) {
                showNotification('Trecho removido com sucesso!', 'success');

                // Carregar automaticamente o vídeo cortado no player e sair do modo editor
                if (result.autoLoad && result.outputPath) {
                    await this.loadProcessedVideo(result.outputPath, true); // Forçar saída do modo editor
                } else if (result.outputPath) {
                    await this.showSaveDialog(result.outputPath);
                    // Mesmo se salvar manualmente, sair do modo editor
                    this.setSelectionMode(false, { trigger: 'cut_completed' });
                }
            } else {
                throw new Error(result.error || 'Erro desconhecido');
            }
        } catch (error) {
            console.error('Erro ao cortar vídeo:', error);
            showNotification(`Erro ao cortar vídeo: ${error.message}`, "error");
        }
    }
}


let questionManager = new QuestionManager(currentProject);
let videoEditor;

// SEM VARIÁVEIS GLOBAIS DE MODO - Sistema simplificado

// ---------------------------------------------------------------------------------
// 3. RENDERIZAÇÃO E ATUALIZAÇÃO DA UI
// ---------------------------------------------------------------------------------

// Estado da aplicação para timeline avançada
const timelineState = {
    isPlaying: false,
    currentTime: 0, // Posição atual em percentual (iniciar no zero)
    selectedMarker: null,
    selectedOverlay: null,
    zoomLevel: 1,
    markerCount: 4,
    overlayCount: 3,
    currentMarkers: {}, // Marcadores dos botões A,B,C,D (unificado com o sistema legado)
    // Otimização: cache de elementos DOM
    domCache: {
        playhead: null,
        playheadHitArea: null,
        playheadTimeTooltip: null,
        progress: null,
        currentTimeElement: null,
        markerDropIndicator: null,
        overlayDropIndicator: null,
        markerPositionIndicator: null,
        overlayPositionIndicator: null,
        markerPlayheadConnection: null,
        overlayPlayheadConnection: null,
        timelineWrapper: null
    },
    // Otimização: variáveis para rastreamento de arrasto
    dragState: {
        isDragging: false,
        element: null,
        track: null,
        dropIndicator: null,
        positionIndicator: null,
        initialX: 0,
        initialLeft: 0,
        initialWidth: 0,
        isResizing: false,
        isDraggingPlayhead: false,
        // Novo: tipo de interação unificado
        interactionType: null, // 'move' | 'resize-left' | 'resize-right' | 'move-playhead'
        resizeHandle: null // 'left' | 'right'
    },
    // Otimização: cache de dimensões para eliminar queries DOM repetitivas
    dimensionCache: {
        trackWidth: 0,
        timelineWidth: 0,
        lastCacheUpdate: 0,
        cacheTimeout: 16, // ~60fps throttling
        resizeObserver: null,

        // Método para obter largura em cache
        getTrackWidth() {
            const now = performance.now();
            if (now - this.lastCacheUpdate < this.cacheTimeout && this.trackWidth > 0) {
                return this.trackWidth;
            }

            if (timelineState.dragState && timelineState.dragState.track) {
                this.trackWidth = timelineState.dragState.track.offsetWidth;
                this.lastCacheUpdate = now;
                console.log(`🔄 Cache atualizado: trackWidth=${this.trackWidth}px`);
            }
            return this.trackWidth;
        },

        // Método para obter largura da timeline
        getTimelineWidth() {
            const now = performance.now();
            if (now - this.lastCacheUpdate < this.cacheTimeout && this.timelineWidth > 0) {
                return this.timelineWidth;
            }

            if (timelineState.domCache && timelineState.domCache.timelineWrapper) {
                this.timelineWidth = timelineState.domCache.timelineWrapper.offsetWidth;
                this.lastCacheUpdate = now;
            }
            return this.timelineWidth;
        },

        // Invalidar cache forçadamente
        invalidate() {
            this.lastCacheUpdate = 0;
            console.log('🗑️ Cache de dimensões invalidado');
        },

        // Inicializar ResizeObserver para invalidação automática
        initResizeObserver() {
            if (window.ResizeObserver && timelineState.domCache.timelineWrapper) {
                this.resizeObserver = new ResizeObserver(() => {
                    this.invalidate();
                });
                this.resizeObserver.observe(timelineState.domCache.timelineWrapper);
                console.log('📏 ResizeObserver configurado para cache de dimensões');
            }
        }
    },
    // Otimização: registry de eventos para prevenir memory leaks
    eventRegistry: {
        listeners: [],
        animationFrames: [],
        timeouts: [],
        intervals: [],

        // Registrar event listener com cleanup automático
        register(element, event, handler, options = null) {
            element.addEventListener(event, handler, options);
            this.listeners.push({ element, event, handler, options });
            console.log(`📝 Evento registrado: ${event} em ${element.tagName}${element.id ? '#' + element.id : ''}`);
        },

        // Registrar animation frame com cleanup automático
        registerAnimationFrame(callback) {
            const frameId = requestAnimationFrame(callback);
            this.animationFrames.push(frameId);
            return frameId;
        },

        // Registrar timeout com cleanup automático
        registerTimeout(callback, delay) {
            const timeoutId = setTimeout(callback, delay);
            this.timeouts.push(timeoutId);
            return timeoutId;
        },

        // Registrar interval com cleanup automático
        registerInterval(callback, delay) {
            const intervalId = setInterval(callback, delay);
            this.intervals.push(intervalId);
            return intervalId;
        },

        // Remover listener específico
        removeListener(element, event, handler) {
            element.removeEventListener(event, handler);
            const index = this.listeners.findIndex(l =>
                l.element === element && l.event === event && l.handler === handler
            );
            if (index > -1) {
                this.listeners.splice(index, 1);
            }
        },

        // Limpar todos os recursos (para prevenir memory leaks)
        cleanup() {
            console.log(`🧹 Limpando ${this.listeners.length} event listeners, ${this.animationFrames.length} animation frames, ${this.timeouts.length} timeouts, ${this.intervals.length} intervals`);

            // Remover todos os event listeners
            this.listeners.forEach(({ element, event, handler, options }) => {
                try {
                    element.removeEventListener(event, handler, options);
                } catch (error) {
                    console.warn('⚠️ Erro ao remover event listener:', error);
                }
            });

            // Cancelar todos os animation frames
            this.animationFrames.forEach(id => {
                try {
                    cancelAnimationFrame(id);
                } catch (error) {
                    console.warn('⚠️ Erro ao cancelar animation frame:', error);
                }
            });

            // Limpar todos os timeouts
            this.timeouts.forEach(id => {
                try {
                    clearTimeout(id);
                } catch (error) {
                    console.warn('⚠️ Erro ao limpar timeout:', error);
                }
            });

            // Limpar todos os intervals
            this.intervals.forEach(id => {
                try {
                    clearInterval(id);
                } catch (error) {
                    console.warn('⚠️ Erro ao limpar interval:', error);
                }
            });

            // Resetar arrays
            this.listeners = [];
            this.animationFrames = [];
            this.timeouts = [];
            this.intervals = [];

            console.log('✅ Cleanup de eventos concluído');
        },

        // Obter estatísticas para debugging
        getStats() {
            return {
                listeners: this.listeners.length,
                animationFrames: this.animationFrames.length,
                timeouts: this.timeouts.length,
                intervals: this.intervals.length
            };
        }
    }
};

// Inicializar cache de elementos DOM para timeline
function initTimelineDOMCache() {
    timelineState.domCache.playhead = document.getElementById('playhead');
    timelineState.domCache.playheadHitArea = document.getElementById('playheadHitArea');
    timelineState.domCache.playheadTimeTooltip = document.getElementById('playheadTimeTooltip');
    timelineState.domCache.progress = document.querySelector('.timeline-progress');
    timelineState.domCache.currentTimeElement = document.querySelector('.time-info .font-mono:first-child');
    timelineState.domCache.durationElement = document.querySelector('.time-info span .font-mono:last-child');
    timelineState.domCache.markerDropIndicator = document.getElementById('markerDropIndicator');
    timelineState.domCache.overlayDropIndicator = document.getElementById('overlayDropIndicator');
    timelineState.domCache.markerPositionIndicator = document.getElementById('markerPositionIndicator');
    timelineState.domCache.overlayPositionIndicator = document.getElementById('overlayPositionIndicator');
    timelineState.domCache.markerPlayheadConnection = document.getElementById('markerPlayheadConnection');
    timelineState.domCache.overlayPlayheadConnection = document.getElementById('overlayPlayheadConnection');
    timelineState.domCache.timelineWrapper = document.querySelector('.timeline-wrapper');

    // Inicializar sistema de cache de dimensões
    timelineState.dimensionCache.initResizeObserver();
    console.log('✅ Sistema de cache de dimensões inicializado');
}

// Gerar ticks da ruler avançada
function generateTimelineRuler() {
    const ruler = document.getElementById('timelineRuler');
    if (!ruler) return;

    ruler.innerHTML = '';
    const duration = 100; // Duração total em segundos (exemplo)
    const majorInterval = 10; // Intervalo maior a cada 10 segundos
    const minorInterval = 2;  // Intervalo menor a cada 2 segundos

    for (let i = 0; i <= duration; i += minorInterval) {
        const tick = document.createElement('div');
        tick.className = `ruler-tick ${i % majorInterval === 0 ? 'major' : 'minor'}`;
        tick.style.left = `${(i / duration) * 100}%`;

        ruler.appendChild(tick);

        // Adicionar labels nos ticks maiores
        if (i % majorInterval === 0) {
            const label = document.createElement('div');
            label.className = 'ruler-label';
            label.textContent = formatTimeWithMilliseconds(i);
            label.style.left = `${(i / duration) * 100}%`;
            ruler.appendChild(label);
        }
    }
}

// OTIMIZAÇÃO: Sistema de Event Delegation para performance
class TimelineEventDelegator {
    constructor() {
        this.handlers = new Map();
        this.isDelegating = false;
        this.setupDelegation();
    }

    setupDelegation() {
        const timeline = document.querySelector('.timeline');
        if (!timeline) {
            console.warn('⚠️ Timeline não encontrada para configuração de event delegation');
            return;
        }

        // Usar o registry de eventos para prevenir memory leaks
        timelineState.eventRegistry.register(timeline, 'mousedown', this.handleMouseDown.bind(this));
        timelineState.eventRegistry.register(document, 'mousemove', this.handleMouseMove.bind(this));
        timelineState.eventRegistry.register(document, 'mouseup', this.handleMouseUp.bind(this));

        this.isDelegating = true;
        console.log('✅ Event delegation configurado para timeline');
    }

    handleMouseDown(e) {
        const target = this.findTimelineTarget(e.target);
        if (!target) return;

        const eventType = this.getEventType(target, e);
        const handler = this.handlers.get(eventType);

        if (handler) {
            console.log(`🎯 Event delegation: ${eventType} acionado para`, target);
            handler(e, target);
        } else {
            console.warn(`⚠️ Nenhum handler encontrado para evento: ${eventType}`);
        }
    }

    handleMouseMove(e) {
        if (!timelineState.dragState.isDragging) return;

        const target = timelineState.dragState.element;
        if (!target) return;

        const eventType = this.getDragEventType();
        const handler = this.handlers.get(eventType);

        if (handler) {
            handler(e, target);
        }
    }

    handleMouseUp(e) {
        if (!timelineState.dragState.isDragging) return;

        const eventType = 'drag-end';
        const handler = this.handlers.get(eventType);

        if (handler) {
            handler(e, timelineState.dragState.element);
        }

        // Resetar drag state
        this.resetDragState();
    }

    findTimelineTarget(target) {
        // Encontrar o elemento timeline INTERATIVO mais próximo (ignorando o wrapper)
        return target.closest('.overlay-segment, .marker-item, .playhead, .playhead-hit-area, .timeline-handle');
    }

    getEventType(target, event) {
        if (target.classList.contains('overlay-segment')) {
            // Verificar se está no handle de redimensionamento
            const rect = target.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const isLeftHandle = x < 10; // 10px da esquerda
            const isRightHandle = x > rect.width - 10; // 10px da direita

            if (isLeftHandle) return 'overlay-resize-left';
            if (isRightHandle) return 'overlay-resize-right';
            return 'overlay-move';
        }

        if (target.classList.contains('marker-item')) return 'marker-move';
        if (target.classList.contains('playhead') || target.classList.contains('playhead-hit-area')) return 'playhead-move';
        if (target.classList.contains('timeline-handle')) return 'timeline-resize';

        return 'unknown';
    }

    getDragEventType() {
        const interactionType = timelineState.dragState.interactionType;
        if (interactionType) return interactionType;

        // Fallback baseado no elemento
        if (timelineState.dragState.element) {
            if (timelineState.dragState.element.classList.contains('overlay-segment')) return 'overlay-drag';
            if (timelineState.dragState.element.classList.contains('marker-item')) return 'marker-drag';
            if (timelineState.dragState.element.classList.contains('playhead')) return 'playhead-drag';
        }

        return 'generic-drag';
    }

    resetDragState() {
        timelineState.dragState.isDragging = false;
        timelineState.dragState.element = null;
        timelineState.dragState.interactionType = null;
        timelineState.dragState.resizeHandle = null;
    }

    // Registrar handlers para diferentes tipos de eventos
    register(eventType, handler) {
        this.handlers.set(eventType, handler);
        console.log(`📝 Handler registrado para: ${eventType}`);
    }

    // Remover handler específico
    unregister(eventType) {
        this.handlers.delete(eventType);
        console.log(`🗑️ Handler removido para: ${eventType}`);
    }

    // Obter estatísticas
    getStats() {
        return {
            isDelegating: this.isDelegating,
            handlersCount: this.handlers.size,
            registeredEvents: Array.from(this.handlers.keys())
        };
    }
}

// OTIMIZAÇÃO: Sistema de batching para atualizações DOM
class DOMUpdateBatcher {
    constructor() {
        this.pendingReads = [];
        this.pendingWrites = [];
        this.isScheduled = false;
        this.frameId = null;
        this.stats = {
            totalBatches: 0,
            totalReads: 0,
            totalWrites: 0,
            averageFrameTime: 0
        };
    }

    // Agendar operação de leitura
    read(fn) {
        this.pendingReads.push(fn);
        this.schedule();
    }

    // Agendar operação de escrita
    write(fn) {
        this.pendingWrites.push(fn);
        this.schedule();
    }

    // Agendar ambas as operações
    readWrite(readFn, writeFn) {
        this.read(readFn);
        this.write(writeFn);
    }

    // Agendar execução no próximo frame
    schedule() {
        if (this.isScheduled) return;

        this.isScheduled = true;
        this.frameId = timelineState.eventRegistry.registerAnimationFrame(() => {
            this.flush();
        });
    }

    // Executar todas as operações pendentes
    flush() {
        const startTime = performance.now();

        try {
            // Executar todas as leituras primeiro
            const readResults = [];
            this.pendingReads.forEach(readFn => {
                try {
                    const result = readFn();
                    readResults.push(result);
                } catch (error) {
                    console.warn('⚠️ Erro na operação de leitura:', error);
                }
            });

            // Executar todas as escritas
            this.pendingWrites.forEach(writeFn => {
                try {
                    writeFn();
                } catch (error) {
                    console.warn('⚠️ Erro na operação de escrita:', error);
                }
            });

            // Atualizar estatísticas
            this.stats.totalBatches++;
            this.stats.totalReads += this.pendingReads.length;
            this.stats.totalWrites += this.pendingWrites.length;

            const frameTime = performance.now() - startTime;
            this.stats.averageFrameTime = (this.stats.averageFrameTime + frameTime) / 2;

            // Logging detalhado para debugging
            if (this.pendingReads.length > 0 || this.pendingWrites.length > 0) {
                console.log(`⚡ DOM Batch: ${this.pendingReads.length} reads, ${this.pendingWrites.length} writes, ${frameTime.toFixed(2)}ms`);
            }

        } finally {
            // Limpar e resetar para o próximo frame
            this.pendingReads = [];
            this.pendingWrites = [];
            this.isScheduled = false;
            this.frameId = null;
        }
    }

    // Forçar execução imediata (para casos críticos)
    flushNow() {
        if (this.frameId) {
            cancelAnimationFrame(this.frameId);
            this.frameId = null;
        }
        this.isScheduled = false;
        this.flush();
    }

    // Obter estatísticas de performance
    getStats() {
        return { ...this.stats };
    }

    // Resetar estatísticas
    resetStats() {
        this.stats = {
            totalBatches: 0,
            totalReads: 0,
            totalWrites: 0,
            averageFrameTime: 0
        };
    }
}

// Instância global do sistema de batching
const domBatcher = new DOMUpdateBatcher();

// Instância global do sistema de event delegation
const timelineEventDelegator = new TimelineEventDelegator();

// Configurar handlers para eventos da timeline usando event delegation
function setupTimelineEventHandlers() {
    // Handler para movimento de overlay
    timelineEventDelegator.register('overlay-move', (e, target) => {
        startOverlayInteraction(target, e.clientX, 'move');
    });

    // Handlers para redimensionamento de overlay
    timelineEventDelegator.register('overlay-resize-left', (e, target) => {
        startOverlayInteraction(target, e.clientX, 'resize-left');
    });

    timelineEventDelegator.register('overlay-resize-right', (e, target) => {
        startOverlayInteraction(target, e.clientX, 'resize-right');
    });

    // Handler para movimento de marcadores
    timelineEventDelegator.register('marker-move', (e, target) => {
        startDraggingAdvancedMarker(e, target);
    });

    // Handler para movimento do playhead
    timelineEventDelegator.register('playhead-move', (e, target) => {
        startDraggingAdvancedPlayhead(e);
    });

    // Handler para drag genérico (mouse move)
    timelineEventDelegator.register('move', handleAdvancedMouseMove);
    timelineEventDelegator.register('resize-left', (e, target) => {
        handleOverlayResize('resize-left', 0);
    });
    timelineEventDelegator.register('resize-right', (e, target) => {
        handleOverlayResize('resize-right', 0);
    });

    // Handler para fim do drag
    timelineEventDelegator.register('drag-end', (e, target) => {
        handleAdvancedMouseUp(e);
    });

    console.log('✅ Event handlers da timeline configurados com event delegation');
}

// Formatar tempo em MM:SS.mmm (avançado)
function formatTimeWithMilliseconds(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

// Otimização: função para atualizar posição com DOM batching
function updateTimelinePlayheadPosition(position, useTransition = true) {
    // Limitar entre 0 e 100
    position = Math.max(0, Math.min(position, 100));

    if (!timelineState.domCache.playhead || !timelineState.domCache.progress) return;

    // OTIMIZAÇÃO: Usar DOM batching para melhor performance
    domBatcher.write(() => {
        // Operações de leitura (movidas para dentro da escrita)
        const isTooltipActive = timelineState.domCache.playheadTimeTooltip &&
                                timelineState.domCache.playheadTimeTooltip.classList.contains('active');
        const totalSeconds = (position / 100) * 100;
        const formattedTime = formatTimeWithMilliseconds(totalSeconds);

        // Usar VisualStateManager para atualização centralizada
        VisualStateManager.setState({
            playhead: {
                position,
                isDragging: !useTransition
            },
            progress: {
                width: position
            },
            timeline: {
                currentTime: position
            }
        }, true);

        // Atualizar estado
        timelineState.currentTime = position;

        // Atualizar tempo atual
        if (timelineState.domCache.currentTimeElement) {
            timelineState.domCache.currentTimeElement.textContent = formattedTime;
        }

        // Atualizar tooltip se estiver visível
        if (isTooltipActive) {
            timelineState.domCache.playheadTimeTooltip.textContent = formattedTime;
            VisualStateManager.setState({
                timeline: {
                    tooltipPosition: position
                }
            }, true);
        }
    });
}

// Selecionar marcador para controle via teclado
function selectAdvancedMarker(marker) {
    // Remover seleção anterior
    if (timelineState.selectedMarker) {
        timelineState.selectedMarker.classList.remove('selected');
    }

    // Limpar seleção de overlay se houver
    if (timelineState.selectedOverlay) {
        timelineState.selectedOverlay.classList.remove('selected');
        timelineState.selectedOverlay = null;
    }

    // Selecionar novo marcador
    timelineState.selectedMarker = marker;
    marker.classList.add('selected');

    // Mover playhead para o marcador
    const position = parseFloat(marker.style.left);
    updateTimelinePlayheadPosition(position);
}

// Implementar drag-and-drop avançado
function initAdvancedDragAndDrop() {
    // REMOVIDO: Listener global conflitante que causava problemas com seleção
    // O VideoEditor agora trata seus próprios eventos sem conflitos
    // document.addEventListener('mousedown', handleAdvancedMouseDown);

    // OTIMIZAÇÃO: Usar registry de eventos para prevenir memory leaks
    timelineState.eventRegistry.register(document, 'mousemove', handleAdvancedMouseMove);
    timelineState.eventRegistry.register(document, 'mouseup', handleAdvancedMouseUp);

    // Prevenir comportamento padrão de arrastar para imagens e links
    timelineState.eventRegistry.register(document, 'dragstart', e => e.preventDefault());
}

function handleAdvancedMouseDown(e) {
    const target = e.target;

    // Verificar se é o playhead ou sua área de clique
    if (target === timelineState.domCache.playhead || target === timelineState.domCache.playheadHitArea) {
        startDraggingAdvancedPlayhead(e);
        return;
    }

    // Verificar se é um marcador
    if (target.classList.contains('marker-item')) {
        startDraggingAdvancedMarker(e, target);
        return;
    }

    // Verificar se é um overlay ou seu handle de redimensionamento
    if (target.classList.contains('overlay-segment')) {
        startDraggingAdvancedOverlay(e, target);
        return;
    }
}

// Iniciar arrasto do playhead avançado
function startDraggingAdvancedPlayhead(e) {
    // EVITAR CONFLITO: Sinalizar modo de arrasto com prioridade máxima
    // window.timelineInteractionMode = 'dragging'; // REMOVIDO - Sistema simplificado

    timelineState.dragState.isDragging = true;
    timelineState.dragState.isDraggingPlayhead = true;
    timelineState.dragState.initialX = e.clientX;
    timelineState.dragState.initialLeft = parseFloat(timelineState.domCache.playhead.style.left);

    // Usar VisualStateManager para estado de arrasto
    VisualStateManager.setState({
        playhead: {
            isDragging: true
        },
        timeline: {
            tooltipVisible: true,
            tooltipPosition: timelineState.currentTime,
            tooltipText: formatTimeWithMilliseconds((timelineState.currentTime / 100) * 100)
        }
    });

    e.preventDefault();
}

// Iniciar arrasto de marcador avançado
function startDraggingAdvancedMarker(e, marker) {
    timelineState.dragState.isDragging = true;
    timelineState.dragState.element = marker;
    timelineState.dragState.track = document.getElementById('markersTrack');
    timelineState.dragState.dropIndicator = timelineState.domCache.markerDropIndicator;
    timelineState.dragState.positionIndicator = timelineState.domCache.markerPositionIndicator;
    timelineState.dragState.initialX = e.clientX;
    timelineState.dragState.initialLeft = parseFloat(marker.style.left);

    marker.classList.add('dragging');
    e.preventDefault();
}

// Implementar atalhos de teclado avançados
function initAdvancedKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        // Ignorar se o usuário estiver digitando em um campo de entrada
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // Espaço: Reproduzir/Pausar
        if (e.code === 'Space') {
            e.preventDefault();
            timelineState.isPlaying = !timelineState.isPlaying;
            return;
        }

        // M: Adicionar marcador
        if (e.key === 'm' || e.key === 'M') {
            e.preventDefault();
            addAdvancedMarker();
            return;
        }

        // Delete: Excluir elemento selecionado
        if (e.code === 'Delete') {
            e.preventDefault();
            deleteAdvancedSelectedElement();
            return;
        }
    });
}

// Adicionar marcador avançado na posição atual
function addAdvancedMarker() {
    const markersTrack = document.getElementById('markersTrack');
    if (!markersTrack) return;

    const markerCount = timelineState.markerCount + 1;

    const marker = document.createElement('div');
    marker.className = 'marker-item';
    marker.style.left = `${timelineState.currentTime}%`;
    marker.setAttribute('data-number', markerCount);
    marker.setAttribute('tabindex', '0');
    marker.setAttribute('title', `Marcador ${markerCount} - ${formatTimeWithMilliseconds((timelineState.currentTime / 100) * 100)}`);

    markersTrack.appendChild(marker);
    timelineState.markerCount = markerCount;
}

// Excluir elemento selecionado avançado
function deleteAdvancedSelectedElement() {
    if (timelineState.selectedMarker) {
        const markerNumber = timelineState.selectedMarker.getAttribute('data-number');
        timelineState.selectedMarker.remove();
        timelineState.selectedMarker = null;
        return;
    }

    if (timelineState.selectedOverlay) {
        const overlayLabel = timelineState.selectedOverlay.getAttribute('data-label');
        timelineState.selectedOverlay.remove();
        timelineState.selectedOverlay = null;
        return;
    }
}

// ===== FASE 1: RENDERIZAÇÃO CORRETA DA NOVA TIMELINE =====

// Renderizar marcadores na trilha de marcadores
function renderMarkers() {
    const markersTrack = document.getElementById('markersTrack');
    const videoPlayer = document.getElementById('videoPlayer');

    if (!markersTrack) {
        return;
    }

    // Limpar marcadores existentes
    markersTrack.querySelectorAll('.marker-item').forEach(m => m.remove());

    const fragment = document.createDocumentFragment();
    let markerNumber = 1;

    for (const key in timelineState.currentMarkers) {
        const time = timelineState.currentMarkers[key];
        const marker = document.createElement('div');
        marker.className = 'marker-item';
        marker.setAttribute('data-number', markerNumber);
        marker.setAttribute('data-label', key);
        marker.setAttribute('data-time', time);
        marker.setAttribute('tabindex', '0');

        // Calcular posição - se houver vídeo, usar duração real, senão usar 100s como base
        const duration = videoPlayer && videoPlayer.duration ? videoPlayer.duration : 100;
        marker.style.left = `${(time / duration) * 100}%`;

        // Tooltip informativo
        marker.setAttribute('title', `${key} - ${formatTimeWithMilliseconds(time)}`);

        fragment.appendChild(marker);
        markerNumber++;
    }

    markersTrack.appendChild(fragment);
}

// Renderizar overlays na trilha de overlays - CORRIGIDO para usar estado centralizado
function renderOverlays() {
    const overlaysTrack = document.getElementById('overlaysTrack');
    const videoPlayer = document.getElementById('videoPlayer');

    if (!overlaysTrack) {
        console.warn('⚠️ overlaysTrack não encontrado');
        return;
    }

    // Limpar overlays existentes
    overlaysTrack.querySelectorAll('.overlay-segment').forEach(o => o.remove());

    // Usar estado centralizado se disponível, senão usar currentProject (COMPATIBILIDADE)
    const overlaysToRender = (typeof OverlayState !== 'undefined')
        ? OverlayState.getAllOverlays()
        : (currentProject?.overlays || []);

    console.log(`🎨 Renderizando ${overlaysToRender.length} overlays na timeline`);

    // DEBUG: Verificar consistência dos dados
    if (typeof OverlayState !== 'undefined' && currentProject?.overlays) {
        const stateOverlays = OverlayState.getAllOverlays();
        const projectOverlays = currentProject.overlays;

        console.log('🔍 DEBUG: Verificação de consistência de dados:');
        console.log(`  - OverlayState: ${stateOverlays.length} overlays`);
        console.log(`  - currentProject: ${projectOverlays.length} overlays`);

        // Verificar se há diferenças nos tempos
        stateOverlays.forEach(stateOverlay => {
            const projectOverlay = projectOverlays.find(p => p.id === stateOverlay.id);
            if (projectOverlay) {
                const stateTime = stateOverlay.startTime || stateOverlay.start;
                const projectTime = projectOverlay.start;
                if (Math.abs(stateTime - projectTime) > 0.1) {
                    console.warn(`⚠️ Inconsistência detectada - Overlay ${stateOverlay.id}: state=${stateTime}, project=${projectTime}`);
                }
            }
        });
    }

    const fragment = document.createDocumentFragment();

    overlaysToRender.forEach((overlay, index) => {
        const segment = document.createElement('div');
        segment.className = 'overlay-segment';
        segment.setAttribute('data-label', overlay.label || `Overlay ${index + 1}`);
        segment.setAttribute('data-start', overlay.start || overlay.startTime);
        segment.setAttribute('data-duration', overlay.duration);
        segment.setAttribute('tabindex', '0');

        // Adicionar ID se disponível
        if (overlay.id) {
            segment.setAttribute('data-id', overlay.id);
            console.log(`🔍 [DEBUG] Overlay segment criado com ID: ${overlay.id}, label: ${overlay.label}`);
        } else {
            console.warn(`⚠️ [DEBUG] Overlay sem ID detectado:`, overlay);
        }

        // Calcular posições
        const duration = videoPlayer && videoPlayer.duration ? videoPlayer.duration : 100;
        const startPercent = ((overlay.start || overlay.startTime) / duration) * 100;
        const durationPercent = (overlay.duration / duration) * 100;

        segment.style.left = `${startPercent}%`;
        segment.style.width = `${durationPercent}%`;

        // Tooltip informativo - usar formatação centralizada se disponível
        const startTime = overlay.start || overlay.startTime;
        const endTime = startTime + overlay.duration;

        let tooltipText;
        if (typeof formatTimeWithMilliseconds !== 'undefined') {
            tooltipText = `${overlay.label || 'Overlay'} - ${formatTimeWithMilliseconds(startTime)} a ${formatTimeWithMilliseconds(endTime)}`;
        } else if (typeof OverlayUtils !== 'undefined' && OverlayUtils.formatTime) {
            tooltipText = `${overlay.label || 'Overlay'} - ${OverlayUtils.formatTime(startTime)} a ${OverlayUtils.formatTime(endTime)}`;
        } else {
            tooltipText = `${overlay.label || 'Overlay'} - ${startTime.toFixed(1)}s a ${endTime.toFixed(1)}s`;
        }

        segment.setAttribute('title', tooltipText);

        // Adicionar eventos de interação se houver funções correspondentes
        if (typeof selectOverlay === 'function') {
            segment.addEventListener('click', (e) => {
                console.log('🖱️ [DEBUG] Overlay clicado:', {
                    overlayId: overlay.id,
                    overlayLabel: overlay.label || `Overlay ${index + 1}`,
                    segmentElement: segment
                });

                e.stopPropagation();
                selectOverlay(segment);
                updateTimelineConnections();
            });

            // Adicionar evento de teclado para permitir seleção via Tab
            segment.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    console.log('⌨️ [DEBUG] Overlay selecionado via teclado:', segment);
                    e.preventDefault();
                    selectOverlay(segment);
                    updateTimelineConnections();
                }
            });

            // Adicionar evento de mouse para interações unificadas (mover/redimensionar)
            segment.addEventListener('mousedown', (e) => {
                console.log('🖱️ [UNIFIED] Mouse down no overlay:', {
                    overlayId: overlay.id,
                    overlayLabel: overlay.label || `Overlay ${index + 1}`,
                    shiftKey: e.shiftKey,
                    ctrlKey: e.ctrlKey,
                    altKey: e.altKey,
                    clientX: e.clientX,
                    target: e.target
                });

                // SEMPRE processar clique no overlay (removida condição Shift obrigatória)
                e.preventDefault();
                e.stopPropagation();

                // Detectar tipo de interação baseado na posição do cursor e modificadores
                const rect = segment.getBoundingClientRect();
                const relativeX = e.clientX - rect.left;
                const width = rect.width;
                const edgeThreshold = 8; // pixels das bordas

                let interactionType = 'move'; // padrão: mover
                let resizeHandle = null;

                // Prioridade 1: Teclas modificadoras para modo avançado
                if (e.shiftKey || e.ctrlKey || e.altKey) {
                    // Verificar se está próximo das bordas para redimensionamento
                    if (relativeX <= edgeThreshold) {
                        interactionType = 'resize-left';
                        resizeHandle = 'left';
                    } else if (relativeX >= width - edgeThreshold) {
                        interactionType = 'resize-right';
                        resizeHandle = 'right';
                    } else {
                        // Com modificadores no centro, permite movimento preciso
                        interactionType = 'move';
                    }
                } else {
                    // Prioridade 2: Detecção automática sem modificadores
                    if (relativeX <= edgeThreshold || relativeX >= width - edgeThreshold) {
                        // Nas bordas: redimensionar (mais intuitivo)
                        if (relativeX <= edgeThreshold) {
                            interactionType = 'resize-left';
                            resizeHandle = 'left';
                        } else {
                            interactionType = 'resize-right';
                            resizeHandle = 'right';
                        }
                    } else {
                        // No centro: mover
                        interactionType = 'move';
                    }
                }

                console.log('🎯 [UNIFIED] Tipo de interação detectado:', {
                    interactionType,
                    resizeHandle,
                    relativeX,
                    width,
                    edgeThreshold,
                    modifiers: {
                        shift: e.shiftKey,
                        ctrl: e.ctrlKey,
                        alt: e.altKey
                    }
                });

                // Selecionar overlay automaticamente se não estiver selecionado
                if (!segment.classList.contains('selected')) {
                    selectOverlay(segment);
                    updateTimelineConnections();
                }

                // Iniciar interação unificada
                if (typeof startOverlayInteraction === 'function') {
                    startOverlayInteraction(segment, interactionType, e.clientX);

                    // Mostrar ajuda contextual na primeira interação
                    if (!sessionStorage.getItem('overlay-help-shown')) {
                        setTimeout(() => {
                            showContextualHelp(interactionType);
                            sessionStorage.setItem('overlay-help-shown', 'true');
                        }, 1000);
                    }
                } else {
                    console.warn('⚠️ [UNIFIED] Função startOverlayInteraction não disponível');
                }
            });

            // Adicionar evento de hover para mostrar feedback visual aprimorado
            segment.addEventListener('mouseenter', (e) => {
                const rect = segment.getBoundingClientRect();
                const relativeX = e.clientX - rect.left;
                const width = rect.width;
                const edgeThreshold = 8;

                // Sempre mostrar feedback de hover
                segment.classList.add('hover-active');

                // Feedback específico baseado na posição do cursor
                if (relativeX <= edgeThreshold) {
                    segment.classList.add('hover-resize-left');
                    segment.title = `${overlay.label || 'Overlay'} - Clique e arraste para redimensionar início`;
                } else if (relativeX >= width - edgeThreshold) {
                    segment.classList.add('hover-resize-right');
                    segment.title = `${overlay.label || 'Overlay'} - Clique e arraste para redimensionar fim`;
                } else {
                    segment.classList.add('hover-move');
                    segment.title = `${overlay.label || 'Overlay'} - Clique e arraste para mover`;
                }

                // Feedback adicional para teclas modificadoras
                if (e.shiftKey || e.ctrlKey || e.altKey) {
                    segment.classList.add('hover-advanced');
                    console.log('👆 [HOVER] Modo avançado ativo no overlay:', overlay.label);
                }
            });

            segment.addEventListener('mouseleave', (e) => {
                // Limpar todas as classes de hover
                segment.classList.remove(
                    'hover-active',
                    'hover-resize-left',
                    'hover-resize-right',
                    'hover-move',
                    'hover-advanced',
                    'hover-shift'
                );
            });

            // Adicionar evento de movimento do mouse para feedback em tempo real
            segment.addEventListener('mousemove', (e) => {
                const rect = segment.getBoundingClientRect();
                const relativeX = e.clientX - rect.left;
                const width = rect.width;
                const edgeThreshold = 8;

                // Remover classes específicas anteriores
                segment.classList.remove('hover-resize-left', 'hover-resize-right', 'hover-move');

                // Adicionar classe baseada na posição atual
                if (relativeX <= edgeThreshold) {
                    segment.classList.add('hover-resize-left');
                } else if (relativeX >= width - edgeThreshold) {
                    segment.classList.add('hover-resize-right');
                } else {
                    segment.classList.add('hover-move');
                }
            });

        } else {
            console.warn('⚠️ [DEBUG] Função selectOverlay não disponível');
        }

        fragment.appendChild(segment);
    });

    overlaysTrack.appendChild(fragment);

    console.log('✅ Overlays renderizados com sucesso na timeline');
}

// ===== FASE 2: INTERATIVIDADE AVANÇADA =====

// Implementar interatividade para marcadores e overlays
function initTimelineInteractivity() {
    const markersTrack = document.getElementById('markersTrack');
    const overlaysTrack = document.getElementById('overlaysTrack');

    if (markersTrack) {
        markersTrack.addEventListener('click', handleMarkerClick);
        markersTrack.addEventListener('mousedown', handleMarkerMouseDown);
        markersTrack.addEventListener('keydown', handleMarkerKeydown);
    }

    if (overlaysTrack) {
        overlaysTrack.addEventListener('click', handleOverlayClick);
        // CONFLITO RESOLVIDO: Desabilitar mousedown duplicado para evitar conflitos com timeline.js
        // overlaysTrack.addEventListener('mousedown', handleOverlayMouseDown);
        overlaysTrack.addEventListener('keydown', handleOverlayKeydown);
    }

    // Adicionar eventos de teclado globais
    document.addEventListener('keydown', handleTimelineKeydown);
}

// Manipular clique na trilha de marcadores para adicionar novo marcador
function handleMarkersTrackClick(e) {
    // Se clicou em um marcador existente, não adiciona novo
    if (e.target.classList.contains('marker-item')) {
        return;
    }

    // Se clicou na área vazia da trilha, adiciona novo marcador
    if (e.target.classList.contains('markers-track')) {
        e.preventDefault();
        addAdvancedMarker();
    }
}


// Manipular clique em marcadores
function handleMarkerClick(e) {
    if (e.target.classList.contains('marker-item')) {
        selectMarker(e.target);
        updateTimelineConnections();
    }
}

// Manipular clique em overlays
function handleOverlayClick(e) {
    if (e.target.classList.contains('overlay-segment')) {
        selectOverlay(e.target);
        updateTimelineConnections();
    }
}

// Selecionar marcador
function selectMarker(marker) {
    // Limpar seleções anteriores
    document.querySelectorAll('.marker-item.selected').forEach(m => m.classList.remove('selected'));
    document.querySelectorAll('.overlay-segment.selected').forEach(o => o.classList.remove('selected'));

    // Selecionar novo marcador
    marker.classList.add('selected');
    timelineState.selectedMarker = marker;
    timelineState.selectedOverlay = null;

    // Mover playhead para posição do marcador
    const position = parseFloat(marker.style.left);
    updateTimelinePlayheadPosition(position);
}

// Selecionar overlay
function selectOverlay(overlay) {
    console.log('🎯 [UNIFIED] selectOverlay() chamado:', {
        overlayElement: overlay,
        overlayId: overlay.getAttribute('data-id'),
        overlayLabel: overlay.getAttribute('data-label')
    });

    // Limpar seleções de marcadores
    document.querySelectorAll('.marker-item.selected').forEach(m => {
        m.classList.remove('selected');
    });

    // Limpar estado de marcadores
    timelineState.selectedMarker = null;

    // Usar sistema unificado de sincronização
    syncSelectedOverlayStates(overlay);

    // Adicionar feedback visual de que o overlay pode ser controlado por teclado
    setTimeout(() => {
        overlay.classList.add('keyboard-active');
    }, 100);

    console.log('✅ [DEBUG] Overlay selecionado com sucesso:', {
        selectedOverlay: overlay,
        timelineState: {
            selectedOverlay: timelineState.selectedOverlay,
            selectedMarker: timelineState.selectedMarker,
            selectedElement: timelineState.selectedElement
        }
    });

    // Notificação de atalhos removida - era desnecessária

    // Mover playhead para início do overlay
    const position = parseFloat(overlay.style.left);
    if (!isNaN(position)) {
        updateTimelinePlayheadPosition(position);
        console.log('📍 [DEBUG] Playhead movido para posição do overlay:', position);
    } else {
        console.warn('⚠️ [DEBUG] Posição do overlay inválida:', overlay.style.left);
    }
}

// Iniciar arrasto de marcador
function handleMarkerMouseDown(e) {
    if (!e.target.classList.contains('marker-item')) return;

    e.preventDefault();
    startDraggingMarker(e.target, e.clientX);
}

// Iniciar arrasto de overlay
function handleOverlayMouseDown(e) {
    if (!e.target.classList.contains('overlay-segment')) return;

    e.preventDefault();
    // CORREÇÃO: Usar assinatura compatível com timeline.js
    if (typeof startDraggingOverlay === 'function') {
        startDraggingOverlay(e, e.target);
    }
}

// Função unificada para iniciar interação com overlays
function startOverlayInteraction(element, interactionType, clientX) {
    console.log('🎯 [UNIFIED] Iniciando interação com overlay:', {
        element,
        interactionType,
        clientX,
        elementClasses: element.className,
        overlayId: element.getAttribute('data-id')
    });

    // Resetar estado anterior
    if (timelineState.dragState.isDragging) {
        endCurrentInteraction();
    }

    // Configurar estado baseado no tipo de interação
    timelineState.dragState.isDragging = true;
    timelineState.dragState.element = element;
    // FIX: Usar a timeline principal como referência de largura em vez da overlaysTrack
    timelineState.dragState.track = timelineState.domCache.timelineWrapper;
    timelineState.dragState.dropIndicator = timelineState.domCache.overlayDropIndicator;
    timelineState.dragState.positionIndicator = timelineState.domCache.overlayPositionIndicator;
    timelineState.dragState.initialX = clientX;
    timelineState.dragState.initialLeft = parseFloat(element.style.left);
    timelineState.dragState.initialWidth = parseFloat(element.style.width);
    timelineState.dragState.interactionType = interactionType;
    timelineState.dragState.isResizing = interactionType.includes('resize');

    // Identificar handle de redimensionamento
    if (interactionType.includes('resize')) {
        timelineState.dragState.resizeHandle = interactionType === 'resize-left' ? 'left' : 'right';
    }

    // Aplicar classes visuais baseadas no tipo de interação
    element.classList.add('dragging');
    // Remover estado de teclado apenas visualmente durante interação ativa
    element.classList.remove('keyboard-active');

    if (interactionType === 'move') {
        element.classList.add('moving');
    } else if (interactionType.includes('resize')) {
        element.classList.add('resizing');
    }

    // Atualizar cursor unificado
    updateUnifiedCursor(element, interactionType);

    // REMOVIDO: Não mostrar indicadores visuais na track principal durante arrasto
    // A track principal deve permanecer limpa, mostrando apenas estado de reprodução
    // if (timelineState.domCache.overlayDropIndicator) {
    //     timelineState.domCache.overlayDropIndicator.classList.add('active');
    // }
    // if (timelineState.dragState.positionIndicator) {
    //     timelineState.domCache.overlayPositionIndicator.classList.add('active');
    // }

    console.log('✅ [UNIFIED] Interação iniciada com sucesso:', {
        interactionType,
        resizeHandle: timelineState.dragState.resizeHandle,
        element: element
    });
}

// Função para finalizar interação atual
function endCurrentInteraction() {
    if (!timelineState.dragState.isDragging) return;

    const element = timelineState.dragState.element;
    if (!element) return;

    console.log('🏁 [UNIFIED] Finalizando interação:', {
        interactionType: timelineState.dragState.interactionType,
        element
    });

    // Remover classes visuais
    element.classList.remove('dragging', 'moving', 'resizing', 'resizing-left', 'resizing-right');

    // Remover indicadores de tempo de redimensionamento
    const startIndicator = element.querySelector('.resize-start-indicator');
    const endIndicator = element.querySelector('.resize-end-indicator');

    if (startIndicator) {
        startIndicator.remove();
    }

    if (endIndicator) {
        endIndicator.remove();
    }

    // Restaurar cursor padrão
    restoreDefaultCursor();

    // Restaurar estado de teclado consistentemente
    if (element.classList.contains('selected')) {
        // Usar sistema unificado de sincronização para evitar conflitos
        syncSelectedOverlayStates(element);
    }

    // Limpar estado
    resetDragState();
}

// Resetar estado de arrasto de forma segura
function resetDragState() {
    const wasInteracting = timelineState.dragState.isDragging;

    timelineState.dragState.isDragging = false;
    timelineState.dragState.element = null;
    timelineState.dragState.track = null;
    timelineState.dragState.dropIndicator = null;
    timelineState.dragState.positionIndicator = null;
    timelineState.dragState.initialX = 0;
    timelineState.dragState.initialLeft = 0;
    timelineState.dragState.initialWidth = 0;
    timelineState.dragState.isResizing = false;
    timelineState.dragState.isDraggingPlayhead = false;
    timelineState.dragState.interactionType = null;
    timelineState.dragState.resizeHandle = null;

    // REMOVIDO: Não há indicadores na track principal para ocultar
    // if (timelineState.domCache.overlayDropIndicator) {
    //     timelineState.domCache.overlayDropIndicator.classList.remove('active');
    // }
    // if (timelineState.domCache.overlayPositionIndicator) {
    //     timelineState.domCache.overlayPositionIndicator.classList.remove('active');
    // }

    console.log('🧹 [UNIFIED] Estado de drag resetado');
}

// Iniciar arrasto de marcador (função aprimorada) - usando sistema unificado
function startDraggingMarker(marker, clientX) {
    console.log('📍 [UNIFIED] Iniciando arrasto de marcador (legado para compatibilidade)');

    // Usar sistema unificado para compatibilidade
    const element = marker;
    element.classList.add('dragging');
    element.style.cursor = 'grabbing';

    // Mostrar indicadores visuais
    if (timelineState.domCache.markerDropIndicator) {
        timelineState.dragState.markerDropIndicator.classList.add('active');
    }
    if (timelineState.domCache.markerPositionIndicator) {
        timelineState.domCache.markerPositionIndicator.classList.add('active');
    }
}

// Iniciar arrasto de overlay
// REMOVIDO: Função startDraggingOverlay duplicada - usando implementação do timeline.js

// Manipular movimento do mouse durante arrasto
function handleAdvancedMouseMove(e) {
    if (!timelineState.dragState.isDragging) return;

    // EVITAR CONFLITO: Tratar arrasto do playhead separadamente
    if (timelineState.dragState.isDraggingPlayhead) {
        const deltaX = e.clientX - timelineState.dragState.initialX;
        // OTIMIZAÇÃO: Usar cache de dimensões para timelineWidth
        const timelineWidth = timelineState.dimensionCache.getTimelineWidth();
        const deltaPercent = (deltaX / timelineWidth) * 100;
        let newPosition = timelineState.dragState.initialLeft + deltaPercent;

        // Limitar dentro da timeline
        newPosition = Math.max(0, Math.min(newPosition, 100));

        // Atualizar posição do playhead
        updateTimelinePlayheadPosition(newPosition, false);

        // Atualizar tooltip se estiver visível
        if (timelineState.domCache.playheadTimeTooltip && timelineState.domCache.playheadTimeTooltip.classList.contains('active')) {
            const totalSeconds = (newPosition / 100) * 100;
            timelineState.domCache.playheadTimeTooltip.textContent = formatTimeWithMilliseconds(totalSeconds);
            timelineState.domCache.playheadTimeTooltip.style.left = `${newPosition}%`;
        }
        return;
    }

    const deltaX = e.clientX - timelineState.dragState.initialX;
    // OTIMIZAÇÃO: Usar cache de dimensões em vez de query DOM repetitiva
    const trackWidth = timelineState.dimensionCache.getTrackWidth();

    // VALIDAÇÃO: Garantir que trackWidth > 0 para evitar divisão por zero
    if (trackWidth <= 0) {
        console.error('❌ trackWidth inválido:', trackWidth, '- abortando movimento do overlay');
        return;
    }

    const deltaPercent = (deltaX / trackWidth) * 100;

    // DEBUG: Log dos valores para verificação
    if (timelineState.dragState.element.classList.contains('overlay-segment')) {
        console.log(`🔍 DEBUG: deltaX=${deltaX}, trackWidth=${trackWidth}, deltaPercent=${deltaPercent}`);
    }

    if (timelineState.dragState.element.classList.contains('marker-item')) {
        // Arrastar marcador
        const newPosition = Math.max(0, Math.min(100, timelineState.dragState.initialLeft + deltaPercent));
        timelineState.dragState.element.style.left = `${newPosition}%`;

        // REMOVIDO: Indicador de posição do marcador para limpar a timeline principal
        // O feedback visual deve ser mantido apenas no próprio marcador
        // if (timelineState.domCache.markerPositionIndicator) {
        //     timelineState.domCache.markerPositionIndicator.style.left = `${newPosition}%`;
        // }

        // ATUALIZAR DADOS DO MARCADOR EM TEMPO REAL
        const videoPlayer = document.getElementById('videoPlayer');
        const duration = videoPlayer && videoPlayer.duration ? videoPlayer.duration : 100;
        const newTime = (newPosition / 100) * duration;

        // Atualizar atributos do elemento
        timelineState.dragState.element.setAttribute('data-time', newTime);

        // Atualizar tooltip com novo tempo
        const currentLabel = timelineState.dragState.element.getAttribute('data-label');
        timelineState.dragState.element.setAttribute('title', `${currentLabel} - ${formatTimeWithMilliseconds(newTime)}`);

        // Atualizar em timelineState.currentMarkers
        timelineState.currentMarkers[currentLabel] = newTime;

    } else if (timelineState.dragState.element.classList.contains('overlay-segment')) {
        // Verificar tipo de interação: mover ou redimensionar
        const interactionType = timelineState.dragState.interactionType;

        if (interactionType === 'resize-left' || interactionType === 'resize-right') {
            // REDIMENSIONAR OVERLAY
            handleOverlayResize(interactionType, deltaPercent);
        } else {
            // MOVER OVERLAY (funcionalidade existente)
            const newPosition = Math.max(0, Math.min(100, timelineState.dragState.initialLeft + deltaPercent));
            timelineState.dragState.element.style.left = `${newPosition}%`;

            // REMOVIDO: Não atualizar indicadores na track principal durante arrasto de overlays
            // A track principal deve mostrar apenas playhead e progresso do vídeo
            // console.log('🚫 [FIX] Indicadores de posição removidos da track principal durante arrasto de overlay');

            // ATUALIZAR DADOS DO OVERLAY EM TEMPO REAL
            const videoPlayer = document.getElementById('videoPlayer');
            const duration = videoPlayer && videoPlayer.duration ? videoPlayer.duration : 100;
            const newTime = (newPosition / 100) * duration;

            // Atualizar atributos do elemento
            timelineState.dragState.element.setAttribute('data-start', newTime);

            // Atualizar tooltip com novo tempo
            const currentLabel = timelineState.dragState.element.getAttribute('data-label');
            const currentDuration = parseFloat(timelineState.dragState.element.getAttribute('data-duration')) || 5;
            timelineState.dragState.element.setAttribute('title', `${currentLabel} - ${formatTimeWithMilliseconds(newTime)} a ${formatTimeWithMilliseconds(newTime + currentDuration)}`);

            // PRIORIZAR OverlayState: Atualizar estado centralizado primeiro
            const overlayId = timelineState.dragState.element.getAttribute('data-id');
            if (overlayId && typeof OverlayState !== 'undefined') {
                OverlayState.updateOverlay(overlayId, {
                    startTime: newTime,
                    start: newTime // Manter compatibilidade com ambos os campos
                });
                console.log(`✅ Overlay ${overlayId} atualizado no OverlayState: startTime=${newTime}`);
            }

            // OTIMIZAÇÃO: syncWithProject() já foi chamado em updateOverlay()
            // Sistema de sincronização unificado já cuida da consistência dos dados
        }
    }
}

/**
 * Handle overlay resizing in real-time
 * @param {string} resizeType - 'resize-left' or 'resize-right'
 * @param {number} deltaPercent - Delta percentage based on mouse movement
 */
function handleOverlayResize(resizeType, deltaPercent) {
    const element = timelineState.dragState.element;
    if (!element || !element.classList.contains('overlay-segment')) {
        console.warn('⚠️ handleOverlayResize: Elemento overlay inválido');
        return;
    }

    const videoPlayer = document.getElementById('videoPlayer');
    const duration = videoPlayer && videoPlayer.duration ? videoPlayer.duration : 100;
    // OTIMIZAÇÃO: Usar cache de dimensões em vez de query DOM repetitiva
    const timelineWidth = timelineState.dimensionCache.getTrackWidth();

    // VALIDAÇÃO: Garantir que timelineWidth > 0 para evitar divisão por zero
    if (timelineWidth <= 0) {
        console.error('❌ timelineWidth inválido:', timelineWidth, '- abortando redimensionamento do overlay');
        return;
    }

    // Valores iniciais salvos em startOverlayInteraction
    const initialLeft = timelineState.dragState.initialLeft; // posição inicial (%)
    const initialWidth = timelineState.dragState.initialWidth; // largura inicial (%)

    let newLeft = initialLeft;
    let newWidth = initialWidth;

    if (resizeType === 'resize-left') {
        // Redimensionar pela esquerda: mover início e ajustar largura
        const deltaLeftPercent = (deltaPercent / 100) * 100; // delta em porcentagem
        newLeft = Math.max(0, Math.min(initialLeft + deltaLeftPercent, initialLeft + initialWidth - 1)); // mínimo 1% de largura
        newWidth = initialWidth - (newLeft - initialLeft);
    } else if (resizeType === 'resize-right') {
        // Redimensionar pela direita: apenas ajustar largura
        newWidth = Math.max(1, Math.min(initialWidth + deltaPercent, 100 - initialLeft)); // mínimo 1% e máximo até o fim
    }

    // Aplicar nova posição e largura
    element.style.left = `${newLeft}%`;
    element.style.width = `${newWidth}%`;

    // Converter para tempo
    const newStartTime = (newLeft / 100) * duration;
    const newEndTime = ((newLeft + newWidth) / 100) * duration;
    const newDuration = newEndTime - newStartTime;

    // Atualizar atributos do elemento
    element.setAttribute('data-start', newStartTime);
    element.setAttribute('data-duration', newDuration);

    // Atualizar tooltip
    const currentLabel = element.getAttribute('data-label');
    element.setAttribute('title', `${currentLabel} - ${formatTimeWithMilliseconds(newStartTime)} a ${formatTimeWithMilliseconds(newEndTime)}`);

    // PRIORIZAR OverlayState: Atualizar estado centralizado
    const overlayId = element.getAttribute('data-id');
    if (overlayId && typeof OverlayState !== 'undefined') {
        OverlayState.updateOverlay(overlayId, {
            startTime: newStartTime,
            duration: newDuration,
            start: newStartTime, // Manter compatibilidade
            end: newEndTime     // Manter compatibilidade
        });
        console.log(`✅ Overlay ${overlayId} redimensionado no OverlayState: start=${newStartTime}, duration=${newDuration}`);
    }

    // OTIMIZAÇÃO: syncWithProject() já foi chamado em updateOverlay()
    // Não há necessidade de atualizar currentProject manualmente

    // Feedback visual: mostrar indicadores de tempo
    showResizeIndicators(element, newStartTime, newEndTime);

    console.log(`🔄 Redimensionando ${resizeType}: newLeft=${newLeft.toFixed(2)}%, newWidth=${newWidth.toFixed(2)}%, duration=${newDuration.toFixed(2)}s`);
}

/**
 * Mostrar indicadores visuais durante redimensionamento
 */
function showResizeIndicators(element, startTime, endTime) {
    // Criar ou atualizar tooltips de tempo
    let startIndicator = element.querySelector('.resize-start-indicator');
    let endIndicator = element.querySelector('.resize-end-indicator');

    if (!startIndicator) {
        startIndicator = document.createElement('div');
        startIndicator.className = 'resize-start-indicator';
        element.appendChild(startIndicator);
    }

    if (!endIndicator) {
        endIndicator = document.createElement('div');
        endIndicator.className = 'resize-end-indicator';
        element.appendChild(endIndicator);
    }

    startIndicator.textContent = formatTimeWithMilliseconds(startTime);
    endIndicator.textContent = formatTimeWithMilliseconds(endTime);

    // Posicionar indicadores
    startIndicator.style.left = '0';
    startIndicator.style.top = '-25px';
    endIndicator.style.right = '0';
    endIndicator.style.top = '-25px';
}

/**
 * Gerenciar cursor unificado para interações mouse-teclado
 */
function updateUnifiedCursor(element, interactionType) {
    if (!element) return;

    // Remover classes de cursor anteriores
    element.classList.remove('resizing-left', 'resizing-right', 'moving');

    // Adicionar classe baseada no tipo de interação
    switch (interactionType) {
        case 'resize-left':
            element.classList.add('resizing-left');
            document.body.style.cursor = 'ew-resize';
            break;
        case 'resize-right':
            element.classList.add('resizing-right');
            document.body.style.cursor = 'ew-resize';
            break;
        case 'move':
            element.classList.add('moving');
            document.body.style.cursor = 'grabbing';
            break;
        default:
            document.body.style.cursor = '';
    }
}

/**
 * Restaurar cursor para estado padrão
 */
function restoreDefaultCursor() {
    document.body.style.cursor = '';

    // Remover classes de cursor de todos os overlays
    document.querySelectorAll('.overlay-segment').forEach(overlay => {
        overlay.classList.remove('resizing-left', 'resizing-right', 'moving');
    });
}

/**
 * Mostrar dica de resize para overlay
 */
function showResizeHint(overlay, clientX, clientY) {
    const rect = overlay.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    const width = rect.width;
    const edgeThreshold = 8;

    let hintType = 'move';
    if (relativeX <= edgeThreshold) {
        hintType = 'resize-left';
    } else if (relativeX >= width - edgeThreshold) {
        hintType = 'resize-right';
    }

    // Remover tooltip existente se houver
    const existingTooltip = document.querySelector('.resize-hint-tooltip');
    if (existingTooltip) {
        existingTooltip.remove();
    }

    // Mostrar tooltip de dica
    const tooltip = document.createElement('div');
    tooltip.className = 'resize-hint-tooltip';
    tooltip.style.cssText = `
        position: fixed;
        top: ${clientY - 30}px;
        left: ${clientX}px;
        background: var(--surface-primary);
        color: var(--text-primary);
        padding: 4px 8px;
        border-radius: var(--radius);
        font-size: var(--font-size-xs);
        border: 1px solid var(--border-color);
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 1000;
        pointer-events: none;
        opacity: 0.9;
    `;

    let hintText = 'Clique e arraste para mover';
    if (hintType === 'resize-left') {
        hintText = '← Redimensionar início';
    } else if (hintType === 'resize-right') {
        hintText = 'Redimensionar fim →';
    }

    tooltip.textContent = hintText;
    document.body.appendChild(tooltip);

    // Auto-remover após 2 segundos
    setTimeout(() => {
        if (tooltip.parentNode) {
            tooltip.remove();
        }
    }, 2000);
}

/**
 * Esconder dica de resize
 */
function hideResizeHint() {
    const tooltip = document.querySelector('.resize-hint-tooltip');
    if (tooltip) {
        tooltip.remove();
    }
}

/**
 * SISTEMA UNIFICADO DE VALIDAÇÃO DE SELECTED OVERLAY
 * Centraliza a lógica de validação e sincronização do overlay selecionado
 */
function getValidatedSelectedOverlay() {
    // Método 1: Verificar estado centralizado timelineState
    if (timelineState.selectedOverlay && timelineState.selectedOverlay.parentNode) {
        return timelineState.selectedOverlay;
    }

    // Método 2: Verificar classe CSS .selected
    const selectedViaCSS = document.querySelector('.overlay-segment.selected');
    if (selectedViaCSS) {
        // Sincronizar com timelineState
        timelineState.selectedOverlay = selectedViaCSS;
        console.log('🔄 [UNIFIED] Sincronizando selectedOverlay via CSS:', selectedViaCSS);
        return selectedViaCSS;
    }

    // Método 3: Verificar estado de foco do teclado
    const keyboardActive = document.querySelector('.overlay-segment.keyboard-active');
    if (keyboardActive) {
        // Sincronizar ambos os estados
        keyboardActive.classList.add('selected');
        timelineState.selectedOverlay = keyboardActive;
        console.log('⌨️ [UNIFIED] Sincronizando selectedOverlay via teclado:', keyboardActive);
        return keyboardActive;
    }

    console.warn('⚠️ [UNIFIED] Nenhum overlay selecionado encontrado');
    return null;
}

/**
 * Sincronizar todos os estados do overlay selecionado
 * Garante consistência entre timelineState, classes CSS e estado de teclado
 */
function syncSelectedOverlayStates(overlayElement) {
    if (!overlayElement) {
        // Limpar todos os estados
        timelineState.selectedOverlay = null;
        document.querySelectorAll('.overlay-segment.selected, .overlay-segment.keyboard-active').forEach(el => {
            el.classList.remove('selected', 'keyboard-active');
        });
        return;
    }

    // Sincronizar estado centralizado
    timelineState.selectedOverlay = overlayElement;

    // Sincronizar classes CSS
    overlayElement.classList.add('selected');
    overlayElement.classList.add('keyboard-active');

    // Remover seleção de outros overlays
    document.querySelectorAll('.overlay-segment.selected, .overlay-segment.keyboard-active').forEach(el => {
        if (el !== overlayElement) {
            el.classList.remove('selected', 'keyboard-active');
        }
    });

    console.log('✅ [UNIFIED] Estados sincronizados para overlay:', overlayElement.getAttribute('data-label'));
}

// Finalizar arrasto
function handleAdvancedMouseUp(e) {
    if (!timelineState.dragState.isDragging) return;

    // EVITAR CONFLITO: Tratar finalização do arrasto do playhead
    if (timelineState.dragState.isDraggingPlayhead) {
        // Usar VisualStateManager para finalizar arrasto
        VisualStateManager.setState({
            playhead: {
                isDragging: false
            },
            timeline: {
                tooltipVisible: false
            }
        });

        // Limpar estado específico do playhead
        timelineState.dragState.isDraggingPlayhead = false;
        // window.timelineInteractionMode = 'idle'; // REMOVIDO - Sistema simplificado
        return;
    }

    const element = timelineState.dragState.element;

    // SINCRONIZAÇÃO FINAL: Garantir que overlays estejam sincronizados ao finalizar arrasto
    if (element.classList.contains('overlay-segment')) {
        const overlayId = element.getAttribute('data-id');
        const overlayLabel = element.getAttribute('data-label');
        const finalStartTime = parseFloat(element.getAttribute('data-start'));

        console.log(`🔄 Finalizando arrasto do overlay: ID=${overlayId}, Label=${overlayLabel}, StartTime=${finalStartTime}`);

        // Sincronização final com OverlayState
        if (overlayId && typeof OverlayState !== 'undefined') {
            const overlayInState = OverlayState.getOverlay(overlayId);
            if (overlayInState) {
                OverlayState.updateOverlay(overlayId, {
                    startTime: finalStartTime,
                    start: finalStartTime
                });
                console.log(`✅ Sincronização final com OverlayState: ${overlayId} -> startTime=${finalStartTime}`);
            } else {
                console.warn(`⚠️ Overlay ${overlayId} não encontrado no OverlayState`);
            }
        }

        // OTIMIZAÇÃO: syncWithProject() já garante consistência entre sistemas
        // Não há necessidade de verificações manuais de sincronização
    }

    // Remover estados de arrasto
    element.classList.remove('dragging');
    element.style.cursor = 'grab';

    // Esconder indicadores visuais
    if (timelineState.domCache.markerDropIndicator) {
        timelineState.domCache.markerDropIndicator.classList.remove('active');
    }
    // REMOVIDO: Indicadores de overlays removidos da track principal
    // if (timelineState.domCache.overlayDropIndicator) {
    //     timelineState.domCache.overlayDropIndicator.classList.remove('active');
    // }
    if (timelineState.domCache.markerPositionIndicator) {
        timelineState.domCache.markerPositionIndicator.classList.remove('active');
    }
    // if (timelineState.domCache.overlayPositionIndicator) {
    //     timelineState.domCache.overlayPositionIndicator.classList.remove('active');
    // }

    // Limpar estado de arrasto
    timelineState.dragState.isDragging = false;
    timelineState.dragState.element = null;
    timelineState.dragState.track = null;

    // EVITAR CONFLITO: Limpar modo de interação ao finalizar arrasto
    // window.timelineInteractionMode = 'idle'; // REMOVIDO - Sistema simplificado
}

// Atualizar conexões visuais com playhead
function updateTimelineConnections() {
    const markerConnection = timelineState.domCache.markerPlayheadConnection;
    const overlayConnection = timelineState.domCache.overlayPlayheadConnection;

    if (timelineState.selectedMarker && markerConnection) {
        const markerPos = parseFloat(timelineState.selectedMarker.style.left);
        const playheadPos = parseFloat(timelineState.domCache.playhead.style.left);

        markerConnection.style.left = `${markerPos}%`;
        markerConnection.style.width = `${Math.abs(playheadPos - markerPos)}%`;
        markerConnection.classList.add('active');
    } else if (markerConnection) {
        markerConnection.classList.remove('active');
    }

    // LIMPEZA: Garantir que track principal permaneça limpa
    // A track principal deve mostrar apenas playhead e progresso do vídeo
    // Elementos de conexão foram removidos do HTML para evitar poluição visual
    if (overlayConnection && overlayConnection.classList) {
        overlayConnection.classList.remove('active');
    }
}

// Manipular atalhos de teclado para elementos selecionados
function handleMarkerKeydown(e) {
    if (!e.target.classList.contains('marker-item')) return;

    switch (e.key) {
        case 'Enter':
        case ' ':
            e.preventDefault();
            selectMarker(e.target);
            break;
        case 'Delete':
            e.preventDefault();
            deleteMarker(e.target);
            break;
    }
}

function handleOverlayKeydown(e) {
    if (!e.target.classList.contains('overlay-segment')) return;

    switch (e.key) {
        case 'Enter':
        case ' ':
            e.preventDefault();
            selectOverlay(e.target);
            break;
        case 'Delete':
            e.preventDefault();
            deleteOverlay(e.target);
            break;
    }
}

// REMOVIDO: Função duplicada handleTimelineKeydown - mantida versão mais completa na linha 3953

// Excluir marcador
function deleteMarker(marker) {
    const label = marker.getAttribute('data-label');
    if (timelineState.currentMarkers[label]) {
        delete timelineState.currentMarkers[label];
        marker.remove();

        if (timelineState.selectedMarker === marker) {
            timelineState.selectedMarker = null;
            updateTimelineConnections();
        }
    }
}

// Excluir overlay
function deleteOverlay(overlay) {
    const label = overlay.getAttribute('data-label');
    if (currentProject && currentProject.overlays) {
        const index = currentProject.overlays.findIndex(o => o.label === label);
        if (index !== -1) {
            currentProject.overlays.splice(index, 1);
            overlay.remove();

            if (timelineState.selectedOverlay === overlay) {
                timelineState.selectedOverlay = null;
                updateTimelineConnections();
            }
        }
    }
}

// Sobrescrever função handleAdvancedMouseDown para incluir elementos da nova timeline
function handleAdvancedMouseDown(e) {
    const target = e.target;

    // Verificar se é o playhead ou sua área de clique
    if (target === timelineState.domCache.playhead || target === timelineState.domCache.playheadHitArea) {
        startDraggingAdvancedPlayhead(e);
        return;
    }

    // Verificar se é um marcador
    if (target.classList.contains('marker-item')) {
        startDraggingMarker(target, e.clientX);
        return;
    }

    // Verificar se é um overlay
    if (target.classList.contains('overlay-segment')) {
        // CORREÇÃO: Usar assinatura compatível com timeline.js
        if (typeof startDraggingOverlay === 'function') {
            startDraggingOverlay(e, target);
        }
        return;
    }
}

// Sobrescrever função addAdvancedMarker para integrar com timelineState.currentMarkers
function addAdvancedMarker() {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer || !videoPlayer.duration) return;

    const currentTime = (timelineState.currentTime / 100) * videoPlayer.duration;
    const markerLabel = `Marcador ${Object.keys(timelineState.currentMarkers).length + 1}`;

    // Adicionar aos dados
    timelineState.currentMarkers[markerLabel] = currentTime;

    // Re-renderizar marcadores
    renderMarkers();
}

// Adicionar overlay avançado na posição atual
function addAdvancedOverlay(label = null, duration = 5) {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer || !videoPlayer.duration) return;

    const currentTime = (timelineState.currentTime / 100) * videoPlayer.duration;
    const overlayLabel = label || `Overlay ${timelineState.overlayCount + 1}`;

    // Inicializar array de overlays se não existir
    if (!currentProject.overlays) {
        currentProject.overlays = [];
    }

    // Adicionar overlay aos dados
    currentProject.overlays.push({
        label: overlayLabel,
        start: currentTime,
        duration: duration
    });

    // Incrementar contador
    timelineState.overlayCount++;

    // Re-renderizar overlays
    renderOverlays();
}

// Sobrescrever função deleteAdvancedSelectedElement
function deleteAdvancedSelectedElement() {
    if (timelineState.selectedMarker) {
        deleteMarker(timelineState.selectedMarker);
        return;
    }

    if (timelineState.selectedOverlay) {
        deleteOverlay(timelineState.selectedOverlay);
        return;
    }
}

// ===== FASE 3: INTEGRAÇÃO COM SISTEMA DE VÍDEO E TEMPO =====

// Sincronizar timeline com vídeo em tempo real
// REMOVIDO: syncTimelineWithVideo() - Sistema legado substituído por VisualStateManager.initOptimizedVideoSync()
// Esta função foi completamente substituída pelo sistema moderno que possui:
// - Throttling de 33ms para performance (~30fps)
// - Atualização via CSS custom properties (--playhead-position)
// - Gerenciamento de estado centralizado
// - Não chamar esta função diretamente - usar VisualStateManager.handleVideoTimeUpdate()

// Verificar sobreposições e fornecer feedback visual
function checkTimelineOverlays(currentTime) {
    // Limpar estados ativos anteriores
    document.querySelectorAll('.marker-item.active').forEach(m => m.classList.remove('active'));
    document.querySelectorAll('.overlay-segment.active').forEach(o => o.classList.remove('active'));

    // Verificar marcadores próximos
    const markers = document.querySelectorAll('.marker-item');
    markers.forEach(marker => {
        const markerTime = parseFloat(marker.getAttribute('data-time'));
        if (Math.abs(markerTime - currentTime) < 0.5) { // 500ms de tolerância
            marker.classList.add('active');
        }
    });

    // Verificar overlays ativos
    const overlays = document.querySelectorAll('.overlay-segment');
    overlays.forEach(overlay => {
        const startTime = parseFloat(overlay.getAttribute('data-start'));
        const duration = parseFloat(overlay.getAttribute('data-duration'));
        const endTime = startTime + duration;

        if (currentTime >= startTime && currentTime <= endTime) {
            overlay.classList.add('active');
        }
    });
}

// Atualizar duração total quando vídeo carrega
function updateTimelineDuration() {
    const videoPlayer = document.getElementById('videoPlayer');
    const durationElement = timelineState.domCache.durationElement || document.querySelector('.time-info span:last-child .font-mono');

    if (videoPlayer && videoPlayer.duration && durationElement) {
        durationElement.textContent = formatTimeWithMilliseconds(videoPlayer.duration);
    }

    // Re-renderizar timeline para recalcular posições
    renderTimeline();
}

// Inicializar sincronização com vídeo (USANDO SISTEMA OTIMIZADO)
function initTimelineVideoSync() {
    console.log('🚀 initTimelineVideoSync: Inicializando sincronização de vídeo...');

    // PONTO ÚNICO DE INICIALIZAÇÃO - Exclusivamente VisualStateManager
    if (typeof VisualStateManager !== 'undefined' && VisualStateManager.initOptimizedVideoSync) {
        VisualStateManager.initOptimizedVideoSync();
        console.log('✅ Sincronização de vídeo delegada para o VisualStateManager');
        console.log('🎯 Sistema moderno ativo - playhead controlado por CSS custom properties');
        return;
    }

    // ERRO CRÍTICO - VisualStateManager não disponível
    console.error('❌ VisualStateManager não está disponível! A timeline não funcionará.');
    console.error('   Verifique se base.js foi carregado corretamente.');
    console.error('   O playhead não se moverá sem o VisualStateManager.');

    // REMOVIDO: Fallback legado - não deve existir alternativa
    // Força o desenvolvedor a resolver o problema do VisualStateManager
}

// Salvar estado da timeline nos dados do projeto
function saveTimelineState() {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer || !videoPlayer.duration) return;

    // Salvar marcadores no formato existente (compatibilidade)
    // timelineState.currentMarkers já é mantido atualizado pelas funções de adicionar/remover

    // Salvar overlays na estrutura do projeto
    if (!currentProject.overlays) {
        currentProject.overlays = [];
    }

    // Limpar overlays existentes
    currentProject.overlays = [];

    // Coletar overlays da timeline
    const overlayElements = document.querySelectorAll('.overlay-segment');
    overlayElements.forEach(overlay => {
        const label = overlay.getAttribute('data-label');
        const start = parseFloat(overlay.getAttribute('data-start'));
        const duration = parseFloat(overlay.getAttribute('data-duration'));

        if (!isNaN(start) && !isNaN(duration)) {
            currentProject.overlays.push({
                label: label,
                start: start,
                duration: duration
            });
        }
    });

    console.log('Timeline state saved:', {
        markers: timelineState.currentMarkers,
        overlays: currentProject.overlays
    });
}

// Carregar estado da timeline dos dados do projeto
function loadTimelineState() {
    // Marcadores já são carregados via timelineState.currentMarkers (sistema unificado)

    // Carregar overlays do projeto
    if (currentProject && currentProject.overlays) {
        renderOverlays();
    }
}

// Controles de reprodução integrados com timeline
function handleTimelinePlayback() {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer) return;

    // Toggle play/pause
    if (videoPlayer.paused) {
        videoPlayer.play();
        timelineState.isPlaying = true;
    } else {
        videoPlayer.pause();
        timelineState.isPlaying = false;
    }

    // Atualizar botão de play/pause se existir
    const playPauseBtn = document.getElementById('play-pause');
    if (playPauseBtn) {
        playPauseBtn.innerHTML = timelineState.isPlaying ?
            '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
    }
}

// Navegar para posição específica da timeline
function seekToPosition(percentage) {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer || !videoPlayer.duration) return;

    const targetTime = (percentage / 100) * videoPlayer.duration;
    videoPlayer.currentTime = targetTime;
    updateTimelinePlayheadPosition(percentage);
}

// Buscar para marcador específico
function seekToMarker(markerLabel) {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer || !videoPlayer.duration) return;

    const time = timelineState.currentMarkers[markerLabel];
    if (time !== undefined) {
        seekToPosition((time / videoPlayer.duration) * 100);
    }
}

// Pular para próximo marcador
function seekToNextMarker() {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer || !videoPlayer.duration) return;

    const currentTime = videoPlayer.currentTime;
    let nextMarkerTime = null;
    let nextMarkerKey = null;

    for (const key in timelineState.currentMarkers) {
        const markerTime = timelineState.currentMarkers[key];
        if (markerTime > currentTime && (!nextMarkerTime || markerTime < nextMarkerTime)) {
            nextMarkerTime = markerTime;
            nextMarkerKey = key;
        }
    }

    if (nextMarkerTime !== null) {
        seekToPosition((nextMarkerTime / videoPlayer.duration) * 100);

        // Destacar marcador visualmente
        const markers = document.querySelectorAll('.marker-item');
        markers.forEach(marker => {
            if (marker.getAttribute('data-label') === nextMarkerKey) {
                selectMarker(marker);
            }
        });
    }
}

// Pular para marcador anterior
function seekToPreviousMarker() {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer || !videoPlayer.duration) return;

    const currentTime = videoPlayer.currentTime;
    let prevMarkerTime = null;
    let prevMarkerKey = null;

    for (const key in timelineState.currentMarkers) {
        const markerTime = timelineState.currentMarkers[key];
        if (markerTime < currentTime && (!prevMarkerTime || markerTime > prevMarkerTime)) {
            prevMarkerTime = markerTime;
            prevMarkerKey = key;
        }
    }

    if (prevMarkerTime !== null) {
        seekToPosition((prevMarkerTime / videoPlayer.duration) * 100);

        // Destacar marcador visualmente
        const markers = document.querySelectorAll('.marker-item');
        markers.forEach(marker => {
            if (marker.getAttribute('data-label') === prevMarkerKey) {
                selectMarker(marker);
            }
        });
    }
}

// Atualizar função de atalhos para incluir navegação
function handleTimelineKeydown(e) {
    // Ignorar se estiver em campo de input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // M: Adicionar marcador na posição atual (opcional - agora pode clicar na trilha)
    if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        addAdvancedMarker();
        return;
    }

    // REMOVIDO: Atalho "O" para adicionar overlays
    // Agora overlays são adicionados apenas via modal (botão overlayButton)

    // Delete: Remover elemento selecionado
    if (e.code === 'Delete') {
        e.preventDefault();
        deleteAdvancedSelectedElement();
        return;
    }

    // Espaço: Play/Pause
    if (e.code === 'Space') {
        e.preventDefault();
        handleTimelinePlayback();
        return;
    }

    // Seta esquerda: Voltar 1 segundo (apenas se não houver modificadores)
    if (e.code === 'ArrowLeft' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        const videoPlayer = document.getElementById('videoPlayer');
        if (videoPlayer && videoPlayer.duration) {
            videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 1);
        }
        return;
    }

    // Seta direita: Avançar 1 segundo (apenas se não houver modificadores)
    if (e.code === 'ArrowRight' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        const videoPlayer = document.getElementById('videoPlayer');
        if (videoPlayer && videoPlayer.duration) {
            videoPlayer.currentTime = Math.min(videoPlayer.duration, videoPlayer.currentTime + 1);
        }
        return;
    }

    // Page Up: Próximo marcador
    if (e.code === 'PageUp') {
        e.preventDefault();
        seekToNextMarker();
        return;
    }

    // Page Down: Marcador anterior
    if (e.code === 'PageDown') {
        e.preventDefault();
        seekToPreviousMarker();
        return;
    }
}

// Adicionar listeners de clique na timeline principal para navegação
function initTimelineSeeking() {
    const timelineTrack = document.querySelector('.timeline-track');
    if (!timelineTrack) return;

    // REMOVIDO: Click handler conflitava com detecção de clique duplo do VideoEditor
    // A navegação agora é tratada pelo mousedown do VideoEditor quando não for clique duplo
}

// Sobrescrever função saveProject para incluir timeline
function saveProject() {
    saveTimelineState();

    // Salvar no localStorage
    localStorage.setItem('currentProject', JSON.stringify(currentProject));
    localStorage.setItem('currentMarkers', JSON.stringify(timelineState.currentMarkers));

    console.log('Project and timeline saved successfully');
}

// Sobrescrever função loadProject para incluir timeline
function loadProject() {
    const savedProject = localStorage.getItem('currentProject');
    const savedMarkers = localStorage.getItem('currentMarkers');

    if (savedProject) {
        currentProject = JSON.parse(savedProject);
    }

    if (savedMarkers) {
        timelineState.currentMarkers = JSON.parse(savedMarkers);
    }

    loadTimelineState();
    updateProjectUI();

    console.log('Project and timeline loaded successfully');
}

// Atualizar função principal para manter apenas Fases 1-3
function renderTimeline() {
    renderMarkers();
    renderOverlays();

    // Inicializar timeline avançada se ainda não foi feita
    if (!timelineState.domCache.playhead) {
        initTimelineDOMCache();
        generateTimelineRuler();
        initAdvancedDragAndDrop();
        initAdvancedKeyboardShortcuts();
        initTimelineInteractivity();
        initTimelineVideoSync();
        initTimelineSeeking();
        initExtendedTimelineFeatures(); // Adicionar funcionalidades estendidas
        loadTimelineState();
    }
}

// Manter compatibilidade com código existente

function updateProjectUI() {
    // Update project header with IDs
    const projectTitle = document.getElementById('project-title');
    const projectType = document.getElementById('project-type');
    const projectProgress = document.getElementById('project-progress');
    const questionCount = document.getElementById('question-count');

    if (projectTitle) projectTitle.textContent = currentProject.name;
    if (projectType) projectType.textContent = `Múltipla Escolha • ${currentProject.totalAlternatives} alternativas`;
    if (projectProgress) projectProgress.textContent = `${currentProject.questions.length} questões (máximo 90)`;

    if (questionCount) questionCount.textContent = currentProject.questions.length;

    const playhead = document.querySelector('.playhead');
    if (playhead) {
        playhead.style.display = currentVideoURL ? 'block' : 'none';
    }

    toggleDropHint(!currentVideoURL);
    renderQuestionGrid();
    renderTimeline();
    updateMarkerButtons();

    const activeQuestion = currentProject.questions[activeQuestionIndex];
    renderDetailsPanel(activeQuestion);
    updateStatusBar();
}

// ---------------------------------------------------------------------------------
// FUNÇÕES DE ALTERNATIVAS DINÂMICAS (MVP)
// ---------------------------------------------------------------------------------

function updateMarkerButtons() {
    const container = document.getElementById('marker-alternatives-container');
    if (!container) return;

    const alternatives = Array.from({ length: currentProject.totalAlternatives }, (_, i) =>
        String.fromCharCode(65 + i)
    );

    container.innerHTML = '';

    alternatives.forEach(marker => {
        const button = document.createElement('button');
        button.className = 'btn btn-ghost btn-icon';
        button.innerHTML = `<span style="font-weight: 600; font-size: var(--font-size-xs);">${marker}</span>`;
        button.setAttribute('data-marker', marker);
        button.setAttribute('role', 'button');
        button.setAttribute('aria-label', `Marcador ${marker}`);
        button.addEventListener('click', () => setMarker(marker));
        container.appendChild(button);
    });

  }

function setMarker(marker) {
    if (!currentVideoURL || !videoPlayer || !videoPlayer.duration) {
            return;
    }

    const currentTime = videoPlayer.currentTime;

    // Usar estado centralizado em timelineState
    if (!timelineState.currentMarkers) timelineState.currentMarkers = {};
    timelineState.currentMarkers[marker] = currentTime;

    if (activeQuestionIndex === -1) {
        // Modo de criação de nova questão
      } else {
        // Modo de edição de questão existente
        const question = currentProject.questions[activeQuestionIndex];
        if (question) {
            if (!question.markers) question.markers = {};
            question.markers[marker] = currentTime;
            questionManager.updateQuestion(question.originalIndex, question);
            }
    }

    // Adicionar classe active ao botão clicado
    const clickedButton = document.querySelector(`[data-marker="${marker}"]`);
    if (clickedButton) {
        clickedButton.classList.add('active');
    }

    // Atualizar visualização dos marcadores na timeline
    renderTimeline();
}


function toggleDropHint(show) {
    const dropHint = document.querySelector('.drop-hint');
    if (dropHint) {
        if (show) {
            dropHint.classList.add('visible');
        } else {
            dropHint.classList.remove('visible');
        }
    }
}

function renderMarkerButtons() {
    const container = document.getElementById('marker-buttons-container');
    const videoPlayer = document.getElementById('videoPlayer');
    if (!container) return;

    // Clear only the buttons, keep the label
    container.querySelectorAll('.q-tag').forEach(btn => btn.remove());
    const fragment = document.createDocumentFragment();

    const alternatives = Array.from({ length: currentProject.totalAlternatives }, (_, i) => String.fromCharCode(65 + i));

    alternatives.forEach(alt => {
        const button = document.createElement('button');
        button.className = 'btn btn-icon';
        button.textContent = alt;
        button.setAttribute('role', 'button');
        button.setAttribute('aria-label', `Marcador ${alt}`);
        
        if (timelineState.currentMarkers[alt] !== undefined) {
            button.classList.add('active');
        }

        button.addEventListener('click', () => {
            if (!videoPlayer.src || videoPlayer.readyState < 2) {
                return;
            }
            const marker = button.textContent.trim();
            timelineState.currentMarkers[marker] = videoPlayer.currentTime;
            button.classList.add('active');
        });

        fragment.appendChild(button);
    });
    container.appendChild(fragment);
}

function renderQuestionGrid() {
    const grid = document.querySelector('.question-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const fragment = document.createDocumentFragment();

    currentProject.questions.forEach((q, index) => {
        const button = document.createElement('button');
        button.className = 'btn btn-icon question-btn';
        button.textContent = q.small_label;
        button.setAttribute('role', 'button');
        button.setAttribute('aria-label', q.label);
        button.dataset.questionIndex = index;

        if (index === activeQuestionIndex) {
            button.classList.add('active');
            button.setAttribute('aria-pressed', 'true');
        }

        button.addEventListener('click', () => {
            activeQuestionIndex = index;
            const question = currentProject.questions[index];
            loadQuestionForEditing(question);
        });

        fragment.appendChild(button);
    });

    const addButton = document.createElement('button');
    addButton.className = 'btn btn-icon q-add';
    addButton.textContent = '+';
    addButton.setAttribute('aria-label', 'Adicionar nova questão');
    addButton.addEventListener('click', () => {
        clearQuestionForm();
        handleVideoUpload();
    });

    if (currentProject.questions.length >= 90 || activeQuestionIndex !== -1) {
        addButton.disabled = true;
        addButton.style.cursor = 'not-allowed';
        addButton.setAttribute('aria-disabled', 'true');
        addButton.title = activeQuestionIndex !== -1 ? 'Salve ou cancele a edição atual para adicionar uma nova questão' : 'Limite de 90 questões atingido';
    }

    fragment.appendChild(addButton);

    grid.appendChild(fragment);
}

function renderDetailsPanel(question) {
    const detailsPanel = document.querySelector('.panel-details');
    const videoNameEl = document.getElementById('details-video-name');
    const alternativesContainer = document.getElementById('details-answers-container');
    const changeVideoButtonContainer = document.getElementById('change-video-button-container');

    // Limpar o contêiner do botão de troca de vídeo
    if (changeVideoButtonContainer) {
        changeVideoButtonContainer.innerHTML = '';
    }

    if (!videoNameEl || !alternativesContainer) return;

    if (activeQuestionIndex === -1) { // Modo de criação de nova questão
        videoNameEl.textContent = currentVideoURL ? videoPaths.get(currentVideoURL)?.split(/[\\/]/).pop() : 'Nenhum vídeo carregado';
        if (alternativesContainer) {
            if (tempCorrectAnswer) {
                // Show selected gabarito in creation mode
                const alternatives = Array.from({ length: currentProject.totalAlternatives }, (_, i) => String.fromCharCode(65 + i));
                alternativesContainer.innerHTML = '';
                alternatives.forEach(alt => {
                    const button = document.createElement('div');
                    button.className = 'answer-choice';
                    button.textContent = alt;
                    button.setAttribute('aria-label', `Alternativa ${alt}`);
                    if (tempCorrectAnswer === alt) {
                        button.classList.add('selected');
                        button.setAttribute('aria-pressed', 'true');
                    }
                    alternativesContainer.appendChild(button);
                });
            } else {
                alternativesContainer.innerHTML = '<p class="text-xs" style="color: var(--text-secondary)">Use o botão de gabarito (✓) para definir a resposta correta.</p>';
            }
        }
        return;
    }

    if (!question) {
        videoNameEl.textContent = 'Nenhum vídeo carregado';
        if (alternativesContainer) {
            alternativesContainer.innerHTML = '<p class="text-xs" style="color: var(--text-secondary)">Selecione uma questão</p>';
        }
        return;
    }

    videoNameEl.textContent = videoPaths.get(question.video)?.split(/[\\/]/).pop() || question.video.split(/[\\/]/).pop();

    // Adicionar botão de troca de vídeo
    if (changeVideoButtonContainer) {
        const changeVideoButton = document.createElement('button');
        changeVideoButton.className = 'btn btn-icon btn-ghost';
        changeVideoButton.innerHTML = '<i class="fas fa-edit"></i>';
        changeVideoButton.title = 'Trocar vídeo da questão';
        changeVideoButton.setAttribute('aria-label', 'Trocar vídeo da questão');
        changeVideoButton.addEventListener('click', handleChangeVideoForQuestion);
        changeVideoButtonContainer.appendChild(changeVideoButton);
    }

    if (alternativesContainer) {
        alternativesContainer.innerHTML = '';

        const alternatives = Array.from({ length: currentProject.totalAlternatives }, (_, i) => String.fromCharCode(65 + i));

        alternatives.forEach(alt => {
            const button = document.createElement('div');
            button.className = 'answer-choice';
            button.textContent = alt;
            button.setAttribute('aria-label', `Alternativa ${alt}`);
            if (question.correctAnswer === alt) {
                button.classList.add('selected');
                button.setAttribute('aria-pressed', 'true');
            }
            alternativesContainer.appendChild(button);
        });

        // Add edit button at the end
        const editGabaritoButton = document.createElement('button');
        editGabaritoButton.className = 'btn btn-ghost btn-icon';
        editGabaritoButton.innerHTML = '<i class="fas fa-edit"></i>';
        editGabaritoButton.setAttribute('aria-label', 'Editar gabarito');
        editGabaritoButton.style.marginLeft = '8px';
        editGabaritoButton.addEventListener('click', showGabaritoModal);
        alternativesContainer.appendChild(editGabaritoButton);
    }
}

async function handleChangeVideoForQuestion() {
    if (activeQuestionIndex < 0) return;

    try {
        const result = await window.electronAPI.showOpenDialog({
            title: 'Selecionar Novo Vídeo',
            properties: ['openFile'],
            filters: [
                { name: 'Vídeos', extensions: ['mp4', 'webm', 'mov', 'avi'] }
            ]
        });
        if (!result || result.canceled || result.filePaths.length === 0) {
            return; // User cancelled
        }

        const newVideoPath = result.filePaths[0];
        const newVideoName = newVideoPath.split(/[\\/]/).pop();

        // Update the video path for the current question
        const question = currentProject.questions[activeQuestionIndex];
        question.video = newVideoPath;
        currentProject.isDirty = true;

        // Update the main video player and state
        currentVideoURL = newVideoPath;
        videoPlayer.src = newVideoPath;
        videoPaths.set(newVideoPath, newVideoName);

        // Update the UI
        document.getElementById('details-video-name').textContent = newVideoName;
        document.getElementById('status-video-name').textContent = newVideoName;

        showNotification(`Vídeo da questão alterado para: ${newVideoName}`, 'success');

    } catch (error) {
        console.error('Error changing video for question:', error);
        showNotification(`Erro ao alterar o vídeo: ${error.message}`, 'error');
    }
}

function updateStatusBar() {
    const videoName = currentVideoURL ? videoPaths.get(currentVideoURL)?.split(/[\\/]/).pop() : 'Nenhum';
    document.getElementById('status-project-name').textContent = currentProject.name;
    document.getElementById('status-video-name').textContent = videoName;
    document.getElementById('status-question-count').textContent = `${currentProject.questions.length}/90`;
}

// ---------------------------------------------------------------------------------
// SISTEMA DE PROJETOS RECENTES
// ---------------------------------------------------------------------------------

function addToRecentProjects(projectPath, projectName) {
    // Remove duplicates
    recentProjects = recentProjects.filter(p => p.path !== projectPath);

    // Add to beginning
    recentProjects.unshift({
        path: projectPath,
        name: projectName,
        lastOpened: new Date().toISOString()
    });

    // Limit to max
    recentProjects = recentProjects.slice(0, MAX_RECENT_PROJECTS);

    // Save to localStorage
    localStorage.setItem('avalibras_recent_projects', JSON.stringify(recentProjects));

    // Update UI
    renderRecentProjects();
}

function removeFromRecentProjects(projectPath) {
    recentProjects = recentProjects.filter(p => p.path !== projectPath);
    localStorage.setItem('avalibras_recent_projects', JSON.stringify(recentProjects));
    renderRecentProjects();
}

function renderRecentProjects() {
    const recentProjectsList = document.getElementById('recentProjectsList');
    if (!recentProjectsList) return;

    recentProjectsList.innerHTML = '';

    if (recentProjects.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.className = 'menu-item disabled';
        emptyItem.innerHTML = '<span class="text-xs" style="color: var(--text-tertiary);">Nenhum projeto recente</span>';
        recentProjectsList.appendChild(emptyItem);
        return;
    }

    recentProjects.forEach(project => {
        const item = document.createElement('li');
        item.className = 'menu-item';

        const button = document.createElement('button');
        button.className = 'recent-project-btn';
        button.innerHTML = `
            <i class="fas fa-clock class="text-xs" style="color: var(--text-tertiary); margin-right: 8px;"></i>
            ${project.name}
        `;
        button.setAttribute('data-project-path', project.path);
        button.setAttribute('title', project.path);

        button.addEventListener('click', () => {
            openRecentProject(project.path);
        });

        item.appendChild(button);
        recentProjectsList.appendChild(item);
    });
}

async function openRecentProject(projectPath) {
    try {
        const { projectData, missingFiles } = await window.electronAPI.openProject(projectPath);
        
        if (missingFiles && missingFiles.length > 0) {
            showNotification(`Arquivos de mídia ausentes: ${missingFiles.join(', ')}`, 'warn');
        }

        currentProject = projectData;
        questionManager = new QuestionManager(currentProject);
        clearQuestionForm();

        // Update recent projects
        addToRecentProjects(projectPath, projectData.name);

            } catch (error) {
        showNotification(`Erro ao abrir projeto recente: ${error.message}`, 'error');
        // Remove from recent if it can't be opened
        removeFromRecentProjects(projectPath);
    }
}

// ---------------------------------------------------------------------------------
// MODAL DE GABARITO
// ---------------------------------------------------------------------------------

function showGabaritoModal() {
    const modal = document.getElementById('gabaritoModal');
    const optionsContainer = document.getElementById('gabaritoOptions');
    const confirmButton = document.getElementById('confirmGabarito');
    const question = activeQuestionIndex >= 0 ? currentProject.questions[activeQuestionIndex] : null;
    const currentCorrectAnswer = question ? question.correctAnswer : tempCorrectAnswer;

    optionsContainer.innerHTML = '';
    confirmButton.disabled = true;

    const alternatives = Array.from({ length: currentProject.totalAlternatives }, (_, i) => String.fromCharCode(65 + i));

    alternatives.forEach(alt => {
        const option = document.createElement('div'); // Use DIV instead of BUTTON
        option.className = 'answer-choice'; // Use the correct class
        option.textContent = alt;
        option.setAttribute('data-alternative', alt);
        option.setAttribute('role', 'button');
        option.setAttribute('tabindex', '0');

        if (currentCorrectAnswer === alt) {
            option.classList.add('selected');
            confirmButton.disabled = false;
        }

        option.addEventListener('click', () => {
            optionsContainer.querySelectorAll('.answer-choice').forEach(opt => {
                opt.classList.remove('selected');
            });

            option.classList.add('selected');
            confirmButton.disabled = false;
        });

        optionsContainer.appendChild(option);
    });

    modal.classList.add('active');
}

function hideGabaritoModal() {
    const modal = document.getElementById('gabaritoModal');
    modal.classList.remove('active');
}

function confirmGabarito() {
    const selectedOption = document.querySelector('#gabaritoOptions .answer-choice.selected');

    if (!selectedOption) {
            return;
    }

    const correctAnswer = selectedOption.getAttribute('data-alternative');

    if (activeQuestionIndex >= 0) {
        // Modo de edição - salvar na questão existente
        const question = currentProject.questions[activeQuestionIndex];
        if (question) {
            question.correctAnswer = correctAnswer;
            currentProject.isDirty = true;

            // Pausar o vídeo e atualizar a UI
            if (videoPlayer) videoPlayer.pause();
            renderDetailsPanel(question);

            hideGabaritoModal();
            showNotification(`Gabarito definido: Alternativa ${correctAnswer}`, 'success');
        }
    } else {
        // Modo de criação - armazenar temporariamente
        tempCorrectAnswer = correctAnswer;

        // Pausar o vídeo e atualizar a UI
        if (videoPlayer) videoPlayer.pause();
        renderDetailsPanel(null);

        hideGabaritoModal();
        showNotification(`Gabarito definido: Alternativa ${correctAnswer}`, 'success');
    }
}

function clearQuestionForm() {
    // Reset save button to create mode
    const saveButton = document.getElementById('saveQuestionButton');
    if (saveButton) {
        const icon = saveButton.querySelector('i');
        icon.className = 'fas fa-save';
        saveButton.setAttribute('data-hint', 'Salvar questão');
        saveButton.setAttribute('aria-label', 'Salvar questão');
        saveButton.setAttribute('title', 'Salvar questão');
    }

    const videoPlayer = document.getElementById('videoPlayer');
    const playPauseBtn = document.getElementById('play-pause');
    const playPauseIcon = document.getElementById('play-pause-icon');

    if (currentVideoURL && currentVideoURL.startsWith('blob:')) {
        URL.revokeObjectURL(currentVideoURL);
    }

    // Verificar se o elemento de vídeo existe antes de manipular
    if (videoPlayer) {
        videoPlayer.src = '';
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
    }

    // Resetar estado do botão play/pause - verificar se existe
    if (playPauseBtn) {
        playPauseBtn.disabled = true;
        playPauseBtn.style.cursor = 'not-allowed';
        playPauseBtn.style.opacity = '0.5';
        playPauseBtn.setAttribute('aria-disabled', 'true');
        playPauseBtn.setAttribute('title', 'Carregue um vídeo primeiro');
        playPauseBtn.setAttribute('aria-pressed', 'false');
    }
    if (playPauseIcon && playPauseIcon.classList && playPauseIcon.classList.contains('fa-pause')) {
        playPauseIcon.classList.replace('fa-pause', 'fa-play');
    }

    currentVideoURL = null;
    timelineState.currentMarkers = {};
    activeQuestionIndex = -1;
    tempCorrectAnswer = null;
    if (videoEditor) {
        videoEditor.clearSelection();
    }
    
    // Limpar campos do formulário
    const videoNameEl = document.getElementById('details-video-name');
    if (videoNameEl) videoNameEl.textContent = 'Nenhum vídeo carregado';

    const answersContainer = document.getElementById('details-answers-container');
    if (answersContainer) answersContainer.innerHTML = '';

    // Resetar estado do player de vídeo
    if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.currentTime = 0;
        const timelineProgress = document.querySelector('.timeline-progress');
        if (timelineProgress) {
            timelineProgress.style.width = '0%';
        }
        const playhead = document.getElementById('playhead');
        if (playhead) {
            playhead.style.left = '0%';
        }
    }
    
    document.querySelectorAll('.video-controls .q-tag[aria-label^="Marcador"]').forEach(btn => {
        btn.classList.remove('active');
    });
    updateProjectUI();
    renderQuestionGrid();
}

function loadQuestionForEditing(question) {
    clearQuestionForm();
    activeQuestionIndex = currentProject.questions.indexOf(question);

    // Update save button for edit mode
    const saveButton = document.getElementById('saveQuestionButton');
    if (saveButton) {
        const icon = saveButton.querySelector('i');
        icon.className = 'fas fa-check';
        saveButton.setAttribute('data-hint', 'Atualizar questão');
        saveButton.setAttribute('aria-label', 'Atualizar questão');
        saveButton.setAttribute('title', 'Atualizar questão');
    }


    const videoPlayer = document.getElementById('videoPlayer');
    const playPauseBtn = document.getElementById('play-pause');
    const playPauseIcon = document.getElementById('play-pause-icon');

    videoPlayer.src = question.video;
    currentVideoURL = question.video;
    timelineState.currentMarkers = { ...question.markers };

    // Garantir que o vídeo comece pausado
    if (videoPlayer) {
        videoPlayer.pause();
    }


    // Atualizar estado do botão play/pause ao carregar questão
    setTimeout(() => {
        if (playPauseBtn) {
            playPauseBtn.disabled = false;
            playPauseBtn.style.cursor = 'pointer';
            playPauseBtn.style.opacity = '1';
            playPauseBtn.setAttribute('aria-disabled', 'false');
            playPauseBtn.removeAttribute('title');
            playPauseBtn.setAttribute('aria-pressed', 'false');
            if (playPauseIcon && playPauseIcon.classList && playPauseIcon.classList.contains('fa-pause')) {
                playPauseIcon.classList.replace('fa-pause', 'fa-play');
            }
        }
    }, 100);

    document.querySelectorAll('.video-controls .q-tag[aria-label^="Marcador"]').forEach(btn => {
        const marker = btn.textContent.trim();
        if (timelineState.currentMarkers[marker] !== undefined) {
            btn.classList.add('active');
        }
    });

    updateProjectUI();
}


// ---------------------------------------------------------------------------------
// 4. LÓGICA DE INTERAÇÃO E EVENTOS
// ---------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------
// 4.1 FUNÇÕES DO MODAL INICIAL (MVP)
// ---------------------------------------------------------------------------------

function initializeNewProjectModal() {
    const modal = document.getElementById('newProjectModal');
    const projectNameInput = document.getElementById('projectName');
    const alternativesSelect = document.getElementById('alternativesCount');
    const confirmButton = document.getElementById('confirmProjectCreation');
    const cancelButton = document.getElementById('cancelProjectCreation');
    const guidedModeCheckbox = document.getElementById('showGuidedMode');

    // Validação em tempo real
    projectNameInput.addEventListener('input', validateProjectForm);
    alternativesSelect.addEventListener('change', validateProjectForm);

    // Eventos dos botões
    confirmButton.addEventListener('click', confirmProjectCreation);
    cancelButton.addEventListener('click', cancelProjectCreation);

    // Fechar modal clicando fora
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            cancelProjectCreation();
        }
    });

    // Atalho ESC para fechar e Enter para confirmar
    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display !== 'none') {
            cancelProjectCreation();
        } else if (e.key === 'Enter' && !confirmButton.disabled) {
            confirmProjectCreation();
        }
    });
}

function validateProjectForm() {
    const projectName = document.getElementById('projectName').value.trim();
    const confirmButton = document.getElementById('confirmProjectCreation');

    // Habilitar botão apenas se nome tiver pelo menos 3 caracteres
    confirmButton.disabled = projectName.length < 3;
}

function confirmProjectCreation() {
    const projectName = document.getElementById('projectName').value.trim();
    const alternativesCount = parseInt(document.getElementById('alternativesCount').value);
    const showGuidedMode = document.getElementById('showGuidedMode').checked;

    if (projectName.length < 3) {
        showNotification('O nome da avaliação deve ter pelo menos 3 caracteres', 'error');
        return;
    }

    // Atualizar projeto atual
    currentProject.name = projectName;
    currentProject.totalAlternatives = alternativesCount;
    currentProject.isDirty = false;

    // Habilitar interface
    unlockInterface();
    // Atualizar estado dos elementos da interface
    updateInterfaceState();

    // Fechar modal
    hideNewProjectModal();

    // Mostrar notificação de sucesso
    showNotification(`Avaliação "${projectName}" criada com sucesso!`, 'success');

    // Mostrar modo guiado se selecionado
    if (showGuidedMode) {
        setTimeout(() => showGuidedModeHelp(), 1000);
    }

    // Atualizar interface
    updateProjectUI();
    updateMarkerButtons();
    renderQuestionGrid();
}

function hideNewProjectModal() {
    const modal = document.getElementById('newProjectModal');
    modal.style.display = 'none';
}

function cancelProjectCreation() {
    // Se não houver projeto criado, perguntar se deseja sair
    if (currentProject.questions.length === 0 && currentProject.name === "Projeto sem Título") {
        showConfirmModal({
            title: 'Cancelar Criação',
            message: 'Deseja fechar o AvaLIBRAS? Nenhuma avaliação foi criada.'
        }).then(result => {
            if (result) {
                window.electronAPI?.quitApp();
            }
        });
    } else {
        hideNewProjectModal();
    }
}

function lockInterface() {
    document.querySelector('.app').classList.add('interface-locked');
}

function unlockInterface() {
    document.querySelector('.app').classList.remove('interface-locked');
}

// Verificar se projeto já foi criado
function isProjectInitialized() {
    // Basta ter nome personalizado para desbloquear a interface
    return currentProject.name !== "Projeto sem Título";
}

// Função global para atualizar estado da interface
function updateInterfaceState() {
    const lockedElements = [
        'overlayButton',           // Adicionar Imagem
        'gabaritoButton',          // Definir Gabarito
        'cutButton',               // Cortar Vídeo
        'importVideoBtn',          // Importar vídeo (se existir)
        'add-question',            // Adicionar Nova (data-action)
        'save-project',            // Salvar Projeto (data-action)
        'export-proof'             // Exportar Prova (data-action)
    ];

    const isLocked = !isProjectInitialized();

    // Mostrar log quando o estado mudar ou for a primeira vez
    const lastLockState = updateInterfaceState.lastLockState;
    if (lastLockState !== isLocked || lastLockState === undefined) {
        console.log('🔒 Interface Lock Status:', isLocked ? 'LOCKED' : 'UNLOCKED');
        console.log('📊 Project Status:', {
            name: currentProject.name,
            questionsCount: currentProject.questions.length,
            isInitialized: isProjectInitialized()
        });
        updateInterfaceState.lastLockState = isLocked;
    }

    lockedElements.forEach(elementId => {
        // Tentar encontrar por ID primeiro
        let element = document.getElementById(elementId);

        // Se não encontrar por ID, tentar por data-action
        if (!element) {
            element = document.querySelector(`[data-action="${elementId}"]`);
        }

        if (element) {
            const wasDisabled = element.disabled;

            if (isLocked) {
                element.disabled = true;
                element.setAttribute('title', 'Crie uma avaliação primeiro');
                element.classList.add('disabled');
            } else {
                element.disabled = false;
                element.removeAttribute('title');
                element.classList.remove('disabled');
            }

            // Só logar quando o estado do elemento mudar
            if (wasDisabled !== element.disabled && lastLockState !== isLocked) {
                console.log(`${isLocked ? '🔒' : '🔓'} ${elementId}: ${element.disabled ? 'Locked' : 'Unlocked'}`);
            }
        }
    });
}

// Sistema de bloqueio de interface
function setupInterfaceLock() {
    // Configurar sistema de bloqueio inicial
    if (!isProjectInitialized()) {
        lockInterface();
    } else {
        unlockInterface();
    }


    // Atualizar estado quando projeto mudar
    const originalUpdateProjectUI = updateProjectUI;
    updateProjectUI = function() {
        originalUpdateProjectUI.call(this);
        updateInterfaceState();
    };

    // Sistema de retry para encontrar elementos que podem aparecer depois
    const findElementsWithRetry = (elementIds, maxRetries = 10, delay = 1000) => {
        let retryCount = 0;

        const retry = () => {
            // Reduzir logging - só mostrar a cada 3 tentativas
            const shouldLog = retryCount % 3 === 0 || retryCount >= maxRetries - 1;

            if (shouldLog) {
                console.log(`🔄 Retry attempt ${retryCount + 1}/${maxRetries}`);
            }

            const foundElements = [];
            elementIds.forEach(id => {
                const element = document.getElementById(id);
                if (element) {
                    if (shouldLog) {
                        console.log(`✅ Found element: ${id}`);
                    }
                    foundElements.push(id);
                } else if (shouldLog) {
                    console.log(`⏳ Still not found: ${id}`);
                }
            });

            if (foundElements.length === elementIds.length || retryCount >= maxRetries) {
                console.log('🏁 Retry process completed');
                updateInterfaceState();
                return;
            }

            retryCount++;
            setTimeout(retry, delay);
        };

        retry();
    };

    // Forçar atualização inicial após carregar o DOM
    const initializeInterface = () => {
        console.log('🚀 DOM Ready State:', document.readyState);
        console.log('🚀 Starting interface initialization...');

        // Verificar se os elementos críticos existem
        const criticalElements = ['overlayButton', 'gabaritoButton', 'cutButton'];
        criticalElements.forEach(id => {
            const element = document.getElementById(id);
            console.log(`🔍 Element ${id}:`, element ? 'FOUND' : 'NOT FOUND');
        });

        // Se algum elemento crítico não foi encontrado, usar retry
        const missingElements = criticalElements.filter(id => !document.getElementById(id));
        if (missingElements.length > 0) {
            console.log('🔄 Some elements missing, starting retry process...');
            findElementsWithRetry(missingElements);
        } else {
            console.log('🚀 All elements found, updating interface...');
            updateInterfaceState();
        }
    };

    // Verificar se DOM já está pronto
    if (document.readyState === 'loading') {
        console.log('⏳ DOM still loading, waiting for DOMContentLoaded...');
        document.addEventListener('DOMContentLoaded', initializeInterface);
    } else {
        // DOM já está pronto, executar imediatamente
        console.log('✅ DOM already loaded, initializing immediately...');
        setTimeout(initializeInterface, 500);
    }
}

// Mostrar modal inicial se necessário
function checkAndShowInitialModal() {
    if (!isProjectInitialized()) {
        lockInterface();
        setTimeout(() => {
            initializeNewProjectModal();
            showNewProjectModal(); // Exibir o modal corretamente
            validateProjectForm(); // Validação inicial
        }, 100);
    } else {
        unlockInterface();
        // Garantir que a interface seja atualizada ao carregar projetos existentes
        setTimeout(() => updateInterfaceState(), 100);
    }
}

// Sistema de modo guiado para primeiros usuários
let guidedModeStep = 0;
const guidedModeSteps = [
    {
        element: '#project-title',
        title: 'Bem-vindo ao AvaLIBRAS',
        content: 'Vamos criar sua primeira avaliação juntos. Clique em "Adicionar Nova Questão" para começar.',
        position: 'bottom'
    },
    {
        element: '.video-controls button[data-hint="Importar vídeo"]',
        title: 'Passo 1: Importe um Vídeo',
        content: 'Clique aqui para selecionar o arquivo de vídeo da sua primeira questão.',
        position: 'top'
    },
    {
        element: '#marker-buttons-container',
        title: 'Passo 2: Adicione os Marcadores',
        content: 'Assista ao vídeo e clique nos botões A, B, C, D para marcar os tempos de cada alternativa.',
        position: 'top'
    },
    {
        element: '#gabaritoButton',
        title: 'Passo 3: Defina o Gabarito',
        content: 'Clique aqui para informar qual alternativa é a resposta correta.',
        position: 'left'
    },
    {
        element: '.panel-questions button',
        title: 'Passo 4: Salve a Questão',
        content: 'Clique no botão "+" para adicionar esta questão à sua avaliação.',
        position: 'right'
    }
];

function showGuidedModeHelp() {
    if (guidedModeStep >= guidedModeSteps.length) {
        guidedModeStep = 0;
        showNotification('Parabéns! Você completou o modo guiado.', 'success');
        return;
    }

    const step = guidedModeSteps[guidedModeStep];
    const element = document.querySelector(step.element);

    if (!element) {
        guidedModeStep++;
        showGuidedModeHelp();
        return;
    }

    showGuidedTooltip(step, element);
}

function showGuidedTooltip(step, element) {
    // Criar tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'guided-tooltip';
    tooltip.innerHTML = `
        <div class="guided-tooltip-header">
            <h4>${step.title}</h4>
            <button class="guided-tooltip-close">&times;</button>
        </div>
        <div class="guided-tooltip-content">
            <p>${step.content}</p>
            <div class="guided-tooltip-actions">
                <button class="btn secondary guided-tooltip-prev" ${guidedModeStep === 0 ? 'style="display:none"' : ''}>
                    Anterior
                </button>
                <button class="btn primary guided-tooltip-next">
                    ${guidedModeStep === guidedModeSteps.length - 1 ? 'Finalizar' : 'Próximo'}
                </button>
            </div>
        </div>
    `;

    // Posicionar tooltip
    document.body.appendChild(tooltip);
    positionTooltip(tooltip, element, step.position);

    // Destacar elemento
    element.classList.add('guided-highlight');
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Event listeners
    const closeBtn = tooltip.querySelector('.guided-tooltip-close');
    const nextBtn = tooltip.querySelector('.guided-tooltip-next');
    const prevBtn = tooltip.querySelector('.guided-tooltip-prev');

    closeBtn.addEventListener('click', closeGuidedTooltip);
    nextBtn.addEventListener('click', nextGuidedStep);
    prevBtn.addEventListener('click', prevGuidedStep);
}

function closeGuidedTooltip() {
    const tooltip = document.querySelector('.guided-tooltip');
    const highlight = document.querySelector('.guided-highlight');

    if (tooltip) tooltip.remove();
    if (highlight) highlight.classList.remove('guided-highlight');
}

function nextGuidedStep() {
    closeGuidedTooltip();
    guidedModeStep++;
    showGuidedModeHelp();
}

function prevGuidedStep() {
    closeGuidedTooltip();
    guidedModeStep--;
    showGuidedModeHelp();
}

function positionTooltip(tooltip, element, position) {
    const elementRect = element.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 10;

    let top, left;

    switch (position) {
        case 'top':
            top = elementRect.top - tooltipRect.height - margin;
            left = elementRect.left + (elementRect.width - tooltipRect.width) / 2;
            break;
        case 'bottom':
            top = elementRect.bottom + margin;
            left = elementRect.left + (elementRect.width - tooltipRect.width) / 2;
            break;
        case 'left':
            top = elementRect.top + (elementRect.height - tooltipRect.height) / 2;
            left = elementRect.left - tooltipRect.width - margin;
            break;
        case 'right':
            top = elementRect.top + (elementRect.height - tooltipRect.height) / 2;
            left = elementRect.right + margin;
            break;
        default:
            top = elementRect.bottom + margin;
            left = elementRect.left;
    }

    // Ajustar posição se sair da tela
    if (top < margin) top = margin;
    if (left < margin) left = margin;
    if (top + tooltipRect.height > window.innerHeight - margin) {
        top = window.innerHeight - tooltipRect.height - margin;
    }
    if (left + tooltipRect.width > window.innerWidth - margin) {
        left = window.innerWidth - tooltipRect.width - margin;
    }

    tooltip.style.position = 'fixed';
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
    tooltip.style.zIndex = '10000';
}

// ---------------------------------------------------------------------------------
// 4.2 FUNÇÕES EXISTENTES
// ---------------------------------------------------------------------------------

function initializeResizeHandles() {
    // ---- Redimensionador Principal da Sidebar (Horizontal) ----
    const resizeHandle = document.querySelector('.resize-handle');
    const sidebar = document.querySelector('.sidebar');

    if (resizeHandle && sidebar) {
        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            const startX = e.clientX;
            const startWidth = sidebar.offsetWidth;

            const doDrag = (e) => {
                const newWidth = startWidth + (e.clientX - startX);
                if (newWidth > 240 && newWidth < 500) { // Min/max width constraints
                    sidebar.style.width = `${newWidth}px`;
                }
            };

            const stopDrag = () => {
                document.body.style.cursor = 'default';
                document.body.style.userSelect = 'auto';
                document.removeEventListener('mousemove', doDrag);
                document.removeEventListener('mouseup', stopDrag);
            };

            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);
        });
    }

    // ---- Redimensionador do Painel de Detalhes (Vertical) ----
    const panelResizeHandle = document.querySelector('.panel-details-resize-handle');
    const questionsPanel = document.querySelector('.panel-questions');

    if (panelResizeHandle && questionsPanel && questionsPanel.parentElement) {
        panelResizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';

            const startY = e.clientY;
            const startHeight = questionsPanel.offsetHeight;
            const containerHeight = questionsPanel.parentElement.offsetHeight;

            const doDrag = (e) => {
                let newHeight = startHeight + (e.clientY - startY);

                const minHeight = containerHeight * 0.20;
                const maxHeight = containerHeight * 0.80;

                if (newHeight < minHeight) newHeight = minHeight;
                if (newHeight > maxHeight) newHeight = maxHeight;

                questionsPanel.style.flex = `0 0 ${newHeight}px`;
            };

            const stopDrag = () => {
                document.body.style.cursor = 'default';
                document.body.style.userSelect = 'auto';
                document.removeEventListener('mousemove', doDrag);
                document.removeEventListener('mouseup', stopDrag);
            };

            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);
        });
    }
}

function initializeEventListeners() {
    const topMenu = document.querySelector('.top-menu');
    console.log('DEBUG: topMenu found:', !!topMenu); // Debug

    topMenu.addEventListener('click', (e) => {
        console.log('DEBUG: Menu click event triggered'); // Debug
        const button = e.target.closest('button[data-menu]');
        console.log('DEBUG: button with data-menu found:', !!button); // Debug

        if (button) {
            const dropdown = button.nextElementSibling;
            console.log('DEBUG: dropdown found:', !!dropdown); // Debug
            console.log('DEBUG: dropdown classes:', dropdown?.className); // Debug

            topMenu.querySelectorAll('.dropdown.show').forEach(d => {
                if (d !== dropdown) d.classList.remove('show');
            });
            dropdown.classList.toggle('show');
            console.log('DEBUG: toggled show class'); // Debug
        }

        const actionButton = e.target.closest('button[data-action]');
        if (actionButton) {
            const action = actionButton.dataset.action;
            handleMenuAction(action);
            topMenu.querySelectorAll('.dropdown.show').forEach(d => d.classList.remove('show'));
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.top-menu')) {
            topMenu.querySelectorAll('.dropdown.show').forEach(d => d.classList.remove('show'));
        }
    });

    // --- Inicialização completa do Player de Vídeo ---
    initializePlayerControls();

    // --- Outros Listeners ---
    const dropHint = document.querySelector('.drop-hint');
    if (dropHint) {
        dropHint.addEventListener('click', handleVideoUpload);
    }

    // Gabarito button
    const gabaritoButton = document.getElementById('gabaritoButton');
    if (gabaritoButton) {
        gabaritoButton.addEventListener('click', showGabaritoModal);
    }

    // Initialize OverlayManager para botão de overlay
    const overlayButton = document.getElementById('overlayButton');
    if (overlayButton) {
        const videoPlayer = document.getElementById('videoPlayer');
        window.overlayManager = new OverlayManager(videoPlayer, {
            onSuccess: (message) => console.log('✅ [DEBUG] Overlay success:', message),
            onError: (error) => showNotification(error, 'error'),
            onProgress: (message) => console.log('📊 [DEBUG] Progress:', message),
            onOverlayStateChanged: (state) => {
                console.log('🔄 [DEBUG] Overlay state changed:', state);
                console.log('🔍 [DEBUG] OverlayManager status:', {
                    hasCurrentOverlay: window.overlayManager.currentOverlay !== null,
                    currentOverlayId: window.overlayManager.currentOverlay?.overlayId,
                    updateFunctionExists: typeof window.overlayManager.currentOverlay?.updateFunction === 'function'
                });
            }
        });

        console.log('✅ [DEBUG] OverlayManager inicializado e disponível globalmente como window.overlayManager');
    }

    // Cut button (agora estático no HTML)
    const cutButton = document.getElementById('cutButton');
    if (cutButton) {
        cutButton.addEventListener('click', () => {
            if (videoEditor) {
                videoEditor.cut();
            } else {
              }
        });
    }

    // Save question button
    const saveQuestionButton = document.getElementById('saveQuestionButton');
    if (saveQuestionButton) {
        saveQuestionButton.addEventListener('click', () => {
            saveCurrentQuestion();
        });
    }
}

function renderTimelineRuler(duration) {
    const ruler = document.querySelector('.timeline-ruler');
    if (!ruler) return;

    ruler.innerHTML = ''; // Clear existing ticks
    const rulerWidth = ruler.offsetWidth;

    if (rulerWidth === 0 || !isFinite(duration) || duration <= 0) {
        return; // Don't draw ruler if width or duration is invalid
    }

    const fragment = document.createDocumentFragment();

    // Determine interval based on duration and width
    const pixelsPerSecond = rulerWidth / duration;
    let majorTickInterval = 10; // Default: 10 seconds
    if (pixelsPerSecond * 10 < 50) majorTickInterval = 20;
    if (pixelsPerSecond * 10 < 25) majorTickInterval = 60;
    if (pixelsPerSecond * 10 < 15) majorTickInterval = 120;
    
    const minorTickInterval = majorTickInterval / 5;

    for (let i = 0; i <= duration; i++) {
        const isMajor = i % majorTickInterval === 0;
        const isMinor = !isMajor && i % minorTickInterval === 0;

        if (isMajor || isMinor) {
            const tick = document.createElement('div');
            tick.className = isMajor ? 'ruler-tick major' : 'ruler-tick minor';
            const position = (i / duration) * 100;
            tick.style.left = `${position}%`;
            fragment.appendChild(tick);

            if (isMajor) {
                const label = document.createElement('span');
                label.className = 'ruler-label';
                label.textContent = formatTime(i).split('.')[0]; // Show only MM:SS
                label.style.left = `${position}%`;
                fragment.appendChild(label);
            }
        }
    }
    ruler.appendChild(fragment);
}

/**
 * Configura todos os event listeners e a lógica de interatividade para o player de vídeo e a timeline.
 */
function initializePlayerControls() {
    const videoPlayer = document.getElementById('videoPlayer');
    const playPauseBtn = document.getElementById('play-pause');
    const playPauseIcon = document.getElementById('play-pause-icon');
    const timelineTrack = document.querySelector('.timeline-track');
    const playhead = document.querySelector('.playhead');
    const progressBar = document.querySelector('.timeline-progress');
    const currentTimeEl = document.querySelector('.timeline span[aria-label="Tempo atual"]');
    const durationEl = document.querySelector('.timeline span[aria-label="Duração total"]');

    // Função para atualizar estado do botão play/pause
    function updatePlayPauseButtonState() {
        const hasVideo = videoPlayer.src && videoPlayer.src !== '' && videoPlayer.readyState >= 2;

        if (hasVideo) {
            playPauseBtn.disabled = false;
            playPauseBtn.style.cursor = 'pointer';
            playPauseBtn.style.opacity = '1';
            playPauseBtn.setAttribute('aria-disabled', 'false');
            playPauseBtn.removeAttribute('title');
        } else {
            playPauseBtn.disabled = true;
            playPauseBtn.style.cursor = 'not-allowed';
            playPauseBtn.style.opacity = '0.5';
            playPauseBtn.setAttribute('aria-disabled', 'true');
            playPauseBtn.setAttribute('title', 'Carregue um vídeo primeiro');

            // Resetar ícone para play quando não há vídeo
            if (playPauseIcon && playPauseIcon.classList && playPauseIcon.classList.contains('fa-pause')) {
                playPauseIcon.classList.replace('fa-pause', 'fa-play');
            }
            playPauseBtn.setAttribute('aria-pressed', 'false');
        }
    }

    // Ações de Play/Pause
    playPauseBtn.addEventListener('click', () => {
        if (playPauseBtn.disabled) return;

        if (videoPlayer.paused || videoPlayer.ended) videoPlayer.play();
        else videoPlayer.pause();
    });

    videoPlayer.addEventListener('play', () => {
        if (playPauseIcon && playPauseIcon.classList) {
            playPauseIcon.classList.remove('fa-play');
            playPauseIcon.classList.add('fa-pause');
        }
        playPauseBtn.setAttribute('aria-pressed', 'true');
    });

    videoPlayer.addEventListener('pause', () => {
        if (playPauseIcon && playPauseIcon.classList) {
            playPauseIcon.classList.remove('fa-pause');
            playPauseIcon.classList.add('fa-play');
        }
        playPauseBtn.setAttribute('aria-pressed', 'false');
    });

    videoPlayer.addEventListener('loadedmetadata', () => {
        const duration = videoPlayer.duration;
        durationEl.textContent = formatTime(duration);
        renderTimelineRuler(duration);
        updatePlayPauseButtonState(); // Atualizar estado quando vídeo carregar
    });

    videoPlayer.addEventListener('loadstart', () => {
        updatePlayPauseButtonState(); // Atualizar estado quando começar a carregar
    });

    videoPlayer.addEventListener('error', () => {
        updatePlayPauseButtonState(); // Atualizar estado em caso de erro
    });

    // REMOVIDO: Listener timeupdate duplicado - agora handled pelo VisualStateManager.initOptimizedVideoSync()
    // Isso previne loops infinitos e conflitos de performance
    // A atualização da timeline agora é feita pelo sistema unificado do VisualStateManager

    // Estado inicial do botão
    updatePlayPauseButtonState();

    // Lógica do Tooltip de preview do tempo na timeline
    const timePreviewTooltip = document.createElement('div');
    timePreviewTooltip.className = 'timeline-time-preview';
    timelineTrack.appendChild(timePreviewTooltip);

    // Mousemove com debouncing para o tooltip de preview
    const debouncedTooltipHandler = VisualStateManager.debounce((e) => {
        // Oculta o tooltip de hover geral se o usuário estiver interagindo com a seleção
        if (videoEditor && (videoEditor.isSelecting || videoEditor.isDraggingHandle)) {
            timePreviewTooltip.style.opacity = '0';
            return;
        }

        if (!videoPlayer.duration) return;
        const rect = timelineTrack.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = x / rect.width;
        const hoverTime = percentage * videoPlayer.duration;

        timePreviewTooltip.textContent = formatTime(hoverTime);
        // Position the tooltip above the cursor
        const tooltipWidth = timePreviewTooltip.offsetWidth;
        timePreviewTooltip.style.left = `${x - (tooltipWidth / 2)}px`;
        timePreviewTooltip.style.opacity = '1';
    }, 16); // ~60fps

    timelineTrack.addEventListener('mousemove', debouncedTooltipHandler);

    timelineTrack.addEventListener('mouseleave', () => {
        timePreviewTooltip.style.opacity = '0';
    });

    // Instancia o editor de vídeo passando os elementos corretos
    videoEditor = new VideoEditor(videoPlayer, timelineTrack);

    // REMOVIDO: Todo o sistema de scrubbing - mouse colado eliminado completamente
    // Apenas preview de tempo ao passar o mouse sem indicador visual que prende o mouse
}

/** Formata segundos para o formato MM:SS.ms ou MM:SS */
function formatTime(seconds, includeMilliseconds = true) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    const baseTime = `${String(minutes).padStart(2, '0')}:${String(Math.floor(remainingSeconds)).padStart(2, '0')}`;

    if (includeMilliseconds) {
        const milliseconds = Math.floor((remainingSeconds - Math.floor(remainingSeconds)) * 1000);
        return `${baseTime}.${String(milliseconds).padStart(3, '0')}`;
    }

    return baseTime;
}

function handleMenuAction(action) {
    switch (action) {
        case 'new-project': showNewProjectModal(); break;
        case 'open-project': openProject(); break;
        case 'save-project': saveProject(); break;
        case 'export-proof': exportProof(); break;
        case 'add-question':
            clearQuestionForm();
            handleVideoUpload();
            break;
        case 'exit-app': window.electronAPI?.quitApp(); break;
        case 'dev-tools': window.electronAPI?.toggleDevTools(); break;

        // Menu Questão - Novas funcionalidades
        case 'import-questions': importQuestions(); break;
        case 'manage-questions': showManageQuestionsModal(); break;
        case 'duplicate-question': duplicateCurrentQuestion(); break;
        case 'clear-all-questions': clearAllQuestions(); break;

        // Menu Ferramentas - Novas funcionalidades
        case 'settings': showSettingsModal(); break;
        case 'clear-cache': clearCache(); break;
        case 'verify-integrity': verifyProjectIntegrity(); break;
        case 'project-stats': showProjectStats(); break;

        // Menu Ajuda - Novas funcionalidades
        case 'user-manual': showUserManual(); break;
        case 'keyboard-shortcuts': showKeyboardShortcuts(); break;
        case 'usage-examples': showUsageExamples(); break;
        case 'check-updates': checkForUpdates(); break;
        case 'report-issue': reportIssue(); break;
        case 'about': showAboutModal(); break;
    }
}

async function handleVideoUpload() {
    if (!window.electronAPI) return showNotification('API não disponível.', 'error');
    try {
        const result = await window.electronAPI.showOpenDialog({
            title: 'Selecionar Vídeo',
            filters: [{ name: 'Vídeos', extensions: ['mp4', 'webm', 'mov', 'avi'] }],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const filePath = result.filePaths[0];
            const videoUrl = `file://${filePath}`;
            
            if (currentVideoURL && currentVideoURL.startsWith('blob:')) {
                URL.revokeObjectURL(currentVideoURL);
            }

            videoPaths.set(videoUrl, filePath);
            document.getElementById('videoPlayer').src = videoUrl;
            currentVideoURL = videoUrl;
            updateProjectUI();

            // Atualizar estado do botão play/pause após carregar vídeo
            setTimeout(() => {
                const playPauseBtn = document.getElementById('play-pause');
                const playPauseIcon = document.getElementById('play-pause-icon');
                if (playPauseBtn) {
                    playPauseBtn.disabled = false;
                    playPauseBtn.style.cursor = 'pointer';
                    playPauseBtn.style.opacity = '1';
                    playPauseBtn.setAttribute('aria-disabled', 'false');
                    playPauseBtn.removeAttribute('title');
                    playPauseBtn.setAttribute('aria-pressed', 'false');
                    if (playPauseIcon && playPauseIcon.classList && playPauseIcon.classList.contains('fa-pause')) {
                        playPauseIcon.classList.replace('fa-pause', 'fa-play');
                    }
                }
            }, 100);
        }
    } catch (error) {
        showNotification(`Erro ao selecionar vídeo: ${error.message}`, 'error');
    }
}

async function saveCurrentQuestion() {
    try {
        // Validações básicas
        if (!currentVideoURL) throw new Error("Nenhum vídeo foi carregado para esta questão.");

        // Verificar se há marcadores definidos
        if (!timelineState.currentMarkers || Object.keys(timelineState.currentMarkers).length === 0) {
            throw new Error("Defina pelo menos um marcador de tempo para a questão.");
        }

        // Verificar se todos os marcadores obrigatórios foram definidos
        const expectedAlternatives = Array.from({ length: currentProject.totalAlternatives }, (_, i) => String.fromCharCode(65 + i));
        const missingMarkers = expectedAlternatives.filter(alt =>
            !timelineState.currentMarkers[alt] || timelineState.currentMarkers[alt] === 0
        );

        if (missingMarkers.length > 0) {
            throw new Error(`Defina os marcadores para as alternativas: ${missingMarkers.join(', ')}`);
        }

        if (activeQuestionIndex >= 0) {
            // Modo de edição - usar gabarito existente
            const currentQuestion = currentProject.questions[activeQuestionIndex];
            const correctAnswer = currentQuestion?.correctAnswer;
            
            if (!correctAnswer) {
                throw new Error("Defina o gabarito da questão antes de salvar.");
            }

            const updatedData = {
                ...currentQuestion,
                video: currentVideoURL,
                markers: timelineState.currentMarkers,
                correctAnswer: correctAnswer
            };
            questionManager.updateQuestion(currentQuestion.originalIndex, updatedData);

        } else {
            // Modo de criação - usar gabarito temporário
            const correctAnswer = tempCorrectAnswer;
            if (!correctAnswer) {
                throw new Error("Defina o gabarito da questão antes de salvar.");
            }
            questionManager.addQuestion(currentVideoURL, timelineState.currentMarkers, correctAnswer);
        }

        // Atualizar interface
        renderQuestionGrid();
        updateProjectUI();
        updateStatusBar();

        showNotification("Questão salva com sucesso!", "success");

        // Limpar formulário para preparar para a próxima ação
        clearQuestionForm();

    } catch (error) {
        showNotification(`Erro ao salvar questão: ${error.message}`, "error");
    }
}

function showNewProjectModal() {
    const modal = document.getElementById('newProjectModal');
    if (!modal) {
        console.error('❌ Modal newProjectModal not found in DOM');
        return;
    }

    modal.classList.add('active');

    // Focar no primeiro campo do formulário com verificação de segurança
    const firstInput = modal.querySelector('input[name="projectName"]');
    if (firstInput) {
        firstInput.focus();
    } else {
        console.warn('⚠️ Input projectName not found in modal, trying alternative selectors...');
        // Tentar encontrar pelo ID
        const inputById = modal.querySelector('#projectName');
        if (inputById) {
            inputById.focus();
        } else {
            console.error('❌ No input found to focus in modal');
        }
    }
}

/** Injeta o HTML do modal de novo projeto no corpo do documento. */
function injectModalHTMLAndCSS() {
    const modalHTML = `
        <div class="modal-overlay" id="advancedProjectModal">
            <div class="modal advanced-project-modal">
                <div class="modal-header">
                    <h3 class="modal-title">Novo Projeto Avançado</h3>
                    <button class="btn btn-ghost btn-icon" id="cancelProjectCreation" aria-label="Fechar">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <form>
                    <div class="form-group">
                        <label for="projectName">Nome do Projeto</label>
                        <input type="text" id="projectName" name="projectName" class="input" placeholder="Ex: Avaliação de Ciências - Corpo Humano">
                    </div>
                    <div class="form-group">
                        <label for="questionCount">Número de Questões</label>
                        <input type="number" id="questionCount" name="questionCount" class="input" value="10" min="1">
                    </div>
                    <div class="form-group">
                        <label for="alternativeCount">Número de Alternativas por Questão</label>
                        <select id="alternativeCount" name="alternativeCount" class="input">
                            <option value="2">2 (A-B)</option>
                            <option value="3">3 (A-B-C)</option>
                            <option value="4" selected>4 (A-B-C-D)</option>
                            <option value="5">5 (A-B-C-D-E)</option>
                        </select>
                    </div>
                    <div class="modal-buttons">
                        <button type="button" class="btn secondary" id="cancelProjectCreationBtn">Cancelar</button>
                        <button type="button" class="btn primary" id="confirmProjectCreation">Criar Projeto</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

async function openProject() {
    if (!window.electronAPI) return showNotification('API não disponível.', 'error');
    try {
        const result = await window.electronAPI.showOpenDialog({
            title: 'Abrir Projeto AvaLIBRAS',
            filters: [{ name: 'Projeto AvaLIBRAS', extensions: ['avaproject'] }],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const filePath = result.filePaths[0];
            const { projectData, missingFiles } = await window.electronAPI.openProject(filePath);
            
            if (missingFiles && missingFiles.length > 0) {
                showNotification(`Arquivos de mídia ausentes: ${missingFiles.join(', ')}`, 'warn');
            }

            currentProject = projectData;
            questionManager = new QuestionManager(currentProject);
            clearQuestionForm();

            // Add to recent projects
            addToRecentProjects(filePath, projectData.name);

                    }
    } catch (error) {
        showNotification(`Erro ao abrir projeto: ${error.message}`, 'error');
    }
}

async function saveProject() {
    if (!window.electronAPI) return showNotification('API não disponível.', 'error');
    try {
        const result = await window.electronAPI.showSaveDialog({
            title: 'Salvar Projeto AvaLIBRAS',
            defaultPath: `${currentProject.name.replace(/[^a-z0-9]/gi, '_')}.avaproject`,
            filters: [{ name: 'Projeto AvaLIBRAS', extensions: ['avaproject'] }]
        });

        if (!result.canceled && result.filePath) {
            await window.electronAPI.saveProject({
                filePath: result.filePath,
                projectData: currentProject,
                videoPaths: Object.fromEntries(videoPaths)
            });
            currentProject.isDirty = false;

            // Add to recent projects
            addToRecentProjects(result.filePath, currentProject.name);

            showNotification('Projeto salvo com sucesso!', 'success');
        }
    } catch (error) {
        showNotification(`Erro ao salvar projeto: ${error.message}`, 'error');
    }
}

async function exportProof() {
    if (!window.electronAPI) return showNotification('API não disponível.', 'error');
    if (currentProject.questions.length === 0) {
        return showNotification('Adicione pelo menos uma questão antes de exportar.', 'warn');
    }

    try {
        const result = await window.electronAPI.showSaveDialog({
            title: 'Exportar Prova Final',
            defaultPath: `${currentProject.name.replace(/[^a-z0-9]/gi, '_')}.ava`,
            filters: [{ name: 'Arquivo de Prova AvaLIBRAS', extensions: ['ava'] }]
        });

        if (!result.canceled && result.filePath) {
                        await window.electronAPI.exportTest({
                filePath: result.filePath,
                projectData: currentProject,
                videoPaths: Object.fromEntries(videoPaths)
            });
            showNotification('Prova exportada com sucesso!', 'success');
        }
    } catch (error) {
        showNotification(`Erro ao exportar a prova: ${error.message}`, 'error');
    }
}

// ---------------------------------------------------------------------------------
// 5. UTILITÁRIOS
// ---------------------------------------------------------------------------------

// Sistema de notificações unificado com gerenciamento de fila
const NotificationManager = {
    container: null,
    queue: [],
    maxNotifications: 1,
    notificationTimeout: 2000,
    lastMessages: new Map(), // Para debouncing
    debounceTime: 500, // 500ms para debouncing

    init() {
        // Criar container se não existir
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'notification-container';
            document.body.appendChild(this.container);
        }
    },

    // Limpar mensagens de duplicatas e emojis
    cleanMessage(message, type) {
        // Remover emojis redundantes
        let cleanedMessage = message.replace(/[🎉❌🗑️✅⚠️ℹ️]/g, '').trim();

        // Remover mensagens duplicadas comuns
        const duplicates = [
            'Seleção cancelada',
            'Seleção removida',
            'Seleção pronta:'
        ];

        for (const duplicate of duplicates) {
            if (cleanedMessage.includes(duplicate)) {
                // Verificar se já existe notificação similar na fila
                const existingNotification = this.queue.find(n =>
                    n.message.includes(duplicate) && n.type === type
                );
                if (existingNotification) {
                    return null; // Não mostrar duplicata
                }
            }
        }

        return cleanedMessage;
    },

    show(message, type = "info", options = {}) {
        this.init();

        // Debouncing: verificar se mensagem similar foi mostrada recentemente
        const messageKey = `${type}:${message}`;
        const now = Date.now();
        const lastTime = this.lastMessages.get(messageKey);

        if (lastTime && (now - lastTime) < this.debounceTime) {
            console.log(`[DEBOUNCED] ${type.toUpperCase()}: ${message}`);
            return; // Ignorar mensagem duplicada
        }

        this.lastMessages.set(messageKey, now);

        // Limpar mensagem
        const cleanedMessage = this.cleanMessage(message, type);
        if (!cleanedMessage) return;

        // Limitar tamanho da fila
        if (this.queue.length >= this.maxNotifications) {
            const oldestNotification = this.queue[0]; // Pega referência sem remover
            this.hide(oldestNotification.element, true); // hide() remove da tela e da fila
        }

        // Criar elemento de notificação
        const notificationElement = document.createElement('div');
        notificationElement.className = `notification ${type}`;

        // Conteúdo da notificação
        const contentWrapper = document.createElement('div');
        contentWrapper.textContent = cleanedMessage;

        // Botão de fechar
        const closeButton = document.createElement('button');
        closeButton.className = 'notification-close';
        closeButton.innerHTML = '×';
        closeButton.setAttribute('aria-label', 'Fechar notificação');

        closeButton.addEventListener('click', () => {
            this.hide(notificationElement);
        });

        notificationElement.appendChild(contentWrapper);
        notificationElement.appendChild(closeButton);

        // Adicionar ao container e à fila
        this.container.appendChild(notificationElement);

        const notificationData = {
            element: notificationElement,
            message: cleanedMessage,
            type: type,
            timestamp: Date.now()
        };

        this.queue.push(notificationData);

        // Log ao console
        console.log(`[${type.toUpperCase()}] ${cleanedMessage}`);

        // Animar entrada
        requestAnimationFrame(() => {
            notificationElement.classList.add('show');
        });

        // Auto-hide após timeout
        const timeout = options.duration || this.notificationTimeout;
        setTimeout(() => {
            this.hide(notificationElement);
        }, timeout);

        // Notificação nativa do Electron
        if (window.electronAPI && window.electronAPI.showNotification) {
            window.electronAPI.showNotification({
                title: `AvaLIBRAS - ${type.charAt(0).toUpperCase() + type.slice(1)}`,
                body: cleanedMessage,
            });
        }

        return notificationData;
    },

    hide(element, immediate = false) {
        const index = this.queue.findIndex(n => n.element === element);
        if (index === -1) return;

        const notification = this.queue[index];

        if (immediate) {
            element.remove();
            this.queue.splice(index, 1);
        } else {
            element.classList.add('hiding');

            setTimeout(() => {
                element.remove();
                this.queue.splice(index, 1);
            }, 300);
        }
    },

    // Limpar todas as notificações
    clear() {
        this.queue.forEach(notification => {
            this.hide(notification.element, true);
        });
        this.queue = [];
        this.lastMessages.clear();
    },

    // Obter mensagens padronizadas
    getStandardMessage(key, ...args) {
        const messages = {
            VIDEO_SAVED: 'Vídeo salvo com sucesso!',
            ERROR_GENERIC: 'Ocorreu um erro',
            ERROR_VIDEO_LIMITS: 'O intervalo selecionado está fora dos limites do vídeo',
            ERROR_BLOB_VIDEO: 'Não foi possível obter o blob do vídeo',
            SUCCESS_AUTO_LOAD: 'Vídeo carregado automaticamente!',
            ERROR_AUTO_LOAD: 'Vídeo cortado, mas erro ao carregar automaticamente.'
        };

        return messages[key] || args[0] || key;
    }
};

// Função de compatibilidade para uso existente
async function showNotification(message, type = "info", options = {}) {
    return NotificationManager.show(message, type, options);
}

function showConfirmModal({ title, message }) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        if (!modal) {
            console.error('Confirm modal not found in DOM.');
            resolve(false); // Resolve with false if modal doesn't exist
            return;
        }

        modal.querySelector('.confirm-title').textContent = title || 'Você tem certeza?';
        modal.querySelector('.confirm-message').textContent = message || 'Esta ação não pode ser desfeita.';

        const confirmButton = modal.querySelector('#confirmConfirm');
        const cancelButton = modal.querySelector('#confirmCancelBtn');

        const closeModal = (result) => {
            modal.classList.remove('active');
            // Remove listeners to avoid memory leaks
            confirmButton.onclick = null;
            cancelButton.onclick = null;
            resolve(result);
        };

        confirmButton.onclick = () => closeModal(true);
        cancelButton.onclick = () => closeModal(false);

        modal.classList.add('active');
    });
}

function initializeWindowControls() {
    const minimizeButton = document.getElementById('minimize');
    const maximizeButton = document.getElementById('maximize');
    const closeButton = document.getElementById('close');

    if (minimizeButton) {
        minimizeButton.addEventListener('click', () => window.electronAPI?.minimizeWindow());
    }

    if (maximizeButton) {
        maximizeButton.addEventListener('click', () => {
            if (maximizeButton.classList.contains('restore')) {
                window.electronAPI?.unmaximizeWindow();
            } else {
                window.electronAPI?.maximizeWindow();
            }
        });
    }

    if (closeButton) {
        closeButton.addEventListener('click', () => window.electronAPI?.closeWindow());
    }

    // Listen for window state changes to update the maximize button icon
    if (window.electronAPI?.onWindowMaximize) {
        window.electronAPI.onWindowMaximize(() => {
            if (maximizeButton) {
                maximizeButton.classList.add('restore');
                maximizeButton.setAttribute('aria-label', 'Restaurar janela');
                maximizeButton.querySelector('.window-control-tooltip').textContent = 'Restaurar';
            }
        });
    }

    if (window.electronAPI?.onWindowUnmaximize) {
        window.electronAPI.onWindowUnmaximize(() => {
            if (maximizeButton) {
                maximizeButton.classList.remove('restore');
                maximizeButton.setAttribute('aria-label', 'Maximizar janela');
                maximizeButton.querySelector('.window-control-tooltip').textContent = 'Maximizar';
            }
        });
    }
}

function initializeFixedTooltips() {
    // Adicionar eventos de mouse para botões com data-hint
    const buttonsWithHints = document.querySelectorAll('.btn-icon[data-hint]');

    buttonsWithHints.forEach(button => {
        button.addEventListener('mouseenter', (e) => {
            showFixedTooltip(e.target);
        });

        button.addEventListener('mouseleave', (e) => {
            hideFixedTooltip(e.target);
        });
    });
}

function showFixedTooltip(button) {
    const hintText = button.getAttribute('data-hint');
    if (!hintText) return;

    // Criar elemento do tooltip se não existir
    let tooltip = document.querySelector('.fixed-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'fixed-tooltip';
        document.body.appendChild(tooltip);
    }

    // Definir conteúdo e estilo
    tooltip.textContent = hintText;
    tooltip.style.cssText = `
        position: fixed;
        background: var(--tooltip-bg-primary);
        color: var(--tooltip-text-primary);
        padding: var(--tooltip-padding-y) var(--tooltip-padding-x);
        border-radius: var(--tooltip-border-radius);
        font-size: var(--tooltip-font-size);
        font-family: var(--font-family-monospace);
        white-space: nowrap;
        z-index: 9999;
        border: 1px solid var(--tooltip-border-primary);
        box-shadow: var(--tooltip-shadow);
        backdrop-filter: var(--tooltip-backdrop-filter);
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
    `;

    // Calcular posição
    const rect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 8; // --tooltip-margin

    // Posicionar acima do botão
    let left = rect.left + rect.width / 2;
    let top = rect.top - margin;

    // Centralizar horizontalmente
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.transform = 'translate(-50%, -100%)';

    // Ajustar se sair da tela
    requestAnimationFrame(() => {
        const actualRect = tooltip.getBoundingClientRect();

        // Ajustar horizontalmente se ultrapassar os limites
        if (actualRect.left < 0) {
            tooltip.style.left = `${actualRect.width / 2}px`;
        } else if (actualRect.right > window.innerWidth) {
            tooltip.style.left = `${window.innerWidth - actualRect.width / 2}px`;
        }

        // Ajustar verticalmente se não tiver espaço acima
        if (actualRect.top < 0) {
            tooltip.style.transform = 'translate(-50%, 100%)';
            tooltip.style.top = `${rect.bottom + margin}px`;
        }

        // Mostrar tooltip
        tooltip.style.opacity = '1';
    });
}

function hideFixedTooltip(button) {
    const tooltip = document.querySelector('.fixed-tooltip');
    if (tooltip) {
        tooltip.style.opacity = '0';
        setTimeout(() => {
            if (tooltip.style.opacity === '0') {
                tooltip.remove();
            }
        }, 200);
    }
}

function injectConfirmModalHTML() {
    const modalHTML = `
        <div class="modal-overlay" id="confirmModal">
            <div class="modal-base-desktop confirm-modal-desktop">
                <div class="modal-header-desktop">
                    <h3 class="modal-title-desktop">
                        <i class="fas fa-exclamation-triangle"></i>
                        Confirmar Ação
                    </h3>
                    <button class="btn btn-ghost btn-icon" id="confirmCancel">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body-desktop">
                    <div class="confirm-content">
                        <h3 class="confirm-title">Você tem certeza?</h3>
                        <p class="confirm-message">Esta ação não pode ser desfeita.</p>
                    </div>
                </div>
                <div class="modal-footer-desktop">
                    <button type="button" class="btn secondary" id="confirmCancelBtn">
                        <i class="fas fa-times"></i>
                        Cancelar
                    </button>
                    <button type="button" class="btn danger" id="confirmConfirm">
                        <i class="fas fa-check"></i>
                        Confirmar
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function injectProgressModalHTML() {
    const modalHTML = `
        <div class="modal-overlay" id="progressModal">
            <div class="modal-base-desktop progress-modal-desktop">
                <div class="modal-header-desktop">
                    <h3 class="modal-title-desktop">
                        <i class="fas fa-spinner fa-spin"></i>
                        Processando
                    </h3>
                </div>
                <div class="modal-body-desktop">
                    <div class="progress-content-desktop">
                        <div class="progress-loader-desktop"></div>
                        <p class="progress-text-desktop">Processando...</p>
                        <div class="progress-bar-desktop">
                            <div class="progress-fill-desktop"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function showProgressModal(message) {
    const modal = document.getElementById('progressModal');
    if (!modal) return;
    const textElement = modal.querySelector('.progress-text-desktop');
    const fillElement = modal.querySelector('.progress-fill-desktop');
    if (textElement) textElement.textContent = message || 'Processando...';
    if (fillElement) fillElement.style.width = '0%';
    modal.classList.add('active');
}

function updateProgressModal({ text, percent }) {
    const modal = document.getElementById('progressModal');
    if (!modal) return;
    if (text) {
        const textElement = modal.querySelector('.progress-text-desktop');
        if (textElement) textElement.textContent = text;
    }
    if (percent !== undefined) {
        const fillElement = modal.querySelector('.progress-fill-desktop');
        if (fillElement) fillElement.style.width = `${percent}%`;
    }
}

function hideProgressModal() {
    const modal = document.getElementById('progressModal');
    if (!modal) return;
    modal.classList.remove('active');
}

// ---------------------------------------------------------------------------------
// SISTEMA DE MONITORAMENTO
// ---------------------------------------------------------------------------------

function updateSystemStats() {
    // Memory usage estimation
    if (window.performance && window.performance.memory) {
        const memoryMB = Math.round(window.performance.memory.usedJSHeapSize / 1048576);
        const memoryElement = document.getElementById('status-memory');
        if (memoryElement) {
            memoryElement.textContent = `${memoryMB} MB`;
        }
    } else {
        // Fallback: estimate based on project size
        const memoryElement = document.getElementById('status-memory');
        if (memoryElement) {
            const estimatedMB = Math.max(30, currentProject.questions.length * 2 + 10);
            memoryElement.textContent = `${estimatedMB} MB (est.)`;
        }
    }

    // CPU estimation (simplified - browser doesn't provide direct CPU access)
    const cpuElement = document.getElementById('status-cpu');
    if (cpuElement) {
        // Simulated CPU usage based on application activity
        const baseUsage = 2;
        const videoUsage = currentVideoURL ? 3 : 0;
        const questionUsage = currentProject.questions.length * 0.5;
        const estimatedCPU = Math.round(baseUsage + videoUsage + questionUsage);
        cpuElement.textContent = `CPU ${estimatedCPU}%`;
    }

    // Status update
    const statusElement = document.getElementById('status-ready');
    if (statusElement) {
        if (currentProject.isDirty) {
            statusElement.textContent = 'Modificado';
            statusElement.style.color = 'var(--warning)';
        } else {
            statusElement.textContent = 'Pronto';
            // Removido style.color para seguir padrão branco da statusbar
        }
    }
}

// ---------------------------------------------------------------------------------
// 6. INICIALIZAÇÃO DA APLICAÇÃO
// ---------------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    try {
    console.log("AvaLIBRAS v2.0 - Carregando aplicação...");

    // Inicializar componentes existentes
    injectModalHTMLAndCSS();
    injectConfirmModalHTML();
    injectProgressModalHTML();
    initializeEventListeners();
    initializeResizeHandles();
    initializeWindowControls();
    initializeFixedTooltips();
    updateProjectUI();
    renderQuestionGrid();
    renderDetailsPanel(null);
    updateMarkerButtons();

    // Inicializar timeline avançada
    renderTimeline();

    // VERIFICAÇÃO CRÍTICA DO MVP: Mostrar modal inicial se necessário
    checkAndShowInitialModal();

    // Configurar sistema de bloqueio de interface
    setupInterfaceLock();

    // Inicializar sistema de arrastar modais
    initializeModalDragging();

    // Carregar projetos recentes
    renderRecentProjects();

    // Setup IPC listeners para comunicação com o processo principal
    function setupIPCEventListeners() {
        // Menu shortcuts listeners
        if (window.electronAPI && window.electronAPI.onNewProject) {
            window.electronAPI.onNewProject(() => {
                showNewProjectModal();
            });
        }

        if (window.electronAPI && window.electronAPI.onSaveProject) {
            window.electronAPI.onSaveProject(() => {
                saveProject();
            });
        }

        if (window.electronAPI && window.electronAPI.onOpenProject) {
            window.electronAPI.onOpenProject(() => {
                openProject();
            });
        }

        if (window.electronAPI && window.electronAPI.onExportProject) {
            window.electronAPI.onExportProject(() => {
                exportProject();
            });
        }

        // Window state listeners
        if (window.electronAPI && window.electronAPI.onWindowMaximize) {
            window.electronAPI.onWindowMaximize(() => {
                const maximizeBtn = document.getElementById('maximizeBtn');
                if (maximizeBtn) {
                    maximizeBtn.innerHTML = '<i class="fas fa-restore"></i>';
                    maximizeBtn.title = 'Restaurar';
                }
            });
        }

        if (window.electronAPI && window.electronAPI.onWindowUnmaximize) {
            window.electronAPI.onWindowUnmaximize(() => {
                const maximizeBtn = document.getElementById('maximizeBtn');
                if (maximizeBtn) {
                    maximizeBtn.innerHTML = '<i class="fas fa-maximize"></i>';
                    maximizeBtn.title = 'Maximizar';
                }
            });
        }

        // Progress modal listeners
        if (window.electronAPI && window.electronAPI.onShowProgressModal) {
            window.electronAPI.onShowProgressModal((event, message) => {
                showProgressModal(message);
            });
        }

        if (window.electronAPI && window.electronAPI.onUpdateProgress) {
            window.electronAPI.onUpdateProgress((event, progress) => {
                updateProgress(progress);
            });
        }

        if (window.electronAPI && window.electronAPI.onHideProgressModal) {
            window.electronAPI.onHideProgressModal(() => {
                hideProgressModal();
            });
        }
    }

    // Setup IPC listeners existentes
    setupIPCEventListeners();

    // Initial UI updates to ensure elements are rendered
    setTimeout(() => {
        updateProjectUI();
        renderQuestionGrid();
    }, 100);

    console.log('AvaLIBRAS v2.0 - Aplicação carregada com sucesso');

    // Initialize gabarito modal event listeners
    const closeGabaritoModal = document.getElementById('closeGabaritoModal');
    const cancelGabarito = document.getElementById('cancelGabarito');
    const confirmGabaritoBtn = document.getElementById('confirmGabarito');

    if (closeGabaritoModal) {
        closeGabaritoModal.addEventListener('click', hideGabaritoModal);
    }
    if (cancelGabarito) {
        cancelGabarito.addEventListener('click', hideGabaritoModal);
    }
    if (confirmGabaritoBtn) {
        confirmGabaritoBtn.addEventListener('click', confirmGabarito);
    }

    // Close modal on background click
    const gabaritoModal = document.getElementById('gabaritoModal');
    if (gabaritoModal) {
        gabaritoModal.addEventListener('click', (e) => {
            if (e.target === gabaritoModal) {
                hideGabaritoModal();
            }
        });
    }

    // Atalho ESC para fechar modal de gabarito
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && gabaritoModal && gabaritoModal.classList.contains('active')) {
            hideGabaritoModal();
        }
    });

    // Clock update
    const clockElement = document.getElementById('clock');
    if (clockElement) {
        setInterval(() => {
            clockElement.textContent = new Date().toLocaleTimeString();
        }, 1000);
    }

    // System monitoring
    updateSystemStats();
    setInterval(updateSystemStats, 5000); // Update every 5 seconds

    // Listen for progress modal events
    if (window.electronAPI?.onShowProgressModal) {
        window.electronAPI.onShowProgressModal((event, message) => {
            showProgressModal(message);
        });
        window.electronAPI.onUpdateProgress((event, data) => {
            updateProgressModal(data);
        });
        window.electronAPI.onHideProgressModal(() => {
            hideProgressModal();
        });
    }

    // Listen for menu shortcuts
    if (window.electronAPI?.onNewProject) {
        window.electronAPI.onNewProject(() => {
            showNewProjectModal();
        });
    }
    if (window.electronAPI?.onSaveProject) {
        window.electronAPI.onSaveProject(() => {
            saveProject();
        });
    }
    if (window.electronAPI?.onOpenProject) {
        window.electronAPI.onOpenProject(() => {
            openProject();
        });
    }
    if (window.electronAPI?.onExportProject) {
        window.electronAPI.onExportProject(() => {
            exportProof();
        });
    }

    // CRÍTICO: Inicializar VisualStateManager para garantir funcionamento da agulha e barra de progresso
    if (typeof VisualStateManager !== 'undefined') {
        console.log('🎯 Inicializando VisualStateManager completo...');
        console.log('📊 VSM: Iniciando sistema de sincronização de playhead...');

        VisualStateManager.init();

        console.log('✅ VisualStateManager inicializado com sucesso - cache de elementos populado');
        console.log('🚀 VSM: Sistema pronto! Playhead controlado por CSS custom properties');
        console.log('🔧 VSM: Para testar: carregue um vídeo e clique em play - verifique os logs acima');
    } else {
        console.error('❌ VisualStateManager não encontrado - agulha e barra de progresso não funcionarão');
        console.error('   Verifique se base.js foi carregado corretamente');
    }

    } catch (e) {
        console.error("Caught error:", e, e.stack);
    }
});

// ---------------------------------------------------------------------------------
// 7. FUNCIONALIDADES DOS NOVOS MENUS
// ---------------------------------------------------------------------------------

// Menu Questão - Funcionalidades
async function importQuestions() {
  }

function showManageQuestionsModal() {
    if (currentProject.questions.length === 0) {
        showNotification('Nenhuma questão para gerenciar.', 'warning');
        return;
    }

      // TODO: Implementar modal de gerenciamento de questões
}

function duplicateCurrentQuestion() {
    if (activeQuestionIndex === -1 || !currentProject.questions[activeQuestionIndex]) {
        showNotification('Selecione uma questão para duplicar.', 'warning');
        return;
    }

    if (currentProject.questions.length >= 90) {
        showNotification('Limite de 90 questões atingido.', 'error');
        return;
    }

    const originalQuestion = currentProject.questions[activeQuestionIndex];
    const duplicatedQuestion = {
        ...originalQuestion,
        label: `Questão ${questionManager._getNextQuestionNumber()}`,
        small_label: questionManager._getNextQuestionNumber().toString().padStart(2, "0"),
        originalIndex: questionManager._getNextQuestionNumber()
    };

    currentProject.questions.push(duplicatedQuestion);
    currentProject.isDirty = true;
    updateProjectUI();
    showNotification('Questão duplicada com sucesso!', 'success');
}

async function clearAllQuestions() {
    if (currentProject.questions.length === 0) {
        showNotification('Nenhuma questão para remover.', 'info');
        return;
    }

    const result = await showConfirmModal({
        title: 'Remover Todas as Questões',
        message: `Tem certeza que deseja remover todas as ${currentProject.questions.length} questões? Esta ação não pode ser desfeita.`
    });

    if (result) {
        currentProject.questions = [];
        currentProject.isDirty = true;
        clearQuestionForm();
        updateProjectUI();
        showNotification('Todas as questões foram removidas.', 'success');
    }
}

// Menu Ferramentas - Funcionalidades
function showSettingsModal() {
    }

function clearCache() {
    // Limpar cache de vídeos temporários
    videoPaths.clear();
    localStorage.clear();
    showNotification('Cache temporário limpo com sucesso!', 'success');
}

function verifyProjectIntegrity() {
    const issues = [];

    // Verificar questões sem vídeo
    currentProject.questions.forEach((q, index) => {
        if (!q.video) {
            issues.push(`Questão ${index + 1}: Sem vídeo`);
        }
        if (!q.markers || Object.keys(q.markers).length === 0) {
            issues.push(`Questão ${index + 1}: Sem marcadores`);
        }
        if (!q.correctAnswer) {
            issues.push(`Questão ${index + 1}: Sem gabarito`);
        }
    });

    if (issues.length === 0) {
        showNotification('Integridade do projeto verificada: Nenhum problema encontrado.', 'success');
    } else {
        showNotification(`Foram encontrados ${issues.length} problemas:\n${issues.join('\n')}`, 'warning');
    }
}

function showProjectStats() {
    const totalQuestions = currentProject.questions.length;
    const questionTypes = {};
    const questionsWithOverlays = currentProject.questions.filter(q => q.overlay).length;

    currentProject.questions.forEach(q => {
        const type = q.overlay ? 'Com overlay' : 'Sem overlay';
        questionTypes[type] = (questionTypes[type] || 0) + 1;
    });

    const stats = `
Estatísticas da Avaliação:
• Total de Questões: ${totalQuestions}/90
• Questões com Overlay: ${questionsWithOverlays}
• Média de marcadores por questão: ${totalQuestions > 0 ? '4' : '0'}
• Status: ${currentProject.isDirty ? 'Modificado' : 'Salvo'}
    `.trim();

  }

// Menu Ajuda - Funcionalidades
function showUserManual() {
    const helpContent = `
Manual do Usuário AvaLIBRAS v2.0:

1. Crie um novo projeto com nome e número de alternativas
2. Adicione questões usando o botão "+" ou menu Questão
3. Para cada questão:
   - Carregue um vídeo
   - Corte trechos indesejados (opcional)
   - Adicione overlays de imagem (opcional)
   - Marque os tempos A, B, C, D, E durante o vídeo
   - Defina o gabarito correto
4. Salve o projeto regularmente
5. Exporte a prova final quando concluída

Atalhos: Ctrl+N (Novo), Ctrl+S (Salvar), Ctrl+O (Abrir), Ctrl+E (Exportar)
    `.trim();

    }

function showKeyboardShortcuts() {
    const shortcuts = `
Atalhos de Teclado AvaLIBRAS:

• Ctrl+N: Novo Projeto
• Ctrl+S: Salvar Projeto
• Ctrl+O: Abrir Projeto
• Ctrl+E: Exportar Prova
• Ctrl+Q: Sair
• Ctrl+T: Tela Cheia
• Ctrl+M: Minimizar
• Ctrl+Shift+I: Ferramentas de Desenvolvimento
    `.trim();

    }

function showUsageExamples() {
    const examples = `
Exemplos de Uso AvaLIBRAS:

1. Avaliação de Matemática:
   - Vídeo demonstrando problema
   - Alternativas A, B, C, D com soluções
   - Gabarito: C

2. Prova de Ciências:
   - Experimento em vídeo
   - Marcar pontos importantes
   - Overlay com diagrama

3. Avaliação de LIBRAS:
   - Vídeo com pergunta em sinais
   - Alternativas em texto/imagem
   - Gabarito correspondente
    `.trim();

    }

function checkForUpdates() {
    }

function reportIssue() {
    const issueContent = `
Para reportar um problema, inclua:
• Versão: AvaLIBRAS v2.0.0
• Sistema Operacional: ${navigator.platform}
• Descrição detalhada do problema
• Passos para reproduzir
• Resultado esperado vs obtido

Envie para: avalibras-support@example.com
    `.trim();

    }

function showAboutModal() {
    const aboutContent = `
AvaLIBRAS v2.0.0
Sistema de Criação de Avaliações Educacionais em LIBRAS

Desenvolvido para educadores que criam conteúdo inclusivo.
Permite criar avaliações completas com vídeo, marcadores e gabarito.

Tecnologias: Electron, FFmpeg, HTML5, CSS3, JavaScript
Licença: MIT
    `.trim();

    }

// ---------------------------------------------------------------------------------
// 8. SISTEMA DE ARRASTAR MODAIS
// ---------------------------------------------------------------------------------

function initializeModalDragging() {
    // Aplicar a todos os modais existentes e futuros
    applyModalDragging();

    // Observer para modais criados dinamicamente
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Verificar se é um modal ou contém modais
                    if (node.classList?.contains('modal') ||
                        node.classList?.contains('modal-base-desktop') ||
                        node.querySelector?.('.modal') ||
                        node.querySelector?.('.modal-base-desktop')) {
                        setTimeout(() => applyModalDragging(), 100);
                    }
                }
            });
        });
    });

    // Observar mudanças no body
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

function applyModalDragging() {
    const modals = document.querySelectorAll('.modal, .modal-base-desktop');
    console.log('DEBUG: Found modals for dragging:', modals.length);

    modals.forEach((modal, index) => {
        // Skip se já tiver arrastar configurado
        if (modal.hasAttribute('data-draggable')) {
            console.log(`DEBUG: Modal ${index} already draggable`);
            return;
        }

        const header = modal.querySelector('.modal-header-desktop, .dialog-titlebar');
        console.log(`DEBUG: Modal ${index} header found:`, !!header);
        if (!header) return;

        modal.setAttribute('data-draggable', 'true');
        console.log(`DEBUG: Modal ${index} made draggable`);

        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let initialLeft = 0;
        let initialTop = 0;

        // Função para iniciar o arrasto
        function startDrag(e) {
            console.log('DEBUG: Start drag triggered');
            isDragging = true;
            startX = e.clientX || e.touches[0].clientX;
            startY = e.clientY || e.touches[0].clientY;

            const rect = modal.getBoundingClientRect();
            const style = window.getComputedStyle(modal);

            initialLeft = rect.left - parseInt(style.marginLeft);
            initialTop = rect.top - parseInt(style.marginTop);

            console.log('DEBUG: Adding global drag listeners');
            // Adicionar listeners globais
            document.addEventListener('mousemove', drag);
            document.addEventListener('mouseup', stopDrag);
            document.addEventListener('touchmove', drag, { passive: false });
            document.addEventListener('touchend', stopDrag);

            // Prevenir seleção de texto
            e.preventDefault();
            document.body.style.userSelect = 'none';
        }

        // Função para arrastar
        function drag(e) {
            if (!isDragging) {
                console.log('DEBUG: Drag called but not dragging');
                return;
            }

            const currentX = e.clientX || e.touches[0].clientX;
            const currentY = e.clientY || e.touches[0].clientY;

            const deltaX = currentX - startX;
            const deltaY = currentY - startY;

            const newLeft = initialLeft + deltaX;
            const newTop = initialTop + deltaY;

            // Limitar dentro da viewport
            const maxX = window.innerWidth - modal.offsetWidth;
            const maxY = window.innerHeight - modal.offsetHeight;

            const constrainedX = Math.max(0, Math.min(newLeft, maxX));
            const constrainedY = Math.max(0, Math.min(newTop, maxY));

            // Aplicar posição sem afetar outros elementos
            if (!modal.style.position || modal.style.position !== 'fixed') {
                modal.style.position = 'fixed';
                modal.style.margin = '0';
            }
            modal.style.left = constrainedX + 'px';
            modal.style.top = constrainedY + 'px';

            e.preventDefault();
        }

        // Função para parar o arrasto
        function stopDrag() {
            isDragging = false;

            // Remover listeners globais
            document.removeEventListener('mousemove', drag);
            document.removeEventListener('mouseup', stopDrag);
            document.removeEventListener('touchmove', drag);
            document.removeEventListener('touchend', stopDrag);

            // Restaurar seleção de texto
            document.body.style.userSelect = '';
        }

        // Adicionar listener ao header
        console.log(`DEBUG: Adding drag listeners to modal ${index} header`);
        header.addEventListener('mousedown', startDrag);
        header.addEventListener('touchstart', startDrag, { passive: false });
        console.log(`DEBUG: Drag listeners added to modal ${index}`);

        // Impedir que cliques em botões fechem o modal durante arrasto
        const buttons = header.querySelectorAll('button');
        buttons.forEach(button => {
            button.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
        });
    });
}

/**
 * Validação robusta de vídeo para overlays
 * Verifica estado do vídeo e metadados antes de operações de overlay
 */
function validateVideoForOverlay(videoElement) {
    if (!videoElement) {
        console.warn('⚠️ validateVideoForOverlay: Elemento de vídeo não fornecido');
        return { valid: false, reason: 'Elemento de vídeo não encontrado' };
    }

    // Verificar se o elemento é realmente um vídeo
    if (videoElement.tagName !== 'VIDEO') {
        console.warn('⚠️ validateVideoForOverlay: Elemento não é um vídeo:', videoElement.tagName);
        return { valid: false, reason: 'Elemento fornecido não é um vídeo' };
    }

    // Verificar se o vídeo tem src
    if (!videoElement.src && !videoElement.currentSrc) {
        console.warn('⚠️ validateVideoForOverlay: Vídeo não possui fonte definida');
        return { valid: false, reason: 'Vídeo não possui fonte' };
    }

    // Verificar metadados
    if (videoElement.readyState < 1) {
        console.warn('⚠️ validateVideoForOverlay: Metadados do vídeo não carregados (readyState:', videoElement.readyState, ')');
        return { valid: false, reason: 'Metadados do vídeo não carregados' };
    }

    // Verificar dimensões
    if (!videoElement.videoWidth || !videoElement.videoHeight ||
        videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
        console.warn('⚠️ validateVideoForOverlay: Dimensões do vídeo inválidas:', videoElement.videoWidth, 'x', videoElement.videoHeight);
        return { valid: false, reason: 'Dimensões do vídeo inválidas' };
    }

    // Verificar duração
    if (!videoElement.duration || videoElement.duration === 0 || isNaN(videoElement.duration)) {
        console.warn('⚠️ validateVideoForOverlay: Duração do vídeo inválida:', videoElement.duration);
        return { valid: false, reason: 'Duração do vídeo inválida' };
    }

    // Atualizar estado centralizado
    if (window.OverlayState) {
        window.OverlayState.videoState = {
            isReady: true,
            duration: videoElement.duration,
            currentTime: videoElement.currentTime,
            videoWidth: videoElement.videoWidth,
            videoHeight: videoElement.videoHeight,
            readyState: videoElement.readyState
        };
    }

    console.log('✅ validateVideoForOverlay: Vídeo validado com sucesso');
    return {
        valid: true,
        duration: videoElement.duration,
        currentTime: videoElement.currentTime,
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight
    };
}

// =================================================================================
// FUNCIONALIDADES ADICIONAIS DA TIMELINE (MIGRADAS DE timeline.js)
// =================================================================================

// Adicionar estado de zoom ao timelineState
if (timelineState) {
    timelineState.zoomLevel = 1;
}

// Zoom in
function zoomIn() {
    timelineState.zoomLevel = Math.min(timelineState.zoomLevel * 1.2, 5);
    applyZoom();
}

// Zoom out
function zoomOut() {
    timelineState.zoomLevel = Math.max(timelineState.zoomLevel / 1.2, 0.5);
    applyZoom();
}

// Aplicar zoom à timeline
function applyZoom() {
    // Em uma implementação real, isso ajustaria a visualização da timeline
    // Para simplificar, apenas mostramos uma notificação
    console.log(`Aplicando zoom de ${timelineState.zoomLevel}x à timeline`);
    if (typeof showNotification === 'function') {
        showNotification(`Zoom: ${timelineState.zoomLevel.toFixed(1)}x`, 'info');
    }
}

// Ir para marcador específico
function goToMarker(markerNumber) {
    const marker = document.querySelector(`.marker-item[data-number="${markerNumber}"]`);
    if (!marker) return;

    // Selecionar o marcador
    selectMarker(marker);

    const position = parseFloat(marker.style.left);
    updateTimelinePlayheadPosition(position);
}

// Navegar entre elementos com Tab
function navigateElements(reverse = false) {
    const allElements = [
        ...document.querySelectorAll('.marker-item'),
        ...document.querySelectorAll('.overlay-segment')
    ];

    if (allElements.length === 0) return;

    // Remover seleção anterior
    if (timelineState.selectedElement) {
        timelineState.selectedElement.classList.remove('selected');
    }

    // Limpar seleções específicas
    if (timelineState.selectedMarker) {
        timelineState.selectedMarker.classList.remove('selected');
        timelineState.selectedMarker = null;
    }

    if (timelineState.selectedOverlay) {
        timelineState.selectedOverlay.classList.remove('selected');
        timelineState.selectedOverlay = null;
    }

    // Encontrar próximo elemento
    let nextIndex = 0;

    if (timelineState.selectedElement) {
        const currentIndex = allElements.indexOf(timelineState.selectedElement);
        nextIndex = reverse ?
            (currentIndex - 1 + allElements.length) % allElements.length :
            (currentIndex + 1) % allElements.length;
    }

    // Selecionar próximo elemento
    timelineState.selectedElement = allElements[nextIndex];
    timelineState.selectedElement.classList.add('selected');
    timelineState.selectedElement.focus();

    // Definir como marcador ou overlay selecionado
    if (timelineState.selectedElement.classList.contains('marker-item')) {
        timelineState.selectedMarker = timelineState.selectedElement;
    } else if (timelineState.selectedElement.classList.contains('overlay-segment')) {
        timelineState.selectedOverlay = timelineState.selectedElement;
    }
}

// Mover marcador selecionado com as setas do teclado
function moveSelectedMarker(direction, largeStep = false) {
    if (!timelineState.selectedMarker) return;

    const step = largeStep ? 5 : 1; // Passo grande de 5%, pequeno de 1%
    const currentPosition = parseFloat(timelineState.selectedMarker.style.left);
    let newPosition;

    if (direction === 'left') {
        newPosition = Math.max(0, currentPosition - step);
    } else {
        newPosition = Math.min(100, currentPosition + step);
    }

    // Atualizar posição do marcador
    timelineState.selectedMarker.style.left = `${newPosition}%`;

    // Sincronizar playhead com marcador
    updateTimelinePlayheadPosition(newPosition);
}

// Mover overlay selecionado com as setas do teclado
function moveSelectedOverlay(direction, isLargeStep = false) {
    console.log('🔧 [UNIFIED] moveSelectedOverlay() chamado:', {
        direction,
        isLargeStep,
        timelineStateKeys: Object.keys(timelineState)
    });

    // Usar sistema unificado de validação
    const selectedOverlay = getValidatedSelectedOverlay();
    if (!selectedOverlay) {
        console.warn('❌ [UNIFIED] Nenhum overlay selecionado encontrado');
        return;
    }

    const step = isLargeStep ? 5 : 1; // Passo grande de 5%, pequeno de 1%
    const currentPosition = parseFloat(selectedOverlay.style.left);
    const currentWidth = parseFloat(selectedOverlay.style.width);

    console.log('📏 [DEBUG] Valores atuais:', {
        currentPosition,
        currentWidth,
        step,
        elementStyle: timelineState.selectedOverlay.style.cssText
    });

    if (isNaN(currentPosition) || isNaN(currentWidth)) {
        console.error('❌ [DEBUG] Valores inválidos detectados:', {
            currentPosition,
            currentWidth,
            element: timelineState.selectedOverlay
        });
        return;
    }

    let newPosition;

    if (direction === 'left') {
        newPosition = Math.max(0, currentPosition - step);
    } else {
        newPosition = Math.min(100 - currentWidth, currentPosition + step);
    }

    console.log('🎯 [DEBUG] Nova posição calculada:', {
        direction,
        oldPosition: currentPosition,
        newPosition,
        maxPosition: 100 - currentWidth
    });

    // Atualizar posição do overlay
    timelineState.selectedOverlay.style.left = `${newPosition}%`;

    // Sincronizar com OverlayState
    const overlayId = timelineState.selectedOverlay.getAttribute('data-id');
    if (overlayId && typeof OverlayState !== 'undefined') {
        const videoPlayer = document.getElementById('videoPlayer');
        const duration = videoPlayer && videoPlayer.duration ? videoPlayer.duration : 100;
        const newTime = (newPosition / 100) * duration;

        console.log('🔄 [DEBUG] Atualizando OverlayState com nova posição:', {
            overlayId,
            newPosition,
            newTime
        });

        OverlayState.updateOverlay(overlayId, {
            startTime: newTime,
            start: newTime // Manter compatibilidade com ambos os campos
        });

        console.log('✅ [DEBUG] OverlayState atualizado com sucesso');
    } else {
        console.warn('⚠️ [DEBUG] Não foi possível atualizar OverlayState:', {
            overlayId,
            overlayStateAvailable: typeof OverlayState !== 'undefined'
        });
    }

    // Sincronizar playhead com overlay
    updateTimelinePlayheadPosition(newPosition);

    console.log('✅ [DEBUG] Overlay movido com sucesso');
}

// Redimensionar overlay selecionado
function resizeSelectedOverlay(direction, isLargeStep = false) {
    console.log('🔧 [UNIFIED] resizeSelectedOverlay() chamado:', {
        direction,
        isLargeStep
    });

    // Usar sistema unificado de validação
    const selectedOverlay = getValidatedSelectedOverlay();
    if (!selectedOverlay) {
        console.warn('❌ [UNIFIED] Nenhum overlay selecionado encontrado');
        return;
    }

    const step = isLargeStep ? 5 : 1; // Passo grande de 5%, pequeno de 1%
    const currentWidth = parseFloat(selectedOverlay.style.width);
    const currentPosition = parseFloat(selectedOverlay.style.left);

    console.log('📏 [DEBUG] Valores atuais para redimensionamento:', {
        currentWidth,
        currentPosition,
        step,
        elementStyle: timelineState.selectedOverlay.style.cssText
    });

    if (isNaN(currentWidth) || isNaN(currentPosition)) {
        console.error('❌ [DEBUG] Valores inválidos detectados:', {
            currentWidth,
            currentPosition,
            element: timelineState.selectedOverlay
        });
        return;
    }

    let newWidth;

    if (direction === 'left') {
        newWidth = Math.max(5, currentWidth - step);
    } else {
        newWidth = Math.min(100 - currentPosition, currentWidth + step);
    }

    console.log('🎯 [DEBUG] Nova largura calculada:', {
        direction,
        oldWidth: currentWidth,
        newWidth,
        maxWidth: 100 - currentPosition
    });

    // Atualizar largura do overlay
    timelineState.selectedOverlay.style.width = `${newWidth}%`;

    // Sincronizar com OverlayState
    const overlayId = timelineState.selectedOverlay.getAttribute('data-id');
    if (overlayId && typeof OverlayState !== 'undefined') {
        const videoPlayer = document.getElementById('videoPlayer');
        const duration = videoPlayer && videoPlayer.duration ? videoPlayer.duration : 100;
        const currentPosition = parseFloat(timelineState.selectedOverlay.style.left);
        const currentStartTime = (currentPosition / 100) * duration;
        const newDuration = (newWidth / 100) * duration;

        console.log('🔄 [DEBUG] Atualizando OverlayState com nova duração:', {
            overlayId,
            newWidth,
            currentPosition,
            currentStartTime,
            newDuration
        });

        OverlayState.updateOverlay(overlayId, {
            duration: newDuration
        });

        console.log('✅ [DEBUG] OverlayState atualizado com nova duração');
    } else {
        console.warn('⚠️ [DEBUG] Não foi possível atualizar OverlayState:', {
            overlayId,
            overlayStateAvailable: typeof OverlayState !== 'undefined'
        });
    }

    console.log('✅ [DEBUG] Overlay redimensionado com sucesso');
}

// Adicionar overlay na posição atual (função unificada)
function addOverlay() {
    const overlaysTrack = document.getElementById('overlaysTrack');
    if (!overlaysTrack) return;

    const overlayCount = timelineState.overlayCount + 1;

    const overlay = document.createElement('div');
    overlay.className = 'overlay-segment';
    overlay.style.left = `${timelineState.currentTime}%`;
    overlay.style.width = '10%';
    overlay.setAttribute('data-label', `Overlay ${overlayCount}`);
    overlay.setAttribute('tabindex', '0');

    // GERAR ID CONSISTENTE COM OVERLAYSTATE
    let overlayId;
    if (typeof OverlayState !== 'undefined') {
        // Criar entrada no OverlayState primeiro para obter ID
        const overlayData = {
            id: `overlay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            label: `Overlay ${overlayCount}`,
            startTime: (timelineState.currentTime / 100) * 100, // Converter para segundos
            duration: 10, // 10% de 100s = 10s
            position: 'center',
            size: 50,
            opacity: 1.0
        };

        OverlayState.addOverlay(overlayData);
        overlayId = overlayData.id;
        console.log('✅ Overlay criado no OverlayState com ID:', overlayId);
    } else {
        // Fallback se OverlayState não disponível
        overlayId = `overlay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.warn('⚠️ OverlayState não disponível, usando ID gerado localmente:', overlayId);
    }

    overlay.setAttribute('data-id', overlayId);

    overlaysTrack.appendChild(overlay);
    timelineState.overlayCount = overlayCount;

    // Adicionar eventos de clique
    overlay.addEventListener('click', function(e) {
        if (!this.classList.contains('dragging')) {
            const overlayLabel = this.getAttribute('data-label');
            console.log(`Overlay "${overlayLabel}" clicado`);
            selectOverlay(this);
        }
    });
}

// Adicionar marcador na posição atual (função unificada)
function addMarker() {
    const markersTrack = document.getElementById('markersTrack');
    if (!markersTrack) return;

    const markerCount = timelineState.markerCount + 1;

    const marker = document.createElement('div');
    marker.className = 'marker-item';
    marker.style.left = `${timelineState.currentTime}%`;
    marker.setAttribute('data-number', markerCount);
    marker.setAttribute('tabindex', '0');

    markersTrack.appendChild(marker);
    timelineState.markerCount = markerCount;

    // Adicionar eventos de clique
    marker.addEventListener('click', function(e) {
        if (!this.classList.contains('dragging')) {
            const markerNumber = this.getAttribute('data-number');
            console.log(`Marcador ${markerNumber} clicado`);
            selectMarker(this);
        }
    });
}

// Estender atalhos de teclado existentes com funcionalidades únicas
function extendTimelineKeyboardShortcuts() {
    // CONFLITO RESOLVIDO: Funcionalidades movidas para handleTimelineKeydown
    console.log('ℹ️ [UNIFIED] extendTimelineKeyboardShortcuts() desativado - funcionalidades consolidadas');
    return; // Evitar conflito de event listeners

    // Código original mantido para referência (não executado)
    document.addEventListener('keydown', function(e) {
        // Log geral para debug de eventos de teclado
        if (e.ctrlKey || e.altKey) {
            console.log('⌨️ [DEBUG] Evento de teclado capturado pelo extendTimelineKeyboardShortcuts:', {
                key: e.key,
                code: e.code,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                shiftKey: e.shiftKey,
                target: e.target.tagName,
                targetClasses: e.target.className
            });
        }

        // Ignorar se o usuário estiver digitando em um campo de entrada
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // 1-4: Ir para marcador
        if (e.key >= '1' && e.key <= '4') {
            e.preventDefault();
            const markerNumber = parseInt(e.key);
            goToMarker(markerNumber);
            return;
        }

        // +/-: Zoom in/out
        if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            zoomIn();
            return;
        }

        if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            zoomOut();
            return;
        }

        // O: Adicionar overlay
        if (e.key === 'o' || e.key === 'O') {
            e.preventDefault();
            addOverlay();
            return;
        }

        // M: Adicionar marcador (se não existir nos atalhos atuais)
        if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            addMarker();
            return;
        }

        // Tab: Navegar entre elementos
        if (e.code === 'Tab') {
            e.preventDefault();
            navigateElements(e.shiftKey);
            return;
        }

        // Ctrl + Setas: Mover elemento selecionado (se não existir nos atalhos atuais)
        if (e.ctrlKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
            console.log('⌨️ [DEBUG] Ctrl + Setas pressionado para mover elemento:', {
                code: e.code,
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey,
                hasSelectedMarker: !!timelineState.selectedMarker,
                hasSelectedOverlay: !!timelineState.selectedOverlay
            });

            e.preventDefault();
            const direction = e.code === 'ArrowLeft' ? 'left' : 'right';
            const largeStep = e.shiftKey; // Shift + Ctrl + Setas para passo grande

            console.log('🎯 [DEBUG] Parâmetros de movimento:', {
                direction,
                largeStep
            });

            // Verificar se há um marcador ou overlay selecionado
            if (timelineState.selectedMarker) {
                console.log('✅ [DEBUG] Movendo marcador selecionado...');
                moveSelectedMarker(direction, largeStep);
            } else if (timelineState.selectedOverlay) {
                console.log('✅ [DEBUG] Movendo overlay selecionado...');
                moveSelectedOverlay(direction, largeStep);
            } else {
                console.warn('❌ [DEBUG] Nenhum elemento selecionado para mover');
            }
            return;
        }

        // Alt + Setas: Redimensionar overlay selecionado
        if (e.altKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
            console.log('⌨️ [UNIFIED] Alt + Setas pressionado para redimensionar overlay:', {
                code: e.code,
                altKey: e.altKey,
                shiftKey: e.shiftKey,
                hasSelectedOverlay: !!timelineState.selectedOverlay
            });

            e.preventDefault();
            const direction = e.code === 'ArrowLeft' ? 'left' : 'right';
            const isLargeStep = e.shiftKey; // Shift + Alt + Setas para passo grande

            console.log('🎯 [UNIFIED] Parâmetros de redimensionamento:', {
                direction,
                isLargeStep,
                selectedOverlay: timelineState.selectedOverlay
            });

            // Usar sistema unificado de validação
            const selectedOverlay = getValidatedSelectedOverlay();
            if (selectedOverlay) {
                console.log('✅ [UNIFIED] Chamando resizeSelectedOverlay...');
                resizeSelectedOverlay(direction, isLargeStep);
            } else {
                console.warn('❌ [UNIFIED] Nenhum overlay selecionado para redimensionar');
            }
            return;
        }
    });
}

// Inicializar as funcionalidades estendidas da timeline
function initExtendedTimelineFeatures() {
    extendTimelineKeyboardShortcuts();
    console.log('✅ Funcionalidades estendidas da timeline inicializadas');
}

// Disponibilizar globalmente
window.validateVideoForOverlay = validateVideoForOverlay;

/**
 * Mostrar ajuda sobre interações com overlays
 */
function showOverlayInteractionHelp() {
    console.log('📖 [HELP] Guia de Interações com Overlays:');
    console.log('');
    console.log('🖱️ INTERAÇÕES COM MOUSE:');
    console.log('• Clique no centro do overlay: Selecionar e mover');
    console.log('• Clique nas bordas do overlay: Redimensionar');
    console.log('• Hover: Mostra feedback visual do que acontecerá');
    console.log('• Shift/Ctrl/Alt + Clique: Modo avançado (mais preciso)');
    console.log('');
    console.log('⌨️ INTERAÇÕES COM TECLADO:');
    console.log('• Tab: Navegar entre overlays');
    console.log('• Enter/Space: Selecionar overlay focado');
    console.log('• Ctrl + ←/→: Mover overlay selecionado');
    console.log('• Alt + ←/→: Redimensionar overlay selecionado');
    console.log('• Shift + Ctrl/Alt + ←/→: Movimento/redimensionamento grande (5%)');
    console.log('• Delete: Remover overlay selecionado');
    console.log('');
    console.log('💡 DICAS:');
    console.log('• Mouse e teclado funcionam de forma integrada');
    console.log('• Overlays selecionados têm borda azul brilhante');
    console.log('• Cursores mudam para indicar a ação disponível');
    console.log('• Tooltips mostram informações sobre cada overlay');
}

/**
 * Mostrar tooltip de ajuda contextual
 */
function showContextualHelp(interactionType) {
    const helpMessages = {
        'move': '🖱️ Clique e arraste para mover o overlay',
        'resize-left': '↔️ Clique e arraste para redimensionar o início',
        'resize-right': '↔️ Clique e arraste para redimensionar o fim',
        'keyboard-move': '⌨️ Use Ctrl + Setas para mover',
        'keyboard-resize': '⌨️ Use Alt + Setas para redimensionar'
    };

    const message = helpMessages[interactionType] || '❓ Ajuda não disponível';
    console.log(message);

    // Mostrar notificação visual temporária
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--surface-primary);
        color: var(--text-primary);
        padding: 12px 16px;
        border-radius: var(--radius);
        border: 1px solid var(--border-color);
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 10000;
        max-width: 300px;
        font-size: var(--font-size-sm);
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s ease;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    // Animar entrada
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateX(0)';
    }, 100);

    // Remover após 3 segundos
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 300);
    }, 3000);
}

// Disponibilizar funções de ajuda globalmente
window.showOverlayInteractionHelp = showOverlayInteractionHelp;
window.showContextualHelp = showContextualHelp;

// OTIMIZAÇÃO: Cleanup global para prevenir memory leaks
function setupGlobalCleanup() {
    // Cleanup quando a página for descarregada
    timelineState.eventRegistry.register(window, 'beforeunload', () => {
        console.log('🔄 Executando cleanup global antes de descarregar');
        timelineState.eventRegistry.cleanup();

        // Limpar ResizeObserver se existir
        if (timelineState.dimensionCache.resizeObserver) {
            timelineState.dimensionCache.resizeObserver.disconnect();
        }
    });

    // Cleanup quando o documento for ocultado (mudar de aba)
    timelineState.eventRegistry.register(document, 'visibilitychange', () => {
        if (document.hidden) {
            console.log('📱 Página oculta, limpando recursos não essenciais');
            // Limpar animation frames pendentes
            timelineState.eventRegistry.animationFrames.forEach(id => {
                cancelAnimationFrame(id);
            });
            timelineState.eventRegistry.animationFrames = [];
        }
    });

    console.log('✅ Cleanup global configurado');
}

// Inicializar sistemas otimizados quando o DOM estiver pronto
function initializeOptimizedSystems() {
    // Configurar cleanup global
    setupGlobalCleanup();

    // Configurar event delegation para timeline
    setupTimelineEventHandlers();

    // Exibir estatísticas da otimização
    console.log('📊 Estatísticas da otimização:');
    console.log('- Event Delegation:', timelineEventDelegator.getStats());
    console.log('- Event Registry:', timelineState.eventRegistry.getStats());
    console.log('- DOM Batcher:', domBatcher.getStats());
}

// OTIMIZAÇÃO: Sistema de benchmark para testar performance
// Inicializar sistemas otimizados quando o DOM estiver pronto
function initializeOptimizedSystems() {
    // Configurar cleanup global
    setupGlobalCleanup();

    // Configurar event delegation para timeline
    setupTimelineEventHandlers();

    // Exibir estatísticas da otimização
    console.log('📊 Estatísticas da otimização:');
    console.log('- Event Delegation:', timelineEventDelegator.getStats());
    console.log('- Event Registry:', timelineState.eventRegistry.getStats());
    console.log('- DOM Batcher:', domBatcher.getStats());

  }

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeOptimizedSystems);
} else {
    initializeOptimizedSystems();
}
