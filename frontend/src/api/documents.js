import http from './http';

export async function listShipmentDocuments(shipmentId) {
  const resp = await http.get(`/Documents/shipments/${shipmentId}/documents`);
  return resp.data;
}

export async function uploadShipmentDocument(shipmentId, file, docType = 'Other') {
  const form = new FormData();
  form.append('file', file);
  form.append('docType', docType);

  const resp = await http.post(`/Documents/shipments/${shipmentId}/upload`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return resp.data;
}

export async function markShipmentDocument(shipmentId, documentName) {
  const resp = await http.post(`/Documents/shipments/${shipmentId}/mark-uploaded`, {
    documentName,
  });
  return resp.data;
}

export async function downloadShipmentDocument(id) {
  const resp = await http.get(`/Documents/${id}/download`, { responseType: 'blob' });

  const disposition = resp.headers['content-disposition'] || resp.headers['Content-Disposition'];
  let fileName = `document-${id}`;
  if (disposition) {
    const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
    if (match) {
      fileName = decodeURIComponent(match[1] || match[2]);
    }
  }

  return { blob: resp.data, fileName };
}

export function saveBlobToFile(blob, fileName) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/**
 * Validates all documents for a shipment against form data and compliance rules
 * Returns validation result with status (approved/failed) and list of issues if any
 */
export async function validateShipmentDocuments(shipmentId) {
  const resp = await http.post(`/Documents/shipments/${shipmentId}/validate`);
  return resp.data;
}

/**
 * Gets the current validation status for a shipment
 * Returns status: not_validated, approved, failed, or error
 */
export async function getValidationStatus(shipmentId) {
  const resp = await http.get(`/Documents/shipments/${shipmentId}/validation-status`);
  return resp.data;
}

/**
 * Request additional documents from shipper for a shipment
 * @param {number} shipmentId - The shipment ID
 * @param {string[]} documentNames - Array of document names to request
 * @param {string} message - Message to shipper explaining the request
 */
export async function requestShipmentDocuments(shipmentId, documentNames, message) {
  const resp = await http.post(`/Documents/shipments/${shipmentId}/request-documents`, {
    documentNames,
    message
  });
  return resp.data;
}

/**
 * Get all document requests for a shipment
 * @param {number} shipmentId - The shipment ID
 */
export async function getDocumentRequests(shipmentId) {
  const resp = await http.get(`/Documents/shipments/${shipmentId}/document-requests`);
  return resp.data;
}

/**
 * Get document upload status for a shipment
 * Returns dictionary mapping documentType -> true (uploaded) or false (not uploaded)
 * @param {number} shipmentId - The shipment ID
 */
export async function getDocumentStatus(shipmentId) {
  const resp = await http.get(`/Shipments/${shipmentId}/documents/status`);
  return resp.data;
}
