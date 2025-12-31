using System.Collections.Generic;
using System.Threading.Tasks;
using PreClear.Api.Models;

namespace PreClear.Api.Interfaces
{
    public interface IDocumentRepository
    {
        Task<ShipmentDocument> AddAsync(ShipmentDocument doc);
        Task<List<ShipmentDocument>> GetByShipmentIdAsync(long shipmentId);
        Task<ShipmentDocument?> FindAsync(long id);
        Task<ShipmentDocument?> GetByIdAsync(long id);
        Task UpdateAsync(ShipmentDocument doc);
        Task<bool> MarkAsUploadedAsync(long shipmentId, string documentName);
        Task<int> DeleteByShipmentIdAsync(long shipmentId);
        Task<bool> DeleteByIdAsync(long id);
        Task<DocumentRequest> CreateDocumentRequestAsync(DocumentRequest request);
        Task<List<DocumentRequest>> GetDocumentRequestsByShipmentAsync(long shipmentId);
        Task<ShipmentDocument?> FindActiveDocumentByTypeAsync(long shipmentId, string documentType);
    }
}
