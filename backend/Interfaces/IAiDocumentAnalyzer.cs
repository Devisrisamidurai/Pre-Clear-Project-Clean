using System.Collections.Generic;
using System.Threading.Tasks;
using PreClear.Api.Models;

namespace PreClear.Api.Interfaces
{
    /// <summary>
    /// AI-powered analyzer that parses unstructured document text into structured fields
    /// and validates compliance against shipping restrictions.
    /// Implementations may use Azure OpenAI, OpenAI, Bedrock, or other LLM providers.
    /// </summary>
    public interface IAiDocumentAnalyzer
    {
        /// <summary>
        /// Extracts fields from document content
        /// </summary>
        Task<Dictionary<string, string>> ExtractFieldsAsync(string content, string documentType);

        /// <summary>
        /// Validates extracted fields and performs comprehensive compliance checks
        /// against CSV rules and shipment form data
        /// </summary>
        Task<ComplianceValidationResult> ValidateAndComplianceCheckAsync(
            string content,
            string documentType,
            Dictionary<string, string> shipmentFormData);
    }
}
