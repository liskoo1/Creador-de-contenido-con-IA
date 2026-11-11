const API_BASE = 'http://localhost:3001/api';

let selectedType = 'single';
let selectedMedia = 'image';
let selectedRatio = '1:1';
let selectedEngine = 'remotion';
let selectedImageModel = 'poe';
let attachedImages = []; // Array de { path: string, url: string, mode: string }
let audioFile = null; // Archivo de audio para audio-reel

document.addEventListener('DOMContentLoaded', () => {
    loadKnowledge();
    setupEventListeners();
    loadBotState();
    setInterval(pollBotStatus, 15000); // Polling cada 15s para actualizar el texto del autopilot
    loadProductContext();
    setupProductContextListeners();
});

function setupEventListeners() {
    document.querySelectorAll('#engine-selector .format-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#engine-selector .format-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedEngine = btn.dataset.engine;
        });
    });

    document.querySelectorAll('#image-model-selector .format-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#image-model-selector .format-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedImageModel = btn.dataset.imageModel;
        });
    });

    document.querySelectorAll('#type-selector .format-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#type-selector .format-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedType = btn.dataset.type;
            
            // Audio Reel: mostrar/ocultar UI específica
            const briefingWrap = document.querySelector('.command-bar .input-wrap');
            const audioZone = document.getElementById('audio-upload-zone');
            const mediaSelGrid = document.getElementById('media-selector');
            const mediaSelHeader = document.getElementById('media-mode-header');
            const engineSelGrid = document.getElementById('engine-selector');
            const engineSelHeader = document.getElementById('engine-mode-header');
            
            if (selectedType === 'audio-reel') {
                // Ocultar briefing, mostrar audio upload
                if (briefingWrap) briefingWrap.style.display = 'none';
                if (audioZone) audioZone.style.display = 'flex';
                // Ocultar media mode y engine mode
                if (mediaSelHeader) mediaSelHeader.style.display = 'none';
                if (mediaSelGrid) mediaSelGrid.style.display = 'none';
                if (engineSelHeader) engineSelHeader.style.display = 'none';
                if (engineSelGrid) engineSelGrid.style.display = 'none';
                selectRatio('9:16');
            } else {
                // Restaurar UI normal
                if (briefingWrap) briefingWrap.style.display = '';
                if (audioZone) audioZone.style.display = 'none';
                if (mediaSelHeader) mediaSelHeader.style.display = '';
                if (mediaSelGrid) mediaSelGrid.style.display = '';
                if (engineSelHeader) engineSelHeader.style.display = '';
                if (engineSelGrid) engineSelGrid.style.display = '';
                audioFile = null;
            }
            
            if (selectedType === 'video') selectRatio('9:16');
            else if (selectedType === 'carousel') selectRatio('1:1');
            
            const videoBtn = document.getElementById('video-mode-btn');
            if (selectedType === 'carousel') {
                videoBtn.classList.add('disabled');
                videoBtn.style.opacity = '0.3';
                videoBtn.style.pointerEvents = 'none';
                selectMediaMode('image');
            } else {
                videoBtn.classList.remove('disabled');
                videoBtn.style.opacity = '1';
                videoBtn.style.pointerEvents = 'auto';
                if (selectedType === 'video') selectMediaMode('video');
            }
        });
    });

    document.querySelectorAll('#ratio-selector .format-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectRatio(btn.dataset.ratio);
        });
    });

    document.querySelectorAll('#media-selector .format-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectMediaMode(btn.dataset.media);
        });
    });

    document.getElementById('start-btn').addEventListener('click', startSwarm);
    document.getElementById('suggest-btn').addEventListener('click', suggestIdea);

    // Auto-Pilot Toggle
    document.getElementById('autopilot-toggle').addEventListener('change', toggleAutoPilot);
}

function selectMediaMode(mode) {
    document.querySelectorAll('#media-selector .format-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-media="${mode}"]`);
    if (btn) {
        btn.classList.add('active');
        selectedMedia = mode;
        
        // Disable image model selector if video is selected
        const imageModelSelector = document.getElementById('image-model-selector');
        if (imageModelSelector) {
            if (mode === 'video') {
                imageModelSelector.style.opacity = '0.3';
                imageModelSelector.style.pointerEvents = 'none';
            } else {
                imageModelSelector.style.opacity = '1';
                imageModelSelector.style.pointerEvents = 'auto';
            }
        }

        // Veo solo soporta 16:9 y 9:16 — deshabilitar ratios incompatibles
        const unsupportedRatios = ['1:1', '4:5'];
        unsupportedRatios.forEach(ratio => {
            const ratioBtn = document.querySelector(`[data-ratio="${ratio}"]`);
            if (ratioBtn) {
                if (mode === 'video') {
                    ratioBtn.style.opacity = '0.3';
                    ratioBtn.style.pointerEvents = 'none';
                    ratioBtn.classList.remove('active');
                } else {
                    ratioBtn.style.opacity = '1';
                    ratioBtn.style.pointerEvents = 'auto';
                }
            }
        });

        // Si el ratio actual no es compatible con video, forzar 16:9
        if (mode === 'video' && unsupportedRatios.includes(selectedRatio)) {
            selectRatio('16:9');
        }
    }
}

function selectRatio(ratio) {
    document.querySelectorAll('#ratio-selector .format-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-ratio="${ratio}"]`);
    if (btn) {
        btn.classList.add('active');
        selectedRatio = ratio;
    }
}

/* ============================================
   AUTO-PILOT FUNCTIONS
   ============================================ */

async function loadBotState() {
    try {
        const response = await fetch(`${API_BASE}/bot/state`);
        const state = await response.json();
        
        const toggle = document.getElementById('autopilot-toggle');
        const label = document.getElementById('autopilot-label');
        const status = document.getElementById('autopilot-status');
        
        toggle.checked = state.isAutoPilotActive;
        
        if (state.isAutoPilotActive) {
            label.textContent = 'AUTO-PILOT ON';
            label.classList.add('autopilot-active-label');
            const now = new Date();
            const currentDay = now.getDate();
            // Buscar la próxima entrada planeada (empezando desde el día actual)
            let nextPost = state.schedule.find(e => e.day >= currentDay && e.status === 'planned');
            if (!nextPost) nextPost = state.schedule.find(e => e.status === 'planned'); // fallback por si acaso
            
            status.textContent = nextPost 
                ? `Próximo: Día ${nextPost.day} a las ${nextPost.hour}` 
                : 'Sin posts pendientes';
        } else {
            label.textContent = 'AUTO-PILOT OFF';
            label.classList.remove('autopilot-active-label');
            status.textContent = 'Sistema en modo manual';
        }

        renderAllowedFormats(state.allowedFormats);
    } catch (e) {
        console.error('Error cargando estado del bot:', e);
    }
}

async function pollBotStatus() {
    try {
        const response = await fetch(`${API_BASE}/bot/state`);
        const state = await response.json();
        
        const label = document.getElementById('autopilot-label');
        const status = document.getElementById('autopilot-status');
        const toggle = document.getElementById('autopilot-toggle');
        
        if (toggle.checked !== state.isAutoPilotActive) {
            toggle.checked = state.isAutoPilotActive;
        }

        if (state.isAutoPilotActive) {
            label.textContent = 'AUTO-PILOT ON';
            label.classList.add('autopilot-active-label');
            const now = new Date();
            const currentDay = now.getDate();
            let nextPost = state.schedule.find(e => e.day >= currentDay && e.status === 'planned');
            if (!nextPost) nextPost = state.schedule.find(e => e.status === 'planned');
            
            status.textContent = nextPost 
                ? `Próximo: Día ${nextPost.day} a las ${nextPost.hour}` 
                : 'Sin posts pendientes';
        } else {
            label.textContent = 'AUTO-PILOT OFF';
            label.classList.remove('autopilot-active-label');
            status.textContent = 'Sistema en modo manual';
        }
    } catch (e) {
        // Silencioso en el polling
    }
}

const DEFAULT_FORMATS = [
    { format: 'single', mediaType: 'image', label: 'Post (Imagen Única)' },
    { format: 'carousel', mediaType: 'image', label: 'Carrusel (Imágenes)' },
    { format: 'carousel', mediaType: 'video', label: 'Carrusel (Vídeos IA)' },
    { format: 'video', mediaType: 'image', label: 'Reel (Imágenes Animadas)' },
    { format: 'video', mediaType: 'video', label: 'Reel (Clips Vídeo IA)' }
];

function renderAllowedFormats(allowedFormats) {
    const container = document.getElementById('format-checkboxes');
    if (!container) return;
    
    const activeFormats = allowedFormats || DEFAULT_FORMATS.map(f => ({ format: f.format, mediaType: f.mediaType }));
    
    container.innerHTML = DEFAULT_FORMATS.map((def, idx) => {
        const isActive = activeFormats.some(f => f.format === def.format && f.mediaType === def.mediaType);
        return `
            <label class="config-checkbox-label">
                <input type="checkbox" value='{"format":"${def.format}","mediaType":"${def.mediaType}"}' ${isActive ? 'checked' : ''} onchange="saveAllowedFormats()">
                <span>${def.label}</span>
            </label>
        `;
    }).join('');
}

async function saveAllowedFormats() {
    const container = document.getElementById('format-checkboxes');
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    const formats = [];
    
    checkboxes.forEach(cb => {
        if (cb.checked) {
            formats.push(JSON.parse(cb.value));
        }
    });

    if (formats.length === 0) {
        alert("Debes seleccionar al menos una combinación de formato.");
        // Revertir a default visualmente
        renderAllowedFormats(DEFAULT_FORMATS.map(f => ({ format: f.format, mediaType: f.mediaType })));
        return;
    }

    try {
        await fetch(`${API_BASE}/bot/formats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ formats })
        });
        addThought('Auto-Pilot', `Configuración de formatos actualizada (${formats.length} permitidos).`);
    } catch (e) {
        console.error('Error guardando configuracion de formatos:', e);
    }
}

async function toggleAutoPilot() {
    try {
        const response = await fetch(`${API_BASE}/bot/toggle`, { method: 'POST' });
        const state = await response.json();
        loadBotState();
        addThought('Auto-Pilot', state.isAutoPilotActive ? '🟢 Activado' : '🔴 Desactivado');
    } catch (e) {
        console.error('Error toggling autopilot:', e);
    }
}

async function forcePlan() {
    const btn = document.getElementById('force-plan-btn');
    btn.textContent = '⏳ GENERANDO...';
    btn.disabled = true;
    addThought('Auto-Pilot', 'Forzando generación de planificación mensual...');
    
    try {
        const response = await fetch(`${API_BASE}/bot/force-plan`, { method: 'POST' });
        const data = await response.json();
        addThought('Auto-Pilot', `✅ Planificación generada: ${data.schedule.length} publicaciones programadas.`);
        loadBotState();
    } catch (e) {
        addThought('Auto-Pilot', '❌ Error generando el plan.');
    } finally {
        btn.textContent = '⚡ GENERAR PLAN';
        btn.disabled = false;
    }
}

/* ============================================
   CALENDARIO
   ============================================ */

let currentSchedule = [];
let editingDay = null;
let editingEntryIndex = 0;

async function openCalendar() {
    loadPlanningMode();
    document.getElementById('calendar-modal').style.display = 'flex';
    renderCalendar();
}

function closeCalendar() {
    document.getElementById('calendar-modal').style.display = 'none';
    closeDayEditor();
}

async function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';
    
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const dayNames = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
    
    document.getElementById('calendar-title').textContent = `📅 ${monthNames[month]} ${year}`;
    
    // Header de días de la semana
    dayNames.forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-header-cell';
        header.textContent = day;
        grid.appendChild(header);
    });
    
    // Obtener planificación
    try {
        const response = await fetch(`${API_BASE}/bot/schedule`);
        currentSchedule = await response.json();
    } catch (e) {
        console.error('Error cargando schedule:', e);
        currentSchedule = [];
    }
    
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7;
    
    // Celdas vacías
    for (let i = 0; i < firstDayOfWeek; i++) {
        const empty = document.createElement('div');
        empty.className = 'calendar-day calendar-day-empty';
        grid.appendChild(empty);
    }
    
    // Días del mes
    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day';
        
        if (day === now.getDate()) cell.classList.add('calendar-day-today');
        
        const entries = currentSchedule.filter(e => e.day === day);
        
        let innerHtml = `<div class="calendar-day-number">${day}</div>`;
        
        if (entries.length > 0) {
            cell.classList.add('calendar-has-post');
            
            entries.forEach((entry, idx) => {
                const displayFormat = (entry.format === 'video' && entry.mediaType === 'image') ? 'video-imagen' : entry.format;
                const tagClass = `calendar-tag-${displayFormat}`;
                const statusClass = `calendar-status-${entry.status}`;
                const statusLabels = {
                    planned: '⏳', generating: '⚙️', pending_approval: '📧', 
                    approved: '✅', published: '🟢', rejected: '❌'
                };
                
                const isLast = idx === entries.length - 1;
                const borderStyle = isLast ? '' : 'border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 6px; padding-bottom: 6px;';
                
                const isAgro = entry.format === 'price-story' || entry.format === 'news-post';
                const conceptHtml = isAgro ? '' : `<div class="calendar-post-concept" style="-webkit-line-clamp: 1;">${entry.concept || ''}</div>`;
                
                innerHtml += `
                    <div style="${borderStyle}">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
                            <span class="calendar-post-tag ${tagClass}" style="margin:0;">${displayFormat.toUpperCase()}</span>
                            <span class="calendar-post-status ${statusClass}" style="position:static; padding:2px 4px; font-size:0.6rem;">${statusLabels[entry.status] || ''}</span>
                        </div>
                        ${conceptHtml}
                        <div class="calendar-post-hour">🕐 ${entry.hour}</div>
                    </div>
                `;
            });
        }
        
        cell.innerHTML = innerHtml;
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => openDayEditor(day));
        grid.appendChild(cell);
    }
}

function openDayEditor(day, entryIdx) {
    editingDay = day;
    const editor = document.getElementById('day-editor');
    editor.classList.remove('hidden');

    const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const now = new Date();
    document.getElementById('day-editor-title').textContent = `${day} de ${monthNames[now.getMonth()]}`;

    const entries = currentSchedule.filter(e => e.day === day);

    // Renderizar selector de entradas si hay más de una
    let selectorContainer = document.getElementById('entry-selector');
    if (!selectorContainer) {
        selectorContainer = document.createElement('div');
        selectorContainer.id = 'entry-selector';
        const body = document.querySelector('.day-editor-body');
        body.parentNode.insertBefore(selectorContainer, body);
    }

    if (entries.length > 1) {
        const selectedIdx = (typeof entryIdx === 'number') ? entryIdx : 0;
        editingEntryIndex = selectedIdx;
        const formatLabels = {
            'single': 'POST', 'carousel': 'CAROUSEL', 'video': 'VIDEO',
            'price-story': 'PRECIOS', 'news-post': 'NOTICIA', 'flyer': 'FLYER'
        };
        selectorContainer.innerHTML = entries.map((e, idx) => {
            const label = formatLabels[e.format] || e.format.toUpperCase();
            const activeClass = idx === selectedIdx ? 'entry-tab-active' : '';
            return `<button class="entry-tab ${activeClass}" onclick="openDayEditor(${day}, ${idx})">${label} ${e.hour}</button>`;
        }).join('');
        selectorContainer.style.display = 'flex';
    } else {
        editingEntryIndex = 0;
        selectorContainer.innerHTML = '';
        selectorContainer.style.display = 'none';
    }

    const entry = entries[editingEntryIndex] || null;
    loadEntryIntoEditor(entry);

    // Highlight del día seleccionado
    document.querySelectorAll('.calendar-day').forEach(c => c.classList.remove('calendar-day-selected'));
    const cells = document.querySelectorAll('.calendar-day:not(.calendar-day-empty)');
    cells.forEach(c => {
        const num = parseInt(c.querySelector('.calendar-day-number')?.textContent);
        if (num === day) c.classList.add('calendar-day-selected');
    });
}

function loadEntryIntoEditor(entry) {
    if (entry) {
        document.getElementById('edit-hour').value = entry.hour || '12:00';
        document.getElementById('edit-format').value = entry.format || 'single';
        document.getElementById('edit-media').value = entry.mediaType || (entry.format === 'video' ? 'video' : 'image');
        document.getElementById('edit-ratio').value = entry.aspectRatio || '1:1';
        document.getElementById('edit-concept').value = entry.concept || '';
        document.getElementById('edit-angle').value = entry.angle || '';
        document.getElementById('edit-briefing').value = entry.briefing || '';
        document.getElementById('edit-status').value = entry.status || 'planned';

        const statusInfo = document.getElementById('edit-status-info');
        if (entry.postId) {
            statusInfo.innerHTML = `<span class="status-linked">🔗 Post ID: ${entry.postId}</span>`;
        } else {
            statusInfo.innerHTML = `<span class="status-unlinked">Sin post generado aún</span>`;
        }

        const generateBtn = document.getElementById('generate-btn');
        generateBtn.style.display = entry.status === 'planned' ? 'block' : 'none';
    } else {
        document.getElementById('edit-hour').value = '12:00';
        document.getElementById('edit-format').value = 'single';
        document.getElementById('edit-media').value = 'image';
        document.getElementById('edit-ratio').value = '1:1';
        document.getElementById('edit-concept').value = '';
        document.getElementById('edit-angle').value = '';
        document.getElementById('edit-briefing').value = '';
        document.getElementById('edit-status').value = 'planned';
        document.getElementById('edit-status-info').innerHTML = '';
        document.getElementById('generate-btn').style.display = 'none';
    }
}

function closeDayEditor() {
    editingDay = null;
    document.getElementById('day-editor').classList.add('hidden');
    document.querySelectorAll('.calendar-day').forEach(c => c.classList.remove('calendar-day-selected'));
}

async function saveDayEntry() {
    if (!editingDay) return;

    const updates = {
        hour: document.getElementById('edit-hour').value,
        format: document.getElementById('edit-format').value,
        mediaType: document.getElementById('edit-media').value,
        aspectRatio: document.getElementById('edit-ratio').value,
        concept: document.getElementById('edit-concept').value,
        angle: document.getElementById('edit-angle').value,
        briefing: document.getElementById('edit-briefing').value,
        status: document.getElementById('edit-status').value
    };

    try {
        const res = await fetch(`${API_BASE}/bot/schedule/${editingDay}/${editingEntryIndex}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        const data = await res.json();
        if (data.success) {
            await renderCalendar();
            openDayEditor(editingDay, editingEntryIndex);
        }
    } catch (e) {
        console.error('Error guardando entrada:', e);
    }
}

async function deleteDayEntry() {
    if (!editingDay) return;
    const entries = currentSchedule.filter(e => e.day === editingDay);
    const entry = entries[editingEntryIndex];
    const label = entry ? `${entry.format.toUpperCase()} (${entry.hour})` : `día ${editingDay}`;
    if (!confirm(`¿Eliminar la entrada "${label}" del día ${editingDay}?`)) return;

    try {
        const res = await fetch(`${API_BASE}/bot/schedule/${editingDay}/${editingEntryIndex}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            await renderCalendar();
            // Si quedan más entradas, abrir la primera; si no, cerrar editor
            const remaining = currentSchedule.filter(e => e.day === editingDay);
            if (remaining.length > 0) {
                openDayEditor(editingDay, 0);
            } else {
                closeDayEditor();
            }
        }
    } catch (e) {
        console.error('Error eliminando entrada:', e);
    }
}

async function executeDayEntry() {
    if (!editingDay) return;
    const generateBtn = document.getElementById('generate-btn');
    if (!confirm(`¿Generar contenido para el día ${editingDay} ahora?`)) return;

    generateBtn.disabled = true;
    generateBtn.textContent = '⏳ GENERANDO...';

    try {
        const res = await fetch(`${API_BASE}/bot/execute/${editingDay}/${editingEntryIndex}`, { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            // Polling: esperar a que el estado cambie de 'generating' a 'pending_approval'
            let attempts = 0;
            const maxAttempts = 120; // ~2 minutos
            const poll = setInterval(async () => {
                attempts++;
                try {
                    const schedRes = await fetch(`${API_BASE}/bot/schedule`);
                    const schedule = await schedRes.json();
                    const entry = schedule.find(e => e.day === editingDay);

                    if (entry && entry.status !== 'generating') {
                        clearInterval(poll);
                        generateBtn.disabled = false;
                        generateBtn.textContent = '🚀 GENERAR';
                        await renderCalendar();
                        openDayEditor(editingDay);
                    } else if (attempts >= maxAttempts) {
                        clearInterval(poll);
                        generateBtn.disabled = false;
                        generateBtn.textContent = '🚀 GENERAR';
                        alert('Tiempo de espera agotado. Revisa el estado en el calendario.');
                    }
                } catch (e) {
                    console.error('Error en polling:', e);
                }
            }, 2000);
        } else {
            alert(data.error || 'Error al iniciar la generación');
            generateBtn.disabled = false;
            generateBtn.textContent = '🚀 GENERAR';
        }
    } catch (e) {
        console.error('Error ejecutando entrada:', e);
        alert('Error de conexión');
        generateBtn.disabled = false;
        generateBtn.textContent = '🚀 GENERAR';
    }
}

/* ============================================
   KNOWLEDGE HUB
   ============================================ */

async function loadKnowledge() {
    try {
        const response = await fetch(`${API_BASE}/knowledge`);
        const data = await response.json();
        window._cachedKnowledge = data;
        const container = document.getElementById('knowledge-items');
        container.innerHTML = '';

        // 1. Mostrar Assets con botón de vista previa accesible
        (data.assets || []).forEach(item => {
            const div = document.createElement('div');
            div.className = 'knowledge-item';
            const isImg = item.type === 'image';
            const icon = isImg ? '🖼️' : '📄';
            const label = item.description || item.fileName || 'Activo';
            const displayText = label.length > 20 ? label.substring(0, 20) + '...' : label;
            
            div.innerHTML = `
                <button type="button" class="knowledge-preview-btn" onclick="openAssetPreview(${item.id})" aria-label="Abrir vista previa de ${label}" title="${label}">
                    <span>[${icon}] ${displayText}</span>
                </button>
                <button type="button" class="delete-btn" onclick="deleteKnowledge('asset', ${item.id})" aria-label="Eliminar activo">×</button>
            `;
            container.appendChild(div);
        });

        // 2. Mostrar URLs
        (data.urls || []).forEach(item => {
            const div = document.createElement('div');
            div.className = 'knowledge-item';
            const title = item.title || item.url || "URL Desconocida";
            const displayText = title.length > 20 ? title.substring(0, 20) + '...' : title;
            div.innerHTML = `
                <span title="${item.url}">[🌐] ${displayText}</span>
                <button type="button" class="delete-btn" onclick="deleteKnowledge('url', ${item.id})" aria-label="Eliminar URL">×</button>
            `;
            container.appendChild(div);
        });
    } catch (e) {
        console.error("Error loading knowledge", e);
    }
}

async function uploadFiles(input) {
    if (!input.files.length) return;
    
    const formData = new FormData();
    for (const file of input.files) {
        formData.append('files', file);
    }

    updateStatus('Analyzing Assets...', 'processing');
    addThought('Vision', `Analizando ${input.files.length} archivos para etiquetado semántico...`);
    
    try {
        const response = await fetch(`${API_BASE}/knowledge/upload`, { 
            method: 'POST', 
            body: formData 
        });
        const data = await response.json();
        addThought('System', `Carga completada: ${data.assets.length} activos indexados.`);
        loadKnowledge();
    } catch (e) {
        addThought('System', 'Error en la subida masiva.');
    } finally {
        updateStatus('SYSTEM ONLINE', 'idle');
        input.value = '';
    }
}

function openMediaLibrary() {
    document.getElementById('media-modal').style.display = 'flex';
    renderMediaGrid();
}

function closeMediaLibrary() {
    document.getElementById('media-modal').style.display = 'none';
}

async function openArchive() {
    document.getElementById('archive-modal').style.display = 'flex';
    loadArchive();
}

function closeArchive() {
    document.getElementById('archive-modal').style.display = 'none';
}

function restoreArchiveToMain(id) {
    if (!window._archiveData) return;
    const post = window._archiveData.find(p => p.id === id);
    if (!post) return;
    
    // Inyectamos en el visor principal
    displayResults(post);
    closeArchive();
}

function _archiveMediaUrl(src) {
    if (!src || typeof src !== 'string') return '';
    if (src.startsWith('http')) return src;
    return `http://localhost:3001${src.startsWith('/') ? '' : '/'}${src}`;
}

function _isVideoMediaUrl(src) {
    return /\.(mp4|webm|mov)($|\?)/i.test(src || '');
}

/**
 * Preview HTML para el Swarm Archive: imágenes normales + primer frame de vídeos.
 */
function _archivePreviewHtml(post) {
    const parts = [];
    const seen = new Set();

    const pushOnce = (key, html) => {
        if (!key || seen.has(key)) return;
        seen.add(key);
        parts.push(html);
    };

    const videoUrl = post.video?.url ? _archiveMediaUrl(post.video.url) : null;
    const thumbUrl = post.video?.thumbnail ? _archiveMediaUrl(post.video.thumbnail) : null;

    if (thumbUrl) {
        pushOnce(thumbUrl, `<div class="archive-media-wrap" onclick="window.open('${videoUrl || thumbUrl}')"><img src="${thumbUrl}" alt="video thumb"><span class="archive-play-badge">▶</span></div>`);
    } else if (videoUrl) {
        pushOnce(videoUrl, `<div class="archive-media-wrap" onclick="window.open('${videoUrl}')"><video class="archive-thumb-video" src="${videoUrl}" muted playsinline preload="metadata" onloadeddata="try{this.currentTime=0.1}catch(e){}"></video><span class="archive-play-badge">▶</span></div>`);
    }

    (post.visuals || []).forEach((raw) => {
        const src = _archiveMediaUrl(raw);
        if (!src) return;
        if (_isVideoMediaUrl(src)) {
            if (videoUrl && src === videoUrl) return;
            pushOnce(src, `<div class="archive-media-wrap" onclick="window.open('${src}')"><video class="archive-thumb-video" src="${src}" muted playsinline preload="metadata" onloadeddata="try{this.currentTime=0.1}catch(e){}"></video><span class="archive-play-badge">▶</span></div>`);
        } else {
            pushOnce(src, `<img src="${src}" onclick="window.open('${src}')" alt="visual">`);
        }
    });

    if (parts.length === 0) {
        return '<span class="label" style="opacity:0.5;">Sin preview</span>';
    }
    return parts.join('');
}

async function loadArchive() {
    const list = document.getElementById('archive-list');
    list.innerHTML = '<p class="label">Loading Archive...</p>';
    _updateSelectionToolbar();

    try {
        const response = await fetch(`${API_BASE}/posts`);
        const posts = await response.json();
        window._archiveData = posts;

        if (posts.length === 0) {
            list.innerHTML = '<p class="label" style="text-align:center; padding: 40px;">No swarms archived yet.</p>';
            return;
        }

        list.innerHTML = posts.map(post => `
            <div class="archive-item" id="archive-item-${post.id}">
                <div class="archive-item-checkbox">
                    <input type="checkbox" data-id="${post.id}" onchange="_onArchiveCheckChange()">
                </div>
                <div class="archive-meta">
                    <b>ID: ${post.id.substring(post.id.length - 6)}</b>
                    <span>TIPO: ${(post.contentType || 'post').toUpperCase()}</span><br>
                    <span>RATIO: ${post.aspectRatio || '1:1'}</span><br>
                    <small>${new Date(post.timestamp).toLocaleString()}</small>
                </div>
                <div class="archive-content-preview">
                    <div class="archive-text">${post.content?.text || post.content?.instagram?.copy || post.content?.facebook?.copy || post.content?.copy_facebook || 'Solo Gráfico'}</div>
                    <div class="archive-images">
                        ${_archivePreviewHtml(post)}
                    </div>
                </div>
                <div class="archive-actions">
                    <button class="publish-archive-btn" onclick="restoreArchiveToMain('${post.id}')">🚀 RE-CARGAR</button>
                    <button class="publish-archive-btn publish-ig" onclick="publishPost('${post.id}', 'instagram')" ${post.publishedTo?.instagram ? 'disabled title="Ya publicado en Instagram"' : ''}>📸 IG</button>
                    <button class="publish-archive-btn publish-fb" onclick="publishPost('${post.id}', 'facebook')" ${post.publishedTo?.facebook ? 'disabled title="Ya publicado en Facebook"' : ''}>📘 FB</button>
                    <button class="publish-archive-btn" onclick="publishPost('${post.id}')" ${(post.publishedTo?.instagram && post.publishedTo?.facebook) ? 'disabled title="Ya publicado en ambas"' : ''}>🚀 AMBAS</button>
                    <button class="del-btn" onclick="deletePost('${post.id}')">DELETE</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<p class="label">Error loading archive.</p>';
    }
}

function _getCheckedIds() {
    return [...document.querySelectorAll('#archive-list input[type="checkbox"]:checked')]
        .map(cb => cb.dataset.id);
}

function _updateSelectionToolbar() {
    const checked = _getCheckedIds();
    const total = document.querySelectorAll('#archive-list input[type="checkbox"]').length;
    const count = checked.length;

    const btn = document.getElementById('archive-del-selected-btn');
    const countEl = document.getElementById('archive-selected-count');
    const selectAll = document.getElementById('archive-select-all');

    if (btn) btn.disabled = count === 0;
    if (countEl) countEl.textContent = count;
    if (selectAll) {
        selectAll.checked = total > 0 && count === total;
        selectAll.indeterminate = count > 0 && count < total;
    }
}

function _onArchiveCheckChange() {
    const checked = _getCheckedIds();
    // Resaltar visualmente los items seleccionados
    document.querySelectorAll('#archive-list input[type="checkbox"]').forEach(cb => {
        const item = document.getElementById(`archive-item-${cb.dataset.id}`);
        if (item) item.classList.toggle('selected', cb.checked);
    });
    _updateSelectionToolbar();
}

function toggleSelectAll(checked) {
    document.querySelectorAll('#archive-list input[type="checkbox"]').forEach(cb => {
        cb.checked = checked;
        const item = document.getElementById(`archive-item-${cb.dataset.id}`);
        if (item) item.classList.toggle('selected', checked);
    });
    _updateSelectionToolbar();
}

async function deleteSelected() {
    const ids = _getCheckedIds();
    if (ids.length === 0) return;
    if (!confirm(`¿Eliminar ${ids.length} publicación(es) seleccionada(s)? Se borrarán también sus archivos de imagen y vídeo.`)) return;

    let deleted = 0;
    for (const id of ids) {
        try {
            await fetch(`${API_BASE}/posts/${id}`, { method: 'DELETE' });
            deleted++;
        } catch (e) {
            console.error(`Error eliminando post ${id}:`, e);
        }
    }

    addThought('System', `${deleted} publicación(es) eliminada(s).`);
    // Resetear el checkbox de "seleccionar todo"
    const selectAll = document.getElementById('archive-select-all');
    if (selectAll) selectAll.checked = false;
    loadArchive();
}

async function deletePost(id) {
    if (!confirm('¿Eliminar esta publicación y sus archivos asociados?')) return;
    try {
        await fetch(`${API_BASE}/posts/${id}`, { method: 'DELETE' });
        addThought('System', `Post eliminado correctamente.`);
        loadArchive();
    } catch (e) {
        alert('Error al borrar.');
    }
}

async function renderMediaGrid() {
    const response = await fetch(`${API_BASE}/knowledge`);
    const data = await response.json();
    const grid = document.getElementById('media-grid');
    grid.innerHTML = '';

    data.assets.forEach(asset => {
        const card = document.createElement('div');
        card.className = 'asset-card';
        
        const isImg = asset.type === 'image';
        const thumbContent = isImg 
            ? `<img src="/assets/${asset.fileName}" class="asset-thumb">`
            : `<div class="asset-icon">📄</div>`;

        card.innerHTML = `
            <div class="asset-thumb-container" onclick="openAssetPreview(${asset.id})" style="cursor:pointer;" title="Clic para ampliar">
                ${thumbContent}
            </div>
            <div class="asset-name" title="${asset.description}">${asset.description}</div>
            <div class="asset-meta">${asset.mimetype.split('/')[1]}</div>
            <button class="asset-delete-overlay delete-btn" onclick="deleteKnowledge('asset', ${asset.id})">×</button>
        `;
        grid.appendChild(card);
    });
}

async function promptAddUrl() {
    const url = prompt("Introduce la URL de la web o noticia:");
    if (!url) return;
    
    updateStatus('Adding URL...', 'processing');
    await fetch(`${API_BASE}/knowledge/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
    });
    loadKnowledge();
    updateStatus('SYSTEM ONLINE', 'idle');
}

async function deleteKnowledge(type, id) {
    if (!confirm("¿Eliminar este elemento del conocimiento?")) return;
    await fetch(`${API_BASE}/knowledge/${type}/${id}`, { method: 'DELETE' });
    loadKnowledge();
    if (document.getElementById('media-modal').style.display === 'flex') {
        renderMediaGrid();
    }
}

async function refinePrompt() {
    const current = document.getElementById('briefing-input').value;
    if (!current) return alert("Escribe primero un briefing para optimizar.");
    
    const btn = document.getElementById('refine-btn');
    const originalHtml = btn ? btn.innerHTML : 'OPTIMIZE_PROMPT';
    if (btn) {
        btn.innerHTML = '<span class="spinner-icon"></span>OPTIMIZANDO...';
        btn.disabled = true;
        btn.classList.add('btn-loading');
    }
    updateStatus('Optimizando prompt con IA...', 'processing');

    try {
        const response = await fetch(`${API_BASE}/ai/refine-prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: current })
        });
        const data = await response.json();
        if (data.refined) {
            document.getElementById('briefing-input').value = data.refined;
            addThought('Sugerencia', 'Briefing optimizado para máxima calidad visual y táctica.');
        }
    } catch (e) {
        alert("Error al optimizar.");
    } finally {
        if (btn) {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
            btn.classList.remove('btn-loading');
        }
        updateStatus('SYSTEM ONLINE', 'idle');
    }
}

/* ============================================
   TEMPORARY REFERENCES
   ============================================ */

async function handleRefUpload(input) {
    if (!input.files || !input.files.length) return;
    
    updateStatus('Uploading Refs...', 'processing');
    
    for (const file of input.files) {
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(`${API_BASE}/temp-upload`, { 
                method: 'POST', 
                body: formData 
            });
            const data = await response.json();
            if (data.success) {
                attachedImages.push({
                    path: data.path,
                    url: data.url,
                    mode: 'reference'
                });
            }
        } catch (e) {
            addThought('System', 'Error al subir una de las imágenes.');
        }
    }
    
    renderAttachedImages();
    updateStatus('SYSTEM ONLINE', 'idle');
}

function renderAttachedImages() {
    const container = document.getElementById('ref-preview-container');
    if (attachedImages.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    container.innerHTML = attachedImages.map((img, index) => `
        <div class="ref-card">
            <img src="${img.url}" alt="Preview">
            <div class="ref-modes-toggle">
                <button class="ref-mode-btn ${img.mode === 'reference' ? 'active' : ''}" onclick="updateImageMode(${index}, 'reference')">REF</button>
                <button class="ref-mode-btn ${img.mode === 'edit' ? 'active' : ''}" onclick="updateImageMode(${index}, 'edit')">EDIT</button>
                <button class="ref-mode-btn ${img.mode === 'vision' ? 'active' : ''}" onclick="updateImageMode(${index}, 'vision')">VIS</button>
            </div>
            <button class="remove-ref-btn" onclick="removeImage(${index})">×</button>
        </div>
    `).join('');
}

function updateImageMode(index, mode) {
    console.log(`[UI] Cambiando imagen #${index} a modo: ${mode}`);
    if (mode === 'edit') {
        attachedImages.forEach((img, i) => {
            if (i !== index && img.mode === 'edit') img.mode = 'reference';
        });
    }
    attachedImages[index].mode = mode;
    renderAttachedImages();
    addThought('System', `Imagen #${index+1} configurada como ${mode.toUpperCase()}`);
}

function removeImage(index) {
    attachedImages.splice(index, 1);
    renderAttachedImages();
}

function prepareImageEdit(url) {
    const relativePath = url.includes('/output/') ? 'output/' + url.split('/output/')[1] : url;
    
    attachedImages.push({
        path: relativePath,
        url: url,
        mode: 'edit'
    });
    
    attachedImages.forEach((img, i) => {
        if (i !== attachedImages.length - 1 && img.mode === 'edit') img.mode = 'reference';
    });
    
    renderAttachedImages();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('briefing-input').focus();
    document.getElementById('briefing-input').placeholder = "Dime qué quieres cambiar de esta imagen...";
    addThought('System', 'Imagen cargada para RE-EDICIÓN. Describe los cambios abajo.');
}

function removeReference() {
    attachedImages = [];
    renderAttachedImages();
    addThought('System', 'Limpiados todos los adjuntos.');
}

function handleAudioSelect(input) {
    if (!input.files || !input.files.length) return;
    audioFile = input.files[0];
    
    const label = document.getElementById('audio-file-label');
    const sizeMB = (audioFile.size / (1024 * 1024)).toFixed(1);
    label.textContent = `✅ ${audioFile.name} (${sizeMB} MB)`;
    label.style.color = 'var(--accent)';
    
    addThought('System', `Audio cargado: ${audioFile.name} (${sizeMB} MB)`);
}

async function suggestIdea() {
    const btn = document.getElementById('suggest-btn');
    const originalHtml = btn ? btn.innerHTML : 'AUTO_IDEAS';
    if (btn) {
        btn.innerHTML = '<span class="spinner-icon"></span>GENERANDO...';
        btn.disabled = true;
        btn.classList.add('btn-loading');
    }
    updateStatus('Generando idea con IA...', 'processing');

    try {
        const response = await fetch(`${API_BASE}/ai/suggest-idea`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                type: selectedType, 
                media: selectedMedia,
                aspectRatio: selectedRatio,
                engineMode: selectedEngine,
                instagramSkill: document.getElementById('instagram-skill-select')?.value || 'auto'
            })
        });
        const data = await response.json();
        if (data.briefing) {
            document.getElementById('briefing-input').value = data.briefing;
            addThought('Arquitecto', `Idea generada para ${selectedType}.`);
        }
    } catch (e) {
        alert("No se pudo generar la idea.");
    } finally {
        if (btn) {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
            btn.classList.remove('btn-loading');
        }
        updateStatus('SYSTEM ONLINE', 'idle');
    }
}

async function startSwarm() {
    // Audio Reel: flujo especial con FormData
    if (selectedType === 'audio-reel') {
        if (!audioFile) return alert('Sube un archivo de audio primero.');
        
        resetUI();
        updateStatus('SWARM_ACTIVE', 'processing');
        
        try {
            const formData = new FormData();
            formData.append('audioFile', audioFile);
            formData.append('aspectRatio', selectedRatio);
            formData.append('imageModel', selectedImageModel);
            
            const response = await fetch(`${API_BASE}/create-audio-reel`, {
                method: 'POST',
                body: formData
            });
            const { projectId } = await response.json();
            audioFile = null;
            document.getElementById('audio-file-label').textContent = 'Arrastra o haz clic para subir audio (.mp3, .wav, .m4a) — Máx 3 min';
            pollStatus(projectId);
        } catch (e) {
            addThought('System', 'Error starting audio reel swarm.');
        }
        return;
    }
    
    const briefing = document.getElementById('briefing-input').value;
    if (!briefing) return alert("Introduce un briefing.");

    resetUI();
    updateStatus('SWARM_ACTIVE', 'processing');
    
    try {
        const response = await fetch(`${API_BASE}/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                briefing, 
                contentType: selectedType,
                mediaType: selectedMedia,
                aspectRatio: selectedRatio,
                engineMode: selectedEngine,
                imageModel: selectedImageModel,
                instagramSkill: document.getElementById('instagram-skill-select')?.value || 'auto',
                externalReferences: attachedImages.map(img => ({ path: img.path, mode: img.mode }))
            })
        });
        const { projectId } = await response.json();
        removeReference();
        pollStatus(projectId);
    } catch (e) {
        addThought('System', 'Error starting swarm.');
    }
}

async function pollStatus(projectId) {
    showLoader();
    const interval = setInterval(async () => {
        const response = await fetch(`${API_BASE}/status/${projectId}`);
        const project = await response.json();

        if (project.status === 'completed') {
            clearInterval(interval);
            updateStatus('MISSION_OVER', 'completed');
            displayResults(project.data);
        } else if (project.status === 'failed') {
            clearInterval(interval);
            updateStatus('FAILED', 'failed');
            alert(project.error);
        }
    }, 3000);
}

function showLoader() {
    const viewer = document.getElementById('result-viewer');
    viewer.innerHTML = `
        <div class="ai-loader-container">
            <div class="ai-core"></div>
            <div class="loader-text">SWARM_PROCESSING</div>
            <div class="loader-subtext">Sincronizando agentes y optimizando activos...</div>
        </div>
    `;
}

function resetUI() { }
function addThought(agent, message) { console.log(`[${agent}] ${message}`); }
function updateStatus(text, className) {
    const badge = document.getElementById('status-badge');
    badge.textContent = text;
    badge.className = `badge ${className}`;
}

function displayResults(data) {
    const viewer = document.getElementById('result-viewer');
    viewer.innerHTML = '';
    window._lastPostId = data._savedId || data.id || null;
    
    const splitContainer = document.createElement('div');
    splitContainer.className = 'result-split-container';
    
    const visualSide = document.createElement('div');
    visualSide.className = 'visual-side';
    
    const isCarousel = data.contentType === 'carousel';
    const isPriceStory = data.contentType === 'price-story';
    const isNewsPost = data.contentType === 'news-post';
    const hasRemotionVideo = data.video && data.video.url;

    if (hasRemotionVideo) {
        // ── Reel: vídeo final como protagonista + preview del primer frame ──
        const videoWrap = document.createElement('div');
        videoWrap.style.cssText = 'position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:12px;';

        const videoSrc = data.video.url.startsWith('http') ? data.video.url : `http://localhost:3001${data.video.url}`;
        const video = document.createElement('video');
        video.src = videoSrc;
        video.controls = true;
        video.loop = true;
        video.style.cssText = 'max-height:80%; max-width:100%; border-radius:12px; box-shadow:0 0 40px rgba(0,243,255,0.15);';
        videoWrap.appendChild(video);

        const thumbsRow = document.createElement('div');
        thumbsRow.style.cssText = 'display:flex; gap:8px; overflow-x:auto; padding-bottom:4px; align-items:center;';

        const addThumbLabel = (text) => {
            const thumbsLabel = document.createElement('div');
            thumbsLabel.style.cssText = 'font-family:"JetBrains Mono",monospace; font-size:0.6rem; color:var(--accent); letter-spacing:2px; margin-top:6px; width:100%; text-align:center;';
            thumbsLabel.textContent = text;
            videoWrap.appendChild(thumbsLabel);
        };

        const appendMediaThumb = (src, isVideo) => {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'position:relative; height:60px; border-radius:6px; border:1px solid var(--border); overflow:hidden; flex-shrink:0; cursor:pointer; background:#000;';
            if (isVideo) {
                const v = document.createElement('video');
                v.src = src;
                v.muted = true;
                v.playsInline = true;
                v.preload = 'metadata';
                v.style.cssText = 'height:60px; width:auto; max-width:110px; object-fit:cover; display:block; opacity:0.85;';
                v.addEventListener('loadeddata', () => { try { v.currentTime = 0.1; } catch (e) {} });
                wrap.appendChild(v);
                const badge = document.createElement('span');
                badge.textContent = '▶';
                badge.style.cssText = 'position:absolute;right:4px;bottom:4px;font-size:9px;color:#fff;background:rgba(0,0,0,0.6);border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;';
                wrap.appendChild(badge);
            } else {
                const thumb = document.createElement('img');
                thumb.src = src;
                thumb.style.cssText = 'height:60px; width:auto; max-width:110px; object-fit:cover; display:block; opacity:0.85;';
                wrap.appendChild(thumb);
            }
            wrap.onclick = () => window.open(src.startsWith('http') && !isVideo ? src : videoSrc, '_blank');
            thumbsRow.appendChild(wrap);
        };

        const normalize = (u) => (!u ? '' : (u.startsWith('http') ? u : `http://localhost:3001${u.startsWith('/') ? '' : '/'}${u}`));
        const isVid = (u) => /\.(mp4|webm|mov)($|\?)/i.test(u || '');
        let thumbCount = 0;

        // 1) Thumbnail oficial del primer frame (ffmpeg)
        if (data.video.thumbnail) {
            appendMediaThumb(normalize(data.video.thumbnail), false);
            thumbCount++;
        }

        // 2) Fondos/escenas que sean imágenes reales (no el MP4 final)
        (data.visuals || []).forEach((raw) => {
            const src = normalize(raw);
            if (!src) return;
            if (isVid(src)) {
                // Evitar duplicar el mismo vídeo final como <img> roto
                if (src === videoSrc || src.replace(/https?:\/\/[^/]+/, '') === videoSrc.replace(/https?:\/\/[^/]+/, '')) return;
                appendMediaThumb(src, true);
                thumbCount++;
                return;
            }
            appendMediaThumb(src, false);
            thumbCount++;
        });

        // 3) Fallback: si no hay thumbnail ni imágenes, preview del propio vídeo
        if (thumbCount === 0) {
            appendMediaThumb(videoSrc, true);
            thumbCount++;
        }

        if (thumbCount > 0) {
            const onlyVideoPreview = !!data.video.thumbnail || !(data.visuals || []).some(v => !isVid(normalize(v)));
            addThumbLabel(onlyVideoPreview ? 'PREVIEW' : 'SCENE_BACKGROUNDS');
            videoWrap.appendChild(thumbsRow);
        }

        visualSide.appendChild(videoWrap);

    } else if (isCarousel && data.visuals && data.visuals.length > 1) {
        // ── Carrusel de Instagram: imágenes con navegación prev/next ──
        let currentSlide = 0;

        const carouselWrap = document.createElement('div');
        carouselWrap.style.cssText = 'position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center;';

        const imgEl = document.createElement('img');
        imgEl.src = data.visuals[0].startsWith('http') ? data.visuals[0] : `http://localhost:3001${data.visuals[0]}`;
        imgEl.style.cssText = 'max-height:90%; max-width:100%; object-fit:contain; border-radius:10px;';

        const counter = document.createElement('div');
        counter.style.cssText = 'position:absolute; bottom:12px; left:50%; transform:translateX(-50%); font-family:"JetBrains Mono",monospace; font-size:0.65rem; color:var(--accent); letter-spacing:2px; background:rgba(0,0,0,0.7); padding:4px 12px; border-radius:20px;';
        counter.textContent = `1 / ${data.visuals.length}`;

        const updateSlide = (idx) => {
            currentSlide = (idx + data.visuals.length) % data.visuals.length;
            const src = data.visuals[currentSlide];
            imgEl.src = src.startsWith('http') ? src : `http://localhost:3001${src}`;
            counter.textContent = `${currentSlide + 1} / ${data.visuals.length}`;
        };

        const btnStyle = 'position:absolute; top:50%; transform:translateY(-50%); background:rgba(0,0,0,0.65); border:1px solid var(--accent); color:var(--accent); border-radius:50%; width:42px; height:42px; font-size:1.2rem; cursor:pointer; display:flex; align-items:center; justify-content:center; z-index:10;';

        const prevBtn = document.createElement('button');
        prevBtn.style.cssText = btnStyle + 'left:10px;';
        prevBtn.innerHTML = '&#8592;';
        prevBtn.onclick = () => updateSlide(currentSlide - 1);

        const nextBtn = document.createElement('button');
        nextBtn.style.cssText = btnStyle + 'right:10px;';
        nextBtn.innerHTML = '&#8594;';
        nextBtn.onclick = () => updateSlide(currentSlide + 1);

        carouselWrap.appendChild(prevBtn);
        carouselWrap.appendChild(imgEl);
        carouselWrap.appendChild(nextBtn);
        carouselWrap.appendChild(counter);
        visualSide.appendChild(carouselWrap);

    } else if (data.visuals && data.visuals.length > 0) {
        // ── Post/Flyer estándar: imagen única con botón de edición ──
        const src = data.visuals[0];
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative; height:100%; display:flex; align-items:center; justify-content:center;';

        const img = document.createElement('img');
        img.src = src.startsWith('http') ? src : `http://localhost:3001${src}`;
        img.style.cssText = 'max-height:100%; max-width:100%; object-fit:contain;';

        const editBtn = document.createElement('button');
        editBtn.className = 'mini-suggest';
        editBtn.innerHTML = '✏️ EDITAR CON IA';
        editBtn.style.cssText = 'position:absolute; top:15px; right:15px; background:rgba(0,0,0,0.7); backdrop-filter:blur(10px); border-color:var(--accent); color:var(--accent);';
        editBtn.onclick = () => prepareImageEdit(src.startsWith('http') ? src : `http://localhost:3001${src}`);

        wrap.appendChild(img);
        wrap.appendChild(editBtn);
        visualSide.appendChild(wrap);
    }
    
    const textSide = document.createElement('div');
    textSide.className = 'text-side';
    
    if (data.content) {
        const c = data.content;
        const fbCopy = c.facebook?.copy || c.text || JSON.stringify(c);
        const fbHash = c.facebook?.hashtags || '';
        const igCopy = c.instagram?.copy || '';
        const igHash = c.instagram?.hashtags || '';

        textSide.innerHTML = `
            <div class="text-block">
                <div style="font-family:'JetBrains Mono';font-size:0.6rem;color:var(--accent);margin-bottom:10px;letter-spacing:2px">PROPOSAL_DATA [STATION_FB]</div>
                <p style="font-size:1.1rem; line-height:1.6; color:#fff">${fbCopy}</p>
                <p style="color:var(--accent); margin-top:10px; font-family:'JetBrains Mono'; font-size:0.85rem">${fbHash}</p>
            </div>
            ${igCopy ? `
            <div class="text-block" style="border-top: 1px solid var(--border); padding-top:20px">
                <div style="font-family:'JetBrains Mono';font-size:0.6rem;color:var(--accent);margin-bottom:10px;letter-spacing:2px">PROPOSAL_DATA [STATION_IG]</div>
                <p style="font-size:1.1rem; line-height:1.6; color:#fff">${igCopy}</p>
                <p style="color:var(--accent); margin-top:10px; font-family:'JetBrains Mono'; font-size:0.85rem">${igHash}</p>
            </div>` : ''}
            <div class="publish-platform-row" style="margin-top:auto; padding-top:20px; display:flex; flex-direction:column; gap:10px">
                <button class="primary-btn publish-ig" style="width:100%" onclick="publishPost('${window._lastPostId}', 'instagram')">📸 PUBLICAR EN INSTAGRAM</button>
                <button class="primary-btn publish-fb" style="width:100%" onclick="publishPost('${window._lastPostId}', 'facebook')">📘 PUBLICAR EN FACEBOOK</button>
                <button class="primary-btn publish-both" style="width:100%; opacity:0.85" onclick="publishPost('${window._lastPostId}')">${hasRemotionVideo ? '🎬 AMBAS (REEL)' : (isCarousel ? '🎠 AMBAS (CARRUSEL)' : (isPriceStory ? '📊 AMBAS (STORY)' : (isNewsPost ? '📰 AMBAS (NOTICIA)' : '🚀 AMBAS PLATAFORMAS')))}</button>
            </div>
        `;
    }

    splitContainer.appendChild(visualSide);
    splitContainer.appendChild(textSide);
    viewer.appendChild(splitContainer);
}

async function publishPost(postId, platform) {
    if (!postId || postId === 'null') {
        alert('❌ No se pudo identificar el post. Prueba a recargarlo desde el archivo.');
        return;
    }
    const platforms = platform ? [platform] : ['instagram', 'facebook'];
    const label = platforms.length === 2
        ? 'Instagram y Facebook'
        : (platforms[0] === 'instagram' ? 'Instagram' : 'Facebook');
    if (!confirm(`¿Publicar este contenido en ${label} ahora?`)) return;
    try {
        const response = await fetch(`${API_BASE}/publish/${postId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platforms })
        });
        const result = await response.json();
        if (!response.ok) {
            alert('❌ ' + (result.error || 'Error al publicar'));
            return;
        }
        if (result.mock) {
            alert('📋 Publicación SIMULADA. Revisa INSTAGRAM_* y FACEBOOK_* en el .env');
        } else if (result.success) {
            const parts = [];
            if (!result.instagram?.skipped) {
                parts.push(result.instagram?.success ? '✅ IG' : '⚠️ IG');
            }
            if (!result.facebook?.skipped) {
                parts.push(result.facebook?.success ? '✅ FB' : '⚠️ FB');
            }
            const type = result.mediaType === 'reel' ? 'Reel/vídeo' : 'Post';
            const details = [];
            if (!result.instagram?.skipped && !result.instagram?.success) {
                details.push('IG: ' + (result.instagram?.error || result.instagram?.message || 'falló'));
            }
            if (!result.facebook?.skipped && !result.facebook?.success) {
                details.push('FB: ' + (result.facebook?.error || result.facebook?.message || 'falló'));
            }
            alert(`📤 ${type} enviado — ${parts.join(' · ')}${details.length ? '\n' + details.join('\n') : ''}`);
            if (typeof loadArchive === 'function') loadArchive().catch(() => {});
        } else {
            alert('❌ Error: ' + (result.error || 'Desconocido'));
        }
    } catch (e) {
        alert('Error de conexión.');
    }
}

async function publishLastPost() {
    if (!window._lastPostId) {
        alert('No hay un post reciente.');
        return;
    }
    await publishPost(window._lastPostId);
}

// ============================================
// AGRO DATA: Precios y Noticias
// ============================================

async function generatePriceStory() {
    resetUI();
    updateStatus('AGRO_PRICE', 'processing');
    addThought('Agro', 'Consultando precios medios de hortalizas en la base de datos...');

    try {
        const response = await fetch(`${API_BASE}/agro/generate-price-story`, { method: 'POST' });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Error desconocido');
        }

        addThought('Agro', `Precios obtenidos: ${result.prices?.length || 0} hortalizas. Imagen generada.`);

        // Recargar el post desde el servicio para mostrarlo con displayResults
        const posts = await (await fetch(`${API_BASE}/posts`)).json();
        const post = posts.find(p => p.id === result.postId);

        if (post) {
            displayResults({ ...post, _savedId: post.id });
        } else {
            addThought('System', 'Post generado pero no encontrado para visualización.');
        }

        updateStatus('AGRO_PRICE', 'idle');
    } catch (e) {
        addThought('System', `Error generando precios: ${e.message}`);
        alert('Error: ' + e.message);
        updateStatus('SYSTEM ONLINE', 'idle');
    }
}

async function generateNewsPost() {
    resetUI();
    updateStatus('AGRO_NEWS', 'processing');
    addThought('Agro', 'Analizando noticias del día en la base de datos...');

    try {
        const response = await fetch(`${API_BASE}/agro/generate-news-post`, { method: 'POST' });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Error desconocido');
        }

        addThought('Agro', `Noticia seleccionada: ${result.news?.Titulo?.substring(0, 60) || 'N/A'}...`);
        if (result.newsUrl) {
            addThought('Agro', `URL: ${result.newsUrl}`);
        }

        // Recargar el post desde el servicio para mostrarlo con displayResults
        const posts = await (await fetch(`${API_BASE}/posts`)).json();
        const post = posts.find(p => p.id === result.postId);

        if (post) {
            displayResults({ ...post, _savedId: post.id });
        } else {
            addThought('System', 'Post generado pero no encontrado para visualización.');
        }

        updateStatus('AGRO_NEWS', 'idle');
    } catch (e) {
        addThought('System', `Error generando noticia: ${e.message}`);
        alert('Error: ' + e.message);
        updateStatus('SYSTEM ONLINE', 'idle');
    }
}

/* ============================================
   PRODUCT CONTEXT EDITOR
   ============================================ */

function setupProductContextListeners() {
    const textarea = document.getElementById('product-context-textarea');
    if (textarea) {
        textarea.addEventListener('input', () => {
            const count = textarea.value.length;
            document.getElementById('product-char-count').textContent = count;
        });

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + 2;
            }
        });
    }

    // Restaurar estado abierto/cerrado
    const savedState = localStorage.getItem('productContextOpen');
    if (savedState === 'true') {
        toggleProductContext(true);
    }
}

function toggleProductContext(forceOpen = false) {
    const body = document.getElementById('product-context-body');
    const header = document.querySelector('.product-context-header');
    const h3 = header.querySelector('h3');
    const isOpen = body.classList.contains('open');
    
    if (forceOpen && isOpen) return;

    if (isOpen) {
        body.classList.remove('open');
        header.classList.remove('open');
        h3.textContent = '▶ Product Context';
        localStorage.setItem('productContextOpen', 'false');
    } else {
        body.classList.add('open');
        header.classList.add('open');
        h3.textContent = '▼ Product Context';
        localStorage.setItem('productContextOpen', 'true');
    }
}

function formatText(type) {
    const textarea = document.getElementById('product-context-textarea');
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);
    let replacement = '';
    
    switch (type) {
        case 'bold':
            replacement = `**${selected || 'texto en negrita'}**`;
            break;
        case 'heading':
            replacement = `\n## ${selected || 'Título de sección'}\n`;
            break;
        case 'list':
            replacement = `\n- ${selected || 'Elemento de lista'}`;
            break;
        case 'link':
            replacement = `[${selected || 'texto del enlace'}](URL)`;
            break;
    }
    
    textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
    textarea.focus();
    textarea.selectionStart = start + replacement.length;
    textarea.selectionEnd = start + replacement.length;
    
    // Trigger input event to update char count
    textarea.dispatchEvent(new Event('input'));
}

async function loadProductContext() {
    try {
        const response = await fetch(`${API_BASE}/product-context`);
        const data = await response.json();
        
        // Fill metadata fields
        const meta = data.metadata || {};
        document.getElementById('product-name').value = meta.productName || '';
        document.getElementById('product-industry').value = meta.industry || '';
        document.getElementById('product-website').value = meta.website || '';
        document.getElementById('product-hashtags').value = meta.defaultHashtags || '';
        
        // Fill context textarea
        const textarea = document.getElementById('product-context-textarea');
        if (textarea && data.context) {
            textarea.value = data.context;
            document.getElementById('product-char-count').textContent = data.context.length;
        }
        
        // Update status badge
        updateProductContextStatus(data);
        
    } catch (e) {
        console.error('Error cargando contexto de producto:', e);
    }
}

function updateProductContextStatus(data) {
    const statusEl = document.getElementById('product-context-status');
    const hasContext = (data.context && data.context.trim().length > 0) || 
                      (data.metadata?.productName && data.metadata.productName.trim().length > 0);
    
    if (hasContext) {
        const prod = data.metadata?.productName || 'Helpmeagro';
        statusEl.textContent = `CONFIGURADO (${prod})`;
        statusEl.className = 'product-context-status active';
    } else {
        statusEl.textContent = 'NO CONFIGURADO';
        statusEl.className = 'product-context-status empty';
    }
}

async function saveProductContext() {
    const btn = document.getElementById('product-context-save-btn');
    const originalText = btn.textContent;
    btn.textContent = '⏳ GUARDANDO...';
    btn.classList.add('saving');
    
    try {
        const contextText = document.getElementById('product-context-textarea').value;
        const metadata = {
            productName: document.getElementById('product-name').value,
            industry: document.getElementById('product-industry').value,
            website: document.getElementById('product-website').value,
            defaultHashtags: document.getElementById('product-hashtags').value
        };
        
        const response = await fetch(`${API_BASE}/product-context`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context: contextText, metadata })
        });
        
        const result = await response.json();
        
        if (result.success) {
            updateProductContextStatus(result.data);
            addThought('System', 'Contexto de producto guardado. Todos los agentes ahora usarán este contexto.');
        }
    } catch (e) {
        console.error('Error guardando contexto:', e);
        addThought('System', 'Error guardando contexto de producto.');
    } finally {
        btn.textContent = originalText;
        btn.classList.remove('saving');
    }
}


/* ============================================
   ANALIZADOR DE NEGOCIO WEB & PROPUESTAS IA
   ============================================ */

let currentBizJobId = null;
let bizPollingTimer = null;
let currentBizProposal = null;
let currentBizCaptures = null;

async function startBusinessAnalysis() {
    const websiteInput = document.getElementById('product-website');
    const url = websiteInput ? websiteInput.value.trim() : '';

    if (!url) {
        alert("Por favor, introduce la URL de tu sitio web (ej: https://minegocio.com)");
        if (websiteInput) websiteInput.focus();
        return;
    }

    const btn = document.getElementById('btn-analyze-biz');
    const progressContainer = document.getElementById('biz-analysis-progress');
    const statusText = document.getElementById('biz-progress-status');
    const progressFill = document.getElementById('biz-progress-fill');
    const alertEl = document.getElementById('biz-analysis-alert');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-icon"></span> Analizando...';
    }

    if (alertEl) {
        alertEl.style.display = 'none';
        alertEl.className = 'biz-analysis-alert';
    }

    if (progressContainer) {
        progressContainer.style.display = 'flex';
        statusText.innerHTML = '<span class="spinner-icon"></span> Validando seguridad e iniciando navegador seguro...';
        progressFill.style.width = '20%';
    }

    try {
        const response = await fetch(`${API_BASE}/product-context/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url,
                reqKey: 'biz_req_' + Date.now(),
                baseRevision: window.currentProductContextRevision || null
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'No se pudo iniciar el análisis del sitio web.');
        }

        currentBizJobId = data.jobId;
        pollBusinessAnalysis(data.jobId);

    } catch (err) {
        if (alertEl) {
            alertEl.className = 'biz-analysis-alert error';
            alertEl.innerHTML = `❌ Error: ${escapeHtml(err.message)}`;
            alertEl.style.display = 'block';
        } else {
            alert(`Error: ${err.message}`);
        }
        if (progressContainer) progressContainer.style.display = 'none';
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '⚡ Analizar mi negocio';
        }
    }
}

function pollBusinessAnalysis(jobId) {
    if (bizPollingTimer) clearInterval(bizPollingTimer);

    const statusText = document.getElementById('biz-progress-status');
    const progressFill = document.getElementById('biz-progress-fill');
    const progressContainer = document.getElementById('biz-analysis-progress');
    const btn = document.getElementById('btn-analyze-biz');

    bizPollingTimer = setInterval(async () => {
        try {
            const res = await fetch(`${API_BASE}/product-context/analysis/${jobId}`);
            if (!res.ok) {
                clearInterval(bizPollingTimer);
                throw new Error('No se pudo consultar el estado del análisis.');
            }

            const job = await res.json();

            if (job.stage === 'reading') {
                if (statusText) statusText.innerHTML = `<span class="spinner-icon"></span> ${escapeHtml(job.progressMessage || 'Leyendo páginas y estructura web...')}`;
                if (progressFill) progressFill.style.width = '40%';
            } else if (job.stage === 'capturing') {
                if (statusText) statusText.innerHTML = `<span class="spinner-icon"></span> ${escapeHtml(job.progressMessage || 'Capturando vista escritorio y móvil...')}`;
                if (progressFill) progressFill.style.width = '70%';
            } else if (job.stage === 'extracting') {
                if (statusText) statusText.innerHTML = `<span class="spinner-icon"></span> ${escapeHtml(job.progressMessage || 'Extrayendo contexto de negocio con IA...')}`;
                if (progressFill) progressFill.style.width = '88%';
            }

            if (job.status === 'ready' || job.status === 'partial') {
                clearInterval(bizPollingTimer);
                if (progressFill) progressFill.style.width = '100%';
                if (statusText) statusText.innerHTML = '✅ Análisis finalizado.';
                setTimeout(() => {
                    if (progressContainer) progressContainer.style.display = 'none';
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '⚡ Analizar mi negocio';
                    }
                    renderBusinessProposal(job);
                }, 400);
            } else if (job.status === 'failed') {
                clearInterval(bizPollingTimer);
                if (statusText) statusText.innerHTML = `❌ ${escapeHtml(job.error || 'Error durante el análisis.')}`;
                const alertEl = document.getElementById('biz-analysis-alert');
                if (alertEl) {
                    alertEl.className = 'biz-analysis-alert error';
                    alertEl.innerHTML = `❌ Error: ${escapeHtml(job.error || 'Fallo al analizar la web')}`;
                    alertEl.style.display = 'block';
                }
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '⚡ Analizar mi negocio';
                }
            } else if (job.status === 'cancelled') {
                clearInterval(bizPollingTimer);
                if (progressContainer) progressContainer.style.display = 'none';
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '⚡ Analizar mi negocio';
                }
            }
        } catch (e) {
            console.error('Error en sondeo de análisis:', e);
        }
    }, 1500);
}

function cancelBusinessAnalysis() {
    if (bizPollingTimer) {
        clearInterval(bizPollingTimer);
        bizPollingTimer = null;
    }
    if (currentBizJobId) {
        fetch(`${API_BASE}/product-context/analysis/${currentBizJobId}`, { method: 'DELETE' }).catch(() => {});
    }
    const progressContainer = document.getElementById('biz-analysis-progress');
    const btn = document.getElementById('btn-analyze-biz');
    if (progressContainer) progressContainer.style.display = 'none';
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '⚡ Analizar mi negocio';
    }
}

function renderBusinessProposal(job) {
    currentBizProposal = job.proposal || {};
    currentBizCaptures = job.captures || {};
    const prop = job.proposal || {};

    // 1. POBLAR DIRECTAMENTE LOS CAMPOS DEL FRONTEND CON EL CONTEXTO OBTENIDO
    if (prop.businessName?.value) {
        const el = document.getElementById('product-name');
        if (el) {
            el.value = prop.businessName.value;
            el.classList.add('field-flash-highlight');
            setTimeout(() => el.classList.remove('field-flash-highlight'), 2000);
        }
    }

    if (prop.industry?.value) {
        const el = document.getElementById('product-industry');
        if (el) {
            el.value = prop.industry.value;
            el.classList.add('field-flash-highlight');
            setTimeout(() => el.classList.remove('field-flash-highlight'), 2000);
        }
    }

    if (prop.website?.value) {
        const el = document.getElementById('product-website');
        if (el) {
            el.value = prop.website.value;
            el.classList.add('field-flash-highlight');
            setTimeout(() => el.classList.remove('field-flash-highlight'), 2000);
        }
    }

    if (prop.defaultHashtags?.value) {
        const el = document.getElementById('product-hashtags');
        if (el) {
            el.value = prop.defaultHashtags.value;
            el.classList.add('field-flash-highlight');
            setTimeout(() => el.classList.remove('field-flash-highlight'), 2000);
        }
    }

    if (prop.summary?.value) {
        const textarea = document.getElementById('product-context-textarea');
        if (textarea) {
            textarea.value = prop.summary.value;
            textarea.classList.add('field-flash-highlight');
            setTimeout(() => textarea.classList.remove('field-flash-highlight'), 2000);
            const charCount = document.getElementById('product-char-count');
            if (charCount) charCount.textContent = prop.summary.value.length;
        }
    }

    // 2. ACTUALIZAR BADGE DE ESTADO A CONFIGURADO
    updateProductContextStatus({
        context: prop.summary?.value || '',
        metadata: { productName: prop.businessName?.value || 'Helpmeagro' }
    });

    // 3. MOSTRAR MENSAJE DE ÉXITO EN EL FORMULARIO
    const alertEl = document.getElementById('biz-analysis-alert');
    if (alertEl) {
        alertEl.className = 'biz-analysis-alert success';
        alertEl.innerHTML = `✅ <b>¡Contexto obtenido con éxito!</b> Los campos se han rellenado con los datos de tu web. Pulsa <b>GUARDAR CONTEXTO</b> para confirmar los cambios.`;
        alertEl.style.display = 'block';
        setTimeout(() => {
            if (alertEl) alertEl.style.display = 'none';
        }, 12000);
    }

    // 4. MOSTRAR MINIATURAS DE CAPTURAS WEB (ESCRITORIO Y MÓVIL)
    const capturesPanel = document.getElementById('biz-captures-panel');
    const capturesGrid = document.getElementById('biz-captures-grid');
    if (capturesPanel && capturesGrid) {
        let capHtml = '';
        if (job.captures?.desktop) {
            capHtml += `
            <div class="biz-capture-card">
                <img src="${job.captures.desktop.previewUrl}" alt="Escritorio 1440x900" class="biz-capture-thumb"
                     onclick="openAssetPreviewUrl('${job.captures.desktop.previewUrl}', 'Captura Web Escritorio (1440x900)')">
                <div class="biz-capture-footer">
                    <span>🖥️ Escritorio</span>
                    <span>1440x900</span>
                </div>
            </div>`;
        }
        if (job.captures?.mobile) {
            capHtml += `
            <div class="biz-capture-card">
                <img src="${job.captures.mobile.previewUrl}" alt="Móvil 390x844" class="biz-capture-thumb"
                     onclick="openAssetPreviewUrl('${job.captures.mobile.previewUrl}', 'Captura Web Móvil Responsive (390x844)')">
                <div class="biz-capture-footer">
                    <span>📱 Móvil</span>
                    <span>390x844</span>
                </div>
            </div>`;
        }
        if (capHtml) {
            capturesGrid.innerHTML = capHtml;
            capturesPanel.style.display = 'block';
        } else {
            capturesPanel.style.display = 'none';
        }
    }

    // 5. AUTO-APLICAR AL BACKEND (PERSISTENCIA Y ACTIVOS)
    fetch(`${API_BASE}/product-context/analysis/${job.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            baseRevision: window.currentProductContextRevision || null,
            selectedFields: ['businessName', 'industry', 'website', 'defaultHashtags', 'tone', 'offering', 'targetAudience', 'keyBenefits', 'location', 'summary'],
            selectedCaptures: ['desktop', 'mobile']
        })
    }).then(res => res.json()).then(data => {
        if (data.success) {
            window.currentProductContextRevision = data.revision;
            loadKnowledge(); // Refrescar lista de activos de la barra lateral para mostrar las capturas
            addThought('System', `✅ Contexto y capturas de ${prop.businessName?.value || 'la web'} guardados en el sistema.`);
        }
    }).catch(err => {
        console.warn('Auto-apply warning:', err);
    });
}

function openAssetPreviewUrl(url, title = 'Vista Previa') {
    const modal = document.getElementById('asset-preview-modal');
    const img = document.getElementById('asset-preview-img');
    const titleEl = document.getElementById('asset-preview-title');
    const descEl = document.getElementById('asset-preview-desc');
    const metaEl = document.getElementById('asset-preview-meta');

    if (!modal || !img) return;

    img.src = url;
    img.alt = title;
    img.style.display = 'block';

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = 'Captura de pantalla generada durante la navegación segura.';
    if (metaEl) metaEl.textContent = 'Rol: website-screenshot';

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
}


/* ============================================
   EXPERIMENTOS, MÉTRICAS Y MEMORIA HISTÓRICA
   ============================================ */

let currentPlanningMode = 'monthly';

async function openExperimentsModal() {
    const modal = document.getElementById('experiments-modal');
    if (modal) {
        modal.style.display = 'flex';
        await loadExperimentsData();
    }
}

function closeExperimentsModal() {
    const modal = document.getElementById('experiments-modal');
    if (modal) modal.style.display = 'none';
}

async function loadExperimentsData() {
    try {
        const [expRes, memRes] = await Promise.all([
            fetch(`${API_BASE}/experiments`).catch(() => null),
            fetch(`${API_BASE}/memory`).catch(() => null)
        ]);

        let expData = null;
        if (expRes && expRes.ok) {
            const json = await expRes.json();
            expData = json.data || json;
        }

        let memData = null;
        if (memRes && memRes.ok) {
            memData = await memRes.json();
        }

        // 1. Métricas agregadas
        const summary = expData?.summary || expData?.global || {};
        const totalPostsEl = document.getElementById('exp-total-posts');
        if (totalPostsEl) totalPostsEl.textContent = summary.totalPosts ?? expData?.posts?.length ?? 0;

        const measuredEl = document.getElementById('exp-measured-posts');
        if (measuredEl) measuredEl.textContent = summary.measuredPosts ?? 0;

        const reachEl = document.getElementById('exp-avg-reach');
        if (reachEl) {
            reachEl.textContent = (summary.averageReach !== null && summary.averageReach !== undefined)
                ? Math.round(summary.averageReach).toLocaleString()
                : 'Sin datos';
        }

        const srrEl = document.getElementById('exp-avg-srr');
        if (srrEl) {
            srrEl.textContent = (summary.averageSRR !== null && summary.averageSRR !== undefined)
                ? summary.averageSRR + '%'
                : 'Sin datos';
        }

        // 2. Top Performer
        const topBox = document.getElementById('top-performer-detail');
        if (topBox) {
            const top = expData?.topPerformer || summary.topPerformer;
            if (top) {
                topBox.innerHTML = `
                    <b>${top.concept || top.angle || 'Post destacado'}</b> (${top.format || 'formato'})<br>
                    <span style="color:var(--text-dim); font-size:0.75rem;">
                        Alcance: <b>${top.metrics?.reach ?? '-'}</b> | Guardados: <b>${top.metrics?.saved ?? '-'}</b> | SRR: <b style="color:#00e676;">${top.srr ?? '-'}%</b>
                    </span>
                `;
            } else {
                topBox.innerHTML = `<span style="color: var(--text-dim); font-style: italic;">Aún no hay publicaciones con métricas consolidadas en Instagram para determinar el mejor contenido. Pulsa "Sincronizar métricas IG" para actualizar.</span>`;
            }
        }

        // 3. Memoria de contenidos recientes
        const memList = document.getElementById('memory-topics-list');
        if (memList) {
            const topics = memData?.recentCoveredTopics || [];
            if (topics.length > 0) {
                let html = '<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:6px;">';
                topics.slice(0, 10).forEach(t => {
                    const snippet = t.topic ? (t.topic.length > 90 ? t.topic.slice(0, 90) + '...' : t.topic) : 'Contenido sin descripción';
                    html += `
                        <li style="border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 4px;">
                            <span style="color:var(--accent); font-family:'JetBrains Mono'; font-size:0.7rem;">[${t.date || 'Reciente'}] ${(t.format || '').toUpperCase()}:</span>
                            <span style="color:#ccc;">${snippet}</span>
                        </li>
                    `;
                });
                html += '</ul>';
                memList.innerHTML = html;
            } else {
                memList.innerHTML = `<span style="color: var(--text-dim); font-style: italic;">No hay memoria temática registrada todavía.</span>`;
            }
        }

        // 4. Tabla de posts & experimentos
        const tbody = document.getElementById('experiments-tbody');
        if (tbody) {
            const posts = expData?.posts || [];
            if (posts.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="padding: 12px; text-align: center; color: var(--text-dim);">No hay publicaciones registradas aún.</td></tr>';
            } else {
                let rowsHtml = '';
                posts.slice(0, 25).forEach(p => {
                    const dateStr = p.timestamp ? new Date(p.timestamp).toLocaleDateString('es-ES') : (p.id ? p.id.slice(-6) : '-');
                    const concept = p.concept || p.briefing?.slice(0, 45) || 'Sin concepto';
                    const reach = p.metrics?.reach !== null && p.metrics?.reach !== undefined ? p.metrics.reach : '-';
                    const saved = p.metrics?.saved !== null && p.metrics?.saved !== undefined ? p.metrics.saved : '-';
                    const srr = p.srr !== null && p.srr !== undefined ? p.srr + '%' : '-';
                    rowsHtml += `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <td style="padding: 8px; font-family:'JetBrains Mono';">${dateStr}</td>
                            <td style="padding: 8px;"><span class="calendar-post-tag calendar-tag-${p.format || 'single'}">${(p.format || 'single').toUpperCase()}</span></td>
                            <td style="padding: 8px;" title="${p.briefing || ''}">${concept}</td>
                            <td style="padding: 8px;">${reach}</td>
                            <td style="padding: 8px;">${saved}</td>
                            <td style="padding: 8px; color:#ff9100; font-weight:bold;">${srr}</td>
                            <td style="padding: 8px;">
                                <button class="hub-btn" onclick="openDayEditorModalForPost('${p.id}')" style="font-size:0.65rem; padding:2px 6px;">VER</button>
                            </td>
                        </tr>
                    `;
                });
                tbody.innerHTML = rowsHtml;
            }
        }
    } catch (e) {
        console.error('Error cargando experimentos:', e);
    }
}

async function syncAllMetrics() {
    const btn = document.querySelector('button[onclick="syncAllMetrics()"]');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-icon"></span> Sincronizando...';
    }

    try {
        const response = await fetch(`${API_BASE}/experiments/sync`, { method: 'POST' });
        const result = await response.json();
        if (result.success) {
            addThought('System', `✅ Sincronización completada: ${result.updatedCount || 0} publicaciones actualizadas con métricas de Instagram.`);
            await loadExperimentsData();
        } else {
            alert(result.error || 'No se pudieron sincronizar las métricas.');
        }
    } catch (e) {
        console.error('Error sincronizando métricas:', e);
        alert('Error conectando con la sincronización: ' + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

/* ============================================
   MODO DE PLANIFICACIÓN DEL CALENDARIO Y PLAN SEMANAL
   ============================================ */

async function loadPlanningMode() {
    try {
        const res = await fetch(`${API_BASE}/bot/planning-mode`);
        const data = await res.json();
        if (data.success && data.mode) {
            currentPlanningMode = data.mode;
        }
    } catch (e) {
        console.warn('No se pudo obtener el modo de planificación:', e);
    }
    updatePlanningModeUI(currentPlanningMode);
}

function updatePlanningModeUI(mode) {
    const radioMonthly = document.getElementById('mode-monthly');
    const radioWeekly = document.getElementById('mode-weekly');
    const labelMonthly = document.getElementById('label-mode-monthly');
    const labelWeekly = document.getElementById('label-mode-weekly');
    const statusText = document.getElementById('planning-mode-status-text');

    if (radioMonthly && radioWeekly) {
        radioMonthly.checked = (mode === 'monthly');
        radioWeekly.checked = (mode === 'weekly');
    }

    if (labelMonthly) labelMonthly.classList.toggle('active', mode === 'monthly');
    if (labelWeekly) labelWeekly.classList.toggle('active', mode === 'weekly');

    if (statusText) {
        if (mode === 'weekly') {
            statusText.innerHTML = '⚡ Modo activo: <b style="color:var(--accent);">Semanal con IA (Investigación en internet cada lunes)</b>';
        } else {
            statusText.innerHTML = '📅 Modo activo: <b style="color:#00e676;">Mensual Completo (Genera el mes completo el día 1)</b>';
        }
    }
}

async function changePlanningMode(newMode) {
    currentPlanningMode = newMode;
    updatePlanningModeUI(newMode);

    try {
        const res = await fetch(`${API_BASE}/bot/planning-mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: newMode })
        });
        const data = await res.json();
        if (data.success) {
            addThought('System', `⚙️ Modo de planificación actualizado a: ${newMode === 'weekly' ? 'Semanal con IA (Grounding + Memoria)' : 'Mensual Completo'}.`);
        }
    } catch (e) {
        console.error('Error guardando modo de planificación:', e);
    }
}

async function executeCurrentPlanningMode() {
    if (currentPlanningMode === 'weekly') {
        await forceWeeklyPlan();
    } else {
        await forceMonthlyPlan();
    }
}

async function forceWeeklyPlan() {
    const forceBtn = document.getElementById('force-plan-btn');
    const calRunBtn = document.getElementById('btn-run-current-plan');
    const originalText = forceBtn ? forceBtn.innerHTML : '⚡ PLAN SEMANAL IA';
    
    if (forceBtn) {
        forceBtn.classList.add('btn-loading');
        forceBtn.innerHTML = '<span class="spinner-icon"></span> INVESTIGANDO Y PLANIFICANDO...';
    }
    if (calRunBtn) {
        calRunBtn.disabled = true;
        calRunBtn.innerHTML = '<span class="spinner-icon"></span> Generando...';
    }

    addThought('AutoPilot', '🔍 Investigando tendencias del mercado e internet con Grounding y consultando memoria histórica...');
    updateStatus('INVESTIGANDO_IA', 'active');

    try {
        const response = await fetch(`${API_BASE}/bot/force-plan-week`, { method: 'POST' });
        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Error desconocido al generar plan semanal');
        }

        const count = result.result?.length || result.schedule?.length || 0;
        addThought('System', `✅ Plan semanal generado con éxito (${count} publicaciones enriquecidas con rutinas de precios y noticias).`);
        
        // Refrescar calendario si está visible
        await renderCalendar();
        alert(`¡Plan semanal con IA generado con éxito! (${count} publicaciones programadas con investigación en vivo).`);
    } catch (e) {
        console.error('Error en forceWeeklyPlan:', e);
        addThought('System', `❌ Error generando plan semanal: ${e.message}`);
        alert('Error generando plan semanal: ' + e.message);
    } finally {
        if (forceBtn) {
            forceBtn.classList.remove('btn-loading');
            forceBtn.innerHTML = originalText;
        }
        if (calRunBtn) {
            calRunBtn.disabled = false;
            calRunBtn.innerHTML = '⚡ GENERAR PLAN AHORA';
        }
        updateStatus('SYSTEM ONLINE', 'idle');
    }
}

async function forceMonthlyPlan() {
    const calRunBtn = document.getElementById('btn-run-current-plan');
    if (calRunBtn) {
        calRunBtn.disabled = true;
        calRunBtn.innerHTML = '<span class="spinner-icon"></span> Generando mes...';
    }

    addThought('AutoPilot', '📅 Planificando el mes completo según los formatos permitidos...');
    updateStatus('PLANIFICANDO_MES', 'active');

    try {
        const response = await fetch(`${API_BASE}/bot/force-plan`, { method: 'POST' });
        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Error al generar plan mensual');
        }

        addThought('System', '✅ Calendario del mes completo generado con éxito.');
        await renderCalendar();
        alert('¡Calendario mensual generado con éxito!');
    } catch (e) {
        console.error('Error en forceMonthlyPlan:', e);
        addThought('System', `❌ Error generando plan mensual: ${e.message}`);
        alert('Error generando plan mensual: ' + e.message);
    } finally {
        if (calRunBtn) {
            calRunBtn.disabled = false;
            calRunBtn.innerHTML = '⚡ GENERAR PLAN AHORA';
        }
        updateStatus('SYSTEM ONLINE', 'idle');
    }
}

/* ============================================
   REVISOR MECÁNICO DE TEXTO IG (MODAL)
   ============================================ */

function openCaptionReviewerModal() {
    const modal = document.getElementById('caption-reviewer-modal');
    if (modal) {
        modal.style.display = 'flex';
        const input = document.getElementById('caption-review-input');
        if (input) {
            input.addEventListener('input', updateCaptionStats);
            updateCaptionStats();
        }
    }
}

function closeCaptionReviewerModal() {
    const modal = document.getElementById('caption-reviewer-modal');
    if (modal) modal.style.display = 'none';
}

function updateCaptionStats() {
    const input = document.getElementById('caption-review-input');
    const charEl = document.getElementById('caption-char-count');
    const tagEl = document.getElementById('caption-tag-count');
    const warnEl = document.getElementById('caption-review-warnings');

    if (!input) return;
    const text = input.value || '';
    const charCount = text.length;
    const hashtags = (text.match(/#[a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]+/g) || []);
    const tagCount = hashtags.length;

    if (charEl) charEl.textContent = charCount;
    if (tagEl) tagEl.textContent = tagCount;

    if (warnEl) {
        let warnings = [];
        if (charCount > 2200) warnings.push('⚠️ Supera el límite máximo de Instagram (2.200 caracteres).');
        if (tagCount > 5) warnings.push(`ℹ️ Recomendación algoritmo: Usar un máximo de 5 hashtags precisos (actual: ${tagCount}).`);
        if (text.includes('http://') || text.includes('https://')) {
            warnings.push('ℹ️ Los enlaces no son clickeables en captions de feed (usa "enlace en bio").');
        }
        warnEl.innerHTML = warnings.map(w => `<div style="font-size:0.75rem; color:#ffb74d; margin-top:4px;">${w}</div>`).join('');
    }
}

function pasteFromCurrentPost() {
    const promptInput = document.getElementById('prompt-input');
    const reviewInput = document.getElementById('caption-review-input');
    if (promptInput && reviewInput) {
        reviewInput.value = promptInput.value;
        updateCaptionStats();
    }
}

function analyzeCaptionInput() {
    updateCaptionStats();
    alert('Análisis de texto completado. Revisa las recomendaciones bajo el campo de texto.');
}

function openDayEditorModalForPost(postId) {
    closeExperimentsModal();
    const schedule = currentSchedule || [];
    const entry = schedule.find(e => e.postId === postId);
    if (entry) {
        openCalendar();
        openDayEditor(entry.day);
    } else {
        alert('Detalle de publicación ID: ' + postId);
    }
}
