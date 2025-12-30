using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using PreClear.Api.Data;
using PreClear.Api.Interfaces;
using PreClear.Api.Models;
using PreClear.Api.Services;

namespace PreClear.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ShipmentsController : ControllerBase
    {
        private readonly IShipmentService _service;
        private readonly BrokerAssignmentService _brokerAssignment;
        private readonly ILogger<ShipmentsController> _logger;
        private readonly INotificationService _notificationService;
        private readonly IDocumentService _documentService;
        private readonly PreclearDbContext _db;

        public ShipmentsController(IShipmentService service, BrokerAssignmentService brokerAssignment, ILogger<ShipmentsController> logger, INotificationService notificationService, IDocumentService documentService, PreclearDbContext db)
        {
            _service = service;
            _brokerAssignment = brokerAssignment;
            _logger = logger;
            _notificationService = notificationService;
            _documentService = documentService;
            _db = db;
        }

        private PreClear.Api.Models.NormalizedShipmentDto MapNormalized(PreClear.Api.Models.ShipmentDetailDto detail)
        {
            var s = detail.Shipment;
            var shipper = detail.Parties.FirstOrDefault(p => p.PartyType == "shipper");
            var consignee = detail.Parties.FirstOrDefault(p => p.PartyType == "consignee");

            // CRITICAL: Fallback to creator's user profile if shipper party data is missing or incomplete
            // Always enrich with user data for ContactName, Email, Phone if they're empty
            var creator = _db.Users
                .Include(u => u.ShipperProfile)
                .FirstOrDefault(u => u.Id == s.CreatedBy);
            
            if (creator != null)
            {
                _logger.LogInformation("Shipment {ShipmentId}: Loaded creator user {UserId} - {FirstName} {LastName}, Company: {Company}, Email: {Email}, Phone: {Phone}", 
                    s.Id, creator.Id, creator.FirstName, creator.LastName, creator.Company, creator.Email, creator.Phone);
                
                if (shipper == null)
                {
                    // Create shipper from user profile
                    shipper = new PreClear.Api.Models.ShipmentParty
                    {
                        PartyType = "shipper",
                        CompanyName = creator.Company ?? "",
                        ContactName = $"{creator.FirstName} {creator.LastName}".Trim(),
                        Email = creator.Email ?? "",
                        Phone = creator.Phone ?? "",
                        Address1 = creator.ShipperProfile?.AddressLine1 ?? "",
                        Address2 = creator.ShipperProfile?.AddressLine2 ?? "",
                        City = creator.ShipperProfile?.City ?? "",
                        State = creator.ShipperProfile?.State ?? "",
                        PostalCode = creator.ShipperProfile?.PostalCode ?? "",
                        Country = creator.ShipperProfile?.CountryCode ?? ""
                    };
                    _logger.LogInformation("Shipment {ShipmentId}: Created shipper from user profile - Company: {Company}, Contact: {Contact}, Email: {Email}",
                        s.Id, shipper.CompanyName, shipper.ContactName, shipper.Email);
                }
                else
                {
                    // ALWAYS fill in ContactName, Email, Phone from user profile if missing
                    var needsEnrichment = false;
                    
                    if (string.IsNullOrWhiteSpace(shipper.CompanyName)) 
                    { 
                        shipper.CompanyName = creator.Company ?? "";
                        needsEnrichment = true;
                    }
                    
                    if (string.IsNullOrWhiteSpace(shipper.ContactName)) 
                    { 
                        shipper.ContactName = $"{creator.FirstName} {creator.LastName}".Trim();
                        needsEnrichment = true;
                        _logger.LogInformation("Shipment {ShipmentId}: Enriched ContactName from user: {ContactName}", s.Id, shipper.ContactName);
                    }
                    
                    if (string.IsNullOrWhiteSpace(shipper.Email)) 
                    { 
                        shipper.Email = creator.Email ?? "";
                        needsEnrichment = true;
                        _logger.LogInformation("Shipment {ShipmentId}: Enriched Email from user: {Email}", s.Id, shipper.Email);
                    }
                    
                    if (string.IsNullOrWhiteSpace(shipper.Phone)) 
                    { 
                        shipper.Phone = creator.Phone ?? "";
                        needsEnrichment = true;
                        _logger.LogInformation("Shipment {ShipmentId}: Enriched Phone from user: {Phone}", s.Id, shipper.Phone);
                    }
                    
                    if (string.IsNullOrWhiteSpace(shipper.Address1)) 
                    { 
                        shipper.Address1 = creator.ShipperProfile?.AddressLine1 ?? "";
                        needsEnrichment = true;
                    }
                    
                    if (string.IsNullOrWhiteSpace(shipper.City)) 
                    { 
                        shipper.City = creator.ShipperProfile?.City ?? "";
                        needsEnrichment = true;
                    }
                    
                    if (string.IsNullOrWhiteSpace(shipper.Country)) 
                    { 
                        shipper.Country = creator.ShipperProfile?.CountryCode ?? "";
                        needsEnrichment = true;
                    }
                    
                    if (needsEnrichment)
                    {
                        _logger.LogInformation("Shipment {ShipmentId}: Enriched shipper with user profile data - Contact: {Contact}, Email: {Email}, Phone: {Phone}",
                            s.Id, shipper.ContactName, shipper.Email, shipper.Phone);
                    }
                }
            }
            else
            {
                _logger.LogError("Shipment {ShipmentId}: Could not load creator user {CreatedBy}", s.Id, s.CreatedBy);
            }

            if (shipper != null)
            {
                _logger.LogInformation("Shipment {ShipmentId}: Final shipper data - Company: {Company}, Contact: {Contact}, Email: {Email}, Phone: {Phone}",
                    s.Id, shipper.CompanyName, shipper.ContactName, shipper.Email, shipper.Phone);
            }

            var normalized = new PreClear.Api.Models.NormalizedShipmentDto
            {
                id = s.Id,
                referenceId = s.ReferenceId,
                title = s.ShipmentName,
                mode = s.Mode,
                shipmentType = s.ShipmentType,
                serviceLevel = s.ServiceLevel,
                currency = s.Currency,
                customsValue = s.CustomsValue,
                pricingTotal = s.PricingTotal,
                pickupType = s.PickupType,
                pickupLocation = s.PickupLocation,
                pickupDate = s.PickupDate,
                pickupTimeEarliest = s.PickupTimeEarliest,
                pickupTimeLatest = s.PickupTimeLatest,
                estimatedDropoffDate = s.EstimatedDropoffDate,
                status = s.Status,
                aiApprovalStatus = s.AiApprovalStatus,
                brokerApprovalStatus = s.BrokerApprovalStatus,
                aiComplianceScore = s.AiComplianceScore,
                preclearToken = s.PreclearToken,
                tokenGeneratedAt = s.TokenGeneratedAt,
                assignedBrokerId = s.AssignedBrokerId,
                createdAt = s.CreatedAt,
                updatedAt = s.UpdatedAt,
                shipper = shipper == null ? null : new PreClear.Api.Models.PartyView
                {
                    company = shipper.CompanyName,
                    contactName = shipper.ContactName,
                    phone = shipper.Phone,
                    email = shipper.Email,
                    address1 = shipper.Address1,
                    address2 = shipper.Address2,
                    city = shipper.City,
                    state = shipper.State,
                    postalCode = shipper.PostalCode,
                    country = shipper.Country,
                    taxId = shipper.TaxId
                },
                consignee = consignee == null ? null : new PreClear.Api.Models.PartyView
                {
                    company = consignee.CompanyName,
                    contactName = consignee.ContactName,
                    phone = consignee.Phone,
                    email = consignee.Email,
                    address1 = consignee.Address1,
                    address2 = consignee.Address2,
                    city = consignee.City,
                    state = consignee.State,
                    postalCode = consignee.PostalCode,
                    country = consignee.Country,
                    taxId = consignee.TaxId
                },
                services = new PreClear.Api.Models.ServiceView
                {
                    serviceLevel = s.ServiceLevel,
                    currency = s.Currency,
                    customsValue = s.CustomsValue
                }
            };

            // Packages with nested products
            var packagesById = detail.Packages.ToDictionary(p => p.Id);
            var productsByPackage = detail.Items.GroupBy(i => i.PackageId).ToDictionary(g => g.Key, g => g.ToList());

            foreach (var pkg in detail.Packages)
            {
                var view = new PreClear.Api.Models.PackageView
                {
                    type = pkg.PackageType,
                    length = pkg.Length,
                    width = pkg.Width,
                    height = pkg.Height,
                    dimUnit = pkg.DimensionUnit,
                    weight = pkg.Weight,
                    weightUnit = pkg.WeightUnit,
                    stackable = pkg.Stackable
                };

                if (productsByPackage.TryGetValue(pkg.Id, out var prods))
                {
                    foreach (var prod in prods)
                    {
                        view.products.Add(new PreClear.Api.Models.ProductView
                        {
                            name = prod.Name,
                            description = prod.Description,
                            category = prod.Category,
                            hsCode = prod.HsCode,
                            qty = prod.Quantity,
                            uom = prod.Unit,
                            unitPrice = prod.UnitPrice,
                            totalValue = prod.TotalValue,
                            originCountry = prod.OriginCountry,
                            reasonForExport = prod.ExportReason
                        });
                    }
                }

                normalized.packages.Add(view);
            }

            // Documents object can be filled later; keep empty object for UI compatibility
            normalized.documents = new { };

            return normalized;
        }

        /// <summary>
        /// Extract userId from JWT claims
        /// </summary>
        private long? GetUserId()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier);
            if (userIdClaim != null && long.TryParse(userIdClaim.Value, out var userId))
            {
                return userId;
            }
            return null;
        }

        /// <summary>
        /// Get user role from claims
        /// </summary>
        private string? GetUserRole()
        {
            return User.FindFirst(ClaimTypes.Role)?.Value;
        }

        // POST: api/shipments (Create new shipment)
        [Authorize]
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] UpsertShipmentDto dto)
        {
            if (dto == null) return BadRequest(new { error = "invalid_payload" });

            try
            {
                var created = await _service.CreateAsync(dto);
                
                // Broker assignment removed - now triggered manually via "Request Broker Review" button after AI approval

                // Reload shipment details
                var updated = await _service.GetDetailAsync(created.Id);
                if (updated == null) return StatusCode(500, new { error = "internal_error" });
                var normalized = MapNormalized(updated);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, normalized);
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogWarning(ex, "Unauthorized shipment creation");
                return Unauthorized(new { error = "not_authenticated", detail = ex.Message });
            }
            catch (ArgumentException aex)
            {
                _logger.LogWarning(aex, "Invalid create shipment request");
                return BadRequest(new { error = "invalid_input", detail = aex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating shipment. Exception: {ExceptionType}, Message: {Message}", ex.GetType().Name, ex.Message);
                return StatusCode(500, new { error = "internal_error", detail = ex.Message, exceptionType = ex.GetType().Name });
            }
        }

        // PATCH: api/shipments/{id}
        [Authorize]
        [HttpPatch("{id:long}")]
        public async Task<IActionResult> Update(long id, [FromBody] UpsertShipmentDto dto)
        {
            if (dto == null) return BadRequest(new { error = "invalid_payload" });
            
            var currentUserId = GetUserId();
            var role = GetUserRole();
            
            if (!currentUserId.HasValue)
            {
                _logger.LogWarning("Update: Unauthorized - No userId in token");
                return Unauthorized(new { error = "not_authenticated" });
            }
            
            try
            {
                // Verify ownership: only creator or admin can update
                var shipment = await _service.GetDetailAsync(id);
                if (shipment == null)
                {
                    _logger.LogWarning("Update: Shipment {Id} not found", id);
                    return NotFound();
                }
                
                _logger.LogInformation("Update: ShipmentId={Id}, CreatedBy={CreatedBy}, CurrentUserId={UserId}, Role={Role}", 
                    id, shipment.Shipment.CreatedBy, currentUserId, role);
                
                if (shipment.Shipment.CreatedBy != currentUserId && role != "admin")
                {
                    _logger.LogWarning("Update: Forbidden - User {UserId} ({Role}) attempted to update shipment {Id} created by {CreatedBy}", 
                        currentUserId, role, id, shipment.Shipment.CreatedBy);
                    return Forbid();
                }
                
                var updated = await _service.UpdateAsync(id, dto);
                if (updated == null) return NotFound();
                
                _logger.LogInformation("Update: Successfully updated shipment {Id}", id);
                var updatedDetail = await _service.GetDetailAsync(id);
                if (updatedDetail == null) return NotFound();
                return Ok(MapNormalized(updatedDetail));
            }
            catch (ArgumentException aex)
            {
                _logger.LogWarning(aex, "Invalid update shipment request for shipment {Id}", id);
                return BadRequest(new { error = "invalid_input", detail = aex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating shipment {Id}", id);
                return StatusCode(500, new { error = "internal_error", detail = ex.Message });
            }
        }

        // PUT: api/shipments/{id}/status
        [Authorize]
        [HttpPut("{id:long}/status")]
        public async Task<IActionResult> UpdateStatus(long id, [FromBody] UpdateStatusRequest req)
        {
            if (req == null || string.IsNullOrWhiteSpace(req.Status))
            {
                _logger.LogWarning("UpdateStatus: Invalid request - status is required");
                return BadRequest(new { error = "status_required" });
            }

            var currentUserId = GetUserId();
            var role = GetUserRole();
            
            if (!currentUserId.HasValue)
            {
                _logger.LogWarning("UpdateStatus: Unauthorized - No userId in token");
                return Unauthorized(new { error = "not_authenticated" });
            }
            
            try
            {
                // Verify ownership: only creator, assigned broker, or admin can update status
                var shipment = await _service.GetDetailAsync(id);
                if (shipment == null)
                {
                    _logger.LogWarning("UpdateStatus: Shipment {Id} not found", id);
                    return NotFound();
                }
                
                _logger.LogInformation("UpdateStatus: ShipmentId={Id}, CreatedBy={CreatedBy}, AssignedBrokerId={BrokerId}, CurrentUserId={UserId}, Role={Role}, NewStatus={Status}",
                    id, shipment.Shipment.CreatedBy, shipment.Shipment.AssignedBrokerId, currentUserId, role, req.Status);
                
                if (shipment.Shipment.CreatedBy != currentUserId && 
                    shipment.Shipment.AssignedBrokerId != currentUserId && 
                    role != "admin")
                {
                    _logger.LogWarning("UpdateStatus: Forbidden - User {UserId} ({Role}) attempted to update status of shipment {Id} (CreatedBy={CreatedBy}, BrokerId={BrokerId})",
                        currentUserId, role, id, shipment.Shipment.CreatedBy, shipment.Shipment.AssignedBrokerId);
                    return Forbid();
                }
                
                var ok = await _service.UpdateStatusAsync(id, req.Status);
                if (!ok)
                {
                    _logger.LogWarning("UpdateStatus: Failed to update status for shipment {Id}", id);
                    return NotFound();
                }
                
                _logger.LogInformation("UpdateStatus: Successfully updated shipment {Id} status to {Status}", id, req.Status);

                // Return full updated shipment object (source of truth)
                var updatedShipment = await _service.GetDetailAsync(id);
                if (updatedShipment == null) return NotFound();
                return Ok(MapNormalized(updatedShipment));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating shipment {Id} status to {Status}", id, req.Status);
                return StatusCode(500, new { error = "internal_error", detail = ex.Message });
            }
        }

        // GET: api/shipments/my-shipments (Ownership filtered - Role-based)
        [Authorize]
        [HttpGet("my-shipments")]
        public async Task<IActionResult> GetMyShipments()
        {
            var userId = GetUserId();
            if (!userId.HasValue)
            {
                _logger.LogWarning("GetMyShipments: Unauthorized - No userId in token");
                return Unauthorized(new { error = "not_authenticated" });
            }

            try
            {
                var role = GetUserRole();
                _logger.LogInformation("GetMyShipments: UserId={UserId}, Role={Role}", userId, role);
                
                if (role == "shipper")
                {
                    // Shippers see only shipments they created (repository already filters by created_by)
                    var list = await _service.GetByUserAsync(userId.Value);
                    _logger.LogInformation("GetMyShipments: Returning {Count} shipments for shipper {UserId}", list.Count, userId);
                    return Ok(list);
                }
                else if (role == "broker")
                {
                    // Brokers see shipments assigned to them - need to query differently
                    var allShipments = await _service.GetAllShipmentsAsync();
                    var brokerShipments = allShipments.Where(s => s.AssignedBrokerId == userId.Value).ToList();
                    _logger.LogInformation("GetMyShipments: Returning {Count} shipments for broker {UserId}", brokerShipments.Count, userId);
                    return Ok(brokerShipments);
                }
                else if (role == "admin")
                {
                    // Admins see all shipments with full details
                    var allShipments = await _service.GetAllShipmentsDetailedAsync();
                    _logger.LogInformation("GetMyShipments: Returning {Count} shipments for admin {UserId}", allShipments.Count, userId);
                    return Ok(allShipments);
                }
                
                _logger.LogWarning("GetMyShipments: Forbidden - Unknown role {Role} for user {UserId}", role, userId);
                return Forbid();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving shipments for user {UserId}", userId);
                return StatusCode(500, new { error = "internal_error", detail = ex.Message });
            }
        }

        // GET: api/shipments/user - Get shipments for the authenticated user only
        [Authorize]
        [HttpGet("user")]
        public async Task<IActionResult> GetByUser()
        {
            var currentUserId = GetUserId();
            
            if (!currentUserId.HasValue)
            {
                _logger.LogWarning("GetByUser: Unauthorized - No userId in JWT token");
                return Unauthorized(new { error = "not_authenticated", message = "User ID not found in authentication token" });
            }

            var role = GetUserRole();
            _logger.LogInformation("GetByUser: Authenticated UserId={UserId}, Role={Role}", currentUserId, role);

            try
            {
                if (role == "broker")
                {
                    var list = await _service.GetBrokerListAsync(currentUserId.Value);
                    _logger.LogInformation("GetByUser: Retrieved {Count} shipments for broker {UserId}", list.Count, currentUserId);
                    return Ok(list);
                }

                // Default: shipper/admin path
                var listDefault = await _service.GetUserListAsync(currentUserId.Value);
                _logger.LogInformation("GetByUser: Retrieved {Count} shipments for authenticated user {UserId}", listDefault.Count, currentUserId);
                return Ok(listDefault);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving shipments for authenticated user {UserId}", currentUserId);
                return StatusCode(500, new { error = "internal_error", detail = ex.Message });
            }
        }

        // GET: api/shipments/user/{id} - Get specific shipment by ID for the authenticated user only
        [Authorize]
        [HttpGet("user/{id:long}")]
        public async Task<IActionResult> GetUserShipmentById(long id)
        {
            var currentUserId = GetUserId();
            var role = GetUserRole();
            
            if (!currentUserId.HasValue)
            {
                _logger.LogWarning("GetUserShipmentById: Unauthorized - No userId in JWT token");
                return Unauthorized(new { error = "not_authenticated" });
            }
            
            try
            {
                var s = await _service.GetDetailAsync(id);
                if (s == null)
                {
                    _logger.LogWarning("GetUserShipmentById: Shipment {Id} not found", id);
                    return NotFound(new { error = "shipment_not_found" });
                }
                
                _logger.LogInformation("GetUserShipmentById: ShipmentId={Id}, CreatedBy={CreatedBy}, AssignedBrokerId={BrokerId}, CurrentUserId={UserId}, Role={Role}, Status={Status}",
                    id, s.Shipment.CreatedBy, s.Shipment.AssignedBrokerId, currentUserId, role, s.Shipment.Status);
                
                // Strict access control: shipper can only see their own shipments
                // Brokers can see assigned shipments, admins see all
                if (role == "shipper")
                {
                    // Shippers can only see shipments they created
                    if (s.Shipment.CreatedBy != currentUserId)
                    {
                        _logger.LogWarning("GetUserShipmentById: Forbidden - Shipper {UserId} attempted to view shipment {Id} created by {CreatedBy}",
                            currentUserId, id, s.Shipment.CreatedBy);
                        return Forbid();
                    }
                }
                else if (role == "broker")
                {
                    // Brokers can see shipments assigned to them or created by them
                    if (s.Shipment.AssignedBrokerId != currentUserId && s.Shipment.CreatedBy != currentUserId)
                    {
                        _logger.LogWarning("GetUserShipmentById: Forbidden - Broker {UserId} attempted to view shipment {Id} (CreatedBy={CreatedBy}, AssignedBrokerId={BrokerId})",
                            currentUserId, id, s.Shipment.CreatedBy, s.Shipment.AssignedBrokerId);
                        return Forbid();
                    }
                }
                else if (role != "admin")
                {
                    _logger.LogWarning("GetUserShipmentById: Forbidden - Unknown role {Role} for user {UserId}", role, currentUserId);
                    return Forbid();
                }
                
                _logger.LogInformation("GetUserShipmentById: Successfully retrieved shipment {Id} for user {UserId}", id, currentUserId);
                return Ok(MapNormalized(s));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting shipment {Id} for user {UserId}", id, currentUserId);
                return StatusCode(500, new { error = "internal_error", detail = ex.Message });
            }
        }

        // GET: api/shipments/{id}
        [Authorize]
        [HttpGet("{id:long}")]
        public async Task<IActionResult> GetById(long id)
        {
            var currentUserId = GetUserId();
            var role = GetUserRole();
            
            if (!currentUserId.HasValue)
            {
                _logger.LogWarning("GetById: Unauthorized - No userId in token");
                return Unauthorized(new { error = "not_authenticated" });
            }
            
            try
            {
                var s = await _service.GetDetailAsync(id);
                if (s == null)
                {
                    _logger.LogWarning("GetById: Shipment {Id} not found", id);
                    return NotFound();
                }
                
                _logger.LogInformation("GetById: ShipmentId={Id}, CreatedBy={CreatedBy}, AssignedBrokerId={BrokerId}, CurrentUserId={UserId}, Role={Role}, Status={Status}",
                    id, s.Shipment.CreatedBy, s.Shipment.AssignedBrokerId, currentUserId, role, s.Shipment.Status);
                
                // Access control: owner, assigned broker, or admin can view
                if (s.Shipment.CreatedBy != currentUserId && 
                    s.Shipment.AssignedBrokerId != currentUserId && 
                    role != "admin")
                {
                    _logger.LogWarning("GetById: Forbidden - User {UserId} ({Role}) attempted to view shipment {Id} (CreatedBy={CreatedBy}, BrokerId={BrokerId})",
                        currentUserId, role, id, s.Shipment.CreatedBy, s.Shipment.AssignedBrokerId);
                    return Forbid();
                }
                
                _logger.LogInformation("GetById: Successfully retrieved shipment {Id}", id);
                return Ok(MapNormalized(s));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting shipment {Id}", id);
                return StatusCode(500, new { error = "internal_error", detail = ex.Message });
            }
        }

        public class UpdateStatusRequest { public string Status { get; set; } = string.Empty; }
        public class BrokerApprovalRequest { public string Decision { get; set; } = string.Empty; public string? Notes { get; set; } }

        // POST: api/shipments/{id}/ai-check
        [Authorize]
        [HttpPost("{id:long}/ai-check")]
        public async Task<IActionResult> RunAiCheck(long id)
        {
            var currentUserId = GetUserId();
            var role = GetUserRole();
            
            try
            {
                // Only creator, assigned broker, or admin can run AI check
                var shipment = await _service.GetDetailAsync(id);
                if (shipment == null) return NotFound();
                
                if (shipment.Shipment.CreatedBy != currentUserId && 
                    shipment.Shipment.AssignedBrokerId != currentUserId && 
                    role != "admin")
                    return Forbid();
                
                var resp = await _service.RunAiComplianceCheckAsync(id);
                // After completion, return full updated shipment object
                var updated = await _service.GetDetailAsync(id);
                return Ok(updated);
            }
            catch (ArgumentException aex)
            {
                _logger.LogWarning(aex, "Invalid AI check request");
                return BadRequest(new { error = "invalid_input", detail = aex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error running AI check for shipment {Id}", id);
                return StatusCode(500, new { error = "internal_error" });
            }
        }

        // POST: api/shipments/{id}/submit-ai
        // Immediately set AI to pending and return updated shipment, processing continues in background
        [Authorize]
        [HttpPost("{id:long}/submit-ai")]
        public async Task<IActionResult> SubmitAi(long id)
        {
            var currentUserId = GetUserId();
            var role = GetUserRole();

            try
            {
                var shipment = await _service.GetDetailAsync(id);
                if (shipment == null) return NotFound();

                if (shipment.Shipment.CreatedBy != currentUserId &&
                    shipment.Shipment.AssignedBrokerId != currentUserId &&
                    role != "admin")
                    return Forbid();

                var updated = await _service.StartAiComplianceCheckAsync(id);
                if (updated == null) return NotFound();
                return Ok(MapNormalized(updated));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error submitting AI check for shipment {Id}", id);
                return StatusCode(500, new { error = "internal_error" });
            }
        }

        // POST: api/shipments/{id}/broker-approve
        // Update broker approval status (approved/rejected/documents-requested)
        [Authorize]
        [HttpPost("{id:long}/broker-approve")]
        public async Task<IActionResult> BrokerApprove(long id, [FromBody] BrokerApprovalRequest req)
        {
            var currentUserId = GetUserId();
            var role = GetUserRole();
            
            if (!currentUserId.HasValue)
            {
                return Unauthorized(new { error = "not_authenticated" });
            }

            if (req == null || string.IsNullOrWhiteSpace(req.Decision))
            {
                return BadRequest(new { error = "decision_required", detail = "Decision must be one of: approved, rejected, documents-requested" });
            }

            try
            {
                var shipment = await _service.GetByIdAsync(id);
                if (shipment == null) return NotFound();
                
                // Only assigned broker or admin can approve/reject
                if (shipment.AssignedBrokerId != currentUserId && role != "admin")
                    return Forbid();
                
                // Update broker approval status
                var decision = req.Decision.ToLower();
                if (decision != "approved" && decision != "rejected" && decision != "documents-requested")
                {
                    return BadRequest(new { error = "invalid_decision", detail = "Decision must be one of: approved, rejected, documents-requested" });
                }

                shipment.BrokerApprovalStatus = decision;
                shipment.UpdatedAt = DateTime.UtcNow;
                
                // Update overall status based on broker decision
                if (decision == "approved")
                {
                    shipment.Status = "broker-approved";
                    // Try to generate token if AI also approved
                    await _service.GenerateTokenIfBothApprovalsCompleteAsync(id);
                    
                    // Create notification for shipper about broker approval
                    try
                    {
                        await _notificationService.CreateNotificationAsync(
                            shipment.CreatedBy,
                            "broker_approved",
                            "Shipment Approved by Broker",
                            $"Your shipment #{id} has been approved by the customs broker.",
                            id
                        );
                    }
                    catch (Exception notifEx)
                    {
                        _logger.LogError(notifEx, "Failed to create broker approval notification for shipment {ShipmentId}", id);
                    }
                }
                else if (decision == "rejected")
                {
                    shipment.Status = "rejected";
                }
                else if (decision == "documents-requested")
                {
                    shipment.Status = "documents-requested";
                }
                
                await _service.UpdateStatusAsync(id, shipment.Status);
                
                _logger.LogInformation("BrokerApprove: Broker {BrokerId} set shipment {ShipmentId} broker status to {Decision}", currentUserId, id, decision);
                
                // Return updated shipment
                var updated = await _service.GetDetailAsync(id);
                if (updated == null) return NotFound();
                return Ok(MapNormalized(updated));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating broker approval for shipment {Id}", id);
                return StatusCode(500, new { error = "internal_error" });
            }
        }

        // POST: api/shipments/{id}/generate-token
        // Generate PreclearToken only after BOTH AI and Broker approvals are "approved"
        [Authorize]
        [HttpPost("{id:long}/generate-token")]
        public async Task<IActionResult> GenerateToken(long id)
        {
            var currentUserId = GetUserId();
            var role = GetUserRole();
            
            if (!currentUserId.HasValue)
            {
                return Unauthorized(new { error = "not_authenticated" });
            }

            try
            {
                var shipment = await _service.GetByIdAsync(id);
                if (shipment == null) return NotFound();
                
                // Only creator or admin can request token generation
                if (shipment.CreatedBy != currentUserId && role != "admin")
                    return Forbid();
                
                var (success, token) = await _service.GenerateTokenIfBothApprovalsCompleteAsync(id);
                
                if (!success)
                {
                    return BadRequest(new 
                    { 
                        error = "token_generation_failed",
                        detail = "Both AI and Broker approvals must be 'approved' before token generation"
                    });
                }

                _logger.LogInformation("Generated token for shipment {ShipmentId} by user {UserId}", id, currentUserId);
                return Ok(new { token });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error generating token for shipment {Id}", id);
                return StatusCode(500, new { error = "internal_error" });
            }
        }

        // POST: api/shipments/{id}/assign-broker
        // Assign broker based on origin country and HS code
        [Authorize]
        [HttpPost("{id:long}/assign-broker")]
        public async Task<IActionResult> AssignBroker(long id)
        {
            var currentUserId = GetUserId();
            var role = GetUserRole();
            
            if (!currentUserId.HasValue)
            {
                return Unauthorized(new { error = "not_authenticated" });
            }

            try
            {
                var shipment = await _service.GetByIdAsync(id);
                if (shipment == null) return NotFound();
                
                // Only creator or admin can trigger broker assignment
                if (shipment.CreatedBy != currentUserId && role != "admin")
                    return Forbid();
                
                // Assign broker using the assignment service
                bool assigned = await _brokerAssignment.AssignBrokerAsync(id);
                
                if (!assigned)
                {
                    _logger.LogWarning("No eligible broker found for shipment {ShipmentId}", id);
                    return BadRequest(new { error = "no_eligible_broker", detail = "No broker found matching the shipment's origin country, destination country, and HS codes." });
                }
                
                _logger.LogInformation("Broker assigned for shipment {ShipmentId} by user {UserId}", id, currentUserId);
                
                // Return updated shipment details
                var updated = await _service.GetDetailAsync(id);
                if (updated == null) return NotFound();
                return Ok(MapNormalized(updated));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error assigning broker for shipment {Id}", id);
                return StatusCode(500, new { error = "internal_error", detail = ex.Message });
            }
        }

        // GET: api/shipments/{id}/status - Poll shipment status for real-time updates
        [Authorize]
        [HttpGet("{id:long}/status")]
        public async Task<IActionResult> GetShipmentStatus(long id)
        {
            var currentUserId = GetUserId();
            var role = GetUserRole();
            
            if (!currentUserId.HasValue)
            {
                return Unauthorized(new { error = "not_authenticated" });
            }

            try
            {
                var detail = await _service.GetDetailAsync(id);
                if (detail == null)
                {
                    return NotFound(new { error = "shipment_not_found" });
                }

                var shipment = detail.Shipment;
                
                // Access control: shipper can only see their own, brokers see assigned, admins see all
                if (role == "shipper")
                {
                    if (shipment.CreatedBy != currentUserId)
                        return Forbid();
                }
                else if (role == "broker")
                {
                    if (shipment.AssignedBrokerId != currentUserId && shipment.CreatedBy != currentUserId)
                        return Forbid();
                }
                else if (role != "admin")
                {
                    return Forbid();
                }

                // Return compact status info for polling
                return Ok(new
                {
                    id = shipment.Id,
                    referenceId = shipment.ReferenceId,
                    status = shipment.Status,
                    aiApprovalStatus = shipment.AiApprovalStatus,
                    brokerApprovalStatus = shipment.BrokerApprovalStatus,
                    preclearToken = shipment.PreclearToken,
                    tokenGeneratedAt = shipment.TokenGeneratedAt,
                    aiComplianceScore = shipment.AiComplianceScore,
                    updatedAt = shipment.UpdatedAt
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving shipment status for {Id}", id);
                return StatusCode(500, new { error = "internal_error" });
            }
        }

        // DELETE /api/shipments/delete/{id} - Delete a shipment
        [HttpDelete("delete/{id:long}")]
        [Authorize]
        public async Task<IActionResult> DeleteShipment(long id)
        {
            var currentUserId = GetUserId();
            var role = GetUserRole();
            
            if (!currentUserId.HasValue)
            {
                return Unauthorized(new { error = "not_authenticated" });
            }

            try
            {
                // Get shipment to verify ownership
                var shipment = await _service.GetByIdAsync(id);
                if (shipment == null)
                {
                    return NotFound(new { error = "shipment_not_found" });
                }

                // Only the creator (shipper) can delete their own shipment
                if (shipment.CreatedBy != currentUserId.Value)
                {
                    return Forbid();
                }

                var result = await _service.DeleteShipmentAsync(id);
                if (!result)
                {
                    return NotFound(new { error = "shipment_not_found" });
                }
                return Ok(new { message = "Shipment deleted successfully" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting shipment {Id}", id);
                return StatusCode(500, new { error = "internal_error" });
            }
        }

        /// <summary>
        /// GET /api/shipments/{id}/documents/status
        /// Get document upload status for a shipment
        /// Returns dictionary mapping documentType -> true (uploaded) or false (not uploaded)
        /// </summary>
        [HttpGet("{id}/documents/status")]
        [Authorize]
        public async Task<IActionResult> GetDocumentStatus(long id)
        {
            try
            {
                var shipment = await _service.GetDetailAsync(id);
                if (shipment == null)
                {
                    return NotFound(new { error = "shipment_not_found" });
                }

                // Verify authorization - user must be shipment creator or assigned broker
                var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
                if (!long.TryParse(userId, out var userIdLong))
                {
                    return Unauthorized();
                }

                var isCreator = shipment.Shipment.CreatedBy == userIdLong;
                var isAssignedBroker = shipment.Shipment.AssignedBrokerId == userIdLong;

                if (!isCreator && !isAssignedBroker)
                {
                    return Forbid();
                }

                var documentStatus = await _documentService.GetDocumentStatusByShipmentAsync(id);
                return Ok(documentStatus);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting document status for shipment {Id}", id);
                return StatusCode(500, new { error = "internal_error" });
            }
        }
    }
}
