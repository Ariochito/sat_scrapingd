// core.js
export const $ = id => document.getElementById(id);

export function mostrarSpinner(show) {
    $("spinner")?.classList.toggle("d-none", !show);
}

export function debugLog(message, data = null) {
    if (window.debugMode) {
        const timestamp = new Date().toLocaleTimeString();
        const debugContent = $("debugContent");
        const entry = document.createElement('div');
        entry.innerHTML = `<strong>${timestamp}:</strong> ${message}${data ? '<br>' + JSON.stringify(data, null, 2) : ''}`;
        debugContent.appendChild(entry);
        console.log(message, data);
    }
}

export function clearDebug() {
    $("debugContent").innerHTML = '';
}

// Toast notifications bonitas con Bootstrap
export function showToast(mensaje, tipo = "info", tiempo = 4000) {
    // tipo: info, success, danger, warning
    const container = document.getElementById('toastContainer');
    const toastId = 'toast-' + Date.now();
    const colors = {
        info:   'bg-info text-white',
        success:'bg-success text-white',
        danger: 'bg-danger text-white',
        warning:'bg-warning text-dark'
    };
    const html = `
    <div id="${toastId}" class="toast align-items-center ${colors[tipo] || ''}" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body">${mensaje}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html);
    const toastElem = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElem, { delay: tiempo });
    toast.show();
    toastElem.addEventListener('hidden.bs.toast', () => toastElem.remove());
}
