// cfdi-api.js
import { debugLog, showToast } from './core.js';

const API_URL = '../api/index.php'; // ruta real según tu estructura

export async function makeRequest(data) {
    debugLog("Making request", data);
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(data)
        });
        debugLog("Response status", response.status);

        const text = await response.text();
        debugLog("Response text", text);

        let json;
        try { json = JSON.parse(text); }
        catch (e) {
            debugLog("JSON parse error", e.message);
            showToast("Respuesta NO JSON del servidor", "danger");
            throw new Error(`Respuesta NO JSON del servidor: ${text}`);
        }
        debugLog("Parsed JSON", json);
        return json;

    } catch (error) {
        debugLog("Request error", error.message);
        showToast("Error de comunicación con el servidor", "danger");
        throw error;
    }
}

export async function loginSat(rfc, ciec) {
    return await makeRequest({ action: 'login', rfc, ciec });
}
export async function logoutSat(rfc) {
    return await makeRequest({ action: 'logout', rfc });
}
export async function statusSat(rfc) {
    return await makeRequest({ action: 'status', rfc });
}
export async function searchCfdi(filters) {
    return await makeRequest({ ...filters, action: 'search' });
}
export async function downloadCfdi(uuids, filters, downloadType) {
    return await makeRequest({ ...filters, action: 'download', selectedUuids: uuids, downloadType });
}

export async function retryPendingCfdi(pendingUuids, filters, downloadType, options = {}) {
    const requestData = { 
        ...filters, 
        action: 'retryPending', 
        pendingUuids, 
        downloadType,
        ...options
    };
    return await makeRequest(requestData);
}
