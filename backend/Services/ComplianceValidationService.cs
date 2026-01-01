using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using PreClear.Api.Models;

namespace PreClear.Api.Services
{
    /// <summary>
    /// Service for validating shipments against compliance rules from CSV data
    /// Checks field-level validations, missing fields, and restrictions/bans
    /// </summary>
    public interface IComplianceValidationService
    {
        Task<ComplianceValidationResult> ValidateShipmentAsync(
            Dictionary<string, string> extractedFields,
            Dictionary<string, string> shipmentFormData,
            string documentType);

        Task<List<ShippingRestrictionRule>> LoadRestrictionsAsync();
    }

    public class ComplianceValidationService : IComplianceValidationService
    {
        private readonly ILogger<ComplianceValidationService> _logger;
        private readonly string _csvPath;
        private List<ShippingRestrictionRule> _cachedRules;

        // Define critical fields required in all shipments
        private static readonly HashSet<string> CriticalFields = new()
        {
            "origin_country", "destination_country", "product_name", "product_description",
            "hs_code", "weight_kg", "mode_of_transport", "package_type", "total_value"
        };

        public ComplianceValidationService(ILogger<ComplianceValidationService> logger)
        {
            _logger = logger;
            _csvPath = "AI/services/document_validator/datasets/cross_border_shipping_restrictions.csv";
        }

        public async Task<ComplianceValidationResult> ValidateShipmentAsync(
            Dictionary<string, string> extractedFields,
            Dictionary<string, string> shipmentFormData,
            string documentType)
        {
            var result = new ComplianceValidationResult
            {
                DocumentType = documentType,
                ExtractedFields = extractedFields
            };

            try
            {
                // 1. Load restriction rules
                if (_cachedRules == null)
                {
                    _cachedRules = await LoadRestrictionsAsync();
                }

                // 2. Validate individual fields
                ValidateFields(extractedFields, shipmentFormData, result);

                // 3. Check for missing critical fields
                CheckMissingFields(extractedFields, result);

                // 4. Extract key information for compliance check
                var origin = GetFieldValue(extractedFields, "origin_country");
                var destination = GetFieldValue(extractedFields, "destination_country");
                var productDesc = GetFieldValue(extractedFields, "product_description");
                var hsCode = GetFieldValue(extractedFields, "hs_code");
                var mode = GetFieldValue(extractedFields, "mode_of_transport");
                var weightStr = GetFieldValue(extractedFields, "weight_kg");
                decimal.TryParse(weightStr, out var weight);

                // 5. Find matching restriction rules
                var matchedRules = FindMatchingRules(origin, destination, productDesc, hsCode, mode);

                // 6. Perform compliance checks
                PerformComplianceChecks(extractedFields, matchedRules, weight, result);

                // 7. Calculate final compliance score
                CalculateComplianceScore(result);

                _logger.LogInformation(
                    "Validation completed for {DocType}: Status={Status}, Score={Score}, Errors={ErrorCount}, Warnings={WarningCount}",
                    documentType, result.ValidationStatus, result.ComplianceScore, result.Errors.Count, result.Warnings.Count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during compliance validation");
                result.Errors.Add(new ValidationError
                {
                    Code = "VALIDATION_ERROR",
                    Message = "An error occurred during compliance validation",
                    Severity = "error",
                    Recommendation = "Please review the document and try again"
                });
                result.ValidationStatus = "rejected";
                result.ComplianceScore = 0;
            }

            return result;
        }

        public async Task<List<ShippingRestrictionRule>> LoadRestrictionsAsync()
        {
            var rules = new List<ShippingRestrictionRule>();
            try
            {
                if (!File.Exists(_csvPath))
                {
                    _logger.LogWarning("CSV file not found at {Path}", _csvPath);
                    return rules;
                }

                var lines = await File.ReadAllLinesAsync(_csvPath);
                if (lines.Length < 2)
                {
                    _logger.LogWarning("CSV file is empty or has no data");
                    return rules;
                }

                // Skip header line (line 0)
                for (int i = 1; i < lines.Length; i++)
                {
                    try
                    {
                        var rule = ParseCsvLine(lines[i]);
                        if (rule != null)
                        {
                            rules.Add(rule);
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Error parsing CSV line {LineNumber}", i + 1);
                    }
                }

                _logger.LogInformation("Loaded {RuleCount} shipping restriction rules from CSV", rules.Count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error loading restrictions CSV from {Path}", _csvPath);
            }

            return rules;
        }

        private ShippingRestrictionRule ParseCsvLine(string line)
        {
            var values = ParseCsvValues(line);
            if (values.Length < 15)
                return null;

            return new ShippingRestrictionRule
            {
                OriginCountry = CleanValue(values[0]),
                OriginCountryIso = CleanValue(values[1]),
                DestinationCountry = CleanValue(values[2]),
                DestinationCountryIso = CleanValue(values[3]),
                Mode = CleanValue(values[4]),
                PackageType = CleanValue(values[5]),
                ProductDescription = CleanValue(values[6]),
                HsCode = CleanValue(values[7]),
                MaxWeightKgPerPackage = decimal.TryParse(CleanValue(values[8]), out var w1) ? w1 : 0,
                MaxTotalWeightKg = decimal.TryParse(CleanValue(values[9]), out var w2) ? w2 : 0,
                IsRestricted = CleanValue(values[10]).Equals("yes", StringComparison.OrdinalIgnoreCase),
                RestrictedDetails = CleanValue(values[11]),
                IsBanned = CleanValue(values[12]).Equals("yes", StringComparison.OrdinalIgnoreCase),
                BannedDetails = CleanValue(values[13]),
                PackingNotes = CleanValue(values[14])
            };
        }

        private string[] ParseCsvValues(string line)
        {
            // Handle CSV with quoted values
            var values = new List<string>();
            var current = new System.Text.StringBuilder();
            var inQuotes = false;

            for (int i = 0; i < line.Length; i++)
            {
                var c = line[i];

                if (c == '"')
                {
                    inQuotes = !inQuotes;
                }
                else if (c == ',' && !inQuotes)
                {
                    values.Add(current.ToString());
                    current.Clear();
                }
                else
                {
                    current.Append(c);
                }
            }

            values.Add(current.ToString());
            return values.ToArray();
        }

        private string CleanValue(string value)
        {
            return value?.Trim(' ', '"') ?? string.Empty;
        }

        private void ValidateFields(Dictionary<string, string> extracted, Dictionary<string, string> form, ComplianceValidationResult result)
        {
            // Validate each field is present and properly formatted
            var fieldsToValidate = new[]
            {
                ("invoice_number", "Invoice Number", false),
                ("tracking_number", "Tracking Number", false),
                ("weight_kg", "Weight (KG)", true),
                ("total_value", "Total Value", true),
                ("hs_code", "HS Code", true),
                ("origin_country", "Origin Country", true),
                ("destination_country", "Destination Country", true),
                ("product_name", "Product Name", true),
                ("product_description", "Product Description", true),
                ("mode_of_transport", "Mode of Transport", true),
                ("package_type", "Package Type", true),
                ("shipper_name", "Shipper Name", false),
                ("consignee_name", "Consignee Name", false)
            };

            foreach (var (field, label, isCritical) in fieldsToValidate)
            {
                var extracted_value = GetFieldValue(extracted, field);
                var form_value = GetFieldValue(form, field);

                var validation = new FieldValidation
                {
                    FieldName = field,
                    IsCritical = isCritical,
                    ExtractedValue = extracted_value
                };

                // Check if field exists
                if (string.IsNullOrWhiteSpace(extracted_value))
                {
                    validation.IsValid = false;
                    validation.ValidationMessage = $"Field '{label}' is missing from document";
                }
                // Check if extracted matches form (if form value provided)
                else if (!string.IsNullOrWhiteSpace(form_value) && !extracted_value.Equals(form_value, StringComparison.OrdinalIgnoreCase))
                {
                    validation.IsValid = false;
                    validation.ValidationMessage = $"Mismatch detected: Document shows '{extracted_value}' but form shows '{form_value}'";
                }
                // Validate format
                else if (!ValidateFieldFormat(field, extracted_value))
                {
                    validation.IsValid = false;
                    validation.ValidationMessage = $"Invalid format for field '{label}'";
                }
                else
                {
                    validation.IsValid = true;
                    validation.ValidationMessage = "Valid";
                }

                result.FieldValidations[field] = validation;

                // Add errors for failed critical field validations
                if (!validation.IsValid && isCritical)
                {
                    result.Errors.Add(new ValidationError
                    {
                        Code = "FIELD_VALIDATION_FAILED",
                        Message = validation.ValidationMessage,
                        Severity = "error",
                        AffectedField = field,
                        Recommendation = $"Ensure '{label}' is correctly filled in both document and shipment form"
                    });
                }
            }
        }

        private bool ValidateFieldFormat(string field, string value)
        {
            if (string.IsNullOrWhiteSpace(value))
                return false;

            return field switch
            {
                "weight_kg" => decimal.TryParse(value, out var w) && w > 0,
                "total_value" => decimal.TryParse(value, out var v) && v >= 0,
                "hs_code" => value.Length >= 6 && Regex.IsMatch(value, @"^\d+$"),
                _ => true
            };
        }

        private void CheckMissingFields(Dictionary<string, string> extracted, ComplianceValidationResult result)
        {
            foreach (var field in CriticalFields)
            {
                var value = GetFieldValue(extracted, field);
                if (string.IsNullOrWhiteSpace(value))
                {
                    result.MissingCriticalFields.Add(field);
                    result.Errors.Add(new ValidationError
                    {
                        Code = "MISSING_CRITICAL_FIELD",
                        Message = $"Critical field '{field}' is missing from the document",
                        Severity = "error",
                        AffectedField = field,
                        Recommendation = $"Ensure the document contains information for {field}"
                    });
                }
            }
        }

        private List<ShippingRestrictionRule> FindMatchingRules(
            string origin, string destination, string productDesc, string hsCode, string mode)
        {
            var matches = new List<ShippingRestrictionRule>();

            if (_cachedRules == null || _cachedRules.Count == 0)
                return matches;

            // Normalize inputs
            var originLower = origin?.ToLower() ?? string.Empty;
            var destLower = destination?.ToLower() ?? string.Empty;
            var prodLower = productDesc?.ToLower() ?? string.Empty;
            var hsLower = hsCode?.ToLower() ?? string.Empty;
            var modeLower = mode?.ToLower() ?? string.Empty;

            // Find all matching rules with scoring
            var scored = _cachedRules
                .Select(r => new
                {
                    Rule = r,
                    Score = CalculateMatchScore(r, originLower, destLower, prodLower, hsLower, modeLower)
                })
                .Where(x => x.Score > 0)
                .OrderByDescending(x => x.Score)
                .ToList();

            // Return top matches
            return scored.Take(5).Select(x => x.Rule).ToList();
        }

        private int CalculateMatchScore(ShippingRestrictionRule rule, string originLower, string destLower, string prodLower, string hsLower, string modeLower)
        {
            int score = 0;

            // Exact matches are worth more
            if (rule.OriginCountry?.ToLower() == originLower)
                score += 40;
            if (rule.DestinationCountry?.ToLower() == destLower)
                score += 40;
            if (rule.ProductDescription?.ToLower().Contains(prodLower) == true)
                score += 30;
            if (rule.HsCode == hsLower)
                score += 25;
            if (rule.Mode?.ToLower() == modeLower)
                score += 15;

            return score;
        }

        private void PerformComplianceChecks(
            Dictionary<string, string> fields,
            List<ShippingRestrictionRule> rules,
            decimal weight,
            ComplianceValidationResult result)
        {
            var productDesc = GetFieldValue(fields, "product_description");

            // Check for banned keywords
            if (ContainsBannedKeywords(productDesc))
            {
                result.Errors.Add(new ValidationError
                {
                    Code = "BANNED_PRODUCT",
                    Message = $"Product contains banned keywords: {productDesc}",
                    Severity = "critical",
                    AffectedField = "product_description",
                    Recommendation = "This shipment cannot be processed. Consult compliance team."
                });
                result.RiskFactors.Add("Banned keywords detected in product description");
            }

            if (rules.Any(r => r.IsBanned))
            {
                result.Errors.Add(new ValidationError
                {
                    Code = "BANNED_ROUTE",
                    Message = $"This product cannot be shipped via this route. Details: {rules.First(r => r.IsBanned).BannedDetails}",
                    Severity = "critical",
                    AffectedField = "shipping_route",
                    Recommendation = "This shipment is banned. No shipment can proceed on this route."
                });
                result.RiskFactors.Add("Banned product-route combination");
                result.ComplianceDetails.IsBanned = true;
                result.ComplianceDetails.BannedDetails = rules.First(r => r.IsBanned).BannedDetails;
            }

            // Check for restrictions
            foreach (var rule in rules)
            {
                if (rule.IsRestricted)
                {
                    result.Warnings.Add(new ValidationWarning
                    {
                        Code = "RESTRICTED_PRODUCT",
                        Message = $"Product is restricted on this route: {rule.RestrictedDetails}",
                        AffectedField = "shipping_route",
                        Resolution = "Additional documents/permits may be required"
                    });
                    result.RiskFactors.Add("Restricted product route");
                    result.ComplianceDetails.IsRestricted = true;
                    result.ComplianceDetails.RestrictedDetails = rule.RestrictedDetails;

                    // Extract required certifications from restriction details
                    ExtractRequiredDocuments(rule.RestrictedDetails, result.ComplianceDetails);
                }

                // Check weight limits
                if (weight > 0)
                {
                    result.ComplianceDetails.ActualWeightKg = weight;
                    result.ComplianceDetails.MaxWeightPerPackageKg = rule.MaxWeightKgPerPackage;
                    result.ComplianceDetails.MaxTotalWeightKg = rule.MaxTotalWeightKg;

                    if (rule.MaxWeightKgPerPackage > 0 && weight > rule.MaxWeightKgPerPackage)
                    {
                        result.Errors.Add(new ValidationError
                        {
                            Code = "WEIGHT_EXCEEDS_LIMIT",
                            Message = $"Weight {weight}kg exceeds per-package limit of {rule.MaxWeightKgPerPackage}kg",
                            Severity = "error",
                            AffectedField = "weight_kg",
                            Recommendation = $"Split shipment into smaller packages, max {rule.MaxWeightKgPerPackage}kg each"
                        });
                    }
                }

                // Store packing requirements
                if (!string.IsNullOrWhiteSpace(rule.PackingNotes))
                {
                    result.ComplianceDetails.PackingNotes = rule.PackingNotes;
                }
            }
        }

        private bool ContainsBannedKeywords(string text)
        {
            if (string.IsNullOrWhiteSpace(text))
                return false;

            var bannedKeywords = new[] { "banned", "prohibited", "counterfeit", "hazmat", "dangerous" };
            var textLower = text.ToLower();
            return bannedKeywords.Any(kw => textLower.Contains(kw));
        }

        private void ExtractRequiredDocuments(string restrictionDetails, ComplianceDetails details)
        {
            if (string.IsNullOrWhiteSpace(restrictionDetails))
                return;

            var detailsLower = restrictionDetails.ToLower();
            var documentKeywords = new Dictionary<string, string>
            {
                { "certificate", "Health/Quality Certificate" },
                { "license", "Import/Export License" },
                { "permit", "Import Permit" },
                { "gmp", "GMP Certificate" },
                { "phytosanitary", "Phytosanitary Certificate" },
                { "veterinary", "Veterinary Health Certificate" },
                { "cites", "CITES Permit" },
                { "sds", "Safety Data Sheet" },
                { "iata", "IATA Declaration" },
                { "dg declaration", "DG Declaration" }
            };

            foreach (var (keyword, document) in documentKeywords)
            {
                if (detailsLower.Contains(keyword) && !details.RequiredDocuments.Contains(document))
                {
                    details.RequiredDocuments.Add(document);
                }
            }
        }

        private void CalculateComplianceScore(ComplianceValidationResult result)
        {
            decimal score = 100m;

            // Deduct points for errors and warnings
            score -= result.Errors.Count * 20;
            score -= result.Warnings.Count * 10;
            score -= result.MissingCriticalFields.Count * 15;

            // Deduct for invalid field validations
            var invalidFields = result.FieldValidations.Values.Count(f => !f.IsValid);
            score -= invalidFields * 5;

            // Determine validation status
            if (result.Errors.Any(e => e.Severity == "critical"))
            {
                result.ValidationStatus = "rejected";
                result.RiskLevel = "critical";
            }
            else if (result.Errors.Count > 0 || result.MissingCriticalFields.Count > 0)
            {
                result.ValidationStatus = "rejected";
                result.RiskLevel = "high";
            }
            else if (result.Warnings.Count > 0)
            {
                result.ValidationStatus = "warning";
                result.RiskLevel = "medium";
            }
            else if (result.FieldValidations.Values.All(f => f.IsValid))
            {
                result.ValidationStatus = "approved";
                result.RiskLevel = "low";
            }

            result.ComplianceScore = Math.Max(0, Math.Min(100, score));
        }

        private string GetFieldValue(Dictionary<string, string> dict, string key)
        {
            if (dict == null)
                return string.Empty;

            return dict.TryGetValue(key, out var value) ? value?.Trim() ?? string.Empty : string.Empty;
        }
    }
}
