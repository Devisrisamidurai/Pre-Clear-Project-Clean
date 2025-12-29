import { useState } from 'react';

// Helper to check if an object/array has actual usable data (not just empty structures)
const hasData = (obj) => {
  if (!obj) return false;
  if (Array.isArray(obj)) return obj.length > 0;
  if (typeof obj === 'object') {
    // Check if object has any non-null, non-empty-string values
    return Object.values(obj).some(v => {
      if (v == null) return false;
      if (typeof v === 'string') return v.trim().length > 0;
      if (typeof v === 'number') return true;
      if (typeof v === 'object') return hasData(v); // recursive check
      return true;
    });
  }
  return true; // primitives (numbers, strings) are considered data
};

export function useShipmentExtraction() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const baseUrl = (import.meta?.env?.VITE_API_URL) || "http://localhost:5000";

  const extract = async (files) => {
    setLoading(true);
    setError(null);
    setData(null);
    
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append('files', file));

      console.log('[useShipmentExtraction] 📤 Calling API:', `${baseUrl}/api/ai/extract-shipment-data`);
      console.log('[useShipmentExtraction] 📎 Files:', files.map(f => ({ name: f.name, size: f.size, type: f.type })));

      const res = await fetch(`${baseUrl}/api/ai/extract-shipment-data`, {
        method: 'POST',
        body: formData,
      });

      console.log('[useShipmentExtraction] 📥 Response status:', res.status, res.statusText);

      // Always try to parse JSON response
      let json = null;
      const responseText = await res.text();
      
      console.log('[useShipmentExtraction] 📄 Response body length:', responseText?.length, 'bytes');
      
      if (responseText) {
        try {
          json = JSON.parse(responseText);
          console.log('[useShipmentExtraction] 📦 Parsed response:', JSON.stringify(json, null, 2));
        } catch (parseErr) {
          console.error('[useShipmentExtraction] ❌ JSON parse failed:', parseErr);
          console.error('[useShipmentExtraction] Raw response:', responseText.substring(0, 500));
          throw new Error('Invalid response from server');
        }
      } else {
        console.error('[useShipmentExtraction] ❌ Empty response body');
        throw new Error('Empty response from server');
      }

      // Check success flag from backend
      if (json.success === false) {
        const errorMsg = json.error || 'Extraction failed';
        console.warn('[useShipmentExtraction] ⚠️ Backend returned success=false:', errorMsg);
        setError(errorMsg);
        setData(null);
        return null;
      }

      // CRITICAL: Validate extracted data with detailed logging
      const validationResults = {
        shipper: hasData(json.shipper),
        consignee: hasData(json.consignee),
        products: hasData(json.products),
        // CRITICAL: Check for 'packages' array which is the primary multi-product/multi-package structure
        packages: hasData(json.packages),
        product: hasData(json.product),
        package: hasData(json.package),
        customsValue: json.customsValue != null && json.customsValue > 0,
        currency: json.currency != null,
        serviceLevel: json.serviceLevel != null
      };

      console.log('[useShipmentExtraction] 🔍 Validation results:', validationResults);
      console.log('[useShipmentExtraction] 📊 Extracted data summary:', {
        shipper: json.shipper,
        consignee: json.consignee,
        packages: json.packages,
        products: json.products,
        customsValue: json.customsValue,
        currency: json.currency,
        serviceLevel: json.serviceLevel
      });

      const hasAnyData = Object.values(validationResults).some(v => v === true);

      if (hasAnyData) {
        console.log('[useShipmentExtraction] ✅ SUCCESS - Found usable data in fields:', 
          Object.entries(validationResults).filter(([k, v]) => v).map(([k]) => k).join(', ')
        );
        setData(json);
        setError(null);
        return json;
      } else {
        console.warn('[useShipmentExtraction] ⚠️ NO USABLE DATA - All fields empty or invalid');
        console.warn('[useShipmentExtraction] Full response:', json);
        setError('No shipment data could be extracted from the documents');
        setData(null);
        return null;
      }
    } catch (err) {
      console.error('[useShipmentExtraction] ❌ Extraction error:', err);
      const errorMsg = err?.message || 'Extraction failed';
      setError(errorMsg);
      setData(null);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, data, extract };
}

export default useShipmentExtraction;
