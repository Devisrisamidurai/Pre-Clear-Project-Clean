namespace backend.Interfaces;

public interface ITextractService
{
    Task<Dictionary<string, object>> ExtractShipmentDataFromDocumentsAsync(List<IFormFile> files);
}
