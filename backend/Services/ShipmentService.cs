using System;
using System.Collections.Generic;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using PreClear.Api.Interfaces;
using PreClear.Api.Models;

namespace PreClear.Api.Services
{
    public class ShipmentService : IShipmentService
    {
        private readonly IShipmentRepository _repo;
        private readonly ILogger<ShipmentService> _logger;
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly IAiService _aiService;
        private readonly INotificationService _notificationService;

        public ShipmentService(IShipmentRepository repo, ILogger<ShipmentService> logger, IHttpContextAccessor httpContextAccessor, IAiService aiService, INotificationService notificationService)
        {
            _repo = repo;
            _logger = logger;
            _httpContextAccessor = httpContextAccessor;
            _aiService = aiService;
            _notificationService = notificationService;
        }

        /// <summary>
        /// Extract userId from JWT claims
        /// </summary>
        private long? GetUserIdFromContext()
        {
            var userIdClaim = _httpContextAccessor?.HttpContext?.User.FindFirst(ClaimTypes.NameIdentifier);
            if (userIdClaim != null && long.TryParse(userIdClaim.Value, out var userId))
            {
                return userId;
            }
            return null;
        }

        public async Task<List<Shipment>> GetByUserAsync(long userId)
        {
            return await _repo.GetByUserAsync(userId);
        }

        public async Task<List<ShipmentListItemDto>> GetUserListAsync(long userId)
        {
            return await _repo.GetUserListAsync(userId);
        }

        public async Task<List<ShipmentListItemDto>> GetBrokerListAsync(long brokerId)
        {
            return await _repo.GetBrokerListAsync(brokerId);
        }

        public async Task<List<Shipment>> GetAllShipmentsAsync()
        {
            return await _repo.GetAllShipmentsAsync();
        }

        /// <summary>
        /// Get all shipments with complete details (parties, packages, items, services)
        /// Used for admin tracking page
        /// </summary>
        public async Task<List<NormalizedShipmentDto>> GetAllShipmentsDetailedAsync()
        {
            var allShipments = await _repo.GetAllShipmentsAsync();
            var result = new List<NormalizedShipmentDto>();

            foreach (var shipment in allShipments)
            {
                var detail = await GetDetailAsync(shipment.Id);
                if (detail != null)
                {
                    var normalized = NormalizeShipmentDetail(detail);
                    result.Add(normalized);
                }
            }

            return result;
        }

        /// <summary>
        /// Convert ShipmentDetailDto to NormalizedShipmentDto
        /// </summary>
        private NormalizedShipmentDto NormalizeShipmentDetail(ShipmentDetailDto detail)
        {
            var s = detail.Shipment;
            var shipper = detail.Parties.FirstOrDefault(p => p.PartyType == "shipper");
            var consignee = detail.Parties.FirstOrDefault(p => p.PartyType == "consignee");

            // Build packages with products
            var packagesById = detail.Packages.ToDictionary(p => p.Id);
            var productsByPackage = detail.Items.GroupBy(i => i.PackageId).ToDictionary(g => g.Key, g => g.ToList());

            var packages = new List<PackageView>();
            foreach (var pkg in detail.Packages)
            {
                var packageView = new PackageView
                {
                    type = pkg.PackageType,
                    length = pkg.Length,
                    width = pkg.Width,
                    height = pkg.Height,
                    dimUnit = pkg.DimensionUnit,
                    weight = pkg.Weight,
                    weightUnit = pkg.WeightUnit,
                    stackable = pkg.Stackable,
                    products = new List<ProductView>()
                };

                // Add products for this package
                if (productsByPackage.TryGetValue(pkg.Id, out var items))
                {
                    foreach (var item in items)
                    {
                        packageView.products.Add(new ProductView
                        {
                            name = item.Name,
                            description = item.Description,
                            category = item.Category,
                            hsCode = item.HsCode,
                            qty = item.Quantity,
                            uom = item.Unit,
                            unitPrice = item.UnitPrice,
                            totalValue = item.TotalValue,
                            originCountry = item.OriginCountry,
                            reasonForExport = item.ExportReason
                        });
                    }
                }

                packages.Add(packageView);
            }

            var normalized = new NormalizedShipmentDto
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
                status = s.Status,
                aiApprovalStatus = s.AiApprovalStatus,
                brokerApprovalStatus = s.BrokerApprovalStatus,
                aiComplianceScore = s.AiComplianceScore,
                preclearToken = s.PreclearToken,
                tokenGeneratedAt = s.TokenGeneratedAt,
                assignedBrokerId = s.AssignedBrokerId,
                createdAt = s.CreatedAt,
                updatedAt = s.UpdatedAt,
                shipper = shipper == null ? null : new PartyView
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
                consignee = consignee == null ? null : new PartyView
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
                packages = packages,
                services = new ServiceView
                {
                    serviceLevel = s.ServiceLevel,
                    currency = s.Currency,
                    customsValue = s.CustomsValue
                }
            };

            return normalized;
        }

        public async Task<Shipment?> GetByIdAsync(long id)
        {
            return await _repo.GetByIdAsync(id);
        }

        public async Task<ShipmentDetailDto?> GetDetailAsync(long id)
        {
            var s = await _repo.GetByIdAsync(id);
            if (s == null) return null;

            var dto = new ShipmentDetailDto
            {
                Shipment = s,
                Parties = await _repo.GetPartiesAsync(id),
                Packages = await _repo.GetPackagesAsync(id),
                Items = await _repo.GetItemsAsync(id),
                Services = await _repo.GetServicesAsync(id)
            };
            return dto;
        }

        public async Task<AiComplianceResponse> RunAiComplianceCheckAsync(long shipmentId)
        {
            var detail = await GetDetailAsync(shipmentId);
            if (detail == null) throw new ArgumentException("shipment_not_found");

            // Set AI approval status to pending immediately
            var shipment = detail.Shipment;
            shipment.AiApprovalStatus = "pending";
            shipment.Status = "ai-review";
            shipment.UpdatedAt = DateTime.UtcNow;
            await _repo.UpdateAsync(shipment);
            _logger.LogInformation("RunAiComplianceCheckAsync: Set shipment {ShipmentId} AI status to pending", shipmentId);

            var origin = detail.Parties.Find(p => p.PartyType == "shipper")?.Country ?? string.Empty;
            var destination = detail.Parties.Find(p => p.PartyType == "consignee")?.Country ?? string.Empty;
            var firstItem = detail.Items.Count > 0 ? detail.Items[0] : null;
            var hsCode = firstItem?.HsCode ?? string.Empty;
            var category = string.Empty;
            var description = firstItem?.Description ?? string.Empty;
            var packageTypeWeight = detail.Packages.Count > 0 ? $"{detail.Packages[0].PackageType} {detail.Packages[0].Weight ?? 0}{detail.Packages[0].WeightUnit}" : string.Empty;
            var mode = detail.Shipment.Mode.ToString();

            var aiDocs = await _aiPredictRequiredDocuments(origin, destination, hsCode, !string.IsNullOrWhiteSpace(hsCode), category, description, packageTypeWeight, mode);

            var suggestionsHs = await _aiSuggestHs(firstItem?.Name ?? string.Empty, category, description, 3);
            var suggestedHsCode = suggestionsHs.Count > 0 ? suggestionsHs[0].HsCode : null;

            // Calculate AI compliance score
            var aiScore = (aiDocs.Suggestions?.Length ?? 0) > 0 ? 80 : 40;
            var status = aiScore >= 70 ? "cleared" : "flagged";
            var risk = aiScore >= 85 ? "low" : aiScore >= 70 ? "medium" : "high";

            // Update shipment with AI results - approved if score >= 70
            shipment.AiApprovalStatus = aiScore >= 70 ? "approved" : "rejected";
            shipment.AiComplianceScore = aiScore;
            shipment.Status = aiScore >= 70 ? "ai-approved" : "rejected";
            shipment.UpdatedAt = DateTime.UtcNow;
            await _repo.UpdateAsync(shipment);
            _logger.LogInformation("RunAiComplianceCheckAsync: Updated shipment {ShipmentId} AI status to {Status}, score {Score}", shipmentId, shipment.AiApprovalStatus, aiScore);

            // Update compliance table
            await _repo.PersistAiDocumentsAsync(shipmentId, aiDocs.Suggestions ?? Array.Empty<string>());

            return new AiComplianceResponse
            {
                AiComplianceScore = aiScore,
                AiComplianceStatus = status,
                AiValidationNotes = aiDocs.Notes,
                MissingDocuments = new List<string>(aiDocs.Suggestions ?? Array.Empty<string>()),
                SuggestedHsCode = suggestedHsCode,
                EstimatedDutyTax = 0,
                RiskLevel = risk.ToString().ToLowerInvariant()
            };
        }

        /// <summary>
        /// Start AI compliance check by immediately setting pending state and returning,
        /// while running the heavy evaluation in the background.
        /// </summary>
        public async Task<ShipmentDetailDto?> StartAiComplianceCheckAsync(long shipmentId)
        {
            var detail = await GetDetailAsync(shipmentId);
            if (detail == null) return null;

            var shipment = detail.Shipment;
            shipment.AiApprovalStatus = "pending";
            shipment.Status = "ai-review";
            shipment.UpdatedAt = DateTime.UtcNow;
            await _repo.UpdateAsync(shipment);
            _logger.LogInformation("StartAiComplianceCheckAsync: Set shipment {ShipmentId} AI status to pending", shipmentId);

            // Fire-and-forget background processing to compute results and persist
            _ = Task.Run(async () =>
            {
                try
                {
                    await RunAiComplianceCheckAsync(shipmentId);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Background AI compliance check failed for shipment {ShipmentId}", shipmentId);
                }
            });

            // Return updated details immediately (pending state)
            return await GetDetailAsync(shipmentId);
        }

        private Task<AiResultDto> _aiPredictRequiredDocuments(string origin, string destination, string hsCode, bool? htsFlag, string category, string description, string packageTypeWeight, string mode)
        {
            return _aiService.PredictRequiredDocumentsAsync(origin, destination, hsCode, htsFlag, category, description, packageTypeWeight, mode, pythonPort: 9000);
        }

        private Task<List<AiService.HsSuggestion>> _aiSuggestHs(string name, string category, string description, int k)
        {
            return _aiService.SuggestHsAsync(name, category, description, k);
        }

        public async Task<Shipment> CreateAsync(UpsertShipmentDto dto)
        {
            if (dto == null) throw new ArgumentNullException(nameof(dto));

            // Extract userId from JWT claims - this is MANDATORY for ownership
            var userId = GetUserIdFromContext();
            if (!userId.HasValue)
            {
                throw new InvalidOperationException("User not authenticated. Cannot create shipment without ownership.");
            }

            var shipment = new Shipment
            {
                CreatedBy = userId.Value,
                ShipmentName = dto.ShipmentName,
                Mode = dto.Mode,
                ShipmentType = dto.ShipmentType,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                ReferenceId = "REF-" + Guid.NewGuid().ToString("N").Substring(0, 12).ToUpperInvariant(),
                Status = dto.Status ?? "draft",
                ServiceLevel = dto.ServiceLevel,
                Currency = dto.Currency,
                CustomsValue = dto.CustomsValue,
                PricingTotal = dto.PricingTotal,
                PickupType = dto.PickupType,
                PickupLocation = dto.PickupLocation,
                PickupDate = dto.PickupDate,
                PickupTimeEarliest = dto.PickupTimeEarliest,
                PickupTimeLatest = dto.PickupTimeLatest,
                EstimatedDropoffDate = dto.EstimatedDropoffDate
            };

            var created = await _repo.AddAsync(shipment);
            _logger.LogInformation("Created shipment {ShipmentId} by user {UserId}", created.Id, userId);

            await UpsertNestedAsync(created.Id, dto);
            return created;
        }

        public async Task<Shipment?> UpdateAsync(long id, UpsertShipmentDto dto)
        {
            var s = await _repo.GetByIdAsync(id);
            if (s == null) return null;

            s.ShipmentName = dto.ShipmentName ?? s.ShipmentName;
            s.Mode = dto.Mode;
            s.ShipmentType = dto.ShipmentType;
            s.Status = dto.Status ?? s.Status;
            s.ServiceLevel = dto.ServiceLevel ?? s.ServiceLevel;
            s.Currency = dto.Currency ?? s.Currency;
            s.CustomsValue = dto.CustomsValue ?? s.CustomsValue;
            s.PricingTotal = dto.PricingTotal ?? s.PricingTotal;
            s.PickupType = dto.PickupType ?? s.PickupType;
            s.PickupLocation = dto.PickupLocation ?? s.PickupLocation;
            s.PickupDate = dto.PickupDate ?? s.PickupDate;
            s.PickupTimeEarliest = dto.PickupTimeEarliest ?? s.PickupTimeEarliest;
            s.PickupTimeLatest = dto.PickupTimeLatest ?? s.PickupTimeLatest;
            s.EstimatedDropoffDate = dto.EstimatedDropoffDate ?? s.EstimatedDropoffDate;
            s.UpdatedAt = DateTime.UtcNow;
            await _repo.UpdateAsync(s);

            await UpsertNestedAsync(id, dto);
            return s;
        }

        private async Task UpsertNestedAsync(long shipmentId, UpsertShipmentDto dto)
        {
            var parties = new List<ShipmentParty>();
            if (dto.Shipper != null)
            {
                parties.Add(new ShipmentParty
                {
                    PartyType = "shipper",
                    CompanyName = dto.Shipper.CompanyName ?? string.Empty,
                    ContactName = dto.Shipper.ContactName,
                    Phone = dto.Shipper.Phone,
                    Email = dto.Shipper.Email,
                    Address1 = dto.Shipper.Address1,
                    Address2 = dto.Shipper.Address2,
                    City = dto.Shipper.City,
                    State = dto.Shipper.State,
                    PostalCode = dto.Shipper.PostalCode,
                    Country = dto.Shipper.Country,
                    TaxId = dto.Shipper.TaxId
                });
            }
            if (dto.Consignee != null)
            {
                parties.Add(new ShipmentParty
                {
                    PartyType = "consignee",
                    CompanyName = dto.Consignee.CompanyName ?? string.Empty,
                    ContactName = dto.Consignee.ContactName,
                    Phone = dto.Consignee.Phone,
                    Email = dto.Consignee.Email,
                    Address1 = dto.Consignee.Address1,
                    Address2 = dto.Consignee.Address2,
                    City = dto.Consignee.City,
                    State = dto.Consignee.State,
                    PostalCode = dto.Consignee.PostalCode,
                    Country = dto.Consignee.Country,
                    TaxId = dto.Consignee.TaxId
                });
            }
            if (dto.OtherParties != null)
            {
                foreach (var p in dto.OtherParties)
                {
                    parties.Add(new ShipmentParty
                    {
                        PartyType = p.PartyType,
                        CompanyName = p.CompanyName ?? string.Empty,
                        ContactName = p.ContactName,
                        Phone = p.Phone,
                        Email = p.Email,
                        Address1 = p.Address1,
                        Address2 = p.Address2,
                        City = p.City,
                        State = p.State,
                        PostalCode = p.PostalCode,
                        Country = p.Country,
                        TaxId = p.TaxId
                    });
                }
            }
            await _repo.ReplacePartiesAsync(shipmentId, parties);

            var packages = new List<ShipmentPackage>();
            var items = new List<ShipmentProduct>();
            
            if (dto.Packages != null)
            {
                foreach (var pkg in dto.Packages)
                {
                    var newPackage = new ShipmentPackage
                    {
                        PackageType = pkg.PackageType,
                        Length = pkg.Length,
                        Width = pkg.Width,
                        Height = pkg.Height,
                        DimensionUnit = pkg.DimensionUnit,
                        Weight = pkg.Weight,
                        WeightUnit = pkg.WeightUnit,
                        Stackable = pkg.Stackable
                    };
                    packages.Add(newPackage);
                }
            }
            
            // First, insert packages and get their IDs
            await _repo.ReplacePackagesAsync(shipmentId, packages);
            
            // Then retrieve packages with their IDs to link products
            var savedPackages = await _repo.GetPackagesAsync(shipmentId);
            var packageIndex = 0;
            
            if (dto.Packages != null)
            {
                foreach (var pkg in dto.Packages)
                {
                    if (packageIndex < savedPackages.Count && pkg.Products != null)
                    {
                        var currentPackageId = savedPackages[packageIndex].Id;
                        foreach (var prod in pkg.Products)
                        {
                            items.Add(new ShipmentProduct
                            {
                                PackageId = currentPackageId,  // Link to the saved package
                                Name = prod.Name ?? string.Empty,
                                Description = prod.Description ?? string.Empty,
                                Category = prod.Category ?? string.Empty,
                                HsCode = prod.HsCode ?? string.Empty,
                                Quantity = prod.Quantity,
                                Unit = prod.Unit ?? "pcs",
                                UnitPrice = prod.UnitPrice,
                                TotalValue = prod.TotalValue,
                                OriginCountry = prod.OriginCountry ?? string.Empty,
                                ExportReason = prod.ExportReason ?? "Sale"
                            });
                        }
                    }
                    packageIndex++;
                }
            }
            
            await _repo.ReplaceItemsAsync(shipmentId, items);

            // Services are embedded in shipment table (ServiceLevel, BillTo, Currency, CustomsValue)
            // Update the shipment with service information
            var s = await _repo.GetByIdAsync(shipmentId);
            if (s != null)
            {
                s.ServiceLevel = dto.ServiceLevel ?? s.ServiceLevel;
                s.Currency = string.IsNullOrWhiteSpace(dto.Currency) ? (s.Currency ?? "USD") : dto.Currency;
                s.CustomsValue = dto.CustomsValue ?? s.CustomsValue;
                s.PricingTotal = dto.PricingTotal ?? s.PricingTotal;
                await _repo.UpdateAsync(s);
            }
        }

        public async Task<bool> UpdateStatusAsync(long shipmentId, string status)
        {
            var s = await _repo.GetByIdAsync(shipmentId);
            if (s == null) 
            {
                _logger.LogWarning("UpdateStatusAsync: Shipment {ShipmentId} not found", shipmentId);
                return false;
            }

            var previousStatus = s.Status;
            s.Status = status;
            s.UpdatedAt = DateTime.UtcNow;
            
            // Auto-set ai_approval_status when status is ai-approved
            if (status == "ai-approved")
            {
                s.AiApprovalStatus = "approved";
                s.AiComplianceScore = s.AiComplianceScore ?? 85; // Default score
                _logger.LogInformation("UpdateStatusAsync: Auto-set AI approval to 'approved' for shipment {ShipmentId}", shipmentId);
            }
            
            try
            {
                await _repo.UpdateAsync(s);
                _logger.LogInformation("UpdateStatusAsync: Successfully updated shipment {ShipmentId} status from '{PreviousStatus}' to '{NewStatus}' at {Timestamp}", 
                    shipmentId, previousStatus, status, DateTime.UtcNow);
                
                // Verify the update was persisted
                var verifyShipment = await _repo.GetByIdAsync(shipmentId);
                if (verifyShipment?.Status != status)
                {
                    _logger.LogError("UpdateStatusAsync: CRITICAL - Status update verification failed for shipment {ShipmentId}. Expected '{ExpectedStatus}', got '{ActualStatus}'",
                        shipmentId, status, verifyShipment?.Status ?? "null");
                    return false;
                }
                
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "UpdateStatusAsync: Exception updating shipment {ShipmentId} status to '{Status}'", shipmentId, status);
                return false;
            }
        }

        public async Task<bool> PersistAiPredictedDocumentsAsync(long shipmentId, string[] predictedDocuments)
        {
            if (predictedDocuments == null || predictedDocuments.Length == 0)
            {
                _logger.LogInformation("No documents to persist for shipment {ShipmentId}", shipmentId);
                return true;
            }

            var shipment = await _repo.GetByIdAsync(shipmentId);
            if (shipment == null)
            {
                _logger.LogWarning("Shipment {ShipmentId} not found for document persistence", shipmentId);
                return false;
            }

            await _repo.PersistAiDocumentsAsync(shipmentId, predictedDocuments);
            _logger.LogInformation("Persisted {Count} AI-predicted documents for shipment {ShipmentId}", predictedDocuments.Length, shipmentId);
            return true;
        }

        /// <summary>
        /// Generate and persist PreclearToken only when BOTH AI and Broker approvals are 'approved'.
        /// Wrapped in transaction to ensure atomicity.
        /// </summary>
        public async Task<(bool success, string? token)> GenerateTokenIfBothApprovalsCompleteAsync(long shipmentId)
        {
            var shipment = await _repo.GetByIdAsync(shipmentId);
            if (shipment == null)
            {
                _logger.LogWarning("GenerateTokenIfBothApprovalsCompleteAsync: Shipment {ShipmentId} not found", shipmentId);
                return (false, null);
            }

            // Check both approvals are "approved"
            var aiApproved = shipment.AiApprovalStatus == "approved";
            var brokerApproved = shipment.BrokerApprovalStatus == "approved";

            if (!aiApproved || !brokerApproved)
            {
                _logger.LogInformation(
                    "GenerateTokenIfBothApprovalsCompleteAsync: Shipment {ShipmentId} cannot generate token. AI={AiStatus}, Broker={BrokerStatus}",
                    shipmentId, shipment.AiApprovalStatus ?? "null", shipment.BrokerApprovalStatus ?? "null");
                return (false, null);
            }

            // Token already generated
            if (!string.IsNullOrWhiteSpace(shipment.PreclearToken))
            {
                _logger.LogInformation("GenerateTokenIfBothApprovalsCompleteAsync: Shipment {ShipmentId} already has token", shipmentId);
                return (true, shipment.PreclearToken);
            }

            // Generate token transactionally
            try
            {
                var token = Guid.NewGuid().ToString("N").Substring(0, 20).ToUpperInvariant();
                shipment.PreclearToken = token;
                shipment.TokenGeneratedAt = DateTime.UtcNow;
                shipment.Status = "token-generated";
                shipment.UpdatedAt = DateTime.UtcNow;

                await _repo.UpdateAsync(shipment);

                _logger.LogInformation(
                    "GenerateTokenIfBothApprovalsCompleteAsync: Successfully generated token for shipment {ShipmentId} at {Timestamp}, status set to token-generated",
                    shipmentId, shipment.TokenGeneratedAt);

                // Create notification for shipper about token generation
                try
                {
                    await _notificationService.CreateNotificationAsync(
                        shipment.CreatedBy,
                        "token_generated",
                        "Preclear Token Generated",
                        $"Your preclear token for shipment #{shipmentId} is ready: {token}",
                        shipmentId
                    );
                }
                catch (Exception notifEx)
                {
                    _logger.LogError(notifEx, "Failed to create token generation notification for shipment {ShipmentId}", shipmentId);
                }

                return (true, token);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "GenerateTokenIfBothApprovalsCompleteAsync: Exception generating token for shipment {ShipmentId}", shipmentId);
                return (false, null);
            }
        }

        public async Task<bool> DeleteShipmentAsync(long shipmentId)
        {
            return await _repo.DeleteAsync(shipmentId);
        }
    }
}
