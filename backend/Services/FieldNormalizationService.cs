using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace backend.Services;

/// <summary>
/// Normalizes extracted field values to match frontend enum/dropdown values exactly.
/// Ensures canonical forms: "USA" → "US", "Box" → "BOX", "Sale" → "SALE", etc.
/// </summary>
public static class FieldNormalizationService
{
    // Country code mappings
    private static readonly Dictionary<string, string> CountryAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        { "United States", "US" },
        { "USA", "US" },
        { "US", "US" },
        { "America", "US" },
        { "India", "IN" },
        { "IN", "IN" },
        { "China", "CN" },
        { "CN", "CN" },
        { "United Kingdom", "GB" },
        { "UK", "GB" },
        { "GB", "GB" },
        { "Germany", "DE" },
        { "DE", "DE" },
        { "France", "FR" },
        { "FR", "FR" },
        { "Japan", "JP" },
        { "JP", "JP" },
        { "Singapore", "SG" },
        { "SG", "SG" },
        { "Hong Kong", "HK" },
        { "HK", "HK" },
        { "Canada", "CA" },
        { "CA", "CA" },
        { "Australia", "AU" },
        { "AU", "AU" },
        { "Mexico", "MX" },
        { "MX", "MX" }
    };

    // Transport mode mappings
    private static readonly Dictionary<string, string> TransportModeAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        { "Air", "AIR" },
        { "Air Freight", "AIR" },
        { "By Air", "AIR" },
        { "Airfreight", "AIR" },
        { "Sea", "SEA" },
        { "Ocean", "SEA" },
        { "Sea Freight", "SEA" },
        { "By Sea", "SEA" },
        { "Road", "ROAD" },
        { "Truck", "ROAD" },
        { "Ground", "ROAD" },
        { "Rail", "RAIL" },
        { "Train", "RAIL" },
        { "Courier", "COURIER" },
        { "Multimodal", "MULTIMODAL" }
    };

    // Unit of Measure mappings
    private static readonly Dictionary<string, string> UnitOfMeasureAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        { "Box", "BOX" },
        { "Boxes", "BOX" },
        { "Carton", "CARTON" },
        { "Cartons", "CARTON" },
        { "Pallet", "PALLET" },
        { "Pallets", "PALLET" },
        { "Piece", "PCS" },
        { "Pieces", "PCS" },
        { "Pcs", "PCS" },
        { "Unit", "UNIT" },
        { "Units", "UNIT" },
        { "Kilogram", "KG" },
        { "Kilograms", "KG" },
        { "KG", "KG" },
        { "LB", "LB" },
        { "Lbs", "LB" },
        { "Pound", "LB" },
        { "Pounds", "LB" },
        { "Liter", "L" },
        { "Liters", "L" },
        { "L", "L" },
        { "Milliliter", "ML" },
        { "Milliliters", "ML" },
        { "ML", "ML" },
        { "M3", "M3" },
        { "Cubic Meter", "M3" },
        { "CBM", "M3" },
        { "Set", "SET" },
        { "Sets", "SET" },
        { "Pack", "PACK" },
        { "Packs", "PACK" },
        { "Bag", "BAG" },
        { "Bags", "BAG" },
        { "Crate", "CRATE" },
        { "Crates", "CRATE" },
        { "Tray", "TRAY" },
        { "Trays", "TRAY" },
        { "Drum", "DRUM" },
        { "Drums", "DRUM" },
        { "Tube", "TUBE" },
        { "Tubes", "TUBE" },
        { "Bottle", "BOTTLE" },
        { "Bottles", "BOTTLE" },
        { "Can", "CAN" },
        { "Cans", "CAN" },
        { "Jar", "JAR" },
        { "Jars", "JAR" },
        { "Roll", "ROLL" },
        { "Rolls", "ROLL" },
        { "Sheet", "SHEET" },
        { "Sheets", "SHEET" },
        { "Spool", "SPOOL" },
        { "Spools", "SPOOL" }
    };

    // Export reason mappings
    private static readonly Dictionary<string, string> ExportReasonAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        { "Sale", "SALE" },
        { "Selling", "SALE" },
        { "For Sale", "SALE" },
        { "Temporary", "TEMPORARY" },
        { "Temp", "TEMPORARY" },
        { "Return", "RETURN" },
        { "Returned", "RETURN" },
        { "Sample", "SAMPLE" },
        { "For Sampling", "SAMPLE" },
        { "Repair", "REPAIR" },
        { "For Repair", "REPAIR" },
        { "Gift", "GIFT" },
        { "Transfer", "TRANSFER" },
        { "Exhibition", "EXHIBITION" },
        { "For Exhibition", "EXHIBITION" }
    };

    // Service level mappings
    private static readonly Dictionary<string, string> ServiceLevelAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        { "Standard", "STANDARD" },
        { "Express", "EXPRESS" },
        { "Economy", "ECONOMY" },
        { "Freight", "FREIGHT" },
        { "Priority", "PRIORITY" }
    };

    // Currency mappings
    private static readonly Dictionary<string, string> CurrencyAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        { "USD", "USD" },
        { "US Dollar", "USD" },
        { "Dollar", "USD" },
        { "$", "USD" },
        { "EUR", "EUR" },
        { "Euro", "EUR" },
        { "€", "EUR" },
        { "GBP", "GBP" },
        { "Pound", "GBP" },
        { "£", "GBP" },
        { "INR", "INR" },
        { "Indian Rupee", "INR" },
        { "₹", "INR" },
        { "CNY", "CNY" },
        { "Chinese Yuan", "CNY" },
        { "JPY", "JPY" },
        { "Japanese Yen", "JPY" },
        { "SGD", "SGD" },
        { "Singapore Dollar", "SGD" },
        { "CAD", "CAD" },
        { "Canadian Dollar", "CAD" },
        { "AUD", "AUD" },
        { "Australian Dollar", "AUD" }
    };

    // HS Code section mapping (first 2 digits map to categories)
    private static readonly Dictionary<string, string> HsCodeSections = new()
    {
        { "01", "Animal Products" },
        { "02", "Vegetable Products" },
        { "03", "Fats and Oils" },
        { "04", "Foodstuffs" },
        { "05", "Minerals" },
        { "06", "Chemicals" },
        { "07", "Plastics" },
        { "08", "Hides and Skins" },
        { "09", "Wood Products" },
        { "10", "Paper" },
        { "11", "Textiles" },
        { "12", "Footwear" },
        { "13", "Stone and Ceramics" },
        { "14", "Precious Metals" },
        { "15", "Metals" },
        { "16", "Machinery" },
        { "17", "Electrical" },
        { "18", "Optical" },
        { "19", "Arms" },
        { "20", "Miscellaneous" },
        { "21", "Works of Art" }
    };

    /// <summary>Normalize country value to ISO 2-letter code</summary>
    public static string NormalizeCountry(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "US"; // Default
        if (CountryAliases.TryGetValue(value.Trim(), out var normalized))
            return normalized;
        // If it's already a 2-letter code, accept it
        return value.Length == 2 ? value.ToUpper() : "US";
    }

    /// <summary>Normalize transport mode to uppercase enum</summary>
    public static string NormalizeTransportMode(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "AIR"; // Default
        if (TransportModeAliases.TryGetValue(value.Trim(), out var normalized))
            return normalized;
        return "AIR";
    }

    /// <summary>Normalize unit of measure to uppercase enum</summary>
    public static string NormalizeUnitOfMeasure(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "PCS"; // Default
        if (UnitOfMeasureAliases.TryGetValue(value.Trim(), out var normalized))
            return normalized;
        return "PCS";
    }

    /// <summary>Normalize export reason to uppercase enum</summary>
    public static string NormalizeExportReason(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "SALE"; // Default
        if (ExportReasonAliases.TryGetValue(value.Trim(), out var normalized))
            return normalized;
        return "SALE";
    }

    /// <summary>Normalize service level to uppercase enum</summary>
    public static string NormalizeServiceLevel(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "STANDARD"; // Default
        if (ServiceLevelAliases.TryGetValue(value.Trim(), out var normalized))
            return normalized;
        return "STANDARD";
    }

    /// <summary>Normalize currency to uppercase code</summary>
    public static string NormalizeCurrency(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "USD"; // Default
        if (CurrencyAliases.TryGetValue(value.Trim(), out var normalized))
            return normalized;
        return "USD";
    }

    /// <summary>Extract HS category from HS code</summary>
    public static string? GetHsCategoryFromCode(string? hsCode)
    {
        if (string.IsNullOrWhiteSpace(hsCode)) return null;
        var section = hsCode.Substring(0, Math.Min(2, hsCode.Length));
        if (HsCodeSections.TryGetValue(section, out var category))
            return category;
        return null;
    }

    /// <summary>Parse ISO date string or common formats</summary>
    public static string? ParseDateToISO(string? dateStr)
    {
        if (string.IsNullOrWhiteSpace(dateStr)) return null;

        var formats = new[]
        {
            "yyyy-MM-dd", "yyyy/MM/dd", "yyyy-MM-dd HH:mm:ss",
            "dd/MM/yyyy", "dd-MM-yyyy", "MM/dd/yyyy", "MM-dd-yyyy",
            "d/M/yyyy", "M/d/yyyy", "dd/MM/yy", "MM/dd/yy",
            "dd.MM.yyyy", "d.M.yyyy"
        };

        if (DateTime.TryParseExact(dateStr.Trim(), formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
        {
            return date.ToString("yyyy-MM-dd");
        }

        return null;
    }

    /// <summary>Calculate unit price from total value and quantity</summary>
    public static decimal CalculateUnitPrice(decimal totalValue, decimal? quantity)
    {
        if (quantity.HasValue && quantity.Value > 0)
            return Math.Round(totalValue / quantity.Value, 2);
        return totalValue;
    }
}
