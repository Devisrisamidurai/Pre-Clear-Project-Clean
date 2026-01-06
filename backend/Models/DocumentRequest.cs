using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

namespace PreClear.Api.Models
{
    /// <summary>
    /// Represents a request from a broker for additional documents
    /// </summary>
    public class DocumentRequest
    {
        public long Id { get; set; }

        /// <summary>
        /// FK to the shipment this request is for
        /// </summary>
        public long ShipmentId { get; set; }

        /// <summary>
        /// The broker requesting the documents
        /// </summary>
        public long RequestedByBrokerId { get; set; }

        /// <summary>
        /// Comma-separated list of requested document names/types
        /// </summary>
        public string RequestedDocumentNames { get; set; } = string.Empty;

        /// <summary>
        /// Message from broker to shipper explaining why documents are needed
        /// </summary>
        public string? RequestMessage { get; set; }

        /// <summary>
        /// Status of the request (pending, fulfilled, cancelled)
        /// </summary>
        public string Status { get; set; } = "pending"; // pending, fulfilled, cancelled

        /// <summary>
        /// When the request was made
        /// </summary>
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        /// <summary>
        /// When the request was fulfilled or resolved
        /// </summary>
        public DateTime? FulfilledAt { get; set; }

        /// <summary>
        /// Navigation property
        /// </summary>
        public virtual Shipment Shipment { get; set; }
    }

    /// <summary>
    /// Request DTO for creating a document request
    /// </summary>
    public class CreateDocumentRequestDto
    {
        /// <summary>
        /// List of document names/types being requested
        /// </summary>
        [Required]
        [MinLength(1)]
        public List<string> DocumentNames { get; set; } = new();

        /// <summary>
        /// Message from broker to shipper
        /// </summary>
        [Required]
        public string Message { get; set; }
    }
}
