using Amazon.Textract;
using Amazon.Textract.Model;
using Amazon.S3;
using Amazon.S3.Model;
using backend.Interfaces;
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
                else
                {
                    // For images/text
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
        var combinedText = string.Join(" ", allText);
        var shipper = ExtractShipper(combinedText, keyValuePairs);
        var consignee = ExtractConsignee(combinedText, keyValuePairs);
        var products = ExtractProducts(combinedText, keyValuePairs);

        if (shipper != null && shipper.Count > 0)
            extractedData["shipper"] = shipper;
        
        if (consignee != null && consignee.Count > 0)
            extractedData["consignee"] = consignee;
        
        if (products != null && products.Count > 0)
            extractedData["products"] = products;

        var customsValue = ExtractCustomsValue(combinedText, keyValuePairs);
        if (customsValue > 0)
            extractedData["customsValue"] = customsValue;

        // Extract additional shipment details
        var mode = ExtractMode(combinedText, keyValuePairs);
        if (!string.IsNullOrEmpty(mode))
            extractedData["mode"] = mode;

        var shipmentType = ExtractShipmentType(combinedText, keyValuePairs);
        if (!string.IsNullOrEmpty(shipmentType))
            extractedData["shipmentType"] = shipmentType;

        var pickupType = ExtractPickupType(combinedText, keyValuePairs);
        if (!string.IsNullOrEmpty(pickupType))
            extractedData["pickupType"] = pickupType;

        var serviceLevel = ExtractServiceLevel(combinedText, keyValuePairs);
        if (!string.IsNullOrEmpty(serviceLevel))
            extractedData["serviceLevel"] = serviceLevel;

        var incoterm = ExtractIncoterm(combinedText, keyValuePairs);
        if (!string.IsNullOrEmpty(incoterm))
            extractedData["incoterm"] = incoterm;

        var currency = ExtractCurrency(combinedText, keyValuePairs);
        if (!string.IsNullOrEmpty(currency))
            extractedData["currency"] = currency;

        var title = ExtractTitle(combinedText, keyValuePairs);
        if (!string.IsNullOrEmpty(title))
            extractedData["title"] = title;

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

        // Try key-value pairs first
        foreach (var key in new[] { "shipper", "exporter", "sender", "from", "consignor" })
        {
            if (kvPairs.TryGetValue(key, out var value))
            {
                shipper["company"] = value;
                break;
            }
        }

        // Pattern matching
        var shipperPattern = @"(?:shipper|exporter|sender|from)[\s:]+([^\n]+)";
        var match = Regex.Match(text, shipperPattern, RegexOptions.IgnoreCase);
        if (match.Success && !shipper.ContainsKey("company"))
        {
            shipper["company"] = match.Groups[1].Value.Trim();
        }

        return shipper;
    }

    private Dictionary<string, object> ExtractConsignee(string text, Dictionary<string, string> kvPairs)
    {
        var consignee = new Dictionary<string, object>();

        foreach (var key in new[] { "consignee", "importer", "receiver", "to", "buyer" })
        {
            if (kvPairs.TryGetValue(key, out var value))
            {
                consignee["company"] = value;
                break;
            }
        }

        var consigneePattern = @"(?:consignee|importer|receiver|to)[\s:]+([^\n]+)";
        var match = Regex.Match(text, consigneePattern, RegexOptions.IgnoreCase);
        if (match.Success && !consignee.ContainsKey("company"))
        {
            consignee["company"] = match.Groups[1].Value.Trim();
        }

        // Extract address
        var addressPattern = @"(?:address|addr)[\s:]+([^\n]+)";
        var addressMatch = Regex.Match(text, addressPattern, RegexOptions.IgnoreCase);
        if (addressMatch.Success)
        {
            consignee["address1"] = addressMatch.Groups[1].Value.Trim();
        }

        // Extract country
        var countryPattern = @"\b(US|USA|United States|IN|India|CN|China|GB|UK|DE|Germany|FR|France)\b";
        var countryMatch = Regex.Match(text, countryPattern, RegexOptions.IgnoreCase);
        if (countryMatch.Success)
        {
            var country = countryMatch.Groups[1].Value.ToUpper();
            if (country == "USA") country = "US";
            if (country == "UNITED STATES") country = "US";
            consignee["country"] = country;
        }

        return consignee;
    }

    private List<Dictionary<string, object>> ExtractProducts(string text, Dictionary<string, string> kvPairs)
    {
        var products = new List<Dictionary<string, object>>();
        var product = new Dictionary<string, object>();

        // Extract description
        foreach (var key in new[] { "description", "goods description", "product", "commodity" })
        {
            if (kvPairs.TryGetValue(key, out var value))
            {
                product["description"] = value;
                break;
            }
        }

        if (!product.ContainsKey("description"))
        {
            var descPattern = @"(?:description|goods)[\s:]+([^\n]+)";
            var match = Regex.Match(text, descPattern, RegexOptions.IgnoreCase);
            if (match.Success)
            {
                product["description"] = match.Groups[1].Value.Trim();
            }
        }

        // Extract HS Code
        var hsPattern = @"\b(\d{4}\.?\d{2}\.?\d{0,2})\b";
        var hsMatch = Regex.Match(text, hsPattern);
        if (hsMatch.Success)
        {
            product["hsCode"] = hsMatch.Groups[1].Value.Replace(".", "");
        }

        // Extract quantity
        var qtyPattern = @"(?:quantity|qty)[\s:]+(\d+(?:,\d{3})*(?:\.\d+)?)";
        var qtyMatch = Regex.Match(text, qtyPattern, RegexOptions.IgnoreCase);
        if (qtyMatch.Success)
        {
            product["qty"] = qtyMatch.Groups[1].Value.Replace(",", "");
        }

        // Extract value
        var valuePattern = @"(?:value|amount|total)[\s:]*(?:USD|EUR|GBP|INR)?[\s$€£₹]*(\d+(?:,\d{3})*(?:\.\d{2})?)";
        var valueMatch = Regex.Match(text, valuePattern, RegexOptions.IgnoreCase);
        if (valueMatch.Success)
        {
            product["totalValue"] = valueMatch.Groups[1].Value.Replace(",", "");
        }

        if (product.Count > 0)
        {
            product["id"] = $"PROD-{Guid.NewGuid()}";
            product["name"] = "Extracted Product";
            products.Add(product);
        }

        return products;
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
