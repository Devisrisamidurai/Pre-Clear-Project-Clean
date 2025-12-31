using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;
using System.Text.Json;

namespace PreClear.Api.Models
{
    [Table("shipment_documents")]
    public class ShipmentDocument
    {
        [Key]
        [Column("id")]
        public long Id { get; set; }

        [Column("shipment_id")]
        [Required]
        public long ShipmentId { get; set; }

        [Column("document_type")]
        [MaxLength(100)]
        [Required]
        public string DocumentType { get; set; } = null!; // Commercial Invoice, Packing List, etc.

        [Column("file_name")]
        [MaxLength(255)]
        [Required]
        public string FileName { get; set; } = null!;

        [Column("file_path")]
        [MaxLength(500)]
        public string? FilePath { get; set; }

        [Column("file_size")]
        public long? FileSize { get; set; }

        [Column("mime_type")]
        [MaxLength(100)]
        public string? MimeType { get; set; }

        // Validation (AI validator results)
        [Column("validation_status")]
        [MaxLength(20)]
        public string? ValidationStatus { get; set; } // not-validated, pass, warning, fail

        [Column("validation_confidence")]
        public decimal? ValidationConfidence { get; set; }

        [Column("validation_notes", TypeName = "json")]
        public string? ValidationNotesJson { get; set; }

        [Column("uploaded_by")]
        public long? UploadedBy { get; set; }

        [Column("uploaded_at")]
        public DateTime UploadedAt { get; set; } = DateTime.UtcNow;

        // Document replacement tracking
        [Column("is_active")]
        public bool IsActive { get; set; } = true;

        [Column("replaced_by_document_id")]
        public long? ReplacedByDocumentId { get; set; }

        [Column("replaced_at")]
        public DateTime? ReplacedAt { get; set; }

        // Navigation
        [ForeignKey("ShipmentId")]
        [JsonIgnore]
        public Shipment? Shipment { get; set; }

        [ForeignKey("UploadedBy")]
        public User? Uploader { get; set; }

        [NotMapped]
        public string? DownloadUrl { get; set; }
    }

    public class MarkUploadedRequest
    {
        public string DocumentName { get; set; } = string.Empty;
    }
}
