const API_BASE = 'http://localhost:3001/api';

let selectedType = 'single';
let selectedMedia = 'image';
let selectedRatio = '1:1';
let selectedEngine = 'remotion';
let selectedImageModel = 'google';
let attachedImages = []; // Array de { path: string, url: string, mode: string }
let audioFile = null; // Archivo de audio para audio-reel

document.addEventListener('DOMContentLoaded', () => {
    loadKnowledge();
    setupEventListeners();
    loadBotState();
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
            const nextPost = state.schedule.find(e => e.status === 'planned');
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

async function openCalendar() {
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
                const tagClass = `calendar-tag-${entry.format}`;
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
                            <span class="calendar-post-tag ${tagClass}" style="margin:0;">${entry.format.toUpperCase()}</span>
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

function openDayEditor(day) {
    editingDay = day;
    const editor = document.getElementById('day-editor');
    editor.classList.remove('hidden');

    const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const now = new Date();
    document.getElementById('day-editor-title').textContent = `${day} de ${monthNames[now.getMonth()]}`;

    const entries = currentSchedule.filter(e => e.day === day);
    let entry = entries.find(e => e.format !== 'price-story' && e.format !== 'news-post');
    if (!entry && entries.length > 0) entry = entries[0];

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

        // Mostrar botón GENERAR solo si el estado es 'planned'
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

        // Nueva entrada: mostrar botón GENERAR
        document.getElementById('generate-btn').style.display = 'none';
    }

    // Highlight del día seleccionado
    document.querySelectorAll('.calendar-day').forEach(c => c.classList.remove('calendar-day-selected'));
    const cells = document.querySelectorAll('.calendar-day:not(.calendar-day-empty)');
    cells.forEach(c => {
        const num = parseInt(c.querySelector('.calendar-day-number')?.textContent);
        if (num === day) c.classList.add('calendar-day-selected');
    });
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
        const res = await fetch(`${API_BASE}/bot/schedule/${editingDay}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        const data = await res.json();
        if (data.success) {
            await renderCalendar();
            openDayEditor(editingDay);
        }
    } catch (e) {
        console.error('Error guardando entrada:', e);
    }
}

async function deleteDayEntry() {
    if (!editingDay) return;
    if (!confirm(`¿Eliminar la planificación del día ${editingDay}?`)) return;

    try {
        const res = await fetch(`${API_BASE}/bot/schedule/${editingDay}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            closeDayEditor();
            await renderCalendar();
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
        const res = await fetch(`${API_BASE}/bot/execute/${editingDay}`, { method: 'POST' });
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
        const container = document.getElementById('knowledge-items');
        container.innerHTML = '';

        (data.urls || []).forEach(item => {
            const div = document.createElement('div');
            div.className = 'knowledge-item';
            const title = item.title || item.url || "URL Desconocida";
            const displayText = title.length > 25 ? title.substring(0, 25) + '...' : title;
            div.innerHTML = `
                <span title="${item.url}">[URL] ${displayText}</span>
                <button class="delete-btn" onclick="deleteKnowledge('url', ${item.id})">×</button>
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
                    <span>TIPO: ${post.contentType.toUpperCase()}</span><br>
                    <span>RATIO: ${post.aspectRatio || '1:1'}</span><br>
                    <small>${new Date(post.timestamp).toLocaleString()}</small>
                </div>
                <div class="archive-content-preview">
                    <div class="archive-text">${post.content?.text || post.content?.copy_facebook || 'Solo Gráfico'}</div>
                    <div class="archive-images">
                        ${(post.visuals || []).map(img => `<img src="${img}" onclick="window.open('${img}')">`).join('')}
                    </div>
                </div>
                <div class="archive-actions">
                    <button class="publish-archive-btn" onclick="restoreArchiveToMain('${post.id}')">🚀 RE-CARGAR</button>
                    <button class="publish-archive-btn" onclick="publishPost('${post.id}')">📸 PUBLISH</button>
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
            <div class="asset-thumb-container">
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
    if (!current) return;
    
    updateStatus('Optimizing...', 'processing');
    try {
        const response = await fetch(`${API_BASE}/ai/refine-prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: current })
        });
        const data = await response.json();
        document.getElementById('briefing-input').value = data.refined;
        addThought('Sugerencia', 'Briefing optimizado para máxima calidad visual y táctica.');
    } catch (e) {
        alert("Error al optimizar.");
    } finally {
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
    updateStatus('Thinking...', 'processing');
    try {
        const response = await fetch(`${API_BASE}/ai/suggest-idea`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                type: selectedType, 
                media: selectedMedia,
                aspectRatio: selectedRatio,
                engineMode: selectedEngine
            })
        });
        const data = await response.json();
        document.getElementById('briefing-input').value = data.briefing;
        addThought('Arquitecto', `Idea generada para ${selectedType}.`);
    } catch (e) {
        alert("No se pudo generar la idea.");
    } finally {
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
        // ── Reel con Remotion: mostrar el vídeo final como protagonista ──
        const videoWrap = document.createElement('div');
        videoWrap.style.cssText = 'position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:12px;';

        const video = document.createElement('video');
        video.src = data.video.url.startsWith('http') ? data.video.url : `http://localhost:3001${data.video.url}`;
        video.controls = true;
        video.loop = true;
        video.style.cssText = 'max-height:80%; max-width:100%; border-radius:12px; box-shadow:0 0 40px rgba(0,243,255,0.15);';
        videoWrap.appendChild(video);

        // Miniaturas de los fondos usados (referencia)
        if (data.visuals && data.visuals.length > 0) {
            const thumbsLabel = document.createElement('div');
            thumbsLabel.style.cssText = 'font-family:"JetBrains Mono",monospace; font-size:0.6rem; color:var(--accent); letter-spacing:2px; margin-top:6px;';
            thumbsLabel.textContent = 'SCENE_BACKGROUNDS';
            videoWrap.appendChild(thumbsLabel);

            const thumbsRow = document.createElement('div');
            thumbsRow.style.cssText = 'display:flex; gap:8px; overflow-x:auto; padding-bottom:4px;';
            data.visuals.forEach(src => {
                const thumb = document.createElement('img');
                thumb.src = src.startsWith('http') ? src : `http://localhost:3001${src}`;
                thumb.style.cssText = 'height:60px; width:auto; border-radius:6px; border:1px solid var(--border); flex-shrink:0; cursor:pointer; opacity:0.7; transition:opacity 0.2s;';
                thumb.onmouseover = () => { thumb.style.opacity = '1'; };
                thumb.onmouseleave = () => { thumb.style.opacity = '0.7'; };
                thumbsRow.appendChild(thumb);
            });
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
            <div style="margin-top:auto; padding-top:20px">
                <button class="primary-btn" style="width:100%" onclick="publishPost('${window._lastPostId}')">${hasRemotionVideo ? '🎬 PUBLICAR REEL' : (isCarousel ? '🎠 PUBLICAR CARRUSEL' : (isPriceStory ? '📊 PUBLICAR STORY PRECIOS' : (isNewsPost ? '📰 PUBLICAR NOTICIA' : '📸 PUBLICAR POST')))}</button>
            </div>
        `;
    }

    splitContainer.appendChild(visualSide);
    splitContainer.appendChild(textSide);
    viewer.appendChild(splitContainer);
}

async function publishPost(postId) {
    if (!postId || postId === 'null') {
        alert('❌ No se pudo identificar el post. Prueba a recargarlo desde el archivo.');
        return;
    }
    if (!confirm('¿Publicar este contenido en Instagram ahora?')) return;
    try {
        const response = await fetch(`${API_BASE}/publish/${postId}`, { method: 'POST' });
        const result = await response.json();
        if (result.mock) {
            alert('📋 Publicación SIMULADA (credenciales de Meta no configuradas).');
        } else if (result.success) {
            const type = result.mediaType === 'reel' ? '🎬 Reel' : '📸 Post';
            alert(`✅ ¡${type} publicado exitosamente!`);
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
        statusEl.textContent = 'CONFIGURADO';
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
