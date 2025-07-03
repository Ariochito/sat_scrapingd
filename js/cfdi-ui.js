// cfdi-ui.js
import { $, mostrarSpinner, debugLog, clearDebug, showToast } from './core.js';
import { loginSat, logoutSat, statusSat, searchCfdi, downloadCfdi, retryPendingCfdi } from './cfdi-api.js';

let satSessionErrorCount = 0;
const SAT_SESSION_ERROR_MSG = "expected to have the session registered";
const SAT_SESSION_INACTIVE_MSG = "No hay sesión activa SAT para este RFC";
const SAT_SESSION_MAX_RETRIES = 3;

window.debugMode = false; // global for debugLog
let metadatosCFDI = [];
let sesionActiva = false;
let pendientesDescarga = [];
let lastDownloadFormData = null;
let lastDownloadType = 'xml';
const descargadosSet = new Set();
const pendientesSet = new Set();

// Nuevo sistema de cola persistente
let colaDescarga = {
    total: 0,
    descargados: 0,
    pendientes: [],
    enProceso: false,
    intentos: 0,
    maxIntentos: 5,
    configuracion: {
        chunkSize: 30,
        maxReintentos: 5,
        delayInicial: 2000,
        autoRetry: true
    }
};

// Al cargar, los botones deben estar todos deshabilitados, incluido logout
$("logoutSatBtn").disabled = true;
$("buscarBtn").disabled = true;
$("descargarTodosBtn").disabled = true;
$("buscarDescargarBtn").disabled = true;

// ==============================
// SISTEMA DE COLA Y PERSISTENCIA
// ==============================

function guardarColaEnLocalStorage() {
    try {
        localStorage.setItem('cfdi_cola_descarga', JSON.stringify({
            cola: colaDescarga,
            pendientes: pendientesDescarga
        }));
    } catch (e) {
        console.warn('No se pudo guardar la cola en localStorage:', e);
    }
}

function cargarColaDeLocalStorage() {
    try {
        const colaGuardada = localStorage.getItem('cfdi_cola_descarga');
        if (colaGuardada) {
            const data = JSON.parse(colaGuardada);
            const colaData = data.cola || {};
            const pendData = data.pendientes || [];
            if (colaData.pendientes && colaData.pendientes.length > 0) {
                colaDescarga = { ...colaDescarga, ...colaData };
                pendientesDescarga = pendData;
                pendData.forEach(u => pendientesSet.add(u));
                mostrarPanelDescarga();
                return true;
            }
        }
    } catch (e) {
        console.warn('Error al cargar cola de localStorage:', e);
    }
    return false;
}

function limpiarColaStorage() {
    localStorage.removeItem('cfdi_cola_descarga');
    colaDescarga = {
        total: 0,
        descargados: 0,
        pendientes: [],
        enProceso: false,
        intentos: 0,
        maxIntentos: 5,
        configuracion: {
            chunkSize: 30,
            maxReintentos: 5,
            delayInicial: 2000,
            autoRetry: true
        }
    };
    pendientesDescarga = [];
    pendientesSet.clear();
}

// ==============================
// PANEL DE CONTROL DE DESCARGA
// ==============================

function mostrarPanelDescarga() {
    let panel = document.getElementById('panelDescarga');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'panelDescarga';
        panel.className = 'card mt-3 border-primary';
        $("resultados").appendChild(panel);
    }
    
    const porcentaje = colaDescarga.total > 0 ? Math.round((colaDescarga.descargados / colaDescarga.total) * 100) : 0;
    const estado = colaDescarga.enProceso ? 'Descargando...' : 
                  colaDescarga.pendientes.length === 0 ? 'Completado' : 'Pausado';
    
    panel.innerHTML = `
        <div class="card-header bg-primary text-white">
            <h6 class="mb-0">
                <i class="fas fa-download"></i> Control de Descarga Masiva
                <span class="badge bg-light text-dark ms-2">${estado}</span>
            </h6>
        </div>
        <div class="card-body">
            <div class="row mb-3">
                <div class="col-md-8">
                    <div class="progress" style="height: 25px;">
                        <div class="progress-bar progress-bar-striped ${colaDescarga.enProceso ? 'progress-bar-animated' : ''}" 
                             style="width: ${porcentaje}%">
                            ${colaDescarga.descargados} / ${colaDescarga.total} (${porcentaje}%)
                        </div>
                    </div>
                    <small class="text-muted">
                        Pendientes: ${colaDescarga.pendientes.length} | 
                        Intentos: ${colaDescarga.intentos}/${colaDescarga.maxIntentos}
                    </small>
                </div>
                <div class="col-md-4 text-end">
                    ${colaDescarga.pendientes.length > 0 ? `
                        <button class="btn btn-sm btn-success me-1" id="reanudarDescarga"
                                ${colaDescarga.enProceso ? 'disabled' : ''}>
                            <i class="fas fa-play"></i> ${colaDescarga.enProceso ? 'Procesando...' : 'Reanudar'}
                        </button>
                        <button class="btn btn-sm btn-warning me-1" id="pausarDescarga"
                                ${!colaDescarga.enProceso ? 'disabled' : ''}>
                            <i class="fas fa-pause"></i> Pausar
                        </button>
                    ` : ''}
                    ${pendientesDescarga.length > 0 ? `
                        <button class="btn btn-sm btn-info me-1" id="descargarPendientes">
                            <i class="fas fa-redo"></i> Pendientes (${pendientesDescarga.length})
                        </button>
                    ` : ''}
                    <button class="btn btn-sm btn-secondary" id="configurarDescarga">
                        <i class="fas fa-cog"></i> Config
                    </button>
                    <button class="btn btn-sm btn-danger" id="cancelarDescarga">
                        <i class="fas fa-times"></i> Cancelar
                    </button>
                </div>
            </div>
            
            ${colaDescarga.pendientes.length > 0 ? `
                <div class="alert alert-info mb-2">
                    <strong>Archivos pendientes:</strong> ${colaDescarga.pendientes.length} CFDIs por descargar
                    ${colaDescarga.configuracion.autoRetry ? '<br><i class="fas fa-sync"></i> Reintentos automáticos activados' : ''}
                </div>
            ` : colaDescarga.descargados > 0 ? `
                <div class="alert alert-success mb-2">
                    <i class="fas fa-check"></i> <strong>¡Descarga completada!</strong> 
                    Se descargaron ${colaDescarga.descargados} archivos correctamente.
                </div>
            ` : ''}
        </div>
    `;
    
    // Agregar event listeners
    $("reanudarDescarga")?.addEventListener('click', reanudarDescarga);
    $("pausarDescarga")?.addEventListener('click', pausarDescarga);
    $("configurarDescarga")?.addEventListener('click', mostrarConfiguracionDescarga);
    $("cancelarDescarga")?.addEventListener('click', cancelarDescarga);
    $("descargarPendientes")?.addEventListener('click', reintentarFaltantes);
}

function mostrarConfiguracionDescarga() {
    // Si existe, lo quitamos para evitar duplicados
    const anterior = document.getElementById('configModal');
    if (anterior) anterior.remove();

    // Crea estilos animados y modernos
    if (!document.getElementById('customConfigModalCSS')) {
        const style = document.createElement('style');
        style.id = 'customConfigModalCSS';
        style.innerHTML = `
            .modal-content {
                border-radius: 1.2rem;
                box-shadow: 0 10px 40px 0 #0003;
                border: none;
                animation: bounceIn .7s cubic-bezier(.87,-.41,.19,1.44);
            }
            .modal-header {
                background: linear-gradient(87deg, #9adcfb 0, #d1f7c4 100%);
                border-top-left-radius: 1.2rem;
                border-top-right-radius: 1.2rem;
            }
            .modal-title i {
                animation: spin 2s linear infinite;
                margin-right: 7px;
            }
            @keyframes spin {
                0% {transform: rotate(0deg);}
                100% {transform: rotate(359deg);}
            }
            @keyframes bounceIn {
                0% {transform: scale(.6);opacity: 0;}
                100% {transform: scale(1);opacity: 1;}
            }
            .preview-value {
                font-weight: bold;
                color: #20a720;
                margin-left: 10px;
            }
            .modal .tip-hover {
                position: absolute;
                background: #222c;
                color: #fff;
                padding: 6px 12px;
                border-radius: 7px;
                font-size: 1em;
                pointer-events: none;
                opacity: 0;
                transition: opacity .2s;
                z-index: 5000;
            }
        `;
        document.head.appendChild(style);
    }

    // Modal principal
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = 'configModal';
    modal.tabIndex = -1;
    modal.setAttribute('aria-labelledby', 'configModalLabel');
    modal.innerHTML = `
        <div class="modal-dialog">
            <div class="modal-content position-relative">
                <div class="modal-header">
                    <h5 class="modal-title" id="configModalLabel">
                        <i class="fas fa-cogs"></i>
                        Configuración de Descarga
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body pb-0">
                    <div class="mb-3 position-relative">
                        <label class="form-label">Tamaño de chunk (archivos por lote)
                            <span class="preview-value" id="previewChunk">${colaDescarga.configuracion.chunkSize}</span>
                        </label>
                        <input type="number" class="form-control" id="configChunkSize"
                            value="${colaDescarga.configuracion.chunkSize}" min="10" max="100" data-tip="Determina cuántos CFDI se descargan por intento. Valores bajos = más seguro.">
                    </div>
                    <div class="mb-3 position-relative">
                        <label class="form-label">Máximo reintentos por lote
                            <span class="preview-value" id="previewReintentos">${colaDescarga.configuracion.maxReintentos}</span>
                        </label>
                        <input type="number" class="form-control" id="configMaxReintentos"
                            value="${colaDescarga.configuracion.maxReintentos}" min="1" max="20" data-tip="¿Cuántos reintentos automáticos quieres por error de descarga?">
                    </div>
                    <div class="mb-3 position-relative">
                        <label class="form-label">Delay inicial (ms)
                            <span class="preview-value" id="previewDelay">${colaDescarga.configuracion.delayInicial}</span>
                        </label>
                        <input type="number" class="form-control" id="configDelay"
                            value="${colaDescarga.configuracion.delayInicial}" min="1000" max="10000" step="500" data-tip="A mayor delay, menos riesgo de bloqueo temporal del SAT.">
                    </div>
                    <div class="mb-3 form-check position-relative">
                        <input class="form-check-input" type="checkbox" id="configAutoRetry"
                            ${colaDescarga.configuracion.autoRetry ? 'checked' : ''} data-tip="Activa para que el sistema intente recuperar automáticamente errores menores.">
                        <label class="form-check-label" for="configAutoRetry">
                            Reintentos automáticos
                        </label>
                    </div>
                    <div class="tip-hover" id="configTip"></div>
                </div>
                <div class="modal-footer pb-3 pt-3">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                    <button type="button" class="btn btn-primary" id="guardarConfig">
                        <span id="guardarIcon" class="fas fa-save"></span> Guardar
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Bootstrap
    const modalInstance = new bootstrap.Modal(modal, { backdrop: 'static', keyboard: true });
    modalInstance.show();

    // Preview en vivo y tips UX
    const chunk = modal.querySelector("#configChunkSize");
    const reint = modal.querySelector("#configMaxReintentos");
    const delay = modal.querySelector("#configDelay");
    const autoR = modal.querySelector("#configAutoRetry");
    chunk.addEventListener('input', e => modal.querySelector("#previewChunk").textContent = e.target.value);
    reint.addEventListener('input', e => modal.querySelector("#previewReintentos").textContent = e.target.value);
    delay.addEventListener('input', e => modal.querySelector("#previewDelay").textContent = e.target.value);

    // Tips flotantes
    const tip = modal.querySelector('#configTip');
    [chunk, reint, delay, autoR].forEach(el => {
        el.addEventListener('mouseenter', e => {
            tip.textContent = el.dataset.tip;
            tip.style.left = (el.getBoundingClientRect().left - modal.getBoundingClientRect().left + 40) + "px";
            tip.style.top = (el.getBoundingClientRect().top - modal.getBoundingClientRect().top - 5) + "px";
            tip.style.opacity = 1;
        });
        el.addEventListener('mouseleave', () => { tip.style.opacity = 0; });
        el.addEventListener('focus', e => {
            tip.textContent = el.dataset.tip;
            tip.style.left = (el.getBoundingClientRect().left - modal.getBoundingClientRect().left + 40) + "px";
            tip.style.top = (el.getBoundingClientRect().top - modal.getBoundingClientRect().top - 5) + "px";
            tip.style.opacity = 1;
        });
        el.addEventListener('blur', () => { tip.style.opacity = 0; });
    });

    // Guardar configuración con animación de botón
    modal.querySelector('#guardarConfig').addEventListener('click', () => {
        const btn = modal.querySelector('#guardarConfig');
        const icon = modal.querySelector('#guardarIcon');
        icon.className = "fas fa-spinner fa-spin";
        btn.setAttribute("disabled", true);

        setTimeout(() => { // Simula guardado y UX
            colaDescarga.configuracion.chunkSize = parseInt(chunk.value);
            colaDescarga.configuracion.maxReintentos = parseInt(reint.value);
            colaDescarga.configuracion.delayInicial = parseInt(delay.value);
            colaDescarga.configuracion.autoRetry = autoR.checked;
            guardarColaEnLocalStorage();
            mostrarPanelDescarga();
            icon.className = "fas fa-check";
            showToast('¡Configuración guardada!', 'success');
            setTimeout(() => modalInstance.hide(), 500);
        }, 700);
    });

    // Limpia el modal del DOM al cerrarse
    modal.addEventListener('hidden.bs.modal', () => {
        modal.remove();
    });
}

// ==============================
// MOTOR DE DESCARGA ROBUSTO
// ==============================

async function procesarColaDescarga() {
    while (colaDescarga.pendientes.length > 0 && colaDescarga.enProceso) {
        const loteSize = Math.min(colaDescarga.configuracion.chunkSize, colaDescarga.pendientes.length);
        const loteActual = colaDescarga.pendientes.splice(0, loteSize);

        mostrarPanelDescarga();

        let pendientesLote = [...loteActual];
        let exitososTotal = [];
        let intentosLote = 0;

        while (pendientesLote.length > 0 && intentosLote < 3) {
            intentosLote++;
            try {
                const response = await retryPendingCfdi(
                    pendientesLote,
                    lastDownloadFormData,
                    lastDownloadType,
                    {
                        maxReintentos: colaDescarga.configuracion.maxReintentos,
                        chunkSize: Math.min(pendientesLote.length, 20),
                        delayInicial: colaDescarga.configuracion.delayInicial
                    }
                );

                if (response.error) {
                    if (await handleSatSessionError(response.error)) continue;
                    throw new Error(response.error);
                }

                exitososTotal = exitososTotal.concat(response.descargados || []);
                pendientesLote = response.noDescargados || [];
            } catch (error) {
                if (await handleSatSessionError(error.message)) continue;
                if (intentosLote >= 3) break;
            }
        }

        colaDescarga.descargados += exitososTotal.length;
        exitososTotal.forEach(uuid => {
            descargadosSet.add(uuid);
            pendientesSet.delete(uuid);
        });
        marcarFilasDescarga(exitososTotal, true);

        if (pendientesLote.length > 0) {
            pendientesLote.forEach(uuid => {
                pendientesSet.add(uuid);
            });
            pendientesDescarga = pendientesDescarga.concat(pendientesLote.filter(u => !pendientesDescarga.includes(u)));
            marcarFilasDescarga(pendientesLote, false);
        }

        guardarColaEnLocalStorage();

        if (colaDescarga.enProceso) {
            await sleep(1000);
        }
    }

    if (colaDescarga.pendientes.length === 0 && pendientesDescarga.length === 0) {
        showToast(`¡Descarga completada! Se descargaron ${colaDescarga.descargados} archivos.`, 'success');
        setTimeout(() => {
            limpiarColaStorage();
            document.getElementById('panelDescarga')?.remove();
        }, 5000);
    } else if (colaDescarga.pendientes.length === 0 && pendientesDescarga.length > 0) {
        showToast('Descarga finalizada con pendientes por revisar', 'warning');
    }
}

// ==============================
// FUNCIONES DE DESCARGA MEJORADAS
// ==============================

async function iniciarDescargaMasiva(uuids, formData, downloadType = 'xml') {
    if (!sesionActiva) {
        showToast('Primero debe iniciar sesión en el SAT', "warning");
        return;
    }
    
    // Filtrar los ya descargados
    const uuidsPendientes = uuids.filter(u => !descargadosSet.has(u));
    
    if (uuidsPendientes.length === 0) {
        showToast('Todos estos CFDI ya fueron descargados', 'info');
        return;
    }

    pendientesSet.clear();
    pendientesDescarga = [];

    // Configurar cola
    colaDescarga.total = uuidsPendientes.length;
    colaDescarga.descargados = 0;
    colaDescarga.pendientes = [...uuidsPendientes];
    colaDescarga.enProceso = true;
    colaDescarga.intentos = 0;
    
    lastDownloadFormData = formData;
    lastDownloadType = downloadType;
    
    guardarColaEnLocalStorage();
    mostrarPanelDescarga();
    
    showToast(`Iniciando descarga de ${uuidsPendientes.length} archivos...`, 'info');
    
    try {
        await procesarColaDescarga();
    } catch (error) {
        showToast('Error en descarga masiva: ' + error.message, 'danger');
    } finally {
        colaDescarga.enProceso = false;
        mostrarPanelDescarga();
        guardarColaEnLocalStorage();
    }
}



// ==============================
// UTILIDADES GENERALES
// ==============================

function obtenerDatosFormulario() {
    const tipo = $("tipo").value;
    const data = {
        rfc: $("rfc").value.trim().toUpperCase(),
        tipo: tipo,
        estado: $("estado").value,
        complemento: $("complemento").value,
        rfcFiltro: $("rfcFiltro").value.trim().toUpperCase(),
        rfcTerceros: $("rfcTerceros").value.trim().toUpperCase()
    };
    if (tipo === 'recibidas') {
        data.mesPeriodo = $("mesPeriodo").value;
        data.anioPeriodo = $("anioPeriodo").value;
    } else {
        data.fechaInicio = $("fechaInicio").value;
        data.fechaFin = $("fechaFin").value;
    }
    return data;
}

function diasEntreFechas(fechaInicio, fechaFin) {
    const d1 = new Date(fechaInicio);
    const d2 = new Date(fechaFin);
    return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
}

function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}

function limpiarBarraDeDescarga() {
    document.querySelectorAll('.descarga-progress, #barraDescargaCFDI').forEach(el => el.remove());
}

function marcarFilasDescarga(uuids, exito) {
    uuids.forEach(uuid => {
        const row = document.querySelector(`tr[data-uuid="${uuid}"]`);
        if (row) {
            if (exito) {
                row.classList.remove('table-warning');
                row.classList.add('table-success');
            } else {
                row.classList.remove('table-success');
                row.classList.add('table-warning');
            }
        }
    });
}

// ==============================
// VISUALIZACIÓN DE PROGRESO
// ==============================

function mostrarBarraDescarga(total, actual) {
    let barra = document.getElementById("barraDescargaCFDI");
    if (!barra) {
        const div = document.createElement("div");
        div.innerHTML = `
            <div class="progress my-3" id="barraDescargaCFDI">
                <div class="progress-bar progress-bar-striped progress-bar-animated" 
                    id="barraDescargaCFDIBar" style="width:0%">0 / ${total}</div>
            </div>
        `;
        $("resultados").appendChild(div.firstElementChild);
        barra = document.getElementById("barraDescargaCFDI");
    }
    const bar = document.getElementById("barraDescargaCFDIBar");
    const porcentaje = Math.round((actual / total) * 100);
    bar.style.width = `${porcentaje}%`;
    bar.innerText = `${actual} / ${total}`;
    if (actual >= total) setTimeout(() => barra.remove(), 2500);
}

function mostrarProgresoChunk(actual, total, msg) {
    $("resultados").innerHTML = `
        <div class="alert alert-info mb-2">
            <strong>${msg}</strong><br>
            Chunk <b>${actual}</b> de <b>${total}</b>
            <div class="progress mt-2" style="height: 25px;">
                <div class="progress-bar progress-bar-striped progress-bar-animated" 
                    role="progressbar" 
                    style="width: ${(actual / total) * 100}%;">
                    ${actual} / ${total}
                </div>
            </div>
        </div>
    `;
}

// ==============================
// TOOLTIP / N/D DATOS
// ==============================

function mostrarDato(valor, tooltip = "No disponible para este campo") {
    if (valor === undefined || valor === null || valor === "") {
        return `<span class="text-muted" data-bs-toggle="tooltip" title="${tooltip}">N/D</span>`;
    }
    return valor;
}

function limpiarTotal(valor) {
    if (!valor) return null;
    const limpio = valor.toString().replace(/[^0-9.]/g, '');
    const num = parseFloat(limpio);
    return isNaN(num) ? null : num;
}

// ==============================
// UI BARRAS Y ESTADO
// ==============================

function mostrarBarraBusqueda() {
    $("resultados").innerHTML = `
        <div class="progress mb-3">
            <div class="progress-bar progress-bar-striped progress-bar-animated" style="width: 100%">
                Buscando CFDI...
            </div>
        </div>`;
}

function mostrarEstadoSesion(activa, mensaje) {
    sesionActiva = activa;
    $("statusLogin").innerHTML = activa
        ? `<span class="badge bg-success">${mensaje}</span>`
        : `<span class="badge bg-danger">${mensaje}</span>`;
    $("buscarBtn").disabled = !activa;
    $("descargarTodosBtn").disabled = !activa;
    $("buscarDescargarBtn").disabled = !activa;
    $("logoutSatBtn").disabled = !activa;
}

// ==============================
// RENDER DE RESULTADOS
// ==============================

function mostrarResultados(data) {
    const { cfdis, total, mostrados, vigentes, cancelados, noIdentificados, avisos } = data;
    let html = `
        <div class="alert alert-info mb-3">
            <strong>Resumen:</strong> 
            Total encontrados: <span class="badge bg-primary">${total}</span> | 
            Vigentes: <span class="badge bg-success">${vigentes}</span> | 
            Cancelados: <span class="badge bg-danger">${cancelados}</span> | 
            No identificados: <span class="badge bg-warning text-dark">${noIdentificados}</span> |
            Mostrando: <strong>${mostrados}</strong>
        </div>
    `;

    if (avisos && avisos.length > 0) {
        html += `<div class="alert alert-warning">
            <strong>Avisos:</strong><br>
            ${avisos.map(aviso => `• ${aviso}`).join('<br>')}
        </div>`;
    }

    if (cfdis.length > 0) {
        html += `
            <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap">
                <div class="mb-2">
                    <button class="btn btn-outline-primary btn-sm me-2" id="seleccionarTodos">
                        Seleccionar todos
                    </button>
                    <button class="btn btn-outline-secondary btn-sm" id="deseleccionarTodos">
                        Deseleccionar todos
                    </button>
                </div>
                <div class="mb-2">
                    <select class="form-select form-select-sm d-inline-block w-auto" id="downloadType">
                        <option value="xml">XML</option>
                        <option value="pdf">PDF</option>
                    </select>
                    <button class="btn btn-primary btn-sm ms-2" id="descargarSeleccionados">
                        Descargar seleccionados
                    </button>
                </div>
            </div>
            <div class="table-responsive" style="max-height: 600px; overflow-x:auto;">
                <table class="table table-striped table-hover table-sticky" role="table">
                    <thead>
                        <tr>
                            <th class="checkbox-col"><input type="checkbox" id="checkboxMaster"></th>
                            <th>UUID</th>
                            <th>Emisor</th>
                            <th>Receptor</th>
                            <th>Fecha Emisión</th>
                            <th>Fecha Certificación</th>
                            <th>RFC PAC</th>
                            <th>Total</th>
                            <th>Tipo</th>
                            <th>Estado</th>
                            <th>Estatus Cancelación</th>
                            <th>Estatus Proceso</th>
                            <th>Fecha Cancelación</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        cfdis.forEach((cfdi) => {
            const estadoClass = cfdi.estado === 'Vigente' ? 'text-success' : 'text-danger';
            const totalFormateado = limpiarTotal(cfdi.total) !== null
                ? `$${limpiarTotal(cfdi.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                : mostrarDato(null, "Total no disponible");

            const rowClass = descargadosSet.has(cfdi.uuid) ? 'table-success' :
                              (pendientesSet.has(cfdi.uuid) ? 'table-warning' : '');

            html += `
                <tr data-uuid="${cfdi.uuid}" class="${rowClass}">
                    <td><input type="checkbox" class="cfdi-checkbox" data-uuid="${cfdi.uuid}"></td>
                    <td><small>${mostrarDato(cfdi.uuid, "UUID no disponible")}</small></td>
                    <td>
                        <strong>${mostrarDato(cfdi.emisor, "Emisor no disponible")}</strong><br>
                        <small>${mostrarDato(cfdi.nombreEmisor, "Nombre del emisor no disponible")}</small>
                    </td>
                    <td>
                        <strong>${mostrarDato(cfdi.receptor, "Receptor no disponible")}</strong><br>
                        <small>${mostrarDato(cfdi.nombreReceptor, "Nombre del receptor no disponible")}</small>
                    </td>
                    <td><small>${mostrarDato(cfdi.fechaEmision, "Fecha de emisión no disponible")}</small></td>
                    <td><small>${mostrarDato(cfdi.fechaCertificacion, "Fecha de certificación no disponible")}</small></td>
                    <td><small>${mostrarDato(cfdi.rfcPac, "RFC PAC no disponible")}</small></td>
                    <td><strong>${totalFormateado}</strong></td>
                    <td><small>${mostrarDato(cfdi.tipo, "Tipo de comprobante no disponible")}</small></td>
                    <td><span class="${estadoClass}">${mostrarDato(cfdi.estado, "El SAT no proporcionó el estado para este CFDI")}</span></td>
                    <td><small>${mostrarDato(cfdi.estatusCancelacion, "Estatus de cancelación no disponible")}</small></td>
                    <td><small>${mostrarDato(cfdi.estatusProceso, "Estatus de proceso no disponible")}</small></td>
                    <td><small>${mostrarDato(cfdi.fechaCancelacion, "Fecha de cancelación no disponible")}</small></td>
                </tr>
            `;
        });
        html += `
                    </tbody>
                </table>
            </div>
            ${pendientesDescarga.length > 0 ? `
                <div class="mt-2">
                    <button class="btn btn-sm btn-info" id="btnDescargarPendientesTabla">
                        Descargar pendientes (${pendientesDescarga.length})
                    </button>
                </div>
            ` : ''}
        `;
    } else {
        html += `<div class="alert alert-warning">No se encontraron CFDI con los criterios especificados.</div>`;
    }

    $("resultados").innerHTML = html;

    // Inicializa tooltips de Bootstrap solo si hay tabla
    if (cfdis.length > 0) {
        setupCheckboxEvents();
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
        document.getElementById('btnDescargarPendientesTabla')?.addEventListener('click', reintentarFaltantes);
    }
}

// ==============================
// CHECKBOX SETUP
// ==============================

function setupCheckboxEvents() {
    const checkboxMaster = $("checkboxMaster");
    const checkboxes = document.querySelectorAll(".cfdi-checkbox");
    checkboxMaster?.addEventListener('change', function () {
        checkboxes.forEach(cb => cb.checked = this.checked);
    });
    $("seleccionarTodos")?.addEventListener('click', () => {
        checkboxes.forEach(cb => cb.checked = true);
        if (checkboxMaster) checkboxMaster.checked = true;
    });
    $("deseleccionarTodos")?.addEventListener('click', () => {
        checkboxes.forEach(cb => cb.checked = false);
        if (checkboxMaster) checkboxMaster.checked = false;
    });
    $("descargarSeleccionados")?.addEventListener('click', descargarSeleccionados);
}

function obtenerUuidsSeleccionados() {
    return Array.from(document.querySelectorAll(".cfdi-checkbox:checked")).map(cb => cb.dataset.uuid);
}

// ==============================
// VALIDACIÓN DE INPUTS
// ==============================

$("rfc").addEventListener('input', function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 13);
});
$("ciec").addEventListener('input', function () {
    if (this.value.length > 8) this.value = this.value.substring(0, 8);
});
$("rfcFiltro").addEventListener('input', function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 13);
});
$("rfcTerceros").addEventListener('input', function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 13);
});

$("tipo").addEventListener('change', function () {
    if (this.value === "recibidas") {
        $("mesPeriodoGroup").style.display = "";
        $("anioPeriodoGroup").style.display = "";
        $("fechaInicioGroup").style.display = "none";
        $("fechaFinGroup").style.display = "none";
        $("labelRfcFiltro").textContent = "RFC Emisor";
    } else {
        $("mesPeriodoGroup").style.display = "none";
        $("anioPeriodoGroup").style.display = "none";
        $("fechaInicioGroup").style.display = "";
        $("fechaFinGroup").style.display = "";
        $("labelRfcFiltro").textContent = "RFC Receptor";
    }
});

// ==============================
// SESSION / LOGIN / LOGOUT
// ==============================

$("toggleDebugBtn").onclick = () => {
    window.debugMode = !window.debugMode;
    $("debugPanel").classList.toggle("d-none", !window.debugMode);
    if (window.debugMode) clearDebug();
};

$("loginSatBtn").onclick = async () => {
    const rfc = $("rfc").value.trim();
    const ciec = $("ciec").value.trim();
    if (!rfc || !ciec) { showToast('Por favor ingrese RFC y CIEC', "warning"); return; }
    mostrarSpinner(true);
    try {
        const response = await loginSat(rfc, ciec);
        if (response.success) {
            mostrarEstadoSesion(true, response.msg);
            showToast("Login exitoso: " + response.msg, "success");
        } else {
            mostrarEstadoSesion(false, 'Error de login');
            showToast("Error: " + (response.error || 'Login fallido'), "danger");
        }
    } catch (e) {
        mostrarEstadoSesion(false, 'Error de login');
        showToast("Error: " + e.message, "danger");
    } finally {
        mostrarSpinner(false);
    }
};

$("logoutSatBtn").onclick = async () => {
    const rfc = $("rfc").value.trim();
    if (!rfc) {
        showToast("Debes ingresar el RFC antes de cerrar sesión", "warning");
        return;
    }
    try {
        await logoutSat(rfc);
        mostrarEstadoSesion(false, 'Sesión cerrada');
        $("resultados").innerHTML = '';
        metadatosCFDI = [];
        showToast("Sesión cerrada", "info");
    } catch (e) {
        showToast("Error en logout: " + (e.message || e), "danger");
    }
};


// ==============================
// FUNCIONES DE BÚSQUEDA Y DESCARGA
// ==============================

async function buscarEnChunksPorDias(formData, diasPorChunk = 7, maxReintentos = 3) {
    const fechaInicioOriginal = new Date(formData.fechaInicio);
    const fechaFinOriginal = new Date(formData.fechaFin);
    let cfdisTotales = [];
    let primerResponse = null;
    let totalDias = diasEntreFechas(formData.fechaInicio, formData.fechaFin);
    let totalChunks = Math.ceil(totalDias / diasPorChunk);

    mostrarSpinner(true);

    for (let chunk = 0; chunk < totalChunks; chunk++) {
        let fechaInicioChunk = new Date(fechaInicioOriginal);
        fechaInicioChunk.setDate(fechaInicioOriginal.getDate() + chunk * diasPorChunk);

        let fechaFinChunk = new Date(fechaInicioChunk);
        fechaFinChunk.setDate(fechaFinChunk.getDate() + diasPorChunk - 1);

        if (fechaFinChunk > fechaFinOriginal) fechaFinChunk = new Date(fechaFinOriginal);

        let formDataChunk = { ...formData };
        formDataChunk.fechaInicio = fechaInicioChunk.toISOString().slice(0, 10);
        formDataChunk.fechaFin = fechaFinChunk.toISOString().slice(0, 10);

        let reintentos = 0;
        let exitoChunk = false;
        let response = null;

        mostrarProgresoChunk(chunk + 1, totalChunks, `Buscando CFDIs del ${formDataChunk.fechaInicio} al ${formDataChunk.fechaFin} (Intento ${reintentos + 1})...`);
        while (reintentos < maxReintentos && !exitoChunk) {
            try {
                response = await searchCfdi(formDataChunk);
                if (response && !response.error) {
                    if (!primerResponse) primerResponse = response;
                    cfdisTotales = cfdisTotales.concat(response.cfdis || []);
                    exitoChunk = true;
                } else {
                    if (response.error && response.error.includes("Connection error")) {
                        showToast(`Chunk ${chunk + 1} falló conexión con el SAT, reintentando...`, "danger");
                        await sleep(2000);
                        reintentos++;
                    } else {
                        showToast(`Error en chunk ${chunk + 1}: ${response.error}`, "danger");
                        reintentos = maxReintentos;
                    }
                }
            } catch (e) {
                showToast(`Error en chunk ${chunk + 1}: ${e.message}`, "danger");
                await sleep(5000);
                reintentos++;
            }
        }

        if (!exitoChunk) {
            showToast(`Chunk ${chunk + 1} falló tras ${maxReintentos} intentos. Consulta tu conexión o espera un rato.`, "danger");
            break;
        }
        await sleep(1200);
    }

    mostrarSpinner(false);

    if (cfdisTotales.length > 0) {
        mostrarResultados({ ...primerResponse, cfdis: cfdisTotales, total: cfdisTotales.length, mostrados: cfdisTotales.length });
        showToast("¡Búsqueda masiva completada!", "success");
    } else {
        $("resultados").innerHTML = `<div class="alert alert-warning">No se encontraron CFDI en el rango solicitado.</div>`;
    }
}

async function descargarEnChunks(uuids, formData, chunkSize = 50) {
     uuids = uuids.filter(u => !descargadosSet.has(u));
    if (uuids.length === 0) {
        showToast('No hay CFDI nuevos para descargar', 'info');
        return;
    }
    let total = uuids.length, descargados = 0;
    mostrarBarraDescarga(total, 0);
    for (let i = 0; i < uuids.length; i += chunkSize) {
        const chunk = uuids.slice(i, i + chunkSize);
        await realizarDescarga(chunk, formData);
        descargados += chunk.length;
        mostrarBarraDescarga(total, descargados);
        await sleep(1000);
    }
    showToast("¡Descarga por lotes finalizada!", "success");
}

async function buscarYDescargarEnChunksPorDias(data, diasPorChunk = 7, reintentos = 2, chunkSize = 50) {
    let fechaActual = new Date(data.fechaInicio);
    const fechaFin = new Date(data.fechaFin);
    let allCfdis = [];

    mostrarSpinner(true);
    mostrarBarraBusqueda();
    try {
        while (fechaActual <= fechaFin) {
            let fechaChunkFin = new Date(fechaActual);
            fechaChunkFin.setDate(fechaChunkFin.getDate() + diasPorChunk - 1);
            if (fechaChunkFin > fechaFin) fechaChunkFin = new Date(fechaFin);

            const chunkData = { ...data };
            chunkData.fechaInicio = fechaActual.toISOString().slice(0, 10);
            chunkData.fechaFin = fechaChunkFin.toISOString().slice(0, 10);

            let response = null;
            for (let intento = 0; intento < reintentos; intento++) {
                response = await searchCfdi(chunkData);
                if (!response.error) break;
                await sleep(3000);
            }
            if (response && response.cfdis && response.cfdis.length) {
                allCfdis = allCfdis.concat(response.cfdis);
            }
            fechaActual.setDate(fechaChunkFin.getDate() + 1);
        }

        metadatosCFDI = allCfdis;
        mostrarResultados({ ...data, cfdis: allCfdis, total: allCfdis.length, mostrados: allCfdis.length });

        if (allCfdis.length > 0 && confirm(`¿Desea descargar todos los ${allCfdis.length} CFDI encontrados?`)) {
            const uuids = allCfdis.map(cfdi => cfdi.uuid);
            const downloadType = data.downloadType || 'xml';
            await iniciarDescargaMasiva(uuids, data, downloadType);
        }

    } catch (e) {
        $("resultados").innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
        showToast(e.message, "danger");
    } finally {
        mostrarSpinner(false);
    }
}

// Función legacy mantenida para compatibilidad - ahora usa el nuevo sistema
async function reintentarFaltantes() {
    if (pendientesDescarga.length > 0) {
        const uuids = [...pendientesDescarga];
        await iniciarDescargaMasiva(uuids, lastDownloadFormData, lastDownloadType);
        pendientesDescarga = [];
        pendientesSet.clear();
    }
}

async function descargarSeleccionados() {
    const uuids = obtenerUuidsSeleccionados();
    if (uuids.length === 0) return showToast('Seleccione al menos un CFDI para descargar', "warning");
    if (uuids.length > 50) {
        await descargarEnChunks(uuids, obtenerDatosFormulario(), 50);
    } else {
        await realizarDescarga(uuids, obtenerDatosFormulario());
    }
}

// Función legacy actualizada para usar el nuevo sistema
async function realizarDescarga(uuids, formData) {
    const downloadType = $("downloadType")?.value || 'xml';
    await iniciarDescargaMasiva(uuids, formData, downloadType);
}

// ==============================
// MANEJO DE ERRORES SAT
// ==============================

async function handleSatSessionError(errorMsg, retryCallback) {
    if (errorMsg && (errorMsg.includes(SAT_SESSION_ERROR_MSG) || errorMsg.includes(SAT_SESSION_INACTIVE_MSG))) {
        satSessionErrorCount++;
        if (satSessionErrorCount >= SAT_SESSION_MAX_RETRIES) {
            mostrarEstadoSesion(false, "Sesión expirada");
            satSessionErrorCount = 0;
        }
        return true;
    }

    if (satSessionErrorCount >= SAT_SESSION_MAX_RETRIES) {
        showToast("No fue posible validar la sesión con el SAT tras varios intentos. Por favor, vuelve a iniciar sesión.", "danger");
        mostrarEstadoSesion(false, "Sesión expirada");
        satSessionErrorCount = 0;
        return true;
    }

    const rfc = $("rfc").value.trim();
    const ciec = $("ciec").value.trim();
    if (rfc && ciec) {
        satSessionErrorCount++;
        try {
            const loginResp = await loginSat(rfc, ciec);
            if (loginResp.success) {
                mostrarEstadoSesion(true, loginResp.msg);
                satSessionErrorCount = 0;
                if (retryCallback) return await retryCallback();
                return true;
            }
            showToast("Error al reingresar al SAT. Verifica RFC y CIEC.", "warning");
        } catch (e) {
            showToast("Error al reingresar al SAT: " + e.message, "warning");
        }
         satSessionErrorCount = SAT_SESSION_MAX_RETRIES;
        return true;
    }
    showToast("La sesión del SAT expiró. Ingresa nuevamente tus credenciales.", "danger");
    mostrarEstadoSesion(false, "Sesión expirada");
    satSessionErrorCount = SAT_SESSION_MAX_RETRIES;
    return true;
}

// ==============================
// LISTENERS PRINCIPALES
// ==============================

$("buscarBtn").onclick = async () => {
    if (!sesionActiva) return showToast('Primero debe iniciar sesión en el SAT', "warning");
    const data = obtenerDatosFormulario();
    mostrarSpinner(true);
    mostrarBarraBusqueda();
    try {
        let response = await searchCfdi(data);
        if (response.error) {
            const retry = async () => {
                const retryResp = await searchCfdi(data);
                if (retryResp.error) {
                    $("resultados").innerHTML = `<div class=\"alert alert-danger\">Error en búsqueda: ${retryResp.error}</div>`;
                    showToast(retryResp.error, "danger");
                } else {
                    metadatosCFDI = retryResp.cfdis || [];
                    mostrarResultados(retryResp);
                }
            };
            if (await handleSatSessionError(response.error, retry)) return;
            $("resultados").innerHTML = `<div class=\"alert alert-danger\">Error en búsqueda: ${response.error}</div>`;
            showToast(response.error, "danger");
            return;
        }
        metadatosCFDI = response.cfdis || [];
        mostrarResultados(response);
    } catch (e) {
        $("resultados").innerHTML = `<div class=\"alert alert-danger\">Error: ${e.message}</div>`;
        showToast(e.message, "danger");
    } finally {
        mostrarSpinner(false);
    }
};

$("descargarTodosBtn").onclick = async () => {
    if (!sesionActiva) return showToast('Primero debe iniciar sesión en el SAT', "warning");
    if (metadatosCFDI.length === 0) return showToast('Primero debe realizar una búsqueda', "warning");
    if (!confirm(`¿Desea descargar todos los ${metadatosCFDI.length} CFDI encontrados?`)) return;
    const uuids = metadatosCFDI.map(cfdi => cfdi.uuid);
    const downloadType = $("downloadType")?.value || 'xml';
    await iniciarDescargaMasiva(uuids, obtenerDatosFormulario(), downloadType);
};


$("buscarDescargarBtn").onclick = async () => {
    if (!sesionActiva) return showToast('Primero debe iniciar sesión en el SAT', "warning");
    const data = obtenerDatosFormulario();

    if (data.tipo === "emitidas" && diasEntreFechas(data.fechaInicio, data.fechaFin) > 7) {
        await buscarYDescargarEnChunksPorDias(data, 7, 2, 50);
        return;
    }

    mostrarSpinner(true);
    mostrarBarraBusqueda();
    try {
        let response = await searchCfdi(data);
        if (response.error) {
            const retry = await handleSatSessionError(response.error, () => searchCfdi(data));
            if (retry === true) return;
            if (retry) response = retry;
            if (response.error) {
                $("resultados").innerHTML = `<div class="alert alert-danger">Error en búsqueda: ${response.error}</div>`;
                showToast(response.error, "danger");
                return;
            }

        }
        metadatosCFDI = response.cfdis || [];
        mostrarResultados(response);

        if (metadatosCFDI.length > 0 && confirm(`¿Desea descargar todos los ${metadatosCFDI.length} CFDI encontrados?`)) {
            const uuids = metadatosCFDI.map(cfdi => cfdi.uuid);
            const downloadType = $("downloadType")?.value || 'xml';
            await iniciarDescargaMasiva(uuids, data, downloadType);
        }
    } catch (e) {
        $("resultados").innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
        showToast(e.message, "danger");
    } finally {
        mostrarSpinner(false);
    }
};

// ==============================
// ESTADO DE SESIÓN AL CARGAR
// ==============================

window.onload = async () => {
    // Siempre deshabilita todos los botones al arrancar
    $("logoutSatBtn").disabled = true;
    $("buscarBtn").disabled = true;
    $("descargarTodosBtn").disabled = true;
    $("buscarDescargarBtn").disabled = true;

    // Cargar cola de descarga pendiente si existe
    const colaRestaurada = cargarColaDeLocalStorage();
    if (colaRestaurada) {
        showToast('Se detectaron descargas pendientes. Use el panel de control para continuar.', 'info');
    }

    const rfc = $("rfc").value.trim();
    if (rfc) {
        try {
            const response = await statusSat(rfc);
            mostrarEstadoSesion(response.active, response.msg);
        } catch {
            mostrarEstadoSesion(false, 'Sin sesión');
        }
    } else {
        mostrarEstadoSesion(false, 'Ingrese RFC para verificar sesión');
    }
};

