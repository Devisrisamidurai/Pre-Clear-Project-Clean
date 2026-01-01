using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Amazon.BedrockRuntime;
using Amazon.BedrockRuntime.Model;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PreClear.Api.Interfaces;
using PreClear.Api.Models;
using PreClear.Api.Services;

namespace PreClear.Api.AI.Services.DocumentValidator
{
    public class AiDocumentAnalyzerBedrock : IAiDocumentAnalyzer
    {
        private readonly IAmazonBedrockRuntime _bedrock;
        private readonly ILogger<AiDocumentAnalyzerBedrock> _logger;
        private readonly BedrockSettings _settings;
        private readonly IComplianceValidationService _complianceService;

        public AiDocumentAnalyzerBedrock(
            IAmazonBedrockRuntime bedrock,
            IOptions<BedrockSettings> settings,
            ILogger<AiDocumentAnalyzerBedrock> logger,
            IComplianceValidationService complianceService)
        {
            _bedrock = bedrock;
            _logger = logger;
            _settings = settings.Value ?? new BedrockSettings();
            _complianceService = complianceService;
        }

        public async Task<Dictionary<string, string>> ExtractFieldsAsync(string content, string documentType)
        {
            var result = new Dictionary<string, string>();
            if (string.IsNullOrWhiteSpace(content) || string.IsNullOrWhiteSpace(_settings.ModelId))
                return result;

            try
            {
                var prompt = BuildPrompt(content, documentType);
                _logger.LogDebug("Invoking Bedrock model {ModelId} for {DocType}. Content length={ContentLength}. Prompt preview={PromptPreview}",
                    _settings.ModelId, documentType, content?.Length ?? 0, prompt.Substring(0, Math.Min(1000, prompt.Length)));
                
                // Use Mistral request format for Mistral models on Bedrock
                var requestPayload = new
                {
                    prompt = prompt,
                    max_tokens = 1024,
                    temperature = 0.1 // Low temperature for consistent JSON output
                };

                var json = JsonSerializer.Serialize(requestPayload);
                var request = new InvokeModelRequest
                {
                    ModelId = _settings.ModelId,
                    ContentType = "application/json",
                    Accept = "application/json",
                    Body = new MemoryStream(Encoding.UTF8.GetBytes(json))
                };

                var response = await _bedrock.InvokeModelAsync(request);
                using var reader = new StreamReader(response.Body);
                var body = await reader.ReadToEndAsync();
                _logger.LogDebug("Bedrock response contentType={ContentType} length={Length} preview={Preview}",
                    response.ContentType, body?.Length ?? 0, body is { Length: > 0 } ? body.Substring(0, Math.Min(1000, body.Length)) : "");

                var extracted = ParseMistralResponse(body);
                _logger.LogDebug("Extracted fields: {Keys}", string.Join(",", extracted.Keys));
                foreach (var kv in extracted)
                {
                    if (!string.IsNullOrWhiteSpace(kv.Value))
                        result[kv.Key] = kv.Value;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Bedrock analysis failed; returning empty parse");
            }

            return result;
        }

        private static string BuildPrompt(string content, string documentType)
        {
            var schema = @"{
  ""invoice_number"": ""string or empty"",
  ""tracking_number"": ""string or empty"",
  ""weight_kg"": ""number or 0"",
  ""package_count"": ""number or 0"",
  ""package_type"": ""string or empty (box, pallet, crate, envelope, case, etc)"",
  ""total_value"": ""number or 0"",
  ""hs_code"": ""string or empty"",
  ""product_name"": ""string or empty - exact product name from document"",
  ""product_description"": ""string or empty - detailed description of product"",
  ""product_category"": ""string or empty - category of product"",
  ""origin_country"": ""string or empty - full country name"",
  ""destination_country"": ""string or empty - full country name"",
  ""shipper_name"": ""string or empty"",
  ""consignee_name"": ""string or empty"",
  ""mode_of_transport"": ""string or empty (air, sea, road, rail, courier, multimodal)"",
  ""shipment_date"": ""string ISO date or empty""
}";
            var instructions = $@"You are an expert customs document parser for {documentType} documents.
Extract ALL the following fields from the provided text. Return ONLY a valid JSON object matching this schema, with no additional text or explanation.

Schema:
{schema}

Rules:
- Return empty string """" for missing string values
- Return 0 for missing numeric values
- Extract EXACT values from the document, preserving original spelling and format
- For countries: use FULL country names (e.g., ""United States"" not ""USA"", ""Germany"" not ""DE"")
- For product name: extract the exact product name as listed (e.g., ""Lithium-Ion Battery Cells"", ""Fresh Apples"", ""Prescription Medications"")
- For product description: extract detailed text from invoice/packing list, including any regulatory notes or restrictions mentioned
- For HS Code: extract complete HS code (e.g., ""851712"" not partial)
- For weight: extract in kilograms, convert if necessary
- For package type: be specific (box, pallet, crate, envelope, case, bundle, bag, etc.)
- For mode of transport: specify how goods are transported (air, sea, road, rail, courier, multimodal)
- IMPORTANT: Look for and include any words like ""BANNED"", ""RESTRICTED"", ""HAZMAT"", ""DANGEROUS"", ""PROHIBITED"" in the product_description
- Respond with ONLY the JSON object, no markdown, no explanation

Document text:
{content}

JSON Response:";
            return instructions;
        }

        private static Dictionary<string, string> ParseMistralResponse(string body)
        {
            var dict = new Dictionary<string, string>();
            try
            {
                using var doc = JsonDocument.Parse(body);
                
                // Mistral response format: { "outputs": [ { "text": "..." } ] }
                if (doc.RootElement.TryGetProperty("outputs", out var outputsArr) && outputsArr.ValueKind == JsonValueKind.Array)
                {
                    var outputs = outputsArr.EnumerateArray().ToList();
                    if (outputs.Count > 0 && outputs[0].TryGetProperty("text", out var textEl))
                    {
                        var jsonText = textEl.GetString() ?? string.Empty;
                        var parsed = TryParseJsonObject(jsonText);
                        foreach (var kv in parsed)
                            dict[kv.Key] = kv.Value;
                    }
                }
                else
                {
                    // Fallback: try to parse the entire body as JSON
                    var parsed = TryParseJsonObject(body);
                    foreach (var kv in parsed)
                        dict[kv.Key] = kv.Value;
                }
            }
            catch (Exception ex)
            {
                // Last resort: try to extract JSON from raw text if parsing fails
                var jsonMatch = System.Text.RegularExpressions.Regex.Match(body, @"\{[^{}]*\}");
                if (jsonMatch.Success)
                {
                    var parsed = TryParseJsonObject(jsonMatch.Value);
                    foreach (var kv in parsed)
                        dict[kv.Key] = kv.Value;
                }
            }

            return dict;
        }

        private static Dictionary<string, string> TryParseJsonObject(string json)
        {
            var dict = new Dictionary<string, string>();
            if (string.IsNullOrWhiteSpace(json)) return dict;
            
            try
            {
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.ValueKind == JsonValueKind.Object)
                {
                    void AddIfExists(string key)
                    {
                        if (doc.RootElement.TryGetProperty(key, out var el))
                        {
                            dict[key] = el.ValueKind switch
                            {
                                JsonValueKind.String => el.GetString() ?? string.Empty,
                                JsonValueKind.Number => el.TryGetDecimal(out var d) ? d.ToString() : el.GetRawText(),
                                JsonValueKind.Null => string.Empty,
                                _ => el.GetRawText()
                            };
                        }
                    }
                    AddIfExists("invoice_number");
                    AddIfExists("tracking_number");
                    AddIfExists("weight_kg");
                    AddIfExists("total_value");
                    AddIfExists("hs_code");
                    AddIfExists("origin_country");
                    AddIfExists("destination_country");
                    AddIfExists("product_name");
                    AddIfExists("product_description");
                    AddIfExists("package_type");
                    AddIfExists("mode_of_transport");
                    AddIfExists("shipper_name");
                    AddIfExists("consignee_name");
                }
            }
            catch { }
            
            return dict;
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

