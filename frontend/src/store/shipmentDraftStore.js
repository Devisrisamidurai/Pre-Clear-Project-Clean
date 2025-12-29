import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useShipmentDraftStore = create(
  persist(
    (set, get) => ({
      mode: 'manual', // 'manual' | 'auto'
      shipmentDraft: {
        shipper: {},
        consignee: {},
        packages: [],
        products: [],
        documents: [],
        customsValue: 0,
        currency: 'USD',
        serviceLevel: 'Standard',
      },
      autoFilledFields: {},
      extractionInProgress: false,
      extractionError: null,

      setMode: (mode) => set({ mode }),

      setShipmentDraft: (draft) => set({ shipmentDraft: draft }),

      updateShipmentDraft: (updates) =>
        set((state) => ({
          shipmentDraft: { ...state.shipmentDraft, ...updates },
        })),

      mergeExtractedData: (extracted) => {
        console.log('[shipmentDraftStore] mergeExtractedData called with:', extracted);
        
        const current = get().shipmentDraft;
        const filled = [];

        const merged = { ...current };

        // Shipper
        if (extracted.shipper && typeof extracted.shipper === 'object') {
          console.log('[shipmentDraftStore] Processing shipper:', extracted.shipper);
          merged.shipper = {
            ...(current.shipper || {}),
            company: extracted.shipper.company || extracted.shipper.name || current.shipper?.company || '',
            address1: extracted.shipper.address1 || extracted.shipper.address || current.shipper?.address1 || '',
            contactName: extracted.shipper.contactName || current.shipper?.contactName || '',
            phone: extracted.shipper.phone || current.shipper?.phone || '',
            email: extracted.shipper.email || current.shipper?.email || '',
            address2: extracted.shipper.address2 || current.shipper?.address2 || '',
            city: extracted.shipper.city || current.shipper?.city || '',
            state: extracted.shipper.state || current.shipper?.state || '',
            postalCode: extracted.shipper.postalCode || current.shipper?.postalCode || '',
            country: extracted.shipper.country || current.shipper?.country || '',
            taxId: current.shipper?.taxId || '',
          };
          if (extracted.shipper.company || extracted.shipper.name) filled.push('shipper.company');
          if (extracted.shipper.address1 || extracted.shipper.address) filled.push('shipper.address1');
        }

        // Consignee
        if (extracted.consignee && typeof extracted.consignee === 'object') {
          console.log('[shipmentDraftStore] Processing consignee:', extracted.consignee);
          merged.consignee = {
            ...(current.consignee || {}),
            company: extracted.consignee.company || extracted.consignee.name || current.consignee?.company || '',
            address1: extracted.consignee.address1 || extracted.consignee.address || current.consignee?.address1 || '',
            country: (extracted.consignee.country || current.consignee?.country || '').toUpperCase(),
            contactName: extracted.consignee.contactName || current.consignee?.contactName || '',
            phone: extracted.consignee.phone || current.consignee?.phone || '',
            email: extracted.consignee.email || current.consignee?.email || '',
            address2: extracted.consignee.address2 || current.consignee?.address2 || '',
            city: extracted.consignee.city || current.consignee?.city || '',
            state: extracted.consignee.state || current.consignee?.state || '',
            postalCode: extracted.consignee.postalCode || current.consignee?.postalCode || '',
          };
          if (extracted.consignee.company || extracted.consignee.name) filled.push('consignee.company');
          if (extracted.consignee.address1 || extracted.consignee.address) filled.push('consignee.address1');
          if (extracted.consignee.country) filled.push('consignee.country');
        }

        // Products/Packages - CRITICAL: Handle both 'packages' array (primary) and 'products' (fallback)
        // 'packages' is the primary structure from TextractService with full package + product hierarchy
        if (extracted.packages && Array.isArray(extracted.packages) && extracted.packages.length > 0) {
          console.log('[shipmentDraftStore] Processing PACKAGES array (primary structure):', extracted.packages);
          
          // Map each package with its products
          const packages = extracted.packages.map((pkg, pkgIdx) => ({
            id: pkg.id || `PKG-${Date.now()}-${pkgIdx}`,
            type: pkg.type || pkg.packageType || 'Box',
            length: pkg.length || pkg.Length || '',
            width: pkg.width || pkg.Width || '',
            height: pkg.height || pkg.Height || '',
            dimUnit: pkg.dimUnit || pkg.DimensionUnit || 'cm',
            weight: pkg.weight || pkg.Weight || '',
            weightUnit: pkg.weightUnit || pkg.WeightUnit || 'kg',
            stackable: pkg.stackable !== undefined ? pkg.stackable : (pkg.Stackable !== undefined ? pkg.Stackable : false),
            products: (pkg.products || []).map((prod, prodIdx) => {
              // Helper to normalize UOM values - convert extracted values to valid form options
              const normalizeUOM = (value) => {
                if (!value) return '';
                const lower = String(value).toLowerCase().trim();
                // Map extracted UOM to form options: ['kg', 'lb', 'pieces', 'meters', 'units', 'sets']
                if (lower.includes('piece') || lower === 'pcs') return 'pieces';
                if (lower.includes('kg') || lower.includes('kilogram')) return 'kg';
                if (lower.includes('lb') || lower.includes('pound')) return 'lb';
                if (lower.includes('meter') || lower === 'm') return 'meters';
                if (lower.includes('unit')) return 'units';
                if (lower.includes('set')) return 'sets';
                return value; // Return as-is if no match
              };

              // Helper to normalize export reason - ensure it matches form options
              const normalizeReason = (value) => {
                if (!value) return '';
                const lower = String(value).toLowerCase().trim();
                // Map extracted reason to form options
                if (lower === 'gift' || lower === 'sample gift') return 'Sending a gift';
                if (lower === 'sale' || lower === 'commercial') return 'Commercial Trade';
                if (lower === 'sample' || lower === 'prototype') return 'Sample/Prototype';
                if (lower === 'return' || lower === 'repair') return 'Return/Repair';
                if (lower === 'personal') return 'Personal Effects';
                if (lower === 'temporary') return 'Temporary Import';
                if (lower === 'exhibition') return 'Exhibition';
                return value; // Return as-is if no match
              };

              return {
                id: prod.id || `PROD-${Date.now()}-${pkgIdx}-${prodIdx}`,
                name: prod.name || prod.Name || 'Extracted Product',
                description: prod.description || prod.Description || '',
                hsCode: prod.hsCode || prod.HsCode || '',
                category: prod.category || prod.Category || '',
                uom: normalizeUOM(prod.uom || prod.Unit || ''),
                qty: prod.qty || prod.Quantity || '',
                unitPrice: prod.unitPrice || prod.UnitPrice || '',
                totalValue: prod.totalValue || prod.TotalValue || '',
                originCountry: prod.originCountry || prod.OriginCountry || merged.shipper?.country || '',
                reasonForExport: normalizeReason(prod.reasonForExport || prod.ExportReason || ''),
              };
            })
          }));

          merged.packages = packages;
          
          // Track which fields were auto-filled
          extracted.packages.forEach((pkg, pkgIdx) => {
            if (pkg.weight || pkg.Weight) filled.push(`packages[${pkgIdx}].weight`);
            if (pkg.length || pkg.Length) filled.push(`packages[${pkgIdx}].length`);
            if (pkg.width || pkg.Width) filled.push(`packages[${pkgIdx}].width`);
            if (pkg.height || pkg.Height) filled.push(`packages[${pkgIdx}].height`);
            
            (pkg.products || []).forEach((prod, prodIdx) => {
              if (prod.description || prod.Description) filled.push(`packages[${pkgIdx}].products[${prodIdx}].description`);
              if (prod.hsCode || prod.HsCode) filled.push(`packages[${pkgIdx}].products[${prodIdx}].hsCode`);
              if (prod.qty || prod.Quantity) filled.push(`packages[${pkgIdx}].products[${prodIdx}].qty`);
              if (prod.totalValue || prod.TotalValue) filled.push(`packages[${pkgIdx}].products[${prodIdx}].totalValue`);
            });
          });

          console.log('[shipmentDraftStore] Mapped', packages.length, 'packages with', packages.reduce((sum, p) => sum + (p.products?.length || 0), 0), 'total products');
        } 
        // Fallback: if no 'packages' array, process individual 'products' array
        else if (extracted.products && Array.isArray(extracted.products) && extracted.products.length > 0) {
          console.log('[shipmentDraftStore] Processing PRODUCTS array (fallback structure):', extracted.products);
          const packages = current.packages && current.packages.length > 0 ? [...current.packages] : [{
            id: `PKG-${Date.now()}`,
            type: 'Box',
            length: '',
            width: '',
            height: '',
            dimUnit: 'cm',
            weight: '',
            weightUnit: 'kg',
            stackable: false,
            products: [],
          }];

          packages[0].products = extracted.products.map((prod, idx) => {
            const product = {
              id: prod.id || `PROD-${Date.now()}-${idx}`,
              name: prod.name || 'Extracted Product',
              description: prod.description || '',
              hsCode: prod.hsCode || '',
              category: prod.category || '',
              uom: prod.uom || '',
              qty: prod.qty || '',
              unitPrice: prod.unitPrice || '',
              totalValue: prod.totalValue || '',
              originCountry: prod.originCountry || merged.shipper?.country || '',
              reasonForExport: prod.reasonForExport || '',
            };
            console.log('[shipmentDraftStore] Mapped product:', product);
            return product;
          });

          merged.packages = packages;
          extracted.products.forEach((prod, idx) => {
            if (prod.description) filled.push(`packages[0].products[${idx}].description`);
            if (prod.hsCode) filled.push(`packages[0].products[${idx}].hsCode`);
            if (prod.qty) filled.push(`packages[0].products[${idx}].qty`);
            if (prod.totalValue) filled.push(`packages[0].products[${idx}].totalValue`);
          });
        } else if (extracted.product && typeof extracted.product === 'object') {
          console.log('[shipmentDraftStore] Processing single product:', extracted.product);
          // Single product
          const packages = current.packages && current.packages.length > 0 ? [...current.packages] : [{
            id: `PKG-${Date.now()}`,
            type: 'Box',
            length: '',
            width: '',
            height: '',
            dimUnit: 'cm',
            weight: '',
            weightUnit: 'kg',
            stackable: false,
            products: [],
          }];

          const firstProd = {
            id: `PROD-${Date.now()}`,
            name: 'Extracted Product',
            description: extracted.product.description || '',
            hsCode: extracted.product.hsCode || '',
            category: '',
            uom: '',
            qty: extracted.product.quantity || extracted.product.qty || '',
            unitPrice: '',
            totalValue: extracted.product.value || extracted.product.totalValue || '',
            originCountry: merged.shipper?.country || '',
          };

          packages[0].products = [firstProd];
          merged.packages = packages;
          if (extracted.product.description) filled.push('packages[0].products[0].description');
          if (extracted.product.hsCode) filled.push('packages[0].products[0].hsCode');
          if (extracted.product.quantity || extracted.product.qty) filled.push('packages[0].products[0].qty');
          if (extracted.product.value || extracted.product.totalValue) filled.push('packages[0].products[0].totalValue');
        }

        // Package dimensions
        if (extracted.package) {
          const packages = merged.packages && merged.packages.length > 0 ? [...merged.packages] : [{
            id: `PKG-${Date.now()}`,
            type: 'Box',
            length: '',
            width: '',
            height: '',
            dimUnit: 'cm',
            weight: '',
            weightUnit: 'kg',
            stackable: false,
            products: [],
          }];

          const parseDims = (dims) => {
            if (!dims) return {};
            const match = String(dims).match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/);
            if (!match) return {};
            return { length: parseFloat(match[1]), width: parseFloat(match[2]), height: parseFloat(match[3]) };
          };

          if (extracted.package.weight) {
            packages[0].weight = parseFloat(extracted.package.weight) || extracted.package.weight;
            filled.push('packages[0].weight');
          }

          const dims = parseDims(extracted.package.dimensions);
          if (dims.length) {
            packages[0].length = dims.length;
            filled.push('packages[0].length');
          }
          if (dims.width) {
            packages[0].width = dims.width;
            filled.push('packages[0].width');
          }
          if (dims.height) {
            packages[0].height = dims.height;
            filled.push('packages[0].height');
          }

          merged.packages = packages;
        }

        // Customs value
        if (extracted.customsValue != null) {
          merged.customsValue = extracted.customsValue;
          console.log('[shipmentDraftStore] Set customsValue:', extracted.customsValue);
          filled.push('customsValue');
        }

        // Currency
        if (extracted.currency) {
          merged.currency = extracted.currency;
          console.log('[shipmentDraftStore] Set currency:', extracted.currency);
          filled.push('currency');
        }

        // Service level
        if (extracted.serviceLevel) {
          merged.serviceLevel = extracted.serviceLevel;
          console.log('[shipmentDraftStore] Set serviceLevel:', extracted.serviceLevel);
          filled.push('serviceLevel');
        }

        // Additional shipment details that should be captured
        if (extracted.title || extracted.shipmentTitle || extracted.shipmentName) {
          merged.title = extracted.title || extracted.shipmentTitle || extracted.shipmentName;
          filled.push('title');
        }
        if (extracted.mode) {
          merged.mode = extracted.mode;
          filled.push('mode');
        }
        if (extracted.shipmentType) {
          merged.shipmentType = extracted.shipmentType;
          filled.push('shipmentType');
        }
        if (extracted.pickupType) {
          merged.pickupType = extracted.pickupType;
          filled.push('pickupType');
        }
        if (extracted.incoterm) {
          merged.incoterm = extracted.incoterm;
          filled.push('incoterm');
        }
        if (extracted.billTo) {
          merged.billTo = extracted.billTo;
          filled.push('billTo');
        }
        if (extracted.paymentTiming) {
          merged.paymentTiming = extracted.paymentTiming;
          filled.push('paymentTiming');
        }
        if (extracted.paymentMethod) {
          merged.paymentMethod = extracted.paymentMethod;
          filled.push('paymentMethod');
        }
        if (extracted.reasonForExport) {
          merged.reasonForExport = extracted.reasonForExport;
          filled.push('reasonForExport');
        }
        if (extracted.specialInstructions) {
          merged.specialInstructions = extracted.specialInstructions;
          filled.push('specialInstructions');
        }
        if (extracted.insuranceRequired !== undefined) {
          merged.insuranceRequired = extracted.insuranceRequired;
          filled.push('insuranceRequired');
        }
        if (extracted.dangerousGoods !== undefined) {
          merged.dangerousGoods = extracted.dangerousGoods;
          filled.push('dangerousGoods');
        }

        // Pickup and delivery details
        if (extracted.pickupLocation || extracted.pickupAddress) {
          merged.pickupLocation = extracted.pickupLocation || extracted.pickupAddress;
          filled.push('pickupLocation');
        }
        if (extracted.pickupDate) {
          merged.pickupDate = extracted.pickupDate;
          filled.push('pickupDate');
        }
        if (extracted.pickupTimeEarliest || extracted.pickupTimeStart) {
          merged.pickupTimeEarliest = extracted.pickupTimeEarliest || extracted.pickupTimeStart;
          filled.push('pickupTimeEarliest');
        }
        if (extracted.pickupTimeLatest || extracted.pickupTimeEnd) {
          merged.pickupTimeLatest = extracted.pickupTimeLatest || extracted.pickupTimeEnd;
          filled.push('pickupTimeLatest');
        }
        if (extracted.estimatedDropoffDate || extracted.dropoffDate) {
          merged.estimatedDropoffDate = extracted.estimatedDropoffDate || extracted.dropoffDate;
          filled.push('estimatedDropoffDate');
        }

        console.log('[shipmentDraftStore] Merge complete. Filled fields:', filled);
        console.log('[shipmentDraftStore] Merged shipmentDraft:', merged);

        set({
          shipmentDraft: merged,
          autoFilledFields: filled.reduce((acc, path) => ({ ...acc, [path]: true }), {}),
        });

        return merged;
      },

      isFieldAutoFilled: (path) => {
        return Boolean(get().autoFilledFields[path]);
      },

      clearDraft: () =>
        set({
          shipmentDraft: {
            shipper: {},
            consignee: {},
            packages: [],
            products: [],
            documents: [],
            customsValue: 0,
            currency: 'USD',
            serviceLevel: 'Standard',
          },
          autoFilledFields: {},
          extractionError: null,
        }),

      setExtractionInProgress: (inProgress) => set({ extractionInProgress: inProgress }),
      setExtractionError: (error) => set({ extractionError: error }),
    }),
    {
      name: 'shipment-draft-storage',
      partialize: (state) => ({
        mode: state.mode,
        shipmentDraft: state.shipmentDraft,
        autoFilledFields: state.autoFilledFields,
      }),
    }
  )
);
