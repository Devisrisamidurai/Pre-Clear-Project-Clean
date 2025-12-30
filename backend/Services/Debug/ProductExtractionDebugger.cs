using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace backend.Services.Debug;

/// <summary>
/// Debug utility to test product extraction without AWS dependencies.
/// Paste your document text here and run to see what products are extracted.
/// </summary>
public static class ProductExtractionDebugger
{
    public static void TestExtraction(string documentText)
    {
        Console.WriteLine("=== PRODUCT EXTRACTION DEBUG ===\n");
        Console.WriteLine($"Input text length: {documentText.Length} characters\n");

        // Test 1: Find product headers
        Console.WriteLine("--- TEST 1: Finding Product Headers ---");
        var matches = Regex.Matches(documentText, @"(?:^|\n|\s)(?:product|item)\s*[\#:\-]*\s*(\d+)(?:\s|:|$|[\n\.\-])", RegexOptions.IgnoreCase | RegexOptions.Multiline);
        Console.WriteLine($"Found {matches.Count} product headers\n");

        if (matches.Count == 0)
        {
            Console.WriteLine("⚠️  No product headers found with primary pattern!");
            Console.WriteLine("Trying alternative patterns...\n");

            // Alternative 1: Just look for "Product" + number
            var alt1 = Regex.Matches(documentText, @"(?:product|item)\s*(\d+)", RegexOptions.IgnoreCase);
            Console.WriteLine($"Alternative 1 (simple 'Product N'): Found {alt1.Count} matches");

            // Alternative 2: Case insensitive word boundary
            var alt2 = Regex.Matches(documentText, @"\bproduct\s*\d+", RegexOptions.IgnoreCase);
            Console.WriteLine($"Alternative 2 (word boundary): Found {alt2.Count} matches\n");
        }

        // Test 2: Extract sections for each product
        Console.WriteLine("--- TEST 2: Extracting Product Sections ---");
        for (int i = 0; i < matches.Count; i++)
        {
            var start = matches[i].Index;
            var end = i + 1 < matches.Count ? matches[i + 1].Index : documentText.Length;
            var block = documentText.Substring(start, end - start);

            Console.WriteLine($"\n📦 PRODUCT {i + 1}:");
            Console.WriteLine($"   Index range: {start}-{end}");
            Console.WriteLine($"   Text preview: {block.Substring(0, Math.Min(100, block.Length))}...\n");

            // Try to extract description
            var descPattern = @"(?:description|goods description|product|commodity|item)[\s:.-]+([^\n]+)";
            var descMatch = Regex.Match(block, descPattern, RegexOptions.IgnoreCase);
            Console.WriteLine($"   Description: {(descMatch.Success ? descMatch.Groups[1].Value : "NOT FOUND")}");

            // Try to extract quantity
            var qtyPattern = @"(?:quantity|qty)[\s:]+(\d+(?:,\d{3})*(?:\.\d+)?)";
            var qtyMatch = Regex.Match(block, qtyPattern, RegexOptions.IgnoreCase);
            Console.WriteLine($"   Quantity: {(qtyMatch.Success ? qtyMatch.Groups[1].Value : "NOT FOUND")}");

            // Try to extract HS Code
            var hsPattern = @"\b(\d{4}\.?\d{2}\.?\d{0,2})\b";
            var hsMatch = Regex.Match(block, hsPattern);
            Console.WriteLine($"   HS Code: {(hsMatch.Success ? hsMatch.Groups[1].Value : "NOT FOUND")}");

            // Try to extract value
            var valuePattern = @"(?:value|amount|total)[\s:]*(?:USD|EUR|GBP|INR)?[\s$€£₹]*(\d+(?:,\d{3})*(?:\.\d{2})?)";
            var valueMatch = Regex.Match(block, valuePattern, RegexOptions.IgnoreCase);
            Console.WriteLine($"   Total Value: {(valueMatch.Success ? valueMatch.Groups[1].Value : "NOT FOUND")}");

            // Try to extract UOM
            var uomPattern = @"\b(?:box|boxes|carton|cartons|pallet|pallets|pcs|pieces|unit|units|kg|kgs|lb|lbs|liter|liters|ml|m3|cbm|set|sets|pack|packs|bag|bags|crate|crates|tray|trays|drum|drums|tube|tubes|bottle|bottles|can|cans|jar|jars|roll|rolls|sheet|sheets|spool|spools)\b";
            var uomMatch = Regex.Match(block, uomPattern, RegexOptions.IgnoreCase);
            Console.WriteLine($"   UOM: {(uomMatch.Success ? uomMatch.Value : "NOT FOUND")}");
        }

        Console.WriteLine("\n=== END DEBUG ===");
    }

    // Example usage:
    // var testDoc = @"
    // Product 1
    // Description: Aspirin Tablets
    // Quantity: 500
    // Value: $8500
    // 
    // Product 2
    // Description: Dolo Tablets
    // Quantity: 300
    // Value: $5100
    // ";
    // ProductExtractionDebugger.TestExtraction(testDoc);
}
