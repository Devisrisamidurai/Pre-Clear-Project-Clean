using System.Threading.Tasks;
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using PreClear.Api.Interfaces;
using PreClear.Api.Services;
using PreClear.Api.Models;
using backend.Interfaces;

namespace PreClear.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AiController : ControllerBase
    {
        private readonly IAiService _ai;
        private readonly ILogger<AiController> _logger;
        private readonly IShipmentService _shipmentService;
        private readonly ITextractService _textractService;

        public AiController(
            IAiService ai, 
            ILogger<AiController> logger, 
            IShipmentService shipmentService,
            ITextractService textractService)
        {
            _ai = ai;
            _logger = logger;
            _shipmentService = shipmentService;
            _textractService = textractService;
        }

        public class RequiredDocumentsRequest
        {
            public string OriginCountry { get; set; } = string.Empty;
            public string DestinationCountry { get; set; } = string.Empty;
            public string HsCode { get; set; } = string.Empty;
            public bool? HtsFlag { get; set; } = null;
            public string ProductCategory { get; set; } = string.Empty;
            public string ProductDescription { get; set; } = string.Empty;
            public string PackageTypeWeight { get; set; } = string.Empty;
            public string ModeOfTransport { get; set; } = string.Empty;
            public int PythonPort { get; set; } = 8002;
            public long ShipmentId { get; set; } = 0;
        }

        [HttpPost("required-documents")]
        public async Task<IActionResult> GetRequiredDocuments([FromBody] RequiredDocumentsRequest req)
        {
            try
            {
                var result = await _ai.PredictRequiredDocumentsAsync(
                    req?.OriginCountry ?? string.Empty,
                    req?.DestinationCountry ?? string.Empty,
                    req?.HsCode ?? string.Empty,
                    req?.HtsFlag,
                    req?.ProductCategory ?? string.Empty,
                    req?.ProductDescription ?? string.Empty,
                    req?.PackageTypeWeight ?? string.Empty,
                    req?.ModeOfTransport ?? string.Empty,
                    req?.PythonPort ?? 8002,
                    timeoutSeconds: 10
                );

                var documents = result.Suggestions ?? Array.Empty<string>();

                if (req?.ShipmentId > 0)
                {
                    await _shipmentService.PersistAiPredictedDocumentsAsync(req.ShipmentId, documents);
                }

                return Ok(new { requiredDocuments = documents });
            }
            catch (TimeoutException tex)
            {
                _logger.LogWarning(tex, "Documents prediction timed out");
                return StatusCode(504, new { error = "gateway_timeout", detail = "Python AI timed out" });
            }
            catch (System.Net.Http.HttpRequestException httpEx)
            {
                _logger.LogWarning(httpEx, "Documents service HTTP error");
                return StatusCode(502, new { error = "bad_gateway", detail = httpEx.Message });
            }
            catch (InvalidOperationException ioex)
            {
                _logger.LogWarning(ioex, "Documents prediction invalid response");
                return BadRequest(new { error = "invalid_response", detail = ioex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error in required-documents endpoint");
                return StatusCode(500, new { error = "internal_error", detail = "Unexpected error fetching required documents" });
            }
        }

        public class AnalyzeRequest
        {
            public string Description { get; set; } = string.Empty;
        }

        [HttpPost("extract-shipment-data")]
        public async Task<IActionResult> ExtractShipmentData([FromForm] List<IFormFile> files)
        {
            try
            {
                if (files == null || files.Count == 0)
                {
                    return Ok(new 
                    { 
                        success = false, 
                        error = "No files provided" 
                    });
                }

                _logger.LogInformation("Extracting shipment data from {Count} files", files.Count);

                var extractedData = await _textractService.ExtractShipmentDataFromDocumentsAsync(files);

                _logger.LogInformation("Extraction completed. Found {KeyCount} keys", extractedData.Keys.Count);

                // Build comprehensive response with all extracted fields
                var response = new
                {
                    success = true,
                    // Addresses
                    shipper = extractedData.ContainsKey("shipper") ? extractedData["shipper"] : null,
                    consignee = extractedData.ContainsKey("consignee") ? extractedData["consignee"] : null,
                    // Products and packages - CRITICAL: return both formats for compatibility
                    // 'packages' is the primary array with full structure (each package contains products[])
                    packages = extractedData.ContainsKey("packages") ? extractedData["packages"] : null,
                    // 'products' is kept for backward compatibility (flat list)
                    products = extractedData.ContainsKey("products") ? extractedData["products"] : null,
                    // 'package' is kept for backward compatibility (single package details)
                    package = extractedData.ContainsKey("package") ? extractedData["package"] : null,
                    // Customs and value
                    customsValue = extractedData.ContainsKey("customsValue") ? extractedData["customsValue"] : null,
                    // Shipment details - provide defaults if not extracted
                    title = extractedData.ContainsKey("title") ? extractedData["title"] : (extractedData.ContainsKey("shipmentName") ? extractedData["shipmentName"] : null),
                    shipmentTitle = extractedData.ContainsKey("shipmentTitle") ? extractedData["shipmentTitle"] : null,
                    shipmentName = extractedData.ContainsKey("shipmentName") ? extractedData["shipmentName"] : null,
                    mode = extractedData.ContainsKey("mode") ? extractedData["mode"] : "Air",
                    shipmentType = extractedData.ContainsKey("shipmentType") ? extractedData["shipmentType"] : "International",
                    pickupType = extractedData.ContainsKey("pickupType") ? extractedData["pickupType"] : "Scheduled Pickup",
                    // Pickup and delivery
                    pickupLocation = extractedData.ContainsKey("pickupLocation") ? extractedData["pickupLocation"] : null,
                    pickupDate = extractedData.ContainsKey("pickupDate") ? extractedData["pickupDate"] : null,
                    pickupTimeEarliest = extractedData.ContainsKey("pickupTimeEarliest") ? extractedData["pickupTimeEarliest"] : null,
                    pickupTimeLatest = extractedData.ContainsKey("pickupTimeLatest") ? extractedData["pickupTimeLatest"] : null,
                    estimatedDropoffDate = extractedData.ContainsKey("estimatedDropoffDate") ? extractedData["estimatedDropoffDate"] : null,
                    // Service and payment
                    serviceLevel = extractedData.ContainsKey("serviceLevel") ? extractedData["serviceLevel"] : "Standard",
                    incoterm = extractedData.ContainsKey("incoterm") ? extractedData["incoterm"] : "FOB",
                    currency = extractedData.ContainsKey("currency") ? extractedData["currency"] : "USD",
                    billTo = extractedData.ContainsKey("billTo") ? extractedData["billTo"] : "Shipper",
                    paymentTiming = extractedData.ContainsKey("paymentTiming") ? extractedData["paymentTiming"] : "Prepaid",
                    paymentMethod = extractedData.ContainsKey("paymentMethod") ? extractedData["paymentMethod"] : "Credit Card",
                    // Additional info
                    reasonForExport = extractedData.ContainsKey("reasonForExport") ? extractedData["reasonForExport"] : null,
                    specialInstructions = extractedData.ContainsKey("specialInstructions") ? extractedData["specialInstructions"] : null,
                    insuranceRequired = extractedData.ContainsKey("insuranceRequired") ? extractedData["insuranceRequired"] : false,
                    dangerousGoods = extractedData.ContainsKey("dangerousGoods") ? extractedData["dangerousGoods"] : false,
                };

                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during shipment data extraction");
                
                // Even on error, return 200 with success=false to prevent frontend JSON parse errors
                return Ok(new 
                { 
                    success = false, 
                    error = ex.Message 
                });
            }
        }

        [HttpPost("analyze")]
        public async Task<IActionResult> Analyze([FromBody] AnalyzeRequest req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Description))
                return BadRequest(new { error = "description_required" });

            try
            {
                var result = await _ai.AnalyzeAsync(req.Description);
                return Ok(result);
            }
            catch (ArgumentException aex)
            {
                _logger.LogWarning(aex, "Bad request in AI analyze");
                return BadRequest(new { error = "invalid_input", detail = aex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error during AI analysis");
                return StatusCode(500, new { error = "internal_error", detail = "An unexpected error occurred while analyzing the description." });
            }
        }

        public class HsSuggestRequest
        {
            public string Name { get; set; } = string.Empty;
            public string Category { get; set; } = string.Empty;
            public string Description { get; set; } = string.Empty;
            public int K { get; set; } = 5;
        }

        [HttpPost("hs/suggest")]
        public async Task<IActionResult> SuggestHs([FromBody] HsSuggestRequest req)
        {
            try
            {
                var suggestions = await _ai.SuggestHsAsync(req?.Name ?? string.Empty, req?.Category ?? string.Empty, req?.Description ?? string.Empty, req?.K ?? 5);
                
                // Map to clean DTO to ensure no reference metadata ($id, $values, etc.) in response
                var safeSuggestions = suggestions ?? new List<AiService.HsSuggestion>();
                var result = safeSuggestions.Select(s => new HsSuggestionDto
                {
                    hscode = s?.HsCode ?? "",
                    description = s?.Description ?? "",
                    score = s?.Score ?? 0f
                }).ToList();
                
                var response = new HsSuggestionsResponse { suggestions = result };
                _logger.LogInformation("SuggestHs: Returned {Count} suggestions", result.Count);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while suggesting HS codes");
                return Ok(new HsSuggestionsResponse { suggestions = new List<HsSuggestionDto>() });
            }
        }

        public class DocumentPredictRequest
        {
            public string ProductName { get; set; } = string.Empty;
            public string Category { get; set; } = string.Empty;
            public string ProductDescription { get; set; } = string.Empty;
            public string HsCode { get; set; } = string.Empty;
            public string OriginCountry { get; set; } = string.Empty;
            public string DestinationCountry { get; set; } = string.Empty;
            public string PackageType { get; set; } = string.Empty;
            public double Weight { get; set; } = 0;
            public double DeclaredValue { get; set; } = 0;
            public string ShipmentType { get; set; } = string.Empty;
            public string ServiceLevel { get; set; } = string.Empty;
        }

        [HttpPost("documents/predict")]
        public async Task<IActionResult> SuggestDocuments([FromBody] DocumentPredictRequest req)
        {
            try
            {
                if (req == null)
                {
                    return BadRequest(new { error = "request_required" });
                }

                var aiRequest = new PreClear.Api.Services.AiService.DocumentPredictionRequest
                {
                    ProductName = req.ProductName ?? string.Empty,
                    Category = req.Category ?? string.Empty,
                    ProductDescription = req.ProductDescription ?? string.Empty,
                    HsCode = req.HsCode ?? string.Empty,
                    OriginCountry = req.OriginCountry ?? string.Empty,
                    DestinationCountry = req.DestinationCountry ?? string.Empty,
                    PackageType = req.PackageType ?? string.Empty,
                    Weight = req.Weight,
                    DeclaredValue = req.DeclaredValue,
                    ShipmentType = req.ShipmentType ?? string.Empty,
                    ServiceLevel = req.ServiceLevel ?? string.Empty,
                };

                var result = await _ai.SuggestDocumentsAsync(aiRequest);
                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while suggesting required documents");
                return StatusCode(500, new { error = "internal_error" });
            }
        }

        [HttpGet("hs/sections")]
        public IActionResult GetHsSections()
        {
            try
            {
                // Locate sections.csv under backend/AI/datasets
                var baseDir = Directory.GetCurrentDirectory();
                var candidate = Path.Combine(baseDir, "AI", "datasets", "sections.csv");
                if (!System.IO.File.Exists(candidate))
                {
                    return NotFound(new { error = "sections_not_found" });
                }

                var lines = System.IO.File.ReadAllLines(candidate);
                if (lines.Length == 0) return Ok(Array.Empty<object>());

                var rows = new List<object>();
                for (int i = 1; i < lines.Length; i++)
                {
                    var line = lines[i];
                    // Handle quoted fields: split by comma but respect quotes
                    var parts = new System.Collections.Generic.List<string>();
                    var current = new System.Text.StringBuilder();
                    var inQuotes = false;
                    foreach (var ch in line)
                    {
                        if (ch == '"') inQuotes = !inQuotes;
                        else if (ch == ',' && !inQuotes)
                        {
                            parts.Add(current.ToString().Trim().Trim('"'));
                            current.Clear();
                        }
                        else current.Append(ch);
                    }
                    if (current.Length > 0) parts.Add(current.ToString().Trim().Trim('"'));

                    string code = parts.Count > 0 ? parts[0].Trim() : i.ToString();
                    string title = parts.Count > 1 ? parts[1].Trim().Trim('"') : "";
                    // Capitalize first letter of each word
                    title = System.Globalization.CultureInfo.CurrentCulture.TextInfo.ToTitleCase(title.ToLower());
                    // Remove any remaining quotes
                    title = title.Replace("\"", "");
                    rows.Add(new { code, title });
                }

                return Ok(rows);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to read HS sections");
                return StatusCode(500, new { error = "internal_error" });
            }
        }
    }
}

