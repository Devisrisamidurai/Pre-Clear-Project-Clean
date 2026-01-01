namespace PreClear.Api.Interfaces
{
    public interface IAiService
    {
        System.Threading.Tasks.Task<PreClear.Api.Models.AiResultDto> AnalyzeAsync(string description);
        System.Threading.Tasks.Task<System.Collections.Generic.List<PreClear.Api.Services.AiService.HsSuggestion>> SuggestHsAsync(string name, string category, string description, int k = 5);
        System.Threading.Tasks.Task<PreClear.Api.Services.AiService.DocumentPredictionResponse> SuggestDocumentsAsync(PreClear.Api.Services.AiService.DocumentPredictionRequest request);
        System.Threading.Tasks.Task<PreClear.Api.Models.AiResultDto> PredictRequiredDocumentsAsync(
            string originCountry,
            string destinationCountry,
            string hsCode,
            bool? htsFlag,
            string productCategory,
            string productDescription,
            string packageTypeWeight,
            string modeOfTransport,
            int pythonPort = 9000,
            int timeoutSeconds = 10);
    }
}
