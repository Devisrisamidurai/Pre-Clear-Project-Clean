using Amazon.Textract;
using Amazon.Textract.Model;
using Amazon.S3;
using Amazon.S3.Model;
using backend.Interfaces;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace backend.Services;

public class TextractService : ITextractService
{
    private readonly IAmazonTextract _textractClient;
    private readonly IAmazonS3 _s3Client;
    private readonly string _bucketName;
    private readonly ILogger<TextractService> _logger;

    public TextractService(IAmazonTextract textractClient, IAmazonS3 s3Client, IConfiguration configuration, ILogger<TextractService> logger)
    {
        _textractClient = textractClient;
        _s3Client = s3Client;
        _bucketName = configuration["AwsS3Settings:BucketName"] ?? "preclear-shipments";
        _logger = logger;
    }

    public async Task<Dictionary<string, object>> ExtractShipmentDataFromDocumentsAsync(List<IFormFile> files)
    {
        var extractedData = new Dictionary<string, object>();
        var allText = new List<string>();
        var keyValuePairs = new Dictionary<string, string>();

        foreach (var file in files)
        {
            try
            {
                var s3Key = $"shipments/{Guid.NewGuid()}/documents/{file.FileName}";
                
                // Upload to S3
                using var stream = file.OpenReadStream();
                var putRequest = new PutObjectRequest
                {
                    BucketName = _bucketName,
                    Key = s3Key,
                    InputStream = stream,
                    ContentType = file.ContentType
                };
                await _s3Client.PutObjectAsync(putRequest);

                // Analyze with Textract
                if (file.ContentType?.Contains("pdf") == true || file.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                {
                    var analyzeRequest = new AnalyzeDocumentRequest
                    {
                        Document = new Document
                        {
                            S3Object = new Amazon.Textract.Model.S3Object
                            {
                                Bucket = _bucketName,
                                Name = s3Key
                            }
                        },
                        FeatureTypes = new List<string> { "FORMS", "TABLES" }
                    };

                    var analyzeResponse = await _textractClient.AnalyzeDocumentAsync(analyzeRequest);
                    
                    // Extract text from blocks
                    foreach (var block in analyzeResponse.Blocks)
                    {
                        if (block.BlockType == "LINE" && !string.IsNullOrWhiteSpace(block.Text))
                        {
                            allText.Add(block.Text);
                        }
                        
                        if (block.BlockType == "KEY_VALUE_SET" && block.EntityTypes.Contains("KEY"))
                        {
                            var key = GetTextFromBlock(block, analyzeResponse.Blocks);
                            var valueBlock = analyzeResponse.Blocks.FirstOrDefault(b => 
                                block.Relationships?.Any(r => r.Type == "VALUE" && r.Ids.Contains(b.Id)) == true);
                            
                            if (valueBlock != null)
                            {
                                var value = GetTextFromBlock(valueBlock, analyzeResponse.Blocks);
                                if (!string.IsNullOrWhiteSpace(key) && !string.IsNullOrWhiteSpace(value))
                                {
                                    keyValuePairs[key.Trim().ToLower()] = value.Trim();
                                }
                            }
                        }
                    }
                }
                // CRITICAL: For TXT files, read directly without Textract (plain text, no OCR needed)
                else if (file.FileName.EndsWith(".txt", StringComparison.OrdinalIgnoreCase) || file.ContentType?.Contains("text/plain") == true)
                {
                    _logger.LogInformation("Reading TXT file directly: {FileName}", file.FileName);
                    using var reader = new StreamReader(file.OpenReadStream());
                    var txtContent = await reader.ReadToEndAsync();
                    
                    // Split by newlines and add each line
                    var lines = txtContent.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.None);
                    foreach (var line in lines)
                    {
                        if (!string.IsNullOrWhiteSpace(line))
                        {
                            allText.Add(line);
                        }
                    }
                    
                    _logger.LogInformation("Extracted {LineCount} lines from TXT file", allText.Count);
                }
                else
                {
                    // For other image/document types, use Textract DetectDocumentText
                    var detectRequest = new DetectDocumentTextRequest
                    {
                        Document = new Document
                        {
                            S3Object = new Amazon.Textract.Model.S3Object
                            {
                                Bucket = _bucketName,
                                Name = s3Key
                            }
                        }
                    };

                    var detectResponse = await _textractClient.DetectDocumentTextAsync(detectRequest);
                    foreach (var block in detectResponse.Blocks)
                    {
                        if (block.BlockType == "LINE" && !string.IsNullOrWhiteSpace(block.Text))
                        {
                            allText.Add(block.Text);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Textract extraction failed for file {FileName}", file.FileName);
            }
        }

        // Parse extracted text
        var combinedText = string.Join("\n", allText);
        var shipper = ExtractShipper(combinedText, keyValuePairs);
        var consignee = ExtractConsignee(combinedText, keyValuePairs);
        var packages = ExtractPackages(combinedText, keyValuePairs);
        var products = ExtractProducts(combinedText, keyValuePairs) ?? new List<Dictionary<string, object>>();

        packages ??= new List<Dictionary<string, object>>();

        // Always expose arrays and never overwrite products; assign to first package when mapping is absent.
        if (packages.Count == 0 && products.Count > 0)
        {
            packages.Add(CreateDefaultPackage("PKG-1"));
        }

        // Ensure each package has a products array and normalize all product fields.
        for (var i = 0; i < packages.Count; i++)
        {
            if (!packages[i].TryGetValue("products", out var pkgProducts) || pkgProducts is not List<Dictionary<string, object>>)
            {
                packages[i]["products"] = new List<Dictionary<string, object>>();
            }
        }

        if (products.Count > 0 && packages.Count > 0)
        {
            var normalizedProducts = NormalizeProductFields(products);
            var firstPackageProducts = (List<Dictionary<string, object>>)packages[0]["products"];
            firstPackageProducts.AddRange(normalizedProducts);
        }

        // Build form-ready output with full structure and defaults
        var customsValue = ExtractCustomsValue(combinedText, keyValuePairs);
        var mode = ExtractMode(combinedText, keyValuePairs);
        var shipmentType = ExtractShipmentType(combinedText, keyValuePairs);
        var serviceLevel = ExtractServiceLevel(combinedText, keyValuePairs);
        var currency = ExtractCurrency(combinedText, keyValuePairs);
        var title = ExtractTitle(combinedText, keyValuePairs);

        // Always return normalized, complete structure
        extractedData["shipmentDetails"] = new Dictionary<string, object>
        {
            { "shipmentName", title ?? "Untitled Shipment" },
            { "transportMode", FieldNormalizationService.NormalizeTransportMode(mode) },
            { "shipmentType", shipmentType?.ToUpper() ?? "INTERNATIONAL" },
            { "serviceLevel", FieldNormalizationService.NormalizeServiceLevel(serviceLevel) },
            { "currency", FieldNormalizationService.NormalizeCurrency(currency) },
            { "customsValue", customsValue > 0 ? customsValue : 0m }
        };

        extractedData["shipper"] = NormalizePartyFields(shipper ?? new Dictionary<string, object>());
        extractedData["consignee"] = NormalizePartyFields(consignee ?? new Dictionary<string, object>(), isConsignee: true);
        extractedData["packages"] = packages;
        extractedData["products"] = products;

        // Extract pickup/delivery details
        var pickupLocation = ExtractPickupLocation(combinedText, keyValuePairs);
        if (!string.IsNullOrEmpty(pickupLocation))
            extractedData["pickupLocation"] = pickupLocation;

        var pickupDate = ExtractPickupDate(combinedText, keyValuePairs);
        if (!string.IsNullOrEmpty(pickupDate))
            extractedData["pickupDate"] = pickupDate;

        var pickupTimeStart = ExtractPickupTimeStart(combinedText, keyValuePairs);
        if (!string.IsNullOrEmpty(pickupTimeStart))
            extractedData["pickupTimeEarliest"] = pickupTimeStart;

        var pickupTimeEnd = ExtractPickupTimeEnd(combinedText, keyValuePairs);
        if (!string.IsNullOrEmpty(pickupTimeEnd))
            extractedData["pickupTimeLatest"] = pickupTimeEnd;

        var dropoffDate = ExtractDropoffDate(combinedText, keyValuePairs);
        if (!string.IsNullOrEmpty(dropoffDate))
            extractedData["estimatedDropoffDate"] = dropoffDate;

        return extractedData;
    }

    /// <summary>Normalize party (shipper/consignee) fields to form-ready structure.</summary>
    private Dictionary<string, object> NormalizePartyFields(Dictionary<string, object> party, bool isConsignee = false)
    {
        // Strip label prefixes like "name:" or "contact name:" if they slipped into the value
        string StripLabelPrefix(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return value;
            var cleaned = value.Trim();
            cleaned = Regex.Replace(cleaned, @"^(?:name|contact\s*name|contact)\s*:\s*", string.Empty, RegexOptions.IgnoreCase);
            return cleaned.Trim();
        }

        var contactRaw = GetStringValue(party, "contactName") ?? GetStringValue(party, "contact") ?? string.Empty;
        var contactName = StripLabelPrefix(contactRaw);

        var normalized = new Dictionary<string, object>
        {
            { "company", GetStringValue(party, "company") ?? string.Empty },
            { "contactName", contactName },
            { "email", GetStringValue(party, "email") ?? string.Empty },
            { "phone", GetStringValue(party, "phone") ?? string.Empty },
            { "address1", GetStringValue(party, "address1") ?? GetStringValue(party, "address") ?? string.Empty },
            { "address2", GetStringValue(party, "address2") ?? string.Empty },
            { "city", GetStringValue(party, "city") ?? string.Empty },
            { "state", GetStringValue(party, "state") ?? string.Empty },
            { "postalCode", GetStringValue(party, "postalCode") ?? GetStringValue(party, "postal") ?? string.Empty },
            { "country", FieldNormalizationService.NormalizeCountry(GetStringValue(party, "country") ?? (isConsignee ? "US" : "IN")) },
            { "taxId", GetStringValue(party, "taxId") ?? string.Empty }
        };
        return normalized;
    }

    /// <summary>Normalize product fields with defaults and calculations.</summary>
    private List<Dictionary<string, object>> NormalizeProductFields(List<Dictionary<string, object>> products)
    {
        var normalized = new List<Dictionary<string, object>>();
        foreach (var prod in products)
        {
            var description = GetStringValue(prod, "description") ?? string.Empty;
            var hsCode = GetStringValue(prod, "hsCode") ?? string.Empty;
            var qtyStr = GetStringValue(prod, "qty");
            var qty = !string.IsNullOrWhiteSpace(qtyStr) && decimal.TryParse(qtyStr, CultureInfo.InvariantCulture, out var q) ? q : 1m;
            var valueStr = GetStringValue(prod, "totalValue");
            var totalValue = !string.IsNullOrWhiteSpace(valueStr) && decimal.TryParse(valueStr, CultureInfo.InvariantCulture, out var v) ? v : 0m;

            var unitPrice = FieldNormalizationService.CalculateUnitPrice(totalValue, qty);
            var hsCategory = FieldNormalizationService.GetHsCategoryFromCode(hsCode);

                var normalized_prod = new Dictionary<string, object>
                {
                    { "name", GetStringValue(prod, "name") ?? description },
                    { "description", description },
                    { "hsCode", hsCode },
                    { "hsCategory", hsCategory ?? string.Empty },
                    { "uom", FieldNormalizationService.NormalizeUnitOfMeasure(GetStringValue(prod, "uom")) },
                    { "quantity", qty },
                    { "unitPrice", unitPrice },
                    { "totalValue", totalValue },
                    { "originCountry", FieldNormalizationService.NormalizeCountry(GetStringValue(prod, "originCountry") ?? "IN") },
                    { "exportReason", FieldNormalizationService.NormalizeExportReason(GetStringValue(prod, "exportReason")) }
                };

            // Preserve product ID if present
            if (prod.TryGetValue("id", out var id))
                normalized_prod["id"] = id;

            normalized.Add(normalized_prod);
        }
        return normalized;
    }

    /// <summary>Safe string extraction helper.</summary>
    private static string? GetStringValue(Dictionary<string, object> dict, string key)
    {
        if (dict.TryGetValue(key, out var val))
        {
            return val?.ToString();
        }
        return null;
    }

    private string GetTextFromBlock(Block block, List<Block> allBlocks)
    {
        if (block.Text != null)
            return block.Text;

        var childIds = block.Relationships?.FirstOrDefault(r => r.Type == "CHILD")?.Ids ?? new List<string>();
        var childTexts = allBlocks
            .Where(b => childIds.Contains(b.Id) && b.BlockType == "WORD")
            .Select(b => b.Text)
            .ToList();

        return string.Join(" ", childTexts);
    }

    private Dictionary<string, object> ExtractShipper(string text, Dictionary<string, string> kvPairs)
    {
        var shipper = new Dictionary<string, object>();

        // CRITICAL: Extract from "Shipper Information:" section
        // Look for the shipper section and extract everything until next section
        var shipperSectionPattern = @"(?:shipper\s+information|shipper\s+details)[\s:]*\n([\s\S]+?)(?=\n(?:Consignee|Product|Package|Shipment\s+Type)|$)";
        var sectionMatch = Regex.Match(text, shipperSectionPattern, RegexOptions.IgnoreCase | RegexOptions.Singleline);
        
        if (sectionMatch.Success)
        {
            var shipperSection = sectionMatch.Groups[1].Value;
            _logger.LogInformation("Found Shipper Information section");
            
            // Extract Company/Name
            var companyPattern = @"(?:company|name|exporter|sender)[\s:.-]+([^\n]+?)(?:\n|$)";
            var companyMatch = Regex.Match(shipperSection, companyPattern, RegexOptions.IgnoreCase);
            if (companyMatch.Success)
            {
                var company = companyMatch.Groups[1].Value.Trim();
                if (!string.IsNullOrWhiteSpace(company) && company.Length > 2)
                {
                    shipper["company"] = company;
                    _logger.LogInformation("Extracted shipper company: {Company}", company);
                }
            }
            
            // Extract Contact Name
            var contactPattern = @"(?:contact|contact\s+name)[\s:.-]+([^\n]+?)(?:\n|$)";
            var contactMatch = Regex.Match(shipperSection, contactPattern, RegexOptions.IgnoreCase);
            if (contactMatch.Success)
            {
                shipper["contactName"] = contactMatch.Groups[1].Value.Trim();
            }
            
            // Extract Address
            var addressPattern = @"(?:address|addr|address\s+line\s+1)[\s:.-]+([^\n]+?)(?:\n|$)";
            var addressMatch = Regex.Match(shipperSection, addressPattern, RegexOptions.IgnoreCase);
            if (addressMatch.Success)
            {
                shipper["address1"] = addressMatch.Groups[1].Value.Trim();
            }
            
            // Extract Address Line 2
            var address2Pattern = @"(?:address\s+line\s+2|address\s+2)[\s:.-]+([^\n]+?)(?:\n|$)";
            var address2Match = Regex.Match(shipperSection, address2Pattern, RegexOptions.IgnoreCase);
            if (address2Match.Success)
            {
                shipper["address2"] = address2Match.Groups[1].Value.Trim();
            }
            
            // Extract City
            var cityPattern = @"(?:city)[\s:.-]+([^\n]+?)(?:\n|$)";
            var cityMatch = Regex.Match(shipperSection, cityPattern, RegexOptions.IgnoreCase);
            if (cityMatch.Success)
            {
                shipper["city"] = cityMatch.Groups[1].Value.Trim();
            }
            
            // Extract State
            var statePattern = @"(?:state|state/province|province)[\s:.-]+([^\n]+?)(?:\n|$)";
            var stateMatch = Regex.Match(shipperSection, statePattern, RegexOptions.IgnoreCase);
            if (stateMatch.Success)
            {
                var state = stateMatch.Groups[1].Value.Trim();
                if (!state.Equals("State/Province", StringComparison.OrdinalIgnoreCase))
                {
                    shipper["state"] = state;
                }
            }
            
            // Extract Postal Code
            var postalPattern = @"(?:postal\s+code|zip|postcode)[\s:.-]+([^\n]+?)(?:\n|$)";
            var postalMatch = Regex.Match(shipperSection, postalPattern, RegexOptions.IgnoreCase);
            if (postalMatch.Success)
            {
                shipper["postalCode"] = postalMatch.Groups[1].Value.Trim();
            }
            
            // Extract Country
            var countryPattern = @"(?:country)[\s:.-]+([^\n]+?)(?:\n|$)";
            var countryMatch = Regex.Match(shipperSection, countryPattern, RegexOptions.IgnoreCase);
            if (countryMatch.Success)
            {
                shipper["country"] = FieldNormalizationService.NormalizeCountry(countryMatch.Groups[1].Value.Trim());
            }
            
            // Extract Phone
            var phonePattern = @"(?:phone|telephone)[\s:.-]+([^\n]+?)(?:\n|$)";
            var phoneMatch = Regex.Match(shipperSection, phonePattern, RegexOptions.IgnoreCase);
            if (phoneMatch.Success)
            {
                shipper["phone"] = phoneMatch.Groups[1].Value.Trim();
            }
            
            // Extract Email
            var emailPattern = @"(?:email|e-mail)[\s:.-]+([^\n]+?)(?:\n|$)";
            var emailMatch = Regex.Match(shipperSection, emailPattern, RegexOptions.IgnoreCase);
            if (emailMatch.Success)
            {
                shipper["email"] = emailMatch.Groups[1].Value.Trim();
            }
            
            // Extract Tax ID
            var taxPattern = @"(?:tax\s+id|tax\s+number|id)[\s:.-]+([^\n]+?)(?:\n|$)";
            var taxMatch = Regex.Match(shipperSection, taxPattern, RegexOptions.IgnoreCase);
            if (taxMatch.Success)
            {
                shipper["taxId"] = taxMatch.Groups[1].Value.Trim();
            }
        }

        return shipper;
    }

    private Dictionary<string, object> ExtractConsignee(string text, Dictionary<string, string> kvPairs)
    {
        var consignee = new Dictionary<string, object>();

        // CRITICAL: Extract from "Consignee Information:" section
        // Look for the consignee section and extract everything until next section
        var consigneeSectionPattern = @"(?:consignee\s+information|consignee\s+details|recipient\s+information)[\s:]*\n([\s\S]+?)(?=\n(?:Shipper|Product|Package|Shipment\s+Type)|$)";
        var sectionMatch = Regex.Match(text, consigneeSectionPattern, RegexOptions.IgnoreCase | RegexOptions.Singleline);
        
        if (sectionMatch.Success)
        {
            var consigneeSection = sectionMatch.Groups[1].Value;
            _logger.LogInformation("Found Consignee Information section");
            
            // Extract Company/Name
            var companyPattern = @"(?:company|name|importer|receiver)[\s:.-]+([^\n]+?)(?:\n|$)";
            var companyMatch = Regex.Match(consigneeSection, companyPattern, RegexOptions.IgnoreCase);
            if (companyMatch.Success)
            {
                var company = companyMatch.Groups[1].Value.Trim();
                if (!string.IsNullOrWhiteSpace(company) && company.Length > 2)
                {
                    consignee["company"] = company;
                    _logger.LogInformation("Extracted consignee company: {Company}", company);
                }
            }
            
            // Extract Contact Name
            var contactPattern = @"(?:contact|contact\s+name)[\s:.-]+([^\n]+?)(?:\n|$)";
            var contactMatch = Regex.Match(consigneeSection, contactPattern, RegexOptions.IgnoreCase);
            if (contactMatch.Success)
            {
                consignee["contactName"] = contactMatch.Groups[1].Value.Trim();
            }
            
            // Extract Address
            var addressPattern = @"(?:address|addr|address\s+line\s+1)[\s:.-]+([^\n]+?)(?:\n|$)";
            var addressMatch = Regex.Match(consigneeSection, addressPattern, RegexOptions.IgnoreCase);
            if (addressMatch.Success)
            {
                consignee["address1"] = addressMatch.Groups[1].Value.Trim();
            }
            
            // Extract Address Line 2
            var address2Pattern = @"(?:address\s+line\s+2|address\s+2)[\s:.-]+([^\n]+?)(?:\n|$)";
            var address2Match = Regex.Match(consigneeSection, address2Pattern, RegexOptions.IgnoreCase);
            if (address2Match.Success)
            {
                consignee["address2"] = address2Match.Groups[1].Value.Trim();
            }
            
            // Extract City
            var cityPattern = @"(?:city)[\s:.-]+([^\n]+?)(?:\n|$)";
            var cityMatch = Regex.Match(consigneeSection, cityPattern, RegexOptions.IgnoreCase);
            if (cityMatch.Success)
            {
                consignee["city"] = cityMatch.Groups[1].Value.Trim();
            }
            
            // Extract State
            var statePattern = @"(?:state|state/province|province)[\s:.-]+([^\n]+?)(?:\n|$)";
            var stateMatch = Regex.Match(consigneeSection, statePattern, RegexOptions.IgnoreCase);
            if (stateMatch.Success)
            {
                var state = stateMatch.Groups[1].Value.Trim();
                if (!state.Equals("State/Province", StringComparison.OrdinalIgnoreCase))
                {
                    consignee["state"] = state;
                }
            }
            
            // Extract Postal Code
            var postalPattern = @"(?:postal\s+code|zip|postcode)[\s:.-]+([^\n]+?)(?:\n|$)";
            var postalMatch = Regex.Match(consigneeSection, postalPattern, RegexOptions.IgnoreCase);
            if (postalMatch.Success)
            {
                consignee["postalCode"] = postalMatch.Groups[1].Value.Trim();
            }
            
            // Extract Country
            var countryPattern = @"(?:country)[\s:.-]+([^\n]+?)(?:\n|$)";
            var countryMatch = Regex.Match(consigneeSection, countryPattern, RegexOptions.IgnoreCase);
            if (countryMatch.Success)
            {
                consignee["country"] = FieldNormalizationService.NormalizeCountry(countryMatch.Groups[1].Value.Trim());
            }
            
            // Extract Phone
            var phonePattern = @"(?:phone|telephone)[\s:.-]+([^\n]+?)(?:\n|$)";
            var phoneMatch = Regex.Match(consigneeSection, phonePattern, RegexOptions.IgnoreCase);
            if (phoneMatch.Success)
            {
                consignee["phone"] = phoneMatch.Groups[1].Value.Trim();
            }
            
            // Extract Email
            var emailPattern = @"(?:email|e-mail)[\s:.-]+([^\n]+?)(?:\n|$)";
            var emailMatch = Regex.Match(consigneeSection, emailPattern, RegexOptions.IgnoreCase);
            if (emailMatch.Success)
            {
                consignee["email"] = emailMatch.Groups[1].Value.Trim();
            }
            
            // Extract Tax ID
            var taxPattern = @"(?:tax\s+id|tax\s+number|id)[\s:.-]+([^\n]+?)(?:\n|$)";
            var taxMatch = Regex.Match(consigneeSection, taxPattern, RegexOptions.IgnoreCase);
            if (taxMatch.Success)
            {
                consignee["taxId"] = taxMatch.Groups[1].Value.Trim();
            }
        }

        return consignee;
    }

    private List<Dictionary<string, object>> ExtractPackages(string text, Dictionary<string, string> kvPairs)
    {
        var packages = new List<Dictionary<string, object>>();
        var normalized = (text ?? string.Empty).Replace("\r", "");
        var lines = normalized
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(l => l.Trim())
            .ToList();

        var sections = new List<List<string>>();
        List<string>? current = null;

        foreach (var line in lines)
        {
            if (Regex.IsMatch(line, @"(?:^|\s)(?:package|pkg|pallet|carton|box)\s*[\#:\-]*\s*\d+(?:\s|:|$|[\n\.\-])", RegexOptions.IgnoreCase))
            {
                if (current != null && current.Count > 0)
                {
                    sections.Add(current);
                }
                current = new List<string> { line };
                continue;
            }

            if (current != null)
            {
                current.Add(line);
            }
        }

        if (current != null && current.Count > 0)
        {
            sections.Add(current);
        }

        if (sections.Count == 0)
        {
            var single = BuildPackageFromBlock(normalized, kvPairs, 0);
            if (single != null)
            {
                packages.Add(single);
            }
            return packages;
        }

        for (var i = 0; i < sections.Count; i++)
        {
            var blockText = string.Join("\n", sections[i]);
            var package = BuildPackageFromBlock(blockText, kvPairs, i);
            if (package != null)
            {
                packages.Add(package);
            }
        }

        return packages;
    }

    private List<Dictionary<string, object>> ExtractProducts(string text, Dictionary<string, string> kvPairs)
    {
        var products = new List<Dictionary<string, object>>();
        var normalized = (text ?? string.Empty).Replace("\r", "");

        // Primary: find product/item headers - flexible patterns to catch "Product 1:", "Product 1 -", "Product 1\n", etc.
        var matches = Regex.Matches(normalized, @"(?:^|\n|\s)(?:product|item)\s*[\#:\-]*\s*(\d+)(?:\s|:|$|[\n\.\-])", RegexOptions.IgnoreCase | RegexOptions.Multiline);
        if (matches.Count > 0)
        {
            _logger.LogInformation("Found {Count} product headers in text", matches.Count);
            for (int i = 0; i < matches.Count; i++)
            {
                var start = matches[i].Index;
                var end = i + 1 < matches.Count ? matches[i + 1].Index : normalized.Length;
                var block = normalized.Substring(start, end - start);
                var product = BuildProductFromBlock(block, kvPairs);
                if (product != null)
                {
                    _logger.LogInformation("Extracted product {Index}: {Description}", i + 1, GetStringValue(product, "description"));
                    products.Add(product);
                }
            }

            return products;
        }

        _logger.LogInformation("No explicit product headers found, using fallback extraction");

        // Fallback: line-based grouping when explicit headers are absent.
        var lines = normalized
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(l => l.Trim())
            .ToList();

        var sections = new List<List<string>>();
        List<string>? current = null;

        foreach (var line in lines)
        {
            // Use flexible pattern that allows punctuation/delimiters after product number
            if (Regex.IsMatch(line, @"(?:product|item)\s*[\#:\-]*\s*\d+(?:\s|:|$|[\n\.\-])", RegexOptions.IgnoreCase))
            {
                if (current != null && current.Count > 0)
                {
                    sections.Add(current);
                }
                current = new List<string> { line };
                continue;
            }

            if (current != null)
            {
                current.Add(line);
            }
        }

        if (current != null && current.Count > 0)
        {
            sections.Add(current);
        }

        if (sections.Count == 0)
        {
            var single = BuildProductFromBlock(normalized, kvPairs);
            if (single != null)
            {
                products.Add(single);
            }
            return products;
        }

        foreach (var section in sections)
        {
            var blockText = string.Join("\n", section);
            var product = BuildProductFromBlock(blockText, kvPairs);
            if (product != null)
            {
                products.Add(product);
            }
        }

        return products;
    }

    private Dictionary<string, object>? BuildProductFromBlock(string text, Dictionary<string, string> kvPairs)
    {
        var product = new Dictionary<string, object>();

        // CRITICAL: Extract product NAME first (e.g., "Electronic Integrated Circuits")
        // Look for "Name:" field followed by actual product name
        var namePattern = @"(?:product\s+)?name[\s:.-]+([^\n:]+?)(?:\n|:)";
        var nameMatch = Regex.Match(text, namePattern, RegexOptions.IgnoreCase);
        if (nameMatch.Success)
        {
            var name = nameMatch.Groups[1].Value.Trim();
            // Filter out junk like "1:" or "2:" - should be actual product name
            if (!string.IsNullOrWhiteSpace(name) && name.Length > 2 && !Regex.IsMatch(name, @"^\d+[:\-\.]?$"))
            {
                product["name"] = name;
            }
        }

        // CRITICAL: Extract DESCRIPTION (detailed product description)
        var descPattern = @"(?:description|goods description)[\s:.-]+([^\n]+)";
        var descMatch = Regex.Match(text, descPattern, RegexOptions.IgnoreCase);
        if (descMatch.Success)
        {
            var desc = descMatch.Groups[1].Value.Trim();
            // Filter out junk like "1:" or "2:"
            if (!string.IsNullOrWhiteSpace(desc) && desc.Length > 2 && !Regex.IsMatch(desc, @"^\d+[:\-\.]?$"))
            {
                product["description"] = desc;
            }
        }

        // Fallback: extract from product header line if name not found yet
        if (!product.ContainsKey("name") || string.IsNullOrWhiteSpace(product["name"]?.ToString()))
        {
            var headerLine = text
                .Split('\n', StringSplitOptions.RemoveEmptyEntries)
                .FirstOrDefault(l => !string.IsNullOrWhiteSpace(l)) ?? string.Empty;
            var headerMatch = Regex.Match(headerLine, @"(?:product|item)\s*[\#:\-]*\s*\d+[\s:.\-]*(.+?)$", RegexOptions.IgnoreCase);
            if (headerMatch.Success)
            {
                var name = headerMatch.Groups[1].Value.Trim();
                if (!string.IsNullOrWhiteSpace(name) && name.Length > 2 && !Regex.IsMatch(name, @"^\d+[:\-\.]?$"))
                {
                    product["name"] = name;
                }
            }
        }

        // Extract HS Code - preserve decimal format
        var hsPattern = @"\b(\d{4}\.?\d{2}(?:\.?\d{0,2}))\b";
        var hsMatch = Regex.Match(text, hsPattern);
        if (hsMatch.Success)
        {
            var hsCode = hsMatch.Groups[1].Value.Trim();
            // Format: ensure it has dots for HS code structure (XXXX.XX.XX)
            if (!hsCode.Contains("."))
            {
                hsCode = hsCode.Insert(4, ".").Insert(7, ".");
            }
            product["hsCode"] = hsCode;
        }

        // CRITICAL: Extract QUANTITY - must find "Quantity:" field
        var qtyPattern = @"(?:quantity|qty)[\s:]+(\d+(?:,\d{3})*(?:\.\d+)?)";
        var qtyMatch = Regex.Match(text, qtyPattern, RegexOptions.IgnoreCase);
        if (qtyMatch.Success)
        {
            product["qty"] = qtyMatch.Groups[1].Value.Replace(",", "");
        }

        // CRITICAL: Extract UNIT OF MEASURE - must find "Unit of Measure:" or similar field
        var uomPattern = @"(?:unit\s+of\s+measure|uom|unit)[\s:.-]+(\w+)";
        var uomMatch = Regex.Match(text, uomPattern, RegexOptions.IgnoreCase);
        if (uomMatch.Success)
        {
            product["uom"] = uomMatch.Groups[1].Value.Trim();
        }
        else
        {
            // Fallback: look for common UOM keywords anywhere in text
            var uomKeywordPattern = @"\b(?:piece|pieces|pcs|pcs|box|boxes|carton|cartons|pallet|pallets|unit|units|kg|kgs|kilogram|kilograms|lb|lbs|pound|pounds|liter|liters|ml|m3|cbm|set|sets|pack|packs|bag|bags|crate|crates|tray|trays|drum|drums|bottle|bottles|can|cans|jar|jars|roll|rolls|sheet|sheets)\b";
            var uomKeywordMatch = Regex.Match(text, uomKeywordPattern, RegexOptions.IgnoreCase);
            if (uomKeywordMatch.Success)
            {
                product["uom"] = uomKeywordMatch.Value.ToLower();
            }
        }

        // Extract Unit Price
        var unitPricePattern = @"(?:unit\s+price|unit\s+value)[\s:]*(?:USD|EUR|GBP|INR)?[\s$€£₹]*(\d+(?:,\d{3})*(?:\.\d{2})?)";
        var unitPriceMatch = Regex.Match(text, unitPricePattern, RegexOptions.IgnoreCase);
        if (unitPriceMatch.Success)
        {
            product["unitPrice"] = unitPriceMatch.Groups[1].Value.Replace(",", "");
        }

        // Extract Total Value
        var valuePattern = @"(?:total\s+value|value|amount)[\s:]*(?:USD|EUR|GBP|INR)?[\s$€£₹]*(\d+(?:,\d{3})*(?:\.\d{2})?)";
        var valueMatch = Regex.Match(text, valuePattern, RegexOptions.IgnoreCase);
        if (valueMatch.Success)
        {
            product["totalValue"] = valueMatch.Groups[1].Value.Replace(",", "");
        }

        // Extract origin country
        var countryPattern = @"(?:origin\s+country|origin|made\s+in|from)[\s:.-]+([A-Za-z\s]+?)(?:\n|$|,)";
        var countryMatch = Regex.Match(text, countryPattern, RegexOptions.IgnoreCase);
        if (countryMatch.Success)
        {
            var countryStr = countryMatch.Groups[1].Value.Trim();
            product["originCountry"] = FieldNormalizationService.NormalizeCountry(countryStr);
        }

        // CRITICAL: Extract REASON FOR EXPORT - must find "Reason for Export:" field
        var reasonPattern = @"(?:reason\s+for\s+export|export\s+reason|reason|purpose)[\s:.-]+([^\n,]+)";
        var reasonMatch = Regex.Match(text, reasonPattern, RegexOptions.IgnoreCase);
        if (reasonMatch.Success)
        {
            var reasonStr = reasonMatch.Groups[1].Value.Trim();
            product["reasonForExport"] = FieldNormalizationService.NormalizeExportReason(reasonStr);
        }

        product["id"] = $"PROD-{Guid.NewGuid()}";

        // Set defaults for missing fields
        if (!product.ContainsKey("name") || string.IsNullOrWhiteSpace(product["name"]?.ToString()))
        {
            product["name"] = "Extracted Product";
        }
        if (!product.ContainsKey("description"))
        {
            product["description"] = string.Empty;
        }

        return product;
    }

    private Dictionary<string, object>? BuildPackageFromBlock(string text, Dictionary<string, string> kvPairs, int index)
    {
        var package = CreateDefaultPackage($"PKG-{index + 1}");

        foreach (var key in new[] { "package type", "packaging", "package" })
        {
            if (kvPairs.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
            {
                package["type"] = NormalizePackageType(value.Trim());
                break;
            }
        }

        if (package["type"] is string typeStr && string.IsNullOrWhiteSpace(typeStr))
        {
            var typePattern = @"(?:package\s+type|type)[\s:.-]+([A-Za-z]+)";
            var match = Regex.Match(text, typePattern, RegexOptions.IgnoreCase);
            if (match.Success)
            {
                package["type"] = NormalizePackageType(match.Groups[1].Value.Trim());
            }
            else
            {
                var typePattern2 = @"(?:package|pkg|pallet|carton|box)[\s:-]*([A-Za-z]+)";
                var match2 = Regex.Match(text, typePattern2, RegexOptions.IgnoreCase);
                if (match2.Success)
                {
                    package["type"] = NormalizePackageType(match2.Groups[1].Value.Trim());
                }
            }
        }

        var qtyPattern = @"(?:packages?|pkgs?|cartons?|boxes?|pallets?|pcs|pieces)[\s:=-]+(\d+)";
        var qtyMatch = Regex.Match(text, qtyPattern, RegexOptions.IgnoreCase);
        if (qtyMatch.Success && int.TryParse(qtyMatch.Groups[1].Value, out var qty))
        {
            package["quantity"] = qty;
        }

        // CRITICAL: Extract package weight - look for "Weight:" field specifically
        var weightPattern = @"(?:weight|weight)[\s:.-]+(\d+(?:,\d{3})*(?:\.\d+)?)[\s]*?(kg|kgs|kilograms|lb|lbs|pounds|g|grams)?";
        var weightMatch = Regex.Match(text, weightPattern, RegexOptions.IgnoreCase);
        if (weightMatch.Success)
        {
            var weightValue = decimal.TryParse(weightMatch.Groups[1].Value.Replace(",", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out var w) ? w : 0m;
            var unit = "kg";  // Default to kg
            if (!string.IsNullOrWhiteSpace(weightMatch.Groups[2].Value))
            {
                var unitStr = weightMatch.Groups[2].Value.ToLower();
                unit = unitStr.StartsWith("lb") || unitStr.StartsWith("pound") ? "lb" : "kg";
            }
            package["weight"] = weightValue;
            package["weightUnit"] = unit;
            _logger.LogInformation("Extracted package weight: {Weight} {Unit}", weightValue, unit);
        }

        // Extract package dimensions
        var dimPattern = @"(?:dimensions?|size)[\s:.-]+(\d+(?:\.\d+)?)(?:\s*(cm|in|mm|m))?\s*[xX*]\s*(\d+(?:\.\d+)?)(?:\s*(cm|in|mm|m))?\s*[xX*]\s*(\d+(?:\.\d+)?)(?:\s*(cm|in|mm|m))?";
        var dimMatch = Regex.Match(text, dimPattern, RegexOptions.IgnoreCase);
        if (dimMatch.Success)
        {
            var unit = dimMatch.Groups[2].Success ? dimMatch.Groups[2].Value : dimMatch.Groups[4].Success ? dimMatch.Groups[4].Value : dimMatch.Groups[6].Success ? dimMatch.Groups[6].Value : "cm";
            unit = string.IsNullOrWhiteSpace(unit) ? "cm" : unit.ToLower();

            if (decimal.TryParse(dimMatch.Groups[1].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var length) &&
                decimal.TryParse(dimMatch.Groups[3].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var width) &&
                decimal.TryParse(dimMatch.Groups[5].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var height))
            {
                package["length"] = length;
                package["width"] = width;
                package["height"] = height;
                package["dimUnit"] = unit;
                _logger.LogInformation("Extracted package dimensions: {Length}x{Width}x{Height} {Unit}", length, width, height, unit);
            }
        }

        if (text.IndexOf("stackable", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            var neg = Regex.IsMatch(text, @"not\s+stackable|non-?stackable", RegexOptions.IgnoreCase);
            package["stackable"] = !neg;
        }

        return package;
    }

    /// <summary>Normalize package type to enum value.</summary>
    private string NormalizePackageType(string? type)
    {
        if (string.IsNullOrWhiteSpace(type)) return string.Empty;
        var lower = type.ToLower();
        return lower switch
        {
            var s when s.Contains("pallet") => "PALLET",
            var s when s.Contains("box") => "BOX",
            var s when s.Contains("carton") => "CARTON",
            var s when s.Contains("crate") => "CRATE",
            var s when s.Contains("bag") => "BAG",
            var s when s.Contains("drum") => "DRUM",
            var s when s.Contains("envelope") => "ENVELOPE",
            var s when s.Contains("tube") => "TUBE",
            var s when s.Contains("case") => "CASE",
            _ => type.ToUpper()
        };
    }

    private Dictionary<string, object> CreateDefaultPackage(string id)
    {
        return new Dictionary<string, object>
        {
            { "id", id },
            { "type", string.Empty },
            { "quantity", 1 },
            { "dimensions", new Dictionary<string, object> { { "length", 0m }, { "width", 0m }, { "height", 0m }, { "unit", "cm" } } },
            { "weight", new Dictionary<string, object> { { "value", 0m }, { "unit", "kg" } } },
            { "stackable", false },
            { "products", new List<Dictionary<string, object>>() }
        };
    }

    private decimal ExtractCustomsValue(string text, Dictionary<string, string> kvPairs)
    {
        foreach (var key in new[] { "customs value", "total value", "invoice value" })
        {
            if (kvPairs.TryGetValue(key, out var value))
            {
                var cleanValue = Regex.Replace(value, @"[^\d.]", "");
                if (decimal.TryParse(cleanValue, out var result))
                    return result;
            }
        }

        var pattern = @"(?:customs value|total value)[\s:]*(?:USD|EUR)?[\s$€]*(\d+(?:,\d{3})*(?:\.\d{2})?)";
        var match = Regex.Match(text, pattern, RegexOptions.IgnoreCase);
        if (match.Success)
        {
            var cleanValue = match.Groups[1].Value.Replace(",", "");
            if (decimal.TryParse(cleanValue, out var result))
                return result;
        }

        return 0;
    }

    private string? ExtractMode(string text, Dictionary<string, string> kvPairs)
    {
        var modes = new[] { "Air", "Sea", "Road", "Rail", "Courier", "Multimodal" };
        foreach (var mode in modes)
        {
            if (text.Contains(mode, StringComparison.OrdinalIgnoreCase))
                return mode;
        }
        return null;
    }

    private string? ExtractShipmentType(string text, Dictionary<string, string> kvPairs)
    {
        var types = new[] { "Domestic", "International" };
        foreach (var type in types)
        {
            if (text.Contains(type, StringComparison.OrdinalIgnoreCase))
                return type;
        }
        return null;
    }

    private string? ExtractPickupType(string text, Dictionary<string, string> kvPairs)
    {
        var types = new[] { "Scheduled Pickup", "Drop-off" };
        foreach (var type in types)
        {
            if (text.Contains(type, StringComparison.OrdinalIgnoreCase))
                return type;
        }
        return null;
    }

    private string? ExtractServiceLevel(string text, Dictionary<string, string> kvPairs)
    {
        var levels = new[] { "Express", "Standard", "Economy", "Freight" };
        foreach (var level in levels)
        {
            if (text.Contains(level, StringComparison.OrdinalIgnoreCase))
                return level;
        }
        return null;
    }

    private string? ExtractIncoterm(string text, Dictionary<string, string> kvPairs)
    {
        var incoterms = new[] { "FOB", "CIF", "DDP", "EXW", "CPT", "DAP" };
        foreach (var term in incoterms)
        {
            if (text.Contains(term, StringComparison.OrdinalIgnoreCase))
                return term;
        }
        return null;
    }

    private string? ExtractCurrency(string text, Dictionary<string, string> kvPairs)
    {
        var currencies = new[] { "USD", "EUR", "GBP", "INR", "CNY", "JPY", "CAD", "AUD", "SGD", "CHF" };
        foreach (var currency in currencies)
        {
            if (text.Contains(currency, StringComparison.OrdinalIgnoreCase) || 
                text.Contains($"${currency}", StringComparison.OrdinalIgnoreCase))
                return currency;
        }
        return null;
    }

    private string? ExtractTitle(string text, Dictionary<string, string> kvPairs)
    {
        // Look for shipment title/reference in key-value pairs (most reliable)
        var titleKeys = new[] { "title", "shipment title", "shipment reference", "reference", "po number", "order number", "po", "shipment name", "order name" };
        foreach (var key in titleKeys)
        {
            if (kvPairs.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
                return value.Trim();
        }

        // Try to extract from text patterns - more flexible patterns
        // Pattern 1: Look for "Shipment Title:" or "Title:" followed by text
        var pattern1 = @"(?:shipment\s+)?title[\s:]+([^\n\r]+?)(?:\n|$)";
        var match1 = Regex.Match(text, pattern1, RegexOptions.IgnoreCase);
        if (match1.Success)
            return match1.Groups[1].Value.Trim();

        // Pattern 1b: Look for "Shipment Name:" or "Name:" followed by text
        var pattern1b = @"(?:shipment\s+)?name[\s:]+([^\n\r]+?)(?:\n|$)";
        var match1b = Regex.Match(text, pattern1b, RegexOptions.IgnoreCase);
        if (match1b.Success)
            return match1b.Groups[1].Value.Trim();

        // Pattern 2: Look for "PO:" or "Order:" followed by text
        var pattern2 = @"(?:PO|Order|Reference)[\s:]+([^\n\r,]+?)(?:\n|$|,)";
        var match2 = Regex.Match(text, pattern2, RegexOptions.IgnoreCase);
        if (match2.Success)
            return match2.Groups[1].Value.Trim();

        // Pattern 3: Look for shipment ID or number patterns
        var pattern3 = @"(?:Shipment|Order|PO)\s*(?:#|No\.?|Number)[\s:]*([^\n\r,]+)";
        var match3 = Regex.Match(text, pattern3, RegexOptions.IgnoreCase);
        if (match3.Success)
            return match3.Groups[1].Value.Trim();

        // Pattern 4: First line that looks like a title (alphanumeric with possible spaces/hyphens)
        var pattern4 = @"^([A-Za-z0-9\s\-]{5,}?)(?:\n|$)";
        var match4 = Regex.Match(text, pattern4, RegexOptions.Multiline);
        if (match4.Success)
        {
            var potentialTitle = match4.Groups[1].Value.Trim();
            // Filter out common document headers
            var lowerTitle = potentialTitle.ToLower();
            if (!lowerTitle.Contains("invoice") && !lowerTitle.Contains("receipt") && 
                !lowerTitle.Contains("document") && potentialTitle.Length > 3)
                return potentialTitle;
        }

        return null;
    }

    private string? ExtractPickupLocation(string text, Dictionary<string, string> kvPairs)
    {
        // Check key-value pairs first
        foreach (var key in new[] { "pickup location", "pickup address", "pickup point", "origin address" })
        {
            if (kvPairs.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
                return value;
        }

        // Try to extract from text patterns
        var pattern = @"(?:pickup|origin)\s*(?:location|address|point)[\s:]*([^\n]+)";
        var match2 = Regex.Match(text, pattern, RegexOptions.IgnoreCase);
        if (match2.Success)
            return match2.Groups[1].Value.Trim();

        return null;
    }

    private string? ExtractPickupDate(string text, Dictionary<string, string> kvPairs)
    {
        // Check key-value pairs
        foreach (var key in new[] { "pickup date", "scheduled pickup date" })
        {
            if (kvPairs.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
                return NormalizeDateToISO(value);
        }

        // Try to extract date patterns
        var datePattern = @"(?:pickup|pick[- ]up)\s*(?:date)?[\s:]*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})";
        var match2 = Regex.Match(text, datePattern, RegexOptions.IgnoreCase);
        if (match2.Success)
            return NormalizeDateToISO(match2.Groups[1].Value);

        return null;
    }

    private string? ExtractPickupTimeStart(string text, Dictionary<string, string> kvPairs)
    {
        // Check key-value pairs
        foreach (var key in new[] { "pickup time start", "earliest pickup time", "pickup time from" })
        {
            if (kvPairs.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
                return NormalizeTimeToISO(value);
        }

        // Try to extract time patterns (HH:MM or H:MM)
        var timePattern = @"(?:earliest|start|from)[\s:]*(\d{1,2}:\d{2})";
        var match2 = Regex.Match(text, timePattern, RegexOptions.IgnoreCase);
        if (match2.Success)
            return NormalizeTimeToISO(match2.Groups[1].Value);

        return null;
    }

    private string? ExtractPickupTimeEnd(string text, Dictionary<string, string> kvPairs)
    {
        // Check key-value pairs
        foreach (var key in new[] { "pickup time end", "latest pickup time", "pickup time to" })
        {
            if (kvPairs.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
                return NormalizeTimeToISO(value);
        }

        // Try to extract time patterns
        var timePattern = @"(?:latest|end|to)[\s:]*(\d{1,2}:\d{2})";
        var match2 = Regex.Match(text, timePattern, RegexOptions.IgnoreCase);
        if (match2.Success)
            return NormalizeTimeToISO(match2.Groups[1].Value);

        return null;
    }

    private string? ExtractDropoffDate(string text, Dictionary<string, string> kvPairs)
    {
        // Check key-value pairs
        foreach (var key in new[] { "dropoff date", "drop-off date", "estimated delivery date", "delivery date" })
        {
            if (kvPairs.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
                return NormalizeDateToISO(value);
        }

        // Try to extract date patterns
        var datePattern = @"(?:drop.?off|delivery)\s*(?:date)?[\s:]*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})";
        var match2 = Regex.Match(text, datePattern, RegexOptions.IgnoreCase);
        if (match2.Success)
            return NormalizeDateToISO(match2.Groups[1].Value);

        return null;
    }

    private string? NormalizeDateToISO(string dateStr)
    {
        if (string.IsNullOrWhiteSpace(dateStr))
            return null;

        // Try various date formats
        var formats = new[] 
        { 
            "dd/MM/yyyy", "dd-MM-yyyy", "MM/dd/yyyy", "MM-dd-yyyy",
            "yyyy-MM-dd", "yyyy/MM/dd", "d/M/yyyy", "M/d/yyyy",
            "dd/MM/yy", "MM/dd/yy", "yyyy-MM-dd HH:mm:ss"
        };

        if (DateTime.TryParseExact(dateStr.Trim(), formats, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var date))
        {
            return date.ToString("yyyy-MM-dd");
        }

        return null;
    }

    private string? NormalizeTimeToISO(string timeStr)
    {
        if (string.IsNullOrWhiteSpace(timeStr))
            return null;

        // Try HH:MM format
        var timePattern = @"^(\d{1,2}):(\d{2})$";
        var match2 = Regex.Match(timeStr.Trim(), timePattern);
        if (match2.Success)
        {
            var hour = int.Parse(match2.Groups[1].Value).ToString("D2");
            var minute = match2.Groups[2].Value;
            return $"{hour}:{minute}";
        }

        return null;
    }
}
