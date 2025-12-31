using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using PreClear.Api.Data;
using PreClear.Api.Interfaces;
using PreClear.Api.Models;

namespace PreClear.Api.Repositories
{
    public class DocumentRepository : IDocumentRepository
    {
        private readonly PreclearDbContext _db;
        public DocumentRepository(PreclearDbContext db) => _db = db;

        public async Task<ShipmentDocument> AddAsync(ShipmentDocument doc)
        {
            _db.ShipmentDocuments.Add(doc);
            await _db.SaveChangesAsync();
            return doc;
        }

        /// <summary>
        /// Gets all documents for a shipment. Only returns non-deleted documents since 
        /// deleted documents are physically removed from the database.
        /// This ensures AI validation only processes currently existing documents.
        /// NOW: Also filters by IsActive to return only active (non-replaced) documents.
        /// </summary>
        public async Task<List<ShipmentDocument>> GetByShipmentIdAsync(long shipmentId)
        {
            return await _db.ShipmentDocuments
                .AsNoTracking()
                .Where(d => d.ShipmentId == shipmentId && d.IsActive)
                .OrderByDescending(d => d.UploadedAt)
                .ToListAsync();
        }

        /// <summary>
        /// Finds an existing active document for a given shipment and document type.
        /// Used for document replacement logic.
        /// </summary>
        public async Task<ShipmentDocument?> FindActiveDocumentByTypeAsync(long shipmentId, string documentType)
        {
            return await _db.ShipmentDocuments
                .FirstOrDefaultAsync(d => d.ShipmentId == shipmentId 
                    && d.DocumentType == documentType 
                    && d.IsActive);
        }

        public async Task<ShipmentDocument?> FindAsync(long id)
        {
            return await _db.ShipmentDocuments.FindAsync(id);
        }

        public async Task<ShipmentDocument?> GetByIdAsync(long id)
        {
            return await _db.ShipmentDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id);
        }

        public async Task UpdateAsync(ShipmentDocument doc)
        {
            _db.ShipmentDocuments.Update(doc);
            await _db.SaveChangesAsync();
        }

        public async Task<int> DeleteByShipmentIdAsync(long shipmentId)
        {
            var docs = await _db.ShipmentDocuments.Where(d => d.ShipmentId == shipmentId).ToListAsync();
            if (docs.Count == 0)
            {
                return 0;
            }

            _db.ShipmentDocuments.RemoveRange(docs);
            return await _db.SaveChangesAsync();
        }

        public async Task<bool> MarkAsUploadedAsync(long shipmentId, string documentName)
        {
            var doc = await _db.ShipmentDocuments
                .FirstOrDefaultAsync(d => d.ShipmentId == shipmentId && d.FileName == documentName);
            
            if (doc == null) return false;
            
            doc.UploadedAt = System.DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return true;
        }

        public async Task<bool> DeleteByIdAsync(long id)
        {
            var doc = await _db.ShipmentDocuments.FindAsync(id);
            if (doc == null) return false;

            _db.ShipmentDocuments.Remove(doc);
            await _db.SaveChangesAsync();
            return true;
        }

        public async Task<DocumentRequest> CreateDocumentRequestAsync(DocumentRequest request)
        {
            _db.DocumentRequests.Add(request);
            await _db.SaveChangesAsync();
            return request;
        }

        public async Task<List<DocumentRequest>> GetDocumentRequestsByShipmentAsync(long shipmentId)
        {
            return await _db.DocumentRequests
                .AsNoTracking()
                .Where(r => r.ShipmentId == shipmentId)
                .OrderByDescending(r => r.CreatedAt)
                .ToListAsync();
        }
    }
}
