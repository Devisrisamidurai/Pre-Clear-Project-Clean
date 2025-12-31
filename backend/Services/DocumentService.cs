using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using PreClear.Api.Interfaces;
using PreClear.Api.Models;

namespace PreClear.Api.Services
{
    public class DocumentService : IDocumentService
    {
        private readonly IDocumentRepository _repo;
        private readonly IShipmentRepository _shipmentRepo;
        private readonly IS3StorageService _storage;
        private readonly ILogger<DocumentService> _logger;
        private readonly INotificationService _notificationService;
        private static readonly HashSet<string> _allowedExt = new(StringComparer.OrdinalIgnoreCase)
        {
            ".pdf",
            ".jpg",
            ".jpeg",
            ".png",
            ".doc",
            ".docx",
            ".xls",
            ".xlsx",
            ".csv",
            ".txt"
        };

        public DocumentService(IDocumentRepository repo, IShipmentRepository shipmentRepo, IS3StorageService storage, ILogger<DocumentService> logger, INotificationService notificationService)
        {
            _repo = repo;
            _shipmentRepo = shipmentRepo;
            _storage = storage;
            _logger = logger;
            _notificationService = notificationService;
        }

        public async Task<ShipmentDocument> UploadAsync(long shipmentId, long? uploadedBy, IFormFile file, string docType)
        {
            if (file == null || file.Length == 0) throw new ArgumentException("file_required", nameof(file));

            var originalFileName = file.FileName;
            var ext = Path.GetExtension(originalFileName);
            if (string.IsNullOrWhiteSpace(ext) || !_allowedExt.Contains(ext))
                throw new ArgumentException("file_type_not_allowed", nameof(originalFileName));

            var shipment = await _shipmentRepo.GetByIdAsync(shipmentId);
            if (shipment == null)
                throw new ArgumentException("shipment_not_found", nameof(shipmentId));

            // CRITICAL: Check if there's an existing active document of the same type
            // If found, mark it as replaced (soft-delete) before uploading the new one
            var existingDoc = await _repo.FindActiveDocumentByTypeAsync(shipmentId, docType);

            var docFolder = SlugifyDocType(docType);
            var folder = $"shippers/{shipment.CreatedBy}/shipments/{shipmentId}/{docFolder}";

            string storedPath;

            try
            {
                // Primary path: upload to S3
                storedPath = await _storage.UploadFileAsync(file, folder);
            }
            catch (Exception ex)
            {
                // Fallback path: persist to local disk so uploads still work in dev/offline
                _logger.LogError(ex, "S3 upload failed, falling back to local storage for shipment {ShipmentId}", shipmentId);

                var localRoot = Path.Combine(Path.GetTempPath(), "preclear-docs", shipmentId.ToString());
                Directory.CreateDirectory(localRoot);
                var localName = $"{Guid.NewGuid()}{ext}";
                var localPath = Path.Combine(localRoot, localName);
                using (var fs = File.Create(localPath))
                {
                    await file.CopyToAsync(fs);
                }

                // Prefix with local: so downloader knows to read from disk
                storedPath = $"local:{localPath}";
            }

            var doc = new ShipmentDocument
            {
                ShipmentId = shipmentId,
                DocumentType = docType,
                FileName = Path.GetFileName(originalFileName),
                FilePath = storedPath,
                FileSize = file.Length,
                MimeType = file.ContentType,
                UploadedBy = uploadedBy,
                UploadedAt = DateTime.UtcNow,
                IsActive = true, // New document is active
                DownloadUrl = BuildDownloadUrlPlaceholder(0) // temporary placeholder, updated below
            };

            var created = await _repo.AddAsync(doc);
            created.DownloadUrl = BuildDownloadUrlPlaceholder(created.Id);

            // REPLACEMENT LOGIC: Mark the old document as replaced
            if (existingDoc != null)
            {
                existingDoc.IsActive = false;
                existingDoc.ReplacedByDocumentId = created.Id;
                existingDoc.ReplacedAt = DateTime.UtcNow;
                await _repo.UpdateAsync(existingDoc);
                _logger.LogInformation("Replaced document {OldDocId} with {NewDocId} for shipment {ShipmentId}, docType {DocType}",
                    existingDoc.Id, created.Id, shipmentId, docType);
            }

            // Check if this upload fulfills a document request
            var pendingRequests = await _repo.GetDocumentRequestsByShipmentAsync(shipmentId);
            var hasPendingRequests = pendingRequests.Any(r => r.Status == "pending");
            
            if (hasPendingRequests)
            {
                // Update shipment status to documents-uploaded when shipper responds to request
                shipment.Status = "documents-uploaded";
                shipment.BrokerApprovalStatus = "pending";
                shipment.UpdatedAt = DateTime.UtcNow;
                await _shipmentRepo.UpdateAsync(shipment);
                _logger.LogInformation("Updated shipment {ShipmentId} status to documents-uploaded", shipmentId);

                // Notify the broker who requested the documents (fallback to assigned broker)
                var targetBrokerId = pendingRequests.FirstOrDefault(r => r.Status == "pending")?.RequestedByBrokerId;
                if (!targetBrokerId.HasValue && shipment.AssignedBrokerId.HasValue)
                {
                    targetBrokerId = shipment.AssignedBrokerId.Value;
                }

                if (targetBrokerId.HasValue)
                {
                    try
                    {
                        await _notificationService.CreateNotificationAsync(
                            targetBrokerId.Value,
                            "documents_uploaded",
                            "Documents Uploaded",
                            $"Shipper has uploaded requested documents for shipment #{shipmentId}. Please review.",
                            shipmentId
                        );
                        _logger.LogInformation("Notified broker {BrokerId} about document upload for shipment {ShipmentId}", targetBrokerId.Value, shipmentId);
                    }
                    catch (Exception notifEx)
                    {
                        _logger.LogWarning(notifEx, "Failed to notify broker {BrokerId} about document upload for shipment {ShipmentId}", targetBrokerId.Value, shipmentId);
                    }
                }
            }

            _logger.LogInformation("Uploaded document {DocId} for shipment {ShipmentId} to storage path {Path}", created.Id, shipmentId, storedPath);
            return created;
        }

        public async Task<List<ShipmentDocument>> GetByShipmentIdAsync(long shipmentId)
        {
            var docs = await _repo.GetByShipmentIdAsync(shipmentId);
            foreach (var doc in docs)
            {
                doc.DownloadUrl = BuildDownloadUrlPlaceholder(doc.Id);
            }

            return docs;
        }

        public async Task<(ShipmentDocument? Document, Stream? Content, string? ContentType, string? FileName)> GetDocumentAsync(long id)
        {
            var doc = await _repo.FindAsync(id);
            if (doc == null) return (null, null, null, null);

            if (string.IsNullOrWhiteSpace(doc.FilePath))
            {
                return (doc, null, null, null);
            }

            // Detect local fallback path
            if (doc.FilePath.StartsWith("local:", StringComparison.OrdinalIgnoreCase))
            {
                var localPath = doc.FilePath.Substring("local:".Length);
                if (!File.Exists(localPath))
                {
                    return (doc, null, null, null);
                }

                var localStream = File.OpenRead(localPath);
                var localContentType = !string.IsNullOrWhiteSpace(doc.MimeType)
                    ? doc.MimeType
                    : GuessContentType(doc.FileName ?? localPath);
                var localName = string.IsNullOrWhiteSpace(doc.FileName)
                    ? Path.GetFileName(localPath)
                    : doc.FileName;

                return (doc, localStream, localContentType, localName);
            }

            try
            {
                var stream = await _storage.DownloadFileAsync(doc.FilePath);
                var contentType = !string.IsNullOrWhiteSpace(doc.MimeType)
                    ? doc.MimeType
                    : GuessContentType(doc.FileName ?? doc.FilePath);
                var fileName = string.IsNullOrWhiteSpace(doc.FileName)
                    ? Path.GetFileName(doc.FilePath)
                    : doc.FileName;

                return (doc, stream, contentType, fileName);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error downloading document {DocId} from S3", id);
                throw;
            }
        }

        public async Task<bool> MarkAsUploadedAsync(long shipmentId, string documentName)
        {
            return await _repo.MarkAsUploadedAsync(shipmentId, documentName);
        }

        public async Task<int> DeleteShipmentDocumentsAsync(long shipmentId)
        {
            var docs = await _repo.GetByShipmentIdAsync(shipmentId);
            if (docs == null || docs.Count == 0)
            {
                _logger.LogInformation("No documents to delete for shipment {ShipmentId}", shipmentId);
                return 0;
            }

            foreach (var doc in docs)
            {
                if (string.IsNullOrWhiteSpace(doc.FilePath))
                {
                    continue;
                }

                try
                {
                    await _storage.DeleteFileAsync(doc.FilePath);
                    _logger.LogInformation("Deleted S3 object {Key} for shipment {ShipmentId}", doc.FilePath, shipmentId);
                }
                catch (Exception ex)
                {
                    // Log and continue so we can attempt to remove remaining files and DB records
                    _logger.LogWarning(ex, "Failed to delete S3 object {Key} for shipment {ShipmentId}", doc.FilePath, shipmentId);
                }
            }

            var removed = await _repo.DeleteByShipmentIdAsync(shipmentId);
            _logger.LogInformation("Removed {Count} document records for shipment {ShipmentId}", removed, shipmentId);
            return removed;
        }

        public async Task<bool> DeleteDocumentAsync(long documentId)
        {
            var doc = await _repo.GetByIdAsync(documentId);
            if (doc == null)
            {
                _logger.LogWarning("Document {DocumentId} not found for deletion", documentId);
                return false;
            }

            bool s3DeleteSuccess = true;
            bool dbDeleteSuccess = false;

            // Delete from S3 if file path exists
            if (!string.IsNullOrWhiteSpace(doc.FilePath))
            {
                try
                {
                    await _storage.DeleteFileAsync(doc.FilePath);
                    _logger.LogInformation("Deleted S3 object {Key} for document {DocumentId}", doc.FilePath, documentId);
                }
                catch (Exception ex)
                {
                    s3DeleteSuccess = false;
                    _logger.LogError(ex, "Failed to delete S3 object {Key} for document {DocumentId}. Document will still be removed from database.", doc.FilePath, documentId);
                    // Continue to delete from database even if S3 deletion fails to prevent orphaned records
                }
            }

            // Delete from database
            try
            {
                dbDeleteSuccess = await _repo.DeleteByIdAsync(documentId);
                _logger.LogInformation("Deleted document {DocumentId} from database: {Success}", documentId, dbDeleteSuccess);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to delete document {DocumentId} from database", documentId);
                return false;
            }

            // Log if we have an inconsistent state
            if (!s3DeleteSuccess && dbDeleteSuccess)
            {
                _logger.LogWarning("Document {DocumentId} deleted from database but S3 object {Key} may still exist", documentId, doc.FilePath);
            }

            return dbDeleteSuccess;
        }

        private static string SlugifyDocType(string docType)
        {
            if (string.IsNullOrWhiteSpace(docType)) return "other";
            var cleaned = Regex.Replace(docType.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
            return string.IsNullOrWhiteSpace(cleaned) ? "other" : cleaned;
        }

        private static string GuessContentType(string fileName)
        {
            var ext = Path.GetExtension(fileName).ToLowerInvariant();
            return ext switch
            {
                ".pdf" => "application/pdf",
                ".jpg" => "image/jpeg",
                ".jpeg" => "image/jpeg",
                ".png" => "image/png",
                ".doc" => "application/msword",
                ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".xls" => "application/vnd.ms-excel",
                ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ".csv" => "text/csv",
                _ => "application/octet-stream",
            };
        }

        private static string BuildDownloadUrlPlaceholder(long id) =>
            id <= 0 ? "/api/documents/pending/download" : $"/api/documents/{id}/download";

        public async Task<DocumentRequest> RequestDocumentsAsync(long shipmentId, long brokerId, List<string> documentNames, string message)
        {
            try
            {
                var docNames = string.Join(", ", documentNames ?? new List<string>());
                _logger.LogInformation("RequestDocumentsAsync: Starting for shipment {ShipmentId}, broker {BrokerId}, docs: {DocNames}", shipmentId, brokerId, docNames);
                
                var request = new DocumentRequest
                {
                    ShipmentId = shipmentId,
                    RequestedByBrokerId = brokerId,
                    RequestedDocumentNames = docNames,
                    RequestMessage = message,
                    Status = "pending",
                    CreatedAt = DateTime.UtcNow
                };

                await _repo.CreateDocumentRequestAsync(request);
                _logger.LogInformation("Document request saved: ID={RequestId}, Shipment={ShipmentId}", request.Id, shipmentId);

                // Notify shipper (creator of the shipment)
                var shipment = await _shipmentRepo.GetByIdAsync(shipmentId);
                _logger.LogInformation("Shipment lookup: ShipmentId={ShipmentId}, Found={Found}", shipmentId, shipment != null);
                
                if (shipment != null)
                {
                    // Update shipment status to documents-requested
                    shipment.Status = "documents-requested";
                    shipment.BrokerApprovalStatus = "documents-requested";
                    shipment.UpdatedAt = DateTime.UtcNow;
                    await _shipmentRepo.UpdateAsync(shipment);
                    _logger.LogInformation("Updated shipment {ShipmentId} status to documents-requested", shipmentId);

                    var shipperId = shipment.CreatedBy;
                    var title = "Additional Documents Requested";
                    var messageText = string.IsNullOrWhiteSpace(message)
                        ? $"Broker requested: {docNames}"
                        : $"{message}\nRequested: {docNames}";
                    try
                    {
                        await _notificationService.CreateNotificationAsync(shipperId, "document_request", title, messageText, shipmentId);
                        _logger.LogInformation("Notification created for shipper {ShipperId}", shipperId);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to create notification for shipper {UserId} on shipment {ShipmentId}", shipperId, shipmentId);
                    }
                }
                else
                {
                    _logger.LogWarning("Shipment {ShipmentId} not found; skipping shipper notification", shipmentId);
                }

                return request;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "RequestDocumentsAsync failed for shipment {ShipmentId}", shipmentId);
                throw;
            }
        }

        public async Task<List<DocumentRequest>> GetDocumentRequestsAsync(long shipmentId)
        {
            var requests = await _repo.GetDocumentRequestsByShipmentAsync(shipmentId);
            _logger.LogInformation("Retrieved {Count} document requests for shipment {ShipmentId}", requests.Count, shipmentId);
            return requests;
        }

        /// <summary>
        /// Get document upload status for all expected document types
        /// Returns dictionary mapping documentType -> true (uploaded) or false (not uploaded)
        /// Handles both normalized keys (commercial_invoice) and display names (Commercial Invoice)
        /// </summary>
        public async Task<Dictionary<string, bool>> GetDocumentStatusByShipmentAsync(long shipmentId)
        {
            var documents = await GetByShipmentIdAsync(shipmentId);
            
            _logger.LogInformation("Checking document status for shipment {ShipmentId}, found {Count} documents", 
                shipmentId, documents.Count);
            
            // Log actual document types stored in database
            foreach (var doc in documents)
            {
                _logger.LogInformation("Found document: Type='{Type}', FileName='{FileName}', FilePath='{FilePath}'", 
                    doc.DocumentType, doc.FileName, doc.FilePath);
            }
            
            // Define expected document types for a shipment
            var expectedDocumentTypes = new[]
            {
                "commercial_invoice",
                "packing_list",
                "bill_of_lading",
                "certificates_of_origin",
                "product_documentation",
                "export_compliance",
                "insurance",
                "customs_declaration",
                "other"
            };

            var status = new Dictionary<string, bool>();
            foreach (var docType in expectedDocumentTypes)
            {
                // Normalize stored DocumentType for comparison (handles "Commercial Invoice" vs "commercial_invoice")
                var hasDocument = documents.Any(d => 
                {
                    var normalizedStored = d.DocumentType?.Replace(" ", "_").ToLowerInvariant() ?? "";
                    var normalizedExpected = docType.ToLowerInvariant();
                    var matches = normalizedStored == normalizedExpected && !string.IsNullOrEmpty(d.FilePath);
                    
                    if (matches)
                    {
                        _logger.LogInformation("Document type '{Stored}' matches expected '{Expected}'", 
                            d.DocumentType, docType);
                    }
                    
                    return matches;
                });
                
                status[docType] = hasDocument;
                _logger.LogInformation("Document type '{Type}': {Status}", docType, hasDocument ? "uploaded" : "missing");
            }

            _logger.LogInformation("Document status for shipment {ShipmentId}: {Status}", 
                shipmentId, string.Join(", ", status.Select(s => $"{s.Key}={s.Value}")));
            
            return status;
        }
    }
}
 
