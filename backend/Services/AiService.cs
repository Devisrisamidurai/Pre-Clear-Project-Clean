using System;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using PreClear.Api.Data;
using PreClear.Api.Interfaces;
using PreClear.Api.Models;

namespace PreClear.Api.Services
{
    using System.Net.Http;
    using System.Net.Http.Json;
    using System.Collections.Generic;

    public class AiService : IAiService
    {
        private readonly IAiRepository _repo;
        private readonly ILogger<AiService> _logger;
        private readonly IHttpClientFactory _httpFactory;

        public AiService(IAiRepository repo, ILogger<AiService> logger, IHttpClientFactory httpFactory)
        {
            _repo = repo;
            _logger = logger;
            _httpFactory = httpFactory;
        }

        public async Task<AiResultDto> AnalyzeAsync(string description)
        {
            if (string.IsNullOrWhiteSpace(description))
            {
                return new AiResultDto { HsCode = string.Empty, Confidence = 0.0, ComplianceRisk = false, Restrictions = Array.Empty<string>(), Suggestions = Array.Empty<string>(), Notes = "empty_input" };
            }

            // Simulate work on a background thread to keep API responsive
            var result = await Task.Run(() => RunHeuristics(description));

            try
            {
                // persist a finding for audit (non-blocking integrity)
                var finding = new AiFinding
                {
                    ShipmentId = 0,
                    Message = $"HS:{result.HsCode}; Risk:{result.ComplianceRisk}; Notes:{result.Notes}",
                    SuggestedAction = result.Suggestions != null && result.Suggestions.Length > 0 ? string.Join(";", result.Suggestions) : null,
                    Details = JsonDocument.Parse(JsonSerializer.Serialize(result)),
                    Severity = result.ComplianceRisk ? Severity.warning : Severity.info
                };

                await _repo.SaveFindingAsync(finding);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to persist AI finding (non-fatal)");
            }

            return result;
        }
        public class DocumentRequirement
        {
            public required string Name { get; set; }
            public double Confidence { get; set; }
            public required string Provenance { get; set; }
            public required string Description { get; set; }
            public required string RegulatoryBasis { get; set; }
        }

        public class DocumentPredictionRequest
        {
            public required string ProductName { get; set; }
            public required string Category { get; set; }
            public required string ProductDescription { get; set; }
            public required string HsCode { get; set; }
            public required string OriginCountry { get; set; }
            public required string DestinationCountry { get; set; }
            public required string PackageType { get; set; }
            public double Weight { get; set; }
            public double DeclaredValue { get; set; }
            public required string ShipmentType { get; set; }
            public required string ServiceLevel { get; set; }
        }

        public class DocumentPredictionResponse
        {
            public required string ShipmentId { get; set; }
            public required List<DocumentRequirement> PredictedDocuments { get; set; }
            public required string Mode { get; set; }
            public required string ModelVersion { get; set; }
            public required string Timestamp { get; set; }
            public double ConfidenceThreshold { get; set; }
        }

        public async Task<DocumentPredictionResponse> SuggestDocumentsAsync(DocumentPredictionRequest request)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }

            var client = _httpFactory?.CreateClient() ?? new HttpClient();
            var payload = new
            {
                product_name = request.ProductName ?? string.Empty,
                category = request.Category ?? string.Empty,
                product_description = request.ProductDescription ?? string.Empty,
                hs_code = request.HsCode ?? string.Empty,
                origin_country = request.OriginCountry ?? string.Empty,
                destination_country = request.DestinationCountry ?? string.Empty,
                package_type = request.PackageType ?? string.Empty,
                weight = request.Weight,
                declared_value = request.DeclaredValue,
                shipment_type = request.ShipmentType ?? string.Empty,
                service_level = request.ServiceLevel ?? string.Empty,
            };

            try
            {
                var resp = await client.PostAsJsonAsync("http://localhost:8002/predict-documents", payload);
                if (!resp.IsSuccessStatusCode)
                {
                    _logger.LogWarning("Document recommendation service returned {Status}", resp.StatusCode);
                    return new DocumentPredictionResponse
                    {
                        ShipmentId = "unknown",
                        PredictedDocuments = new List<DocumentRequirement>(),
                        Mode = "error",
                        ModelVersion = "unknown",
                        Timestamp = DateTime.UtcNow.ToString("O"),
                        ConfidenceThreshold = 0.5
                    };
                }

                var result = await resp.Content.ReadFromJsonAsync<DocumentPredictionResponse>();
                return result ?? new DocumentPredictionResponse
                {
                    ShipmentId = "unknown",
                    PredictedDocuments = new List<DocumentRequirement>(),
                    Mode = "ml",
                    ModelVersion = "unknown",
                    Timestamp = DateTime.UtcNow.ToString("O"),
                    ConfidenceThreshold = 0.5
                };
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to call document recommendation service");
                return new DocumentPredictionResponse
                {
                    ShipmentId = "unknown",
                    PredictedDocuments = new List<DocumentRequirement>(),
                    Mode = "error",
                    ModelVersion = "unknown",
                    Timestamp = DateTime.UtcNow.ToString("O"),
                    ConfidenceThreshold = 0.5
                };
            }
        }

        // Response contract for Python FastAPI documents endpoint
        private class RequiredDocumentsResponse
        {
            public required List<string> Required_Documents { get; set; }
        }

        // Calls Python FastAPI /predict-documents and returns AI-predicted documents only
        public async Task<AiResultDto> PredictRequiredDocumentsAsync(
            string originCountry,
            string destinationCountry,
            string hsCode,
            bool? htsFlag,
            string productCategory,
            string productDescription,
            string packageTypeWeight,
            string modeOfTransport,
            int pythonPort = 8002,
            int timeoutSeconds = 10)
        {
            var client = _httpFactory?.CreateClient() ?? new HttpClient();
            client.Timeout = TimeSpan.FromSeconds(timeoutSeconds);

            var payload = new
            {
                origin_country = originCountry ?? string.Empty,
                destination_country = destinationCountry ?? string.Empty,
                hs_code = hsCode ?? string.Empty,
                hts_flag = htsFlag ?? false,
                product_category = productCategory ?? string.Empty,
                product_description = productDescription ?? string.Empty,
                package_type_weight = packageTypeWeight ?? string.Empty,
                mode_of_transport = modeOfTransport ?? string.Empty,
            };

            try
            {
                var url = $"http://localhost:{pythonPort}/predict-documents";
                var resp = await client.PostAsJsonAsync(url, payload);

                if (!resp.IsSuccessStatusCode)
                {
                    var body = await resp.Content.ReadAsStringAsync();
                    throw new HttpRequestException($"Documents service error {(int)resp.StatusCode}: {body}");
                }

                // Read response { required_documents: [..] }
                using var stream = await resp.Content.ReadAsStreamAsync();
                using var doc = await JsonDocument.ParseAsync(stream);
                if (!doc.RootElement.TryGetProperty("required_documents", out var arr) || arr.ValueKind != JsonValueKind.Array)
                {
                    throw new InvalidOperationException("Invalid response format: missing required_documents array");
                }

                var docs = new List<string>();
                foreach (var el in arr.EnumerateArray())
                {
                    if (el.ValueKind == JsonValueKind.String)
                    {
                        var value = el.GetString();
                        if (value != null)
                            docs.Add(value);
                    }
                }

                // Map strictly to AI outputs: place documents into Suggestions
                return new AiResultDto
                {
                    HsCode = string.Empty,
                    Confidence = 0,
                    ComplianceRisk = false,
                    Restrictions = Array.Empty<string>(),
                    Suggestions = docs.ToArray(),
                    Notes = "documents_prediction"
                };
            }
            catch (TaskCanceledException ex)
            {
                // Timeout handling
                throw new TimeoutException("Documents service timed out", ex);
            }
            catch (HttpRequestException)
            {
                throw;
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"Documents prediction failed: {ex.Message}", ex);
            }
        }

        private AiResultDto RunHeuristics(string text)
        {
            var t = text.ToLowerInvariant();

            // Look for explicit HS code
            var m = Regex.Match(text, "\\b(\\d{6,8})\\b");
            if (m.Success)
            {
                return new AiResultDto
                {
                    HsCode = m.Value,
                    Confidence = 0.98,
                    ComplianceRisk = t.Contains("battery") || t.Contains("lithium") || t.Contains("dangerous"),
                    Restrictions = Array.Empty<string>(),
                    Suggestions = new[] { "Verify origin", "Confirm packing" },
                    Notes = "extracted_explicit_hs"
                };
            }

            string hs = "000000";
            double confidence = 0.4;
            bool risk = false;
            var restrictions = new System.Collections.Generic.List<string>();
            var suggestions = new System.Collections.Generic.List<string>();

            if (t.Contains("laptop") || t.Contains("computer") || t.Contains("electronics"))
            {
                hs = "847130";
                confidence = 0.75;
                suggestions.Add("Classify as electronics");
            }
            else if (t.Contains("shirt") || t.Contains("t-shirt") || t.Contains("clothing"))
            {
                hs = "610910";
                confidence = 0.72;
                suggestions.Add("Provide fiber composition");
            }
            else if (t.Contains("chocolate") || t.Contains("cocoa") || t.Contains("food"))
            {
                hs = "1806";
                confidence = 0.65;
                suggestions.Add("Check sanitary certificates");
            }
            else if (t.Contains("battery") || t.Contains("lithium"))
            {
                hs = "850760";
                confidence = 0.9;
                risk = true;
                restrictions.Add("Dangerous goods declaration required");
                suggestions.Add("Use approved battery packaging");
            }
            else
            {
                hs = "000000";
                confidence = 0.35;
                suggestions.Add("Provide more detailed description");
            }

            if (risk) restrictions.Add("May be restricted or require permits");

            return new AiResultDto
            {
                HsCode = hs,
                Confidence = confidence,
                ComplianceRisk = risk,
                Restrictions = restrictions.ToArray(),
                Suggestions = suggestions.ToArray(),
                Notes = "heuristic_analysis"
            };
        }

        public class HsSuggestion
        {
            public required string HsCode { get; set; }
            public required string Description { get; set; }
            public double Score { get; set; }
        }

        public class HsResponse
        {
            public required List<HsSuggestion> Suggestions { get; set; }
        }

        public async System.Threading.Tasks.Task<System.Collections.Generic.List<HsSuggestion>> SuggestHsAsync(string name, string category, string description, int k = 5)
        {
            var client = _httpFactory?.CreateClient() ?? new HttpClient();
            client.Timeout = TimeSpan.FromSeconds(6);

            var payload = new { name = name ?? string.Empty, category = category ?? string.Empty, description = description ?? string.Empty, k };
            try
            {
                var resp = await client.PostAsJsonAsync("http://localhost:8001/suggest-hs", payload);
                if (!resp.IsSuccessStatusCode)
                {
                    _logger.LogWarning("HS suggest service returned {Status}", resp.StatusCode);
                    return new List<HsSuggestion>();
                }

                var body = await resp.Content.ReadFromJsonAsync<HsResponse>();
                if (body?.Suggestions == null)
                {
                    _logger.LogWarning("HS suggest service returned null suggestions");
                    return new List<HsSuggestion>();
                }

                // Map fields (service returns hscode, description, score)
                var mapped = new List<HsSuggestion>();
                foreach (var s in body.Suggestions)
                {
                    if (!string.IsNullOrEmpty(s.HsCode) && !string.IsNullOrEmpty(s.Description))
                        mapped.Add(new HsSuggestion { HsCode = s.HsCode, Description = s.Description, Score = s.Score });
                }
                return mapped;
            }
            catch (TaskCanceledException tex)
            {
                _logger.LogWarning(tex, "HS suggest service timed out");
                return new List<HsSuggestion>();
            }
            catch (HttpRequestException hrex)
            {
                _logger.LogWarning(hrex, "HS suggest service unreachable");
                return new List<HsSuggestion>();
            }
            catch (System.Exception ex)
            {
                _logger.LogWarning(ex, "Failed to call HS suggestion service at localhost:8001/suggest-hs");
                return new List<HsSuggestion>();
            }
        }
    }
}

