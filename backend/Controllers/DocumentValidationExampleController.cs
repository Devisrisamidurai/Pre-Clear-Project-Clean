using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using PreClear.Api.Interfaces;
using PreClear.Api.Models;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace PreClear.Api.Controllers
{
    /// <summary>
    /// Example controller showing how to use the enhanced AI Document Analyzer
    /// with comprehensive field validation and compliance checking
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class DocumentValidationExampleController : ControllerBase
    {
        private readonly IAiDocumentAnalyzer _documentAnalyzer;
        private readonly ILogger<DocumentValidationExampleController> _logger;

        public DocumentValidationExampleController(
            IAiDocumentAnalyzer documentAnalyzer,
            ILogger<DocumentValidationExampleController> logger)
        {
            _documentAnalyzer = documentAnalyzer;
            _logger = logger;
        }

        /// <summary>
        /// Validates a document with comprehensive field checking and compliance verification
        /// against the cross-border shipping restrictions CSV
        /// </summary>
        /// <remarks>
        /// This endpoint:
        /// 1. Extracts all fields from the document using Bedrock AI
        /// 2. Validates each field format and presence
        /// 3. Checks for missing critical fields
        /// 4. Matches against CSV restriction rules
        /// 5. Verifies compliance (no bans, respects restrictions)
        /// 6. Checks weight limits and packing requirements
        /// 7. Returns comprehensive validation result with score
        /// 
        /// Validation Status:
        /// - "approved": All fields valid, no compliance issues
        /// - "warning": Fields valid but restrictions/requirements exist
        /// - "rejected": Critical errors or missing fields
        /// 
        /// Risk Levels:
        /// - "low": Approved, fully compliant
        /// - "medium": Warnings present, additional review recommended
        /// - "high": Non-critical errors present
        /// - "critical": Banned items, critical errors
        /// </remarks>
        [HttpPost("validate-with-compliance")]
        public async Task<IActionResult> ValidateDocumentWithCompliance(
            [FromBody] DocumentValidationRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.DocumentContent))
                return BadRequest(new { error = "Document content is required" });

            try
            {
                _logger.LogInformation(
                    "Starting document validation: Type={DocType}, ContentLength={Length}",
                    request.DocumentType ?? "unknown",
                    request.DocumentContent.Length);

                // Perform comprehensive validation with compliance checking
                var validationResult = await _documentAnalyzer.ValidateAndComplianceCheckAsync(
                    content: request.DocumentContent,
                    documentType: request.DocumentType ?? "document",
                    shipmentFormData: request.ShipmentFormData ?? new Dictionary<string, string>());

                // Log validation summary
                _logger.LogInformation(
                    "Document validation complete: Status={Status}, Score={Score}, RiskLevel={RiskLevel}, ErrorCount={Errors}, WarningCount={Warnings}",
                    validationResult.ValidationStatus,
                    validationResult.ComplianceScore,
                    validationResult.RiskLevel,
                    validationResult.Errors.Count,
                    validationResult.Warnings.Count);

                // Build response based on validation status
                return validationResult.ValidationStatus switch
                {
                    // Document is compliant and approved
                    "approved" => Ok(new
                    {
                        status = "success",
                        message = "Document approved - all fields valid and compliant",
                        validationResult = new
                        {
                            complianceScore = validationResult.ComplianceScore,
                            riskLevel = validationResult.RiskLevel,
                            validationStatus = validationResult.ValidationStatus,
                            extractedFields = validationResult.ExtractedFields,
                            complianceDetails = validationResult.ComplianceDetails,
                            requiredDocuments = validationResult.ComplianceDetails.RequiredDocuments,
                            packingNotes = validationResult.ComplianceDetails.PackingNotes
                        }
                    }),

                    // Document has warnings, manual review recommended
                    "warning" => Ok(new
                    {
                        status = "warning",
                        message = "Document requires manual review - restrictions or special requirements apply",
                        validationResult = new
                        {
                            complianceScore = validationResult.ComplianceScore,
                            riskLevel = validationResult.RiskLevel,
                            validationStatus = validationResult.ValidationStatus,
                            extractedFields = validationResult.ExtractedFields,
                            warnings = validationResult.Warnings,
                            complianceDetails = validationResult.ComplianceDetails,
                            requiredDocuments = validationResult.ComplianceDetails.RequiredDocuments,
                            recommendations = validationResult.Warnings.ConvertAll(w => w.Resolution)
                        }
                    }),

                    // Document validation failed
                    _ => BadRequest(new
                    {
                        status = "error",
                        message = "Document validation failed - cannot proceed with shipment",
                        validationResult = new
                        {
                            complianceScore = validationResult.ComplianceScore,
                            riskLevel = validationResult.RiskLevel,
                            validationStatus = validationResult.ValidationStatus,
                            errors = validationResult.Errors.ConvertAll(e => new
                            {
                                code = e.Code,
                                severity = e.Severity,
                                message = e.Message,
                                field = e.AffectedField,
                                recommendation = e.Recommendation
                            }),
                            missingFields = validationResult.MissingCriticalFields,
                            extractedFields = validationResult.ExtractedFields,
                            complianceDetails = validationResult.ComplianceDetails
                        }
                    })
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during document validation");
                return StatusCode(500, new
                {
                    error = "An error occurred during validation",
                    message = ex.Message
                });
            }
        }

        /// <summary>
        /// Validates specific fields without full compliance checking
        /// Useful for quick field extraction and validation
        /// </summary>
        [HttpPost("extract-fields")]
        public async Task<IActionResult> ExtractFields([FromBody] DocumentValidationRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.DocumentContent))
                return BadRequest(new { error = "Document content is required" });

            try
            {
                var extractedFields = await _documentAnalyzer.ExtractFieldsAsync(
                    request.DocumentContent,
                    request.DocumentType ?? "document");

                return Ok(new
                {
                    status = "success",
                    message = "Fields extracted successfully",
                    extractedFields = extractedFields,
                    fieldCount = extractedFields.Count
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error extracting fields");
                return StatusCode(500, new { error = "Field extraction failed", message = ex.Message });
            }
        }
    }

    /// <summary>
    /// Request model for document validation
    /// </summary>
    public class DocumentValidationRequest
    {
        /// <summary>
        /// The document content (text extracted from PDF, image, etc.)
        /// </summary>
        public string DocumentContent { get; set; }

        /// <summary>
        /// Type of document (invoice, bill-of-lading, packing-list, etc.)
        /// </summary>
        public string DocumentType { get; set; } = "document";

        /// <summary>
        /// Shipment form data to cross-validate against document extraction
        /// Keys: origin_country, destination_country, hs_code, weight_kg, etc.
        /// </summary>
        public Dictionary<string, string> ShipmentFormData { get; set; }
    }
}
