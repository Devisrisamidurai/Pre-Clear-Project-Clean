using System;
using System.Collections.Generic;

namespace PreClear.Api.Models
{
    /// <summary>
    /// Comprehensive validation result from document and compliance analysis
    /// </summary>
    public class ComplianceValidationResult
    {
        // Overall Status
        public bool IsCompliant { get; set; }
        public string ValidationStatus { get; set; } = "pending"; // pending | approved | rejected | warning
        public decimal ComplianceScore { get; set; } // 0-100

        // Field-level validations
        public Dictionary<string, FieldValidation> FieldValidations { get; set; } = new();

        // Extracted Fields
        public Dictionary<string, string> ExtractedFields { get; set; } = new();

        // Issues Found
        public List<ValidationError> Errors { get; set; } = new();
        public List<ValidationWarning> Warnings { get; set; } = new();
        public List<string> MissingCriticalFields { get; set; } = new();

        // Compliance Details
        public ComplianceDetails ComplianceDetails { get; set; } = new();

        // Risk Assessment
        public string RiskLevel { get; set; } = "low"; // low | medium | high | critical
        public List<string> RiskFactors { get; set; } = new();

        // Document Summary
        public string DocumentType { get; set; }
        public DateTime AnalyzedAt { get; set; } = DateTime.UtcNow;
        public string AnalysisNotes { get; set; }
    }

    /// <summary>
    /// Validation status for individual fields
    /// </summary>
    public class FieldValidation
    {
        public string FieldName { get; set; }
        public string ExtractedValue { get; set; }
        public bool IsValid { get; set; }
        public string ValidationMessage { get; set; }
        public bool IsCritical { get; set; }
    }

    /// <summary>
    /// Validation errors (critical issues)
    /// </summary>
    public class ValidationError
    {
        public string Code { get; set; }
        public string Message { get; set; }
        public string Severity { get; set; } = "error"; // error | critical
        public string AffectedField { get; set; }
        public string Recommendation { get; set; }
    }

    /// <summary>
    /// Validation warnings (non-critical issues)
    /// </summary>
    public class ValidationWarning
    {
        public string Code { get; set; }
        public string Message { get; set; }
        public string AffectedField { get; set; }
        public string Resolution { get; set; }
    }

    /// <summary>
    /// Compliance-specific details from CSV rules
    /// </summary>
    public class ComplianceDetails
    {
        public string OriginCountry { get; set; }
        public string DestinationCountry { get; set; }
        public string ProductDescription { get; set; }
        public string HsCode { get; set; }
        public string ModeOfTransport { get; set; }
        public string PackageType { get; set; }

        // Restrictions from CSV
        public bool IsRestricted { get; set; }
        public string RestrictedDetails { get; set; }
        public bool IsBanned { get; set; }
        public string BannedDetails { get; set; }
        
        // Weight Limits (in KG)
        public decimal MaxWeightPerPackageKg { get; set; }
        public decimal MaxTotalWeightKg { get; set; }
        public decimal ActualWeightKg { get; set; }

        // Packing Requirements
        public string PackingNotes { get; set; }

        // Required Documents
        public List<string> RequiredDocuments { get; set; } = new();

        // Certifications/Licenses Required
        public List<string> RequiredCertifications { get; set; } = new();
    }
}
