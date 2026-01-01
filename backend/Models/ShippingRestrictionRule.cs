using System;
using System.Collections.Generic;

namespace PreClear.Api.Models
{
    /// <summary>
    /// Model representing a single row from cross_border_shipping_restrictions.csv
    /// </summary>
    public class ShippingRestrictionRule
    {
        public string OriginCountry { get; set; }
        public string OriginCountryIso { get; set; }
        public string DestinationCountry { get; set; }
        public string DestinationCountryIso { get; set; }
        public string Mode { get; set; } // air, sea, road, rail, courier, multimodal
        public string PackageType { get; set; } // box, pallet, crate, envelope, case, etc.
        public string ProductDescription { get; set; }
        public string HsCode { get; set; }
        public decimal MaxWeightKgPerPackage { get; set; }
        public decimal MaxTotalWeightKg { get; set; }
        
        // Restriction flags
        public bool IsRestricted { get; set; }
        public string RestrictedDetails { get; set; }
        public bool IsBanned { get; set; }
        public string BannedDetails { get; set; }
        
        // Packing and compliance requirements
        public string PackingNotes { get; set; }

        /// <summary>
        /// Generates a composite key for matching rules
        /// </summary>
        public string GetCompositeKey()
        {
            return $"{OriginCountry?.ToLower()}|{DestinationCountry?.ToLower()}|{ProductDescription?.ToLower()}|{HsCode?.ToLower()}|{Mode?.ToLower()}";
        }
    }
}
