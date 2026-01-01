using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using PreClear.Api.Interfaces;
using PreClear.Api.Models;
using PreClear.Api.Services;

namespace PreClear.Api.AI.Services.DocumentValidator
{
    public class AiDocumentAnalyzer : IAiDocumentAnalyzer
    {
        private readonly IConfiguration _config;
        private readonly IHttpClientFactory _httpFactory;
        private readonly ILogger<AiDocumentAnalyzer> _logger;
        private readonly IComplianceValidationService _complianceService;

        public AiDocumentAnalyzer(
            IConfiguration config, 
            IHttpClientFactory httpFactory, 
            ILogger<AiDocumentAnalyzer> logger,
            IComplianceValidationService complianceService)
        {
            _config = config;
            _httpFactory = httpFactory;
            _logger = logger;
            _complianceService = complianceService;
        }

        public async Task<Dictionary<string, string>> ExtractFieldsAsync(string content, string documentType)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (string.IsNullOrWhiteSpace(content)) return result;

            var useAzure = !string.IsNullOrWhiteSpace(_config["AzureOpenAI:Endpoint"]) && !string.IsNullOrWhiteSpace(_config["AzureOpenAI:ApiKey"]) && !string.IsNullOrWhiteSpace(_config["AzureOpenAI:Deployment"]);
            var useOpenAi = !string.IsNullOrWhiteSpace(_config["OpenAI:ApiKey"]) && !string.IsNullOrWhiteSpace(_config["OpenAI:Model"]);

            if (!useAzure && !useOpenAi)
            {
                _logger.LogInformation("No LLM provider configured; skipping AI extraction and returning empty result.");
                return result;
            }

            var schema = new
            {
                invoice_number = "string",
                tracking_number = "string",
                weight_kg = "number",
                total_value = "number",
                hs_code = "string",
                origin_country = "string",
                destination_country = "string"
            };

            var systemPrompt = "You are an expert customs document parser. Extract key fields from the user-provided document text and respond ONLY with minified JSON matching the schema: {invoice_number,tracking_number,weight_kg,total_value,hs_code,origin_country,destination_country}. Use null when unknown. Do not include explanations.";
            var userPrompt = $"DocumentType: {documentType}\n---\n{content}\n---\nReturn JSON now.";

            try
            {
                var client = _httpFactory.CreateClient();
                string json;

                if (useAzure)
                {
                    var endpoint = _config["AzureOpenAI:Endpoint"]!.TrimEnd('/');
                    var deployment = _config["AzureOpenAI:Deployment"]!;
                    var apiKey = _config["AzureOpenAI:ApiKey"]!;
                    var url = $"{endpoint}/openai/deployments/{deployment}/chat/completions?api-version=2024-02-15-preview";

                    using var req = new HttpRequestMessage(HttpMethod.Post, url);
                    req.Headers.Add("api-key", apiKey);
                    var payload = new
                    {
                        messages = new object[]
                        {
                            new { role = "system", content = systemPrompt },
                            new { role = "user", content = userPrompt }
                        },
                        temperature = 0.0,
                        response_format = new { type = "json_object" }
                    };
                    req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                    var resp = await client.SendAsync(req);
                    resp.EnsureSuccessStatusCode();
                    using var stream = await resp.Content.ReadAsStreamAsync();
                    using var doc = await JsonDocument.ParseAsync(stream);
                    json = doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString() ?? "{}";
                }
                else
                {
                    var apiKey = _config["OpenAI:ApiKey"]!;
                    var model = _config["OpenAI:Model"]!;
                    using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
                    req.Headers.Add("Authorization", $"Bearer {apiKey}");
                    var payload = new
                    {
                        model,
                        messages = new object[]
                        {
                            new { role = "system", content = systemPrompt },
                            new { role = "user", content = userPrompt }
                        },
                        temperature = 0.0,
                        response_format = new { type = "json_object" }
                    };
                    req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                    var resp = await client.SendAsync(req);
                    resp.EnsureSuccessStatusCode();
                    using var stream = await resp.Content.ReadAsStreamAsync();
                    using var doc = await JsonDocument.ParseAsync(stream);
                    json = doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString() ?? "{}";
                }

                var parsed = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json) ?? new Dictionary<string, JsonElement>();
                foreach (var kv in parsed)
                {
                    try
                    {
                        switch (kv.Value.ValueKind)
                        {
                            case JsonValueKind.String:
                                result[kv.Key] = kv.Value.GetString() ?? string.Empty;
                                break;
                            case JsonValueKind.Number:
                                result[kv.Key] = kv.Value.ToString();
                                break;
                            case JsonValueKind.Null:
                            case JsonValueKind.Undefined:
                                break;
                            default:
                                result[kv.Key] = kv.Value.ToString();
                                break;
                        }
                    }
                    catch { /* ignore individual field errors */ }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "AI extraction failed; returning empty parsed fields");
            }

            return result;
        }

        public async Task<ComplianceValidationResult> ValidateAndComplianceCheckAsync(
            string content,
            string documentType,
            Dictionary<string, string> shipmentFormData)
        {
            try
            {
                // Step 1: Extract fields from document
                _logger.LogInformation("Starting comprehensive validation for {DocType}", documentType);
                var extractedFields = await ExtractFieldsAsync(content, documentType);

                // Step 2: Perform compliance validation
                var validationResult = await _complianceService.ValidateShipmentAsync(
                    extractedFields,
                    shipmentFormData ?? new Dictionary<string, string>(),
                    documentType);

                _logger.LogInformation(
                    "Validation complete: Status={Status}, Score={Score}, Errors={ErrorCount}, Critical={CriticalErrors}",
                    validationResult.ValidationStatus,
                    validationResult.ComplianceScore,
                    validationResult.Errors.Count,
                    validationResult.Errors.Count(e => e.Severity == "critical"));

                return validationResult;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during compliance validation and checking");

                return new ComplianceValidationResult
                {
                    DocumentType = documentType,
                    ValidationStatus = "rejected",
                    ComplianceScore = 0,
                    RiskLevel = "critical",
                    Errors = new List<ValidationError>
                    {
                        new ValidationError
                        {
                            Code = "VALIDATION_EXCEPTION",
                            Message = "An unexpected error occurred during validation",
                            Severity = "critical",
                            Recommendation = "Please contact support and retry"
                        }
                    }
                };
            }
        }
    }
}
