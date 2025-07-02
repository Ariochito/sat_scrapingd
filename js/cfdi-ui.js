// cfdi-ui.js
import { $, mostrarSpinner, debugLog, clearDebug, showToast } from './core.js';
import { loginSat, logoutSat, statusSat, searchCfdi, downloadCfdi } from './cfdi-api.js';

let satSessionErrorCount = 0;
const SAT_SESSION_ERROR_MSG = "expected to have the session registered";
const SAT_SESSION_MAX_RETRIES = 3;

window.debugMode = false; // global for debugLog
let metadatosCFDI = [];
let sesionActiva = false;
// Al cargar, los botones deben estar todos deshabilitados, incluido logout
$("logoutSatBtn").disabled = true;
$("buscarBtn").disabled = true;
$("descargarTodosBtn").disabled = true;
$("buscarDescargarBtn").disabled = true;

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
            html += `
                <tr>
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
            await descargarEnChunks(uuids, data, chunkSize);
        }

    } catch (e) {
        $("resultados").innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
        showToast(e.message, "danger");
    } finally {
        mostrarSpinner(false);
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

async function realizarDescarga(uuids, formData) {
    if (!sesionActiva) return showToast('Primero debe iniciar sesión en el SAT', "warning");
    const downloadType = $("downloadType")?.value || 'xml';
    limpiarBarraDeDescarga();
    mostrarSpinner(true);
    const progressDiv = document.createElement('div');
    progressDiv.className = "descarga-progress";
    progressDiv.innerHTML = `
        <div class="alert alert-info">
            <strong>Descargando ${uuids.length} archivos...</strong>
            <div class="progress mt-2">
                <div class="progress-bar progress-bar-striped progress-bar-animated"
                     style="width: 100%" id="downloadProgress">
                    Preparando descarga...
                </div>
            </div>
        </div>`;
    $("resultados").appendChild(progressDiv);
    try {
        const response = await downloadCfdi(uuids, formData, downloadType);
        if (response.error) {
            if (await handleSatSessionError(response.error)) return;
            return showToast('Error en descarga: ' + response.error, "danger");
        }
        let msg = `<div class="alert alert-success"><strong>Descarga completada</strong><br>Mensaje: ${response.msg}`;
        if (response.descargados) {
            msg += '<br><strong>Archivos descargados por período:</strong><ul>';
            for (const [periodo, archivos] of Object.entries(response.descargados)) {
                msg += `<li>${periodo}: ${archivos.length} archivos</li>`;
            }
            msg += '</ul>';
        }
        if (response.avisos && response.avisos.length > 0) {
            msg += '<br><strong>Avisos:</strong><ul>';
            response.avisos.forEach(aviso => { msg += `<li>${aviso}</li>`; });
            msg += '</ul>';
        }
        msg += '</div>';
        progressDiv.innerHTML = msg;
        showToast("Descarga completada", "success");
    } catch (e) {
        progressDiv.innerHTML = `<div class="alert alert-danger">Error en descarga: ${e.message}</div>`;
        showToast(e.message, "danger");
        setTimeout(() => { progressDiv.remove(); }, 7000)
    } finally {
        mostrarSpinner(false);
    }
}

// ==============================
// MANEJO DE ERRORES SAT
// ==============================

async function handleSatSessionError(errorMsg, retryCb) {
    if (errorMsg && errorMsg.includes(SAT_SESSION_ERROR_MSG)) {
        satSessionErrorCount++;
        if (satSessionErrorCount < SAT_SESSION_MAX_RETRIES) {
            showToast("El SAT tardó en reconocer la sesión. Reintentando...", "warning");
            if (typeof retryCb === 'function') {
                await retryCb();
            }
            return true;
        } else {
            showToast("No fue posible validar la sesión con el SAT tras varios intentos. Por favor, vuelve a iniciar sesión.", "danger");
            mostrarEstadoSesion(false, "Sesión expirada");
            satSessionErrorCount = 0;
            return true;
        }
    }
    satSessionErrorCount = 0;
    return false;
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
    // Solo si tienes muchos, divídelos
    const CHUNK_SIZE = 200; // Puedes aumentar si el servidor aguanta más
    for (let i = 0; i < uuids.length; i += CHUNK_SIZE) {
        const chunk = uuids.slice(i, i + CHUNK_SIZE);
        await realizarDescarga(chunk, obtenerDatosFormulario());
        // Puedes agregar barra de progreso aquí si quieres
    }
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
        const response = await searchCfdi(data);
        if (response.error) {
            if (await handleSatSessionError(response.error)) return;
            $("resultados").innerHTML = `<div class="alert alert-danger">Error en búsqueda: ${response.error}</div>`;
            showToast(response.error, "danger");
            return;
        }
        metadatosCFDI = response.cfdis || [];
        mostrarResultados(response);

        if (metadatosCFDI.length > 0 && confirm(`¿Desea descargar todos los ${metadatosCFDI.length} CFDI encontrados?`)) {
            const uuids = metadatosCFDI.map(cfdi => cfdi.uuid);
            if (uuids.length > 50) {
                await descargarEnChunks(uuids, data, 50);
            } else {
                await realizarDescarga(uuids, data);
            }
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

