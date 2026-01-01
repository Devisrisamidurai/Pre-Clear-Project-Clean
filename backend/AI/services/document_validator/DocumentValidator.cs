using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using PreClear.Api.Models;

namespace PreClear.Api.AI.Services.DocumentValidator
{
    /// <summary>
    /// Main document validator service
    /// Validates extracted documents against:
    /// 1. Shipment form data (matching)
    /// 2. Compliance rules from dataset (restrictions, bans, requirements)
    /// </summary>
    public class DocumentValidator
    {
        private readonly DocumentExtractor _extractor;
        private readonly ComplianceDatasetLoader _complianceLoader;
        private readonly ILogger<DocumentValidator> _logger;
        private List<ValidationIssue> _issues = new();

        public DocumentValidator(
            DocumentExtractor extractor,
            ComplianceDatasetLoader complianceLoader,
            ILogger<DocumentValidator> logger)
        {
            _extractor = extractor;
            _complianceLoader = complianceLoader;
            _logger = logger;
        }

        /// <summary>
        /// Validates all documents for a shipment against form data and compliance rules
        /// </summary>
        public async Task<ValidationResult> ValidateShipmentAsync(
            ShipmentDetailDto detail,
            List<ExtractedDocument> extractedDocuments)
        {
            _issues.Clear();
            var result = new ValidationResult
            {
                ShipmentId = detail.Shipment.Id,
                ValidationStartedAt = DateTime.UtcNow
            };

            try
            {
                // Step 1: Validate documents exist and are not empty
                ValidateDocumentsExist(extractedDocuments);

                // Step 2: Validate data consistency between documents and form
                ValidateDataConsistency(detail, extractedDocuments);

                // Step 3: Validate compliance rules
                var packingNotes = await ValidateComplianceRulesAsync(detail, extractedDocuments);

                // Step 4: Validate product restrictions and bans
                ValidateProductRestrictions(detail, extractedDocuments);

                // Step 5: Validate packing and handling requirements
                ValidatePackingRequirements(detail, extractedDocuments);

                // Filter out any disabled origin mismatch warnings (defensive)
                _issues = _issues
                    .Where(i => !(string.Equals(i.Message, "Origin country mismatch", StringComparison.OrdinalIgnoreCase)
                                  && string.Equals(i.Category, "data_consistency", StringComparison.OrdinalIgnoreCase)))
                    .ToList();

                // Compile results: pass if there are no errors; warnings/info do not fail validation
                var hasErrors = _issues.Any(i => string.Equals(i.Severity, "error", StringComparison.OrdinalIgnoreCase));
                result.IsValid = !hasErrors;
                result.Issues = _issues;
                result.PackingNotes = packingNotes;
                result.ValidationCompletedAt = DateTime.UtcNow;
                result.ValidationScore = CalculateValidationScore(_issues);

                if (result.IsValid)
                {
                    result.Status = "approved";
                    result.Message = "All documents validated successfully. Request for Broker Review is available.";
                }
                else
                {
                    result.Status = "failed";
                    result.Message = $"Validation failed with {_issues.Count} issue(s). Please fix and resubmit documents.";
                }

                _logger.LogInformation(
                    "Shipment {ShipmentId} validation completed. Valid={Valid}, Issues={Issues}, Score={Score}",
                    detail.Shipment.Id, result.IsValid, result.IssueCount, result.ValidationScore);

                return result;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error validating shipment {ShipmentId}", detail.Shipment.Id);
                result.Status = "error";
                result.Message = $"Validation error: {ex.Message}";
                result.IsValid = false;
                result.Issues = new List<ValidationIssue>
                {
                    new ValidationIssue
                    {
                        Severity = "error",
                        Category = "system",
                        Message = ex.Message,
                        Details = ex.StackTrace
                    }
                };
                return result;
            }
        }

        private void ValidateDocumentsExist(List<ExtractedDocument> documents)
        {
            if (documents == null || documents.Count == 0)
            {
                _issues.Add(new ValidationIssue
                {
                    Severity = "error",
                    Category = "documents",
                    Message = "No documents provided",
                    Details = "At least one document must be uploaded for validation",
                    SuggestedAction = "Upload required base documents: Commercial Invoice and Packing List."
                });
                return;
            }

            // Check for required document types
            var documentTypes = documents.Select(d => d.DocumentType.ToLowerInvariant()).ToList();
            var requiredDocs = new[] { "commercial invoice", "packing list" };

            foreach (var required in requiredDocs)
            {
                if (!documentTypes.Any(d => d.Contains(required)))
                {
                    _issues.Add(new ValidationIssue
                    {
                        Severity = "error",
                        Category = "documents",
                        Message = $"Missing required document: {required}",
                        Details = "This document type is mandatory for international shipments",
                        SuggestedAction = required.Contains("commercial")
                            ? "Upload the Commercial Invoice with itemized values, HS codes, origin and consignee details."
                            : "Upload the Packing List with package counts, weights, and dimensions."
                    });
                }
            }
        }

        private void ValidateDataConsistency(ShipmentDetailDto detail, List<ExtractedDocument> documents)
        {
            if (documents == null || documents.Count == 0) return;

            // Extract all parsed data from documents
            var allParsedData = new Dictionary<string, string>();
            foreach (var doc in documents)
            {
                foreach (var kvp in doc.ParsedData)
                {
                    if (!allParsedData.ContainsKey(kvp.Key))
                        allParsedData[kvp.Key] = kvp.Value;
                }
            }

            // Gather form data
            var shipment = detail.Shipment;
            var originCountry = detail.Parties.FirstOrDefault(p => p.PartyType.Equals("shipper", StringComparison.OrdinalIgnoreCase))?.Country;
            var destinationCountry = detail.Parties.FirstOrDefault(p => p.PartyType.Equals("consignee", StringComparison.OrdinalIgnoreCase))?.Country;
            var shipperName = detail.Parties.FirstOrDefault(p => p.PartyType.Equals("shipper", StringComparison.OrdinalIgnoreCase))?.CompanyName;
            var consigneeName = detail.Parties.FirstOrDefault(p => p.PartyType.Equals("consignee", StringComparison.OrdinalIgnoreCase))?.CompanyName;
            var totalWeight = detail.Packages.Any() ? detail.Packages.Sum(p => p.Weight ?? 0m) : (decimal?)null;
            var packageType = detail.Packages.FirstOrDefault()?.PackageType;
            var packageCount = detail.Packages.Count();
            var hsCode = detail.Items.FirstOrDefault()?.HsCode;
            var productDescription = detail.Items.FirstOrDefault()?.Description ?? detail.Items.FirstOrDefault()?.Name;
            var productCategory = detail.Items.FirstOrDefault()?.Category;
            var modeOfTransport = shipment.Mode;
            var customsValue = shipment.CustomsValue;

            // ===== STRICT SHIPMENT DATA VALIDATION =====
            // Destination country (MANDATORY MATCH)
            if (allParsedData.TryGetValue("destination_country", out var docDest) && !string.IsNullOrWhiteSpace(docDest))
            {
                if (!string.IsNullOrWhiteSpace(destinationCountry))
                {
                    if (!docDest.Equals(destinationCountry, StringComparison.OrdinalIgnoreCase))
                    {
                        _issues.Add(new ValidationIssue
                        {
                            Severity = "error",
                            Category = "data_consistency",
                            Message = "DESTINATION COUNTRY MISMATCH",
                            Details = $"Form shows '{destinationCountry}' but documents clearly state '{docDest}'. This is a critical mismatch indicating the documents may be for a different shipment.",
                            SuggestedAction = "Upload documents for the correct destination country: " + destinationCountry
                        });
                    }
                }
            }

            // HS Code (MANDATORY MATCH - first 4 digits)
            if (allParsedData.TryGetValue("hs_code", out var docHsCode) && !string.IsNullOrWhiteSpace(docHsCode))
            {
                if (!string.IsNullOrEmpty(hsCode))
                {
                    // Compare first 4 digits of HS codes
                    var formHsPrefix = hsCode.Substring(0, Math.Min(4, hsCode.Length));
                    var docHsPrefix = docHsCode.Substring(0, Math.Min(4, docHsCode.Length));
                    
                    if (!formHsPrefix.Equals(docHsPrefix, StringComparison.OrdinalIgnoreCase))
                    {
                        _issues.Add(new ValidationIssue
                        {
                            Severity = "error",
                            Category = "data_consistency",
                            Message = "HS CODE MISMATCH",
                            Details = $"Form shows HS Code '{hsCode}' but documents indicate '{docHsCode}'. Different product categories indicate these are not the correct documents.",
                            SuggestedAction = $"Upload Commercial Invoice and Packing List for HS Code {hsCode}"
                        });
                    }
                }
            }

            // Product Description (WARNING MATCH)
            if (allParsedData.TryGetValue("product_description", out var docProdDesc) && !string.IsNullOrWhiteSpace(docProdDesc))
            {
                if (!string.IsNullOrWhiteSpace(productDescription))
                {
                    var docDescLower = docProdDesc.ToLowerInvariant();
                    var formDescLower = productDescription.ToLowerInvariant();
                    
                    // Check if key words match (allowing for variations)
                    var formKeywords = formDescLower.Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => w.Length > 3).Take(3).ToList();
                    var docHasKeywords = formKeywords.All(kw => docDescLower.Contains(kw));
                    
                    if (!docHasKeywords && Math.Abs(docProdDesc.Length - productDescription.Length) > 50)
                    {
                        _issues.Add(new ValidationIssue
                        {
                            Severity = "warning",
                            Category = "data_consistency",
                            Message = "Product description differs significantly",
                            Details = $"Form: '{productDescription}' vs Document: '{docProdDesc}'. Verify these describe the same product.",
                            SuggestedAction = "Confirm the documents match your shipment contents"
                        });
                    }
                }
            }

            // Weight (STRICT - within 5% tolerance)
            if (allParsedData.TryGetValue("weight_kg", out var docWeight) && !string.IsNullOrWhiteSpace(docWeight))
            {
                if (decimal.TryParse(docWeight, out var parsedWeight) && totalWeight.HasValue && totalWeight.Value > 0)
                {
                    var tolerance = totalWeight.Value * 0.05m; // 5% tolerance for strict matching
                    var diff = Math.Abs(parsedWeight - totalWeight.Value);
                    
                    if (diff > tolerance)
                    {
                        _issues.Add(new ValidationIssue
                        {
                            Severity = "error",
                            Category = "data_consistency",
                            Message = "Weight discrepancy exceeds tolerance",
                            Details = $"Form shows {totalWeight}kg but documents indicate {parsedWeight}kg (difference: {diff}kg, tolerance: {tolerance}kg). This suggests documents may not match the actual shipment.",
                            SuggestedAction = "Verify shipment weight or upload correct packing list"
                        });
                    }
                    else if (diff > tolerance * 0.5m)
                    {
                        _issues.Add(new ValidationIssue
                        {
                            Severity = "warning",
                            Category = "data_consistency",
                            Message = "Minor weight discrepancy",
                            Details = $"Form shows {totalWeight}kg but documents indicate {parsedWeight}kg (difference: {diff}kg)"
                        });
                    }
                }
            }

            // Package Count (WARNING)
            if (allParsedData.TryGetValue("package_count", out var docPackCount) && !string.IsNullOrWhiteSpace(docPackCount))
            {
                if (int.TryParse(docPackCount, out var parsedPackCount) && packageCount > 0)
                {
                    if (parsedPackCount != packageCount)
                    {
                        _issues.Add(new ValidationIssue
                        {
                            Severity = "warning",
                            Category = "data_consistency",
                            Message = "Package count mismatch",
                            Details = $"Form shows {packageCount} package(s) but documents indicate {parsedPackCount}",
                            SuggestedAction = "Verify the number of packages in your shipment"
                        });
                    }
                }
            }

            // Total Value (WARNING - within 5% tolerance)
            if (allParsedData.TryGetValue("total_value", out var docValue) && !string.IsNullOrWhiteSpace(docValue))
            {
                if (decimal.TryParse(docValue, out var parsedValue) && customsValue.HasValue && customsValue.Value > 0)
                {
                    var tolerance = customsValue.Value * 0.05m; // 5% tolerance
                    if (Math.Abs(parsedValue - customsValue.Value) > tolerance)
                    {
                        _issues.Add(new ValidationIssue
                        {
                            Severity = "warning",
                            Category = "data_consistency",
                            Message = "Shipment value discrepancy",
                            Details = $"Form shows ${customsValue} but documents indicate ${parsedValue}. Ensure invoice amounts match declared value.",
                            SuggestedAction = "Verify declared value matches the commercial invoice"
                        });
                    }
                }
            }

            // Mode of Transport (WARNING)
            if (allParsedData.TryGetValue("mode_of_transport", out var docMode) && !string.IsNullOrWhiteSpace(docMode))
            {
                if (!string.IsNullOrWhiteSpace(modeOfTransport))
                {
                    if (!docMode.Equals(modeOfTransport, StringComparison.OrdinalIgnoreCase))
                    {
                        _issues.Add(new ValidationIssue
                        {
                            Severity = "warning",
                            Category = "data_consistency",
                            Message = "Transport mode mismatch",
                            Details = $"Form shows '{modeOfTransport}' but documents indicate '{docMode}'"
                        });
                    }
                }
            }

            // Shipper/Consignee Names (INFO)
            if (allParsedData.TryGetValue("shipper_name", out var docShipper) && !string.IsNullOrWhiteSpace(docShipper))
            {
                if (!string.IsNullOrWhiteSpace(shipperName) && !docShipper.Contains(shipperName, StringComparison.OrdinalIgnoreCase) && !shipperName.Contains(docShipper, StringComparison.OrdinalIgnoreCase))
                {
                    _issues.Add(new ValidationIssue
                    {
                        Severity = "info",
                        Category = "data_consistency",
                        Message = "Shipper name differs",
                        Details = $"Form: '{shipperName}' vs Document: '{docShipper}'"
                    });
                }
            }
        }

        private async Task<List<string>> ValidateComplianceRulesAsync(ShipmentDetailDto detail, List<ExtractedDocument> documents)
        {
            var notes = new List<string>();
            try
            {
                var shipment = detail.Shipment;
                var originCountry = detail.Parties.FirstOrDefault(p => p.PartyType.Equals("shipper", StringComparison.OrdinalIgnoreCase))?.Country ?? string.Empty;
                var destinationCountry = detail.Parties.FirstOrDefault(p => p.PartyType.Equals("consignee", StringComparison.OrdinalIgnoreCase))?.Country ?? string.Empty;
                var packageType = detail.Packages.FirstOrDefault()?.PackageType ?? string.Empty;
                var hsCode = detail.Items.FirstOrDefault()?.HsCode ?? string.Empty;
                var totalWeight = detail.Packages.Any() ? detail.Packages.Sum(p => p.Weight ?? 0m) : (decimal?)null;
                
                // ALSO check extracted products from documents
                var extractedProducts = ExtractProductsFromDocuments(documents);
                
                var matchingRules = _complianceLoader.FindMatchingRules(
                    originCountry,
                    destinationCountry,
                    shipment.Mode,
                    packageType,
                    hsCode);

                _logger.LogDebug("Compliance rules matched: {Count} for O={O} D={D} Mode={M} Package={P} HS={HS}",
                    matchingRules.Count, originCountry, destinationCountry, shipment.Mode, packageType, hsCode);
                
                // Also match rules against extracted product data
                foreach (var extractedProduct in extractedProducts)
                {
                    var productRules = _complianceLoader.FindMatchingRules(
                        originCountry,
                        destinationCountry,
                        shipment.Mode,
                        extractedProduct.PackageType ?? packageType,
                        extractedProduct.HsCode ?? hsCode);
                    
                    matchingRules.AddRange(productRules);
                }

                foreach (var rule in matchingRules)
                {
                    _logger.LogDebug("Rule: O={O} D={D} Mode={M} Package={P} HS={HS} Banned={Banned} Restricted={Restricted}",
                        rule.OriginCountry, rule.DestinationCountry, rule.Mode, rule.PackageType, rule.HsCode, rule.Banned, rule.Restricted);
                    if (!string.IsNullOrWhiteSpace(rule.PackingNotes))
                    {
                        notes.Add(rule.PackingNotes);
                    }
                    // Check if product is banned
                    if (rule.Banned)
                    {
                        _issues.Add(new ValidationIssue
                        {
                            Severity = "error",
                            Category = "compliance",
                            Message = "Product is banned for this route",
                            Details = $"This shipment cannot be sent from {rule.OriginCountry} to {rule.DestinationCountry}. Reason: {rule.BannedDetails}",
                            SuggestedAction = "Change origin/destination or product category, or consult broker for alternative compliance options."
                        });
                        continue;
                    }

                    // Check if product is restricted
                    if (rule.Restricted)
                    {
                        _issues.Add(new ValidationIssue
                        {
                            Severity = "warning",
                            Category = "compliance",
                            Message = "Product is restricted for this route",
                            Details = $"Special requirements apply: {rule.RestrictedDetails}. Ensure all documents address these restrictions.",
                            SuggestedAction = "Provide permits/certifications noted in restrictions (e.g., licenses, declarations) and ensure documents reflect them."
                        });
                    }

                    // Check weight limits
                    if (rule.MaxWeightKgPerPackage.HasValue && totalWeight.HasValue)
                    {
                        if (totalWeight.Value > rule.MaxWeightKgPerPackage.Value)
                        {
                            _issues.Add(new ValidationIssue
                            {
                                Severity = "error",
                                Category = "compliance",
                                Message = "Package weight exceeds limit",
                                Details = $"Maximum {rule.MaxWeightKgPerPackage}kg per package. Your shipment is {totalWeight}kg."
                            });
                        }
                    }

                    if (rule.MaxTotalWeightKg.HasValue && totalWeight.HasValue)
                    {
                        if (totalWeight.Value > rule.MaxTotalWeightKg.Value)
                        {
                            _issues.Add(new ValidationIssue
                            {
                                Severity = "error",
                                Category = "compliance",
                                Message = "Total shipment weight exceeds limit",
                                Details = $"Maximum {rule.MaxTotalWeightKg}kg total. Your shipment is {totalWeight}kg."
                            });
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error validating compliance rules for shipment {ShipmentId}", detail.Shipment.Id);
                _issues.Add(new ValidationIssue
                {
                    Severity = "warning",
                    Category = "compliance",
                    Message = "Compliance validation incomplete",
                    Details = "Could not fully validate compliance rules. Please review manually."
                });
            }
            return notes.Distinct().ToList();
        }

        private List<ExtractedProductInfo> ExtractProductsFromDocuments(List<ExtractedDocument> documents)
        {
            var products = new List<ExtractedProductInfo>();
            
            foreach (var doc in documents)
            {
                if (doc.ParsedData == null) continue;
                
                var product = new ExtractedProductInfo
                {
                    ProductName = doc.ParsedData.TryGetValue("product_name", out var name) ? name : 
                                  (doc.ParsedData.TryGetValue("product_description", out var desc) ? desc : null),
                    ProductCategory = doc.ParsedData.TryGetValue("product_category", out var cat) ? cat : null,
                    HsCode = doc.ParsedData.TryGetValue("hs_code", out var hs) ? hs : null,
                    PackageType = doc.ParsedData.TryGetValue("package_type", out var pkg) ? pkg : null,
                    Weight = doc.ParsedData.TryGetValue("weight_kg", out var wt) && decimal.TryParse(wt, out var wtVal) ? wtVal : null
                };
                
                if (!string.IsNullOrWhiteSpace(product.ProductName) || !string.IsNullOrWhiteSpace(product.HsCode))
                {
                    products.Add(product);
                }
            }
            
            return products;
        }

        private class ExtractedProductInfo
        {
            public string? ProductName { get; set; }
            public string? ProductCategory { get; set; }
            public string? HsCode { get; set; }
            public string? PackageType { get; set; }
            public decimal? Weight { get; set; }
        }

        private void ValidateProductRestrictions(ShipmentDetailDto detail, List<ExtractedDocument> documents)
        {
            var mode = detail.Shipment.Mode?.ToLowerInvariant() ?? "";
            var productDesc = (detail.Items.FirstOrDefault()?.Description ?? detail.Items.FirstOrDefault()?.Name ?? "").ToLowerInvariant();

            // Lithium batteries restrictions
            if (productDesc.Contains("lithium") || productDesc.Contains("battery"))
            {
                if (mode == "air")
                {
                    // Check for IATA DG declaration in documents
                    var hasIataDoc = documents.Any(d => 
                        d.ExtractedContent.Contains("IATA", StringComparison.OrdinalIgnoreCase) ||
                        d.ExtractedContent.Contains("DG", StringComparison.OrdinalIgnoreCase));

                    if (!hasIataDoc)
                    {
                        _issues.Add(new ValidationIssue
                        {
                            Severity = "error",
                            Category = "product_restriction",
                            Message = "Missing IATA dangerous goods documentation",
                            Details = "Lithium batteries shipped by air require IATA DG declarations (UN3480/UN3090). Upload IATA certification."
                        });
                    }
                }
            }

            // Pharmaceutical restrictions
            if (productDesc.Contains("pharmaceutical") || productDesc.Contains("medicine") || productDesc.Contains("drug"))
            {
                var hasPharmDoc = documents.Any(d => 
                    d.DocumentType.Contains("license", StringComparison.OrdinalIgnoreCase) ||
                    d.DocumentType.Contains("certificate", StringComparison.OrdinalIgnoreCase) ||
                    d.ExtractedContent.Contains("GMP", StringComparison.OrdinalIgnoreCase));

                if (!hasPharmDoc)
                {
                    _issues.Add(new ValidationIssue
                    {
                        Severity = "error",
                        Category = "product_restriction",
                        Message = "Missing pharmaceutical certifications",
                        Details = "Pharmaceutical products require GMP certificates, pharmacy licenses, and import permits. Upload required documentation."
                    });
                }
            }

            // Hazardous materials
            if (productDesc.Contains("hazard") || productDesc.Contains("chemical") || productDesc.Contains("solvent"))
            {
                var hasHazmatDoc = documents.Any(d =>
                    d.ExtractedContent.Contains("ADR", StringComparison.OrdinalIgnoreCase) ||
                    d.ExtractedContent.Contains("IMDG", StringComparison.OrdinalIgnoreCase) ||
                    d.ExtractedContent.Contains("SDS", StringComparison.OrdinalIgnoreCase));

                if (!hasHazmatDoc)
                {
                    _issues.Add(new ValidationIssue
                    {
                        Severity = "error",
                        Category = "product_restriction",
                        Message = "Missing hazardous materials documentation",
                        Details = "Hazardous materials require Safety Data Sheets (SDS) and ADR/IMDG compliance certificates. Upload documentation."
                    });
                }
            }

            // Live animals
            if (productDesc.Contains("animal") || productDesc.Contains("pet"))
            {
                var hasAnimalDoc = documents.Any(d =>
                    d.ExtractedContent.Contains("veterinary", StringComparison.OrdinalIgnoreCase) ||
                    d.ExtractedContent.Contains("health certificate", StringComparison.OrdinalIgnoreCase));

                if (!hasAnimalDoc)
                {
                    _issues.Add(new ValidationIssue
                    {
                        Severity = "error",
                        Category = "product_restriction",
                        Message = "Missing animal health documentation",
                        Details = "Live animals require veterinary health certificates, import permits, and humane transport certifications. Upload required documents."
                    });
                }
            }
        }

        private void ValidatePackingRequirements(ShipmentDetailDto detail, List<ExtractedDocument> documents)
        {
            var mode = detail.Shipment.Mode?.ToLowerInvariant() ?? "";
            var packageType = (detail.Packages.FirstOrDefault()?.PackageType ?? "").ToLowerInvariant();
            var productDesc = (detail.Items.FirstOrDefault()?.Description ?? detail.Items.FirstOrDefault()?.Name ?? "").ToLowerInvariant();

            // Sea/IMDG requirements
            if (mode == "sea" || mode == "multimodal")
            {
                var hasImdgCompliance = documents.Any(d =>
                    d.ExtractedContent.Contains("IMDG", StringComparison.OrdinalIgnoreCase) ||
                    d.ExtractedContent.Contains("packing", StringComparison.OrdinalIgnoreCase));

                if (!hasImdgCompliance && productDesc.Contains("chemical"))
                {
                    _issues.Add(new ValidationIssue
                    {
                        Severity = "warning",
                        Category = "packing_requirement",
                        Message = "IMDG packing compliance not documented",
                        Details = "Sea shipments of chemicals should document IMDG-compliant packing. Verify in packing list."
                    });
                }
            }

            // Temperature-controlled requirements
            if (productDesc.Contains("pharmaceutical") || productDesc.Contains("fresh") || productDesc.Contains("fruit") || productDesc.Contains("vegetable"))
            {
                var hasTemperatureControl = documents.Any(d =>
                    d.ExtractedContent.Contains("temperature", StringComparison.OrdinalIgnoreCase) ||
                    d.ExtractedContent.Contains("cold chain", StringComparison.OrdinalIgnoreCase) ||
                    d.ExtractedContent.Contains("refrigerat", StringComparison.OrdinalIgnoreCase));

                if (!hasTemperatureControl)
                {
                    _issues.Add(new ValidationIssue
                    {
                        Severity = "info",
                        Category = "packing_requirement",
                        Message = "Temperature control requirements not documented",
                        Details = "Perishable goods typically require cold-chain documentation. Consider adding temperature monitoring documentation."
                    });
                }
            }

            // Fragile/sensitive goods
            if (productDesc.Contains("electronic") || productDesc.Contains("fragile") || productDesc.Contains("toy"))
            {
                var hasShockProtection = documents.Any(d =>
                    d.ExtractedContent.Contains("shock", StringComparison.OrdinalIgnoreCase) ||
                    d.ExtractedContent.Contains("protection", StringComparison.OrdinalIgnoreCase) ||
                    d.ExtractedContent.Contains("cushion", StringComparison.OrdinalIgnoreCase));

                if (!hasShockProtection)
                {
                    _issues.Add(new ValidationIssue
                    {
                        Severity = "info",
                        Category = "packing_requirement",
                        Message = "Shock protection not documented",
                        Details = "Consider documenting protective packing measures for electronics and fragile items."
                    });
                }
            }
        }

        private decimal CalculateValidationScore(List<ValidationIssue> issues)
        {
            if (issues.Count == 0) return 100m;

            var errorCount = issues.Count(i => i.Severity == "error");
            var warningCount = issues.Count(i => i.Severity == "warning");
            var infoCount = issues.Count(i => i.Severity == "info");

            // Hard fail cases: missing core documents -> score 0
            var hasCoreDocError = issues.Any(i => i.Category == "documents" && i.Severity == "error");
            if (hasCoreDocError)
            {
                return 0m;
            }

            // Hard fail for critical mismatches (destination country, HS code)
            var hasCriticalMismatch = issues.Any(i => 
                (i.Message.Contains("DESTINATION COUNTRY MISMATCH", StringComparison.OrdinalIgnoreCase) ||
                 i.Message.Contains("HS CODE MISMATCH", StringComparison.OrdinalIgnoreCase)) &&
                i.Severity == "error");
            if (hasCriticalMismatch)
            {
                return 0m;
            }

            // Hard fail for banned products
            var hasBannedProduct = issues.Any(i => i.Category == "compliance" && i.Message.Contains("banned", StringComparison.OrdinalIgnoreCase) && i.Severity == "error");
            if (hasBannedProduct)
            {
                return 0m;
            }

            // Scoring: Errors are critical (30 points each), warnings moderate (5 points), info minor (1 point)
            // Base score starts at 100, penalties applied per issue
            var score = 100m - (errorCount * 30) - (warningCount * 5) - (infoCount * 1);
            return Math.Max(0, Math.Min(100, score));
        }
    }

    public class ValidationResult
    {
        public long ShipmentId { get; set; }
        public bool IsValid { get; set; }
        public string Status { get; set; } = "pending"; // pending, approved, failed, error
        public string Message { get; set; } = string.Empty;
        public List<ValidationIssue> Issues { get; set; } = new();
        public int IssueCount => Issues.Count;
        public decimal ValidationScore { get; set; }
        public DateTime ValidationStartedAt { get; set; }
        public DateTime? ValidationCompletedAt { get; set; }
        public List<string> PackingNotes { get; set; } = new();
    }

    public class ValidationIssue
    {
        public string Severity { get; set; } = "info"; // info, warning, error
        public string Category { get; set; } = "general"; // documents, data_consistency, compliance, product_restriction, packing_requirement, system
        public string Message { get; set; } = string.Empty;
        public string? Details { get; set; }
        public string? SuggestedAction { get; set; }
    }
}
