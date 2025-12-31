import { useState, useEffect } from 'react';
import { 
  MapPin, Package, Truck, Clock, DollarSign, Info, AlertCircle, CheckCircle2, 
  AlertTriangle, ChevronDown, Plus, Trash2, FileText, Globe, Settings, Users, Pencil, Sparkles, Upload
} from 'lucide-react';
import { shipmentsStore } from '../../store/shipmentsStore';
import { suggestHSCode, validateAndCheckHSCode, getCurrencyByCountry } from '../../utils/validation';
import { HsSuggestionPanel } from './HsSuggestionPanel';
import { createShipment, updateShipment } from '../../api/shipments';
import { markShipmentDocument } from '../../api/documents';
import { getProfile } from '../../api/auth';
import { uploadShipmentDocument } from '../../api/documents';
import { getDocumentStatus } from '../../api/documents';
import AutoFillToggle from '../AutoFillToggle';
import DocumentUploadSection from '../DocumentUploadSection';
import { useShipmentDraftStore } from '../../store/shipmentDraftStore';

const modes = ['Air', 'Sea', 'Road', 'Rail', 'Courier', 'Multimodal'];
const shipmentTypes = ['Domestic', 'International'];
const pickupTypes = ['Scheduled Pickup', 'Drop-off'];
const serviceLevels = ['Standard', 'Express', 'Economy', 'Freight'];
const incoterms = ['FOB', 'CIF', 'DDP', 'EXW', 'CPT', 'DAP'];
const billToOptions = ['Shipper', 'Consignee', 'ThirdParty'];
const paymentTimings = ['Prepaid', 'Collect', 'COD'];
const paymentMethods = ['Credit Card', 'Bank Transfer', 'Wire Transfer', 'Check'];
const currencies = ['USD', 'EUR', 'GBP', 'INR', 'CNY', 'JPY', 'CAD', 'AUD', 'SGD', 'CHF'];
const packageTypes = ['Box', 'Pallet', 'Crate', 'Bag', 'Case', 'Envelope'];
const uoms = ['kg', 'lb', 'pieces', 'meters', 'units', 'sets'];
const reasonsForExport = [
  'Sending a gift',
  'Commercial Trade',
  'Sample/Prototype',
  'Return/Repair',
  'Personal Effects',
  'Temporary Import',
  'Exhibition',
  'Other'
];

// Customs clearance configuration by country/region
const CLEARANCE_CONFIG = {
  'IN': { base: 50, threshold: 10000, formalFee: 2000, extraLineItemFee: 100, specialCommodityFee: 1500 },
  'US': { base: 0, threshold: 800, formalFee: 35, extraLineItemFee: 5, specialCommodityFee: 25 },
  'GB': { base: 20, threshold: 150, formalFee: 40, extraLineItemFee: 5, specialCommodityFee: 30 },
  'FR': { base: 20, threshold: 150, formalFee: 40, extraLineItemFee: 5, specialCommodityFee: 30 },
  'DE': { base: 20, threshold: 150, formalFee: 40, extraLineItemFee: 5, specialCommodityFee: 30 },
  'IT': { base: 20, threshold: 150, formalFee: 40, extraLineItemFee: 5, specialCommodityFee: 30 },
  'ES': { base: 20, threshold: 150, formalFee: 40, extraLineItemFee: 5, specialCommodityFee: 30 },
  'NL': { base: 20, threshold: 150, formalFee: 40, extraLineItemFee: 5, specialCommodityFee: 30 },
  'BE': { base: 20, threshold: 150, formalFee: 40, extraLineItemFee: 5, specialCommodityFee: 30 },
  'default': { base: 30, threshold: 100, formalFee: 50, extraLineItemFee: 5, specialCommodityFee: 30 }
};

// Pickup charge configuration by origin country
const PICKUP_CONFIG = {
  'IN': 250,
  'US': 35,
  'GB': 25,
  'FR': 28,
  'DE': 30,
  'IT': 27,
  'ES': 26,
  'NL': 32,
  'BE': 29,
  'CN': 40,
  'JP': 50,
  'SG': 45,
  'AU': 55,
  'CA': 40,
  'MX': 38,
  'BR': 42,
  'default': 50
};

// Helper function to calculate estimated customs clearance
const calculateClearance = (destCountry, customsValue, lineItemCount, isSpecialCommodity) => {
  const country = destCountry?.toUpperCase() || '';
  const config = CLEARANCE_CONFIG[country] || CLEARANCE_CONFIG['default'];
  
  let clearance = config.base;
  
  // Add formal clearance fee if customs value exceeds threshold
  if (customsValue > config.threshold) {
    clearance += config.formalFee;
  }
  
  // Add extra line item fee if line items > 5
  if (lineItemCount > 5) {
    clearance += (lineItemCount - 5) * config.extraLineItemFee;
  }
  
  // Add special commodity surcharge if applicable
  if (isSpecialCommodity) {
    clearance += config.specialCommodityFee;
  }
  
  return Math.round(clearance);
};

// Helper function to calculate pickup charge based on origin country
const calculatePickupCharge = (originCountry) => {
  const country = originCountry?.toUpperCase() || '';
  return PICKUP_CONFIG[country] || PICKUP_CONFIG['default'];
};

// Country options (code + full name) shown in selects
const countryOptions = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'MX', name: 'Mexico' },
  { code: 'BR', name: 'Brazil' },
  { code: 'AR', name: 'Argentina' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'ES', name: 'Spain' },
  { code: 'PT', name: 'Portugal' },
  { code: 'IT', name: 'Italy' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'PL', name: 'Poland' },
  { code: 'CN', name: 'China' },
  { code: 'IN', name: 'India' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'SG', name: 'Singapore' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'PH', name: 'Philippines' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'QA', name: 'Qatar' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'KE', name: 'Kenya' },
  { code: 'NG', name: 'Nigeria' },
];

// Country code to full name mapping for lookups
const countryNames = countryOptions.reduce((acc, { code, name }) => {
  acc[code] = name;
  return acc;
}, {});

const resolveCountryCode = (value) => {
  if (!value) return '';
  const codeList = countryOptions.map(c => c.code);
  if (codeList.includes(value)) return value;
  const match = countryOptions.find((c) => c.name.toLowerCase() === value.toLowerCase());
  return match ? match.code : value;
};

// Small helper: return state/province options for a given country code
const getStateOptions = (countryCode) => {
  const cc = (countryCode || '').toUpperCase();
  const US_STATES = [
    { value: 'AL', label: 'Alabama' },{ value: 'AK', label: 'Alaska' },{ value: 'AZ', label: 'Arizona' },{ value: 'AR', label: 'Arkansas' },{ value: 'CA', label: 'California' },{ value: 'CO', label: 'Colorado' },{ value: 'CT', label: 'Connecticut' },{ value: 'DE', label: 'Delaware' },{ value: 'FL', label: 'Florida' },{ value: 'GA', label: 'Georgia' },{ value: 'HI', label: 'Hawaii' },{ value: 'ID', label: 'Idaho' },{ value: 'IL', label: 'Illinois' },{ value: 'IN', label: 'Indiana' },{ value: 'IA', label: 'Iowa' },{ value: 'KS', label: 'Kansas' },{ value: 'KY', label: 'Kentucky' },{ value: 'LA', label: 'Louisiana' },{ value: 'ME', label: 'Maine' },{ value: 'MD', label: 'Maryland' },{ value: 'MA', label: 'Massachusetts' },{ value: 'MI', label: 'Michigan' },{ value: 'MN', label: 'Minnesota' },{ value: 'MS', label: 'Mississippi' },{ value: 'MO', label: 'Missouri' },{ value: 'MT', label: 'Montana' },{ value: 'NE', label: 'Nebraska' },{ value: 'NV', label: 'Nevada' },{ value: 'NH', label: 'New Hampshire' },{ value: 'NJ', label: 'New Jersey' },{ value: 'NM', label: 'New Mexico' },{ value: 'NY', label: 'New York' },{ value: 'NC', label: 'North Carolina' },{ value: 'ND', label: 'North Dakota' },{ value: 'OH', label: 'Ohio' },{ value: 'OK', label: 'Oklahoma' },{ value: 'OR', label: 'Oregon' },{ value: 'PA', label: 'Pennsylvania' },{ value: 'RI', label: 'Rhode Island' },{ value: 'SC', label: 'South Carolina' },{ value: 'SD', label: 'South Dakota' },{ value: 'TN', label: 'Tennessee' },{ value: 'TX', label: 'Texas' },{ value: 'UT', label: 'Utah' },{ value: 'VT', label: 'Vermont' },{ value: 'VA', label: 'Virginia' },{ value: 'WA', label: 'Washington' },{ value: 'WV', label: 'West Virginia' },{ value: 'WI', label: 'Wisconsin' },{ value: 'WY', label: 'Wyoming' }
  ];
  const CA_PROVINCES = [
    { value: 'AB', label: 'Alberta' },{ value: 'BC', label: 'British Columbia' },{ value: 'MB', label: 'Manitoba' },{ value: 'NB', label: 'New Brunswick' },{ value: 'NL', label: 'Newfoundland and Labrador' },{ value: 'NS', label: 'Nova Scotia' },{ value: 'ON', label: 'Ontario' },{ value: 'PE', label: 'Prince Edward Island' },{ value: 'QC', label: 'Quebec' },{ value: 'SK', label: 'Saskatchewan' },{ value: 'NT', label: 'Northwest Territories' },{ value: 'NU', label: 'Nunavut' },{ value: 'YT', label: 'Yukon' }
  ];
  const IN_STATES = [
    { value: 'AN', label: 'Andaman and Nicobar Islands' },{ value: 'AP', label: 'Andhra Pradesh' },{ value: 'AR', label: 'Arunachal Pradesh' },{ value: 'AS', label: 'Assam' },{ value: 'BR', label: 'Bihar' },{ value: 'CH', label: 'Chandigarh' },{ value: 'CT', label: 'Chhattisgarh' },{ value: 'DN', label: 'Dadra and Nagar Haveli' },{ value: 'DD', label: 'Daman and Diu' },{ value: 'DL', label: 'Delhi' },{ value: 'GA', label: 'Goa' },{ value: 'GJ', label: 'Gujarat' },{ value: 'HR', label: 'Haryana' },{ value: 'HP', label: 'Himachal Pradesh' },{ value: 'JK', label: 'Jammu and Kashmir' },{ value: 'JH', label: 'Jharkhand' },{ value: 'KA', label: 'Karnataka' },{ value: 'KL', label: 'Kerala' },{ value: 'LD', label: 'Lakshadweep' },{ value: 'MP', label: 'Madhya Pradesh' },{ value: 'MH', label: 'Maharashtra' },{ value: 'MN', label: 'Manipur' },{ value: 'ML', label: 'Meghalaya' },{ value: 'MZ', label: 'Mizoram' },{ value: 'NL', label: 'Nagaland' },{ value: 'OR', label: 'Odisha' },{ value: 'PY', label: 'Puducherry' },{ value: 'PB', label: 'Punjab' },{ value: 'RJ', label: 'Rajasthan' },{ value: 'SK', label: 'Sikkim' },{ value: 'TN', label: 'Tamil Nadu' },{ value: 'TG', label: 'Telangana' },{ value: 'TR', label: 'Tripura' },{ value: 'UP', label: 'Uttar Pradesh' },{ value: 'UT', label: 'Uttarakhand' },{ value: 'WB', label: 'West Bengal' }
  ];
  const AU_STATES = [
    { value: 'NSW', label: 'New South Wales' },{ value: 'VIC', label: 'Victoria' },{ value: 'QLD', label: 'Queensland' },{ value: 'WA', label: 'Western Australia' },{ value: 'SA', label: 'South Australia' },{ value: 'TAS', label: 'Tasmania' },{ value: 'ACT', label: 'Australian Capital Territory' },{ value: 'NT', label: 'Northern Territory' }
  ];

  if (cc === 'US') return US_STATES;
  if (cc === 'CA') return CA_PROVINCES;
  if (cc === 'IN') return IN_STATES;
  if (cc === 'AU') return AU_STATES;
  // For countries without a predefined list, return an empty array so SelectField shows placeholder
  return [];
};

// Try multiple localStorage keys for profile data
const getStoredProfile = () => {
  const keys = ['userProfile', 'profile', 'shipperProfile'];
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      // ignore parse errors and continue
    }
  }
  return null;
};
const CollapsibleSection = ({ title, isOpen, onToggle, children, icon: Icon }) => (
  <div className="border border-slate-200 rounded-lg overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between p-4 transition-colors"
      style={{ background: '#EAD8C3' }}
    >
      <div className="flex items-center gap-3">
        {Icon && <Icon className="w-5 h-5" style={{ color: '#2F1B17' }} />}
        <h3 className="font-semibold" style={{ color: '#2F1B17' }}>{title}</h3>
      </div>
      <ChevronDown 
        className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        style={{ color: '#2F1B17' }}
      />
    </button>
    {isOpen && (
      <div className="p-6 bg-white border-t border-slate-200 space-y-4">
        {children}
      </div>
    )}
  </div>
);

const OvalButton = ({ children, className = '', style = {}, ...props }) => (
  <button
    {...props}
    className={className}
    style={{ border: 'none', borderRadius: '9999px', padding: '0.5rem 1rem', outline: 'none', ...style }}
  >
    {children}
  </button>
);

const InputField = ({ label, type = 'text', name, value, onChange, required = false, placeholder = '', disabled = false, highlight = false }) => (
  <div>
    <label className="block text-sm font-medium text-slate-700 mb-1">
      {label}
      {required && <span className="text-red-600">*</span>}
    </label>
    <input
      type={type}
      name={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${highlight ? 'border-amber-400 bg-amber-50' : 'border-slate-300'} ${disabled ? 'bg-slate-100 text-slate-500' : ''}`}
    />
  </div>
);

      const SelectField = ({ label, name, value, onChange, options, required = false, disabled = false, highlight = false }) => {
  const normalize = (opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return { value: opt.value ?? opt.code, label: opt.label ?? opt.name ?? opt.value ?? '' };
  };

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}
        {required && <span className="text-red-600">*</span>}
      </label>
      <select
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled}
        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${highlight ? 'border-amber-400 bg-amber-50' : 'border-slate-300'} ${disabled ? 'bg-slate-100 text-slate-500' : ''}`}
      >
        <option value="">-- Select {label} --</option>
        {options.map(opt => {
          const { value: val, label: lab } = normalize(opt);
          return (
            <option key={val} value={val}>{lab}</option>
          );
        })}
      </select>
    </div>
  );
};

const CheckboxField = ({ label, name, checked, onChange }) => (
  <div className="flex items-center gap-3">
    <input
      type="checkbox"
      name={name}
      checked={checked}
      onChange={onChange}
      className="w-4 h-4 border-slate-300 rounded focus:ring-blue-500"
    />
    <label className="text-sm font-medium text-slate-700">{label}</label>
  </div>
);

export function ShipmentForm({ shipment, onNavigate }) {
  const normalizeShipment = (raw) => {
    if (!raw) return null;
    const normalizedId = raw.id ?? raw.Id ?? raw.shipmentId ?? raw.ShipmentId ?? raw.shipment_id;
    return {
      ...raw,
      id: normalizedId,
      referenceId: raw.referenceId ?? raw.ReferenceId ?? raw.reference_id,
      shipper: raw.shipper || {},
      consignee: raw.consignee || {},
      packages: raw.packages || [],
      products: raw.products || [],
      documents: raw.documents || [],
      documentRequests: raw.documentRequests || [],
    };
  };

  // Initialize form data - START COMPLETELY EMPTY for new shipments
  // Only populate from shipment prop if editing existing shipment
  const [formData, setFormData] = useState(() => {
    const normalized = normalizeShipment(shipment);
    if (normalized) return normalized;
    // NEW SHIPMENT: Start completely empty - no default shipper/consignee/packages
    return {
      // Initialize party objects so nested edits always have a target
      shipper: {},
      consignee: {},
      packages: [],
      products: [],
      documents: [],
      documentRequests: [],
      title: '',
      mode: '',
      shipmentType: '',
      serviceLevel: '',
      customsValue: 0,
      currency: 'USD',
      weight: ''
    };
  });
  const [profileCountry, setProfileCountry] = useState('');
  const [profileCurrency, setProfileCurrency] = useState('USD');
  const [profileData, setProfileData] = useState(null);
  // Allow shipper fields to be edited by default on new shipments; lock only when editing an existing shipment
  const [shipperEditable, setShipperEditable] = useState(!shipment);
  const [expandedSections, setExpandedSections] = useState({
    basics: true,
    shipper: false,
    consignee: false,
    packages: false,
    service: false,
    documents: false,
  });
  const [requiredDocuments, setRequiredDocuments] = useState([]);
  const [documentFiles, setDocumentFiles] = useState({});
  const [uploadingDocumentName, setUploadingDocumentName] = useState(null);
  const [documentUploadError, setDocumentUploadError] = useState('');
  const [analyzingDocuments, setAnalyzingDocuments] = useState(false);
  const [documentValidationError, setDocumentValidationError] = useState('');
  const [uploadingDocuments, setUploadingDocuments] = useState({});
  const [documentUploadErrors, setDocumentUploadErrors] = useState({});
  const [errors, setErrors] = useState({});
  const [pricing, setPricing] = useState({
    basePrice: 0,
    serviceCharge: 0,
    customsClearance: 0,
    pickupCharge: 0,
    insurance: 0,
    subtotal: 0,
    tax: 0,
    total: 0,
  });
  const { 
    mode, 
    setMode, 
    shipmentDraft, 
    updateShipmentDraft,
    mergeExtractedData,
    isFieldAutoFilled,
    clearDraft
  } = useShipmentDraftStore();

  const isAutoFilled = (path) => isFieldAutoFilled(path);

  const ensureArray = (arr) => Array.isArray(arr) ? arr : [];

  const parseDims = (dims) => {
    if (!dims) return {};
    const match = String(dims).match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/);
    if (!match) return {};
    return { length: parseFloat(match[1]), width: parseFloat(match[2]), height: parseFloat(match[3]) };
  };

  // HS code suggestion + validation state (per-product)
  const [hsSuggestions, setHsSuggestions] = useState({});
  const [loadingHsSuggestions, setLoadingHsSuggestions] = useState({});
  const [hsValidation, setHsValidation] = useState({});
  const [selectedHsIndex, setSelectedHsIndex] = useState({});
  const [hsSections, setHsSections] = useState([]);
  const [currentStep, setCurrentStep] = useState(1);

  // Step labels for navigation
  const steps = [
    { number: 1, title: 'Shipment Basics' },
    { number: 2, title: 'Shipper Info' },
    { number: 3, title: 'Consignee Info' },
    { number: 4, title: 'Package & Contents' },
    { number: 5, title: 'Service & Billing' },
    { number: 6, title: 'Documents' }
  ];

  // Shared yellow button style used across the form (darker yellow, coffee-brown text)
  // Buttons should be borderless and rounded per UI spec
  const yellowButtonStyle = { background: '#F2B705', color: '#2F1B17', border: 'none', borderRadius: '9999px' };
  // Grey style for secondary buttons (borderless)
  const greyButtonStyle = { background: '#E5E7EB', color: '#111827', border: 'none', borderRadius: '9999px' };


  // Apply profile data into the form (used on load and when profile changes)
  // Populates shipper info from profile to ensure it's saved when creating shipment
  const applyProfileToForm = (profile) => {
    console.log('[ShipmentForm] Applying profile to form:', profile);
    
    // Extract shipper profile data from API response (handle both PascalCase and camelCase)
    const shipperProfile = profile?.Profile || profile?.profile || {};
    const countryCode = resolveCountryCode(shipperProfile.CountryCode || shipperProfile.countryCode || '');
    const currency = countryCode ? getCurrencyByCountry(countryCode).code : 'USD';
    setProfileCountry(countryCode);
    setProfileCurrency(currency);
    setProfileData(profile);

    // Extract profile fields (handle both PascalCase and camelCase from backend)
    const firstName = profile?.FirstName || profile?.firstName || '';
    const lastName = profile?.LastName || profile?.lastName || '';
    const company = profile?.Company || profile?.company || '';
    const email = profile?.Email || profile?.email || '';
    const phone = profile?.Phone || profile?.phone || '';
    const addressLine1 = shipperProfile.AddressLine1 || shipperProfile.addressLine1 || '';
    const addressLine2 = shipperProfile.AddressLine2 || shipperProfile.addressLine2 || '';
    const city = shipperProfile.City || shipperProfile.city || '';
    const state = shipperProfile.State || shipperProfile.state || '';
    const postalCode = shipperProfile.PostalCode || shipperProfile.postalCode || shipperProfile.PinCode || shipperProfile.pinCode || '';

    const contactName = firstName && lastName ? `${firstName} ${lastName}`.trim() : '';

    console.log('[ShipmentForm] Extracted profile data:', {
      company, contactName, email, phone, addressLine1, city, state, postalCode, countryCode
    });

    // Populate shipper info from profile so it's saved in the shipment
    setFormData(prev => {
      const updatedData = {
        ...prev,
        currency: prev.currency || currency,
        shipper: {
          ...(prev.shipper || {}),
          company: prev.shipper?.company || company,
          contactName: prev.shipper?.contactName || contactName,
          email: prev.shipper?.email || email,
          phone: prev.shipper?.phone || phone,
          address1: prev.shipper?.address1 || addressLine1,
          address2: prev.shipper?.address2 || addressLine2,
          city: prev.shipper?.city || city,
          state: prev.shipper?.state || state,
          postalCode: prev.shipper?.postalCode || postalCode,
          country: prev.shipper?.country || countryCode,
        }
      };
      console.log('[ShipmentForm] Updated formData.shipper:', updatedData.shipper);
      return updatedData;
    });
  };

  // Sync formData with shipmentDraft on step changes and when draft changes
  // DISABLED: Do not auto-sync from draft on new shipments to keep sidebar empty
  // Only populate when user explicitly uploads documents with extraction
  useEffect(() => {
    // Intentionally disabled to keep sidebar clean on new shipments
    // if (shipment) return;
    // if (mode === 'auto' && shipmentDraft) { ... }
  }, [shipment, mode, shipmentDraft, currentStep]);

  // Load profile metadata (country, currency only) from database on load
  // Does NOT auto-populate shipper/consignee/packages to keep sidebar clean
  useEffect(() => {
    if (shipment) return; // Don't override if editing existing shipment
    
    const loadProfileFromDB = async () => {
      try {
        console.log('[ShipmentForm] Loading profile from database...');
        const profile = await getProfile();
        console.log('[ShipmentForm] Profile loaded from database:', profile);
        if (profile) {
          applyProfileToForm(profile);
        } else {
          console.warn('[ShipmentForm] No profile data returned from API');
        }
      } catch (err) {
        console.error('[ShipmentForm] Failed to load profile from database:', err);
        // Fallback to localStorage if API fails
        try {
          const localProfile = getStoredProfile();
          if (localProfile) applyProfileToForm(localProfile);
        } catch (e) {
          // ignore
        }
      }
    };
    
    loadProfileFromDB();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipment]);

  // Listen for profile changes (storage events / tab visibility) to refresh shipper info
  useEffect(() => {
    if (shipment) return;
    const handleProfileRefresh = async () => {
      try {
        const profile = await getProfile();
        if (profile) applyProfileToForm(profile);
      } catch (e) {
        // Fallback to localStorage
        try {
          const localProfile = getStoredProfile();
          if (localProfile) applyProfileToForm(localProfile);
        } catch (err) {
          // ignore
        }
      }
    };

    const onStorage = (e) => {
      if (e.key === 'userProfile') handleProfileRefresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') handleProfileRefresh();
    };

    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [shipment, shipperEditable]);

  const uploadDocumentForShipment = async (docName, file) => {
    if (!file) return;

    setDocumentFiles(prev => ({ ...prev, [docName]: file }));

    // If we do not yet have a numeric shipment ID, defer upload until after submit
    if (!formData.id || !/^\d+$/.test(formData.id)) {
      setRequiredDocuments(prev => prev.map(d => d.name === docName ? { ...d, uploaded: true, fileName: file.name } : d));
      return;
    }

    setUploadingDocumentName(docName);
    setDocumentUploadError('');

    try {
      await uploadShipmentDocument(formData.id, file, docName);
      await markShipmentDocument(formData.id, file.name);
      setRequiredDocuments(prev => prev.map(d => d.name === docName ? { ...d, uploaded: true, fileName: file.name } : d));
      setDocumentFiles(prev => {
        const next = { ...prev };
        delete next[docName];
        return next;
      });
    } catch (err) {
      console.error('[ShipmentForm] Failed to upload document', docName, err);
      setDocumentUploadError(`Failed to upload ${docName}: ${err?.message || 'unknown error'}`);
    } finally {
      setUploadingDocumentName(null);
    }
  };

  const uploadPendingDocuments = async (shipmentId) => {
    setDocumentUploadError('');
    const entries = Object.entries(documentFiles || {});
    if (entries.length === 0) return;

    for (const [docName, file] of entries) {
      try {
        await uploadShipmentDocument(shipmentId, file, docName);
        await markShipmentDocument(shipmentId, file.name);
        setRequiredDocuments(prev => prev.map(d => d.name === docName ? { ...d, uploaded: true, fileName: file.name } : d));
      } catch (err) {
        console.error('[ShipmentForm] Failed to upload pending document', docName, err);
        setDocumentUploadError(`Failed to upload ${docName}: ${err?.message || 'unknown error'}`);
        throw err;
      }
    }

    // Clear pending cache after successful uploads
    setDocumentFiles({});
  };

  // Auto-fetch AI required documents when entering step 6
  useEffect(() => {
    if (currentStep !== 6) return;
    if (analyzingDocuments) return;

    const fetchAiDocuments = async () => {
      setAnalyzingDocuments(true);
      
      try {
        // Gather shipment context for AI
        const firstProduct = formData.packages?.[0]?.products?.[0] || {};
        const payload = {
          originCountry: formData.shipper?.country || '',
          destinationCountry: formData.consignee?.country || '',
          hsCode: firstProduct.hsCode || '',
          htsFlag: !!firstProduct.hsCode,
          productCategory: firstProduct.category || '',
          productDescription: firstProduct.description || '',
          packageTypeWeight: formData.packages?.[0]?.type ? `${formData.packages[0].type} ${formData.packages[0].weight || ''}${formData.packages[0].weightUnit || ''}` : '',
          modeOfTransport: formData.mode || '',
          pythonPort: 9000
        };

        const response = await fetch('/api/ai/required-documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`AI service error: ${response.status}`);
        }

        const data = await response.json();
        const aiDocs = (data.requiredDocuments || []).map(name => ({
          name,
          required: true,
          description: '',
          uploaded: false
        }));

        // If we have a shipmentId, fetch document status from backend
        if (formData.id && /^\d+$/.test(formData.id)) {
          try {
            const documentStatus = await getDocumentStatus(formData.id);
            console.log('[ShipmentForm] Document status fetched:', documentStatus);
            
            // Update aiDocs with actual document upload status from backend
            aiDocs.forEach(doc => {
              // Try to match document type
              const docTypeKey = doc.name.toLowerCase().replace(/\s+/g, '_');
              const isUploaded = documentStatus[docTypeKey] || documentStatus[doc.name] || false;
              if (isUploaded) {
                doc.uploaded = true;
                console.log(`[ShipmentForm] Document "${doc.name}" marked as uploaded from database`);
              }
            });
          } catch (err) {
            console.error('[ShipmentForm] Failed to fetch document status:', err);
            // Fall back gracefully - don't prevent form from loading
          }
        }

        setRequiredDocuments(aiDocs);
      } catch (err) {
        console.error('Failed to fetch AI documents:', err);
        setRequiredDocuments([]);
      } finally {
        setAnalyzingDocuments(false);
      }
    };

    fetchAiDocuments();
  }, [currentStep, formData.packages, formData.shipper?.country, formData.consignee?.country, formData.mode]);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;
    setFormData(prev => {
      const updated = { ...prev, [name]: newValue };
      // Sync to global store if in auto mode
      if (mode === 'auto') {
        updateShipmentDraft(updated);
      }
      return updated;
    });
  };

  const handleNestedChange = (parent, field, value) => {
    setFormData(prev => {
      const updated = {
        ...prev,
        [parent]: { ...(prev[parent] || {}), [field]: value }
      };
      // Sync to global store if in auto mode
      if (mode === 'auto') {
        updateShipmentDraft(updated);
      }
      return updated;
    });
  };

  const handleArrayChange = (arrayName, index, field, value) => {
    setFormData(prev => {
      // Ensure the array exists and is an array
      const currentArray = Array.isArray(prev[arrayName]) ? prev[arrayName] : [];
      const newArray = [...currentArray];
      
      // Ensure the item at index exists
      if (!newArray[index]) {
        newArray[index] = {};
      }
      
      newArray[index] = { ...newArray[index], [field]: value };
      const updated = { ...prev, [arrayName]: newArray };
      
      // Sync to global store if in auto mode
      if (mode === 'auto') {
        updateShipmentDraft(updated);
      }
      
      return updated;
    });
  };

  const addArrayItem = (arrayName, template) => {
    setFormData(prev => {
      // Ensure the array exists and is an array
      const currentArray = Array.isArray(prev[arrayName]) ? prev[arrayName] : [];
      return {
        ...prev,
        [arrayName]: [...currentArray, template]
      };
    });
  };

  const removeArrayItem = (arrayName, index) => {
    setFormData(prev => {
      // Ensure the array exists and is an array
      const currentArray = Array.isArray(prev[arrayName]) ? prev[arrayName] : [];
      return {
        ...prev,
        [arrayName]: currentArray.filter((_, i) => i !== index)
      };
    });
  };

  const applyExtractedData = (extracted) => {
    if (!extracted) return;
    console.log('[ShipmentForm] Applying extracted data:', extracted);
    
    // Merge into global store
    const merged = mergeExtractedData(extracted);
    console.log('[ShipmentForm] Merged data:', merged);
    
    // Validate and sanitize dropdown values - ensure they match available options
    const validateDropdownValue = (value, options) => {
      if (!value) return '';
      const sanitized = String(value).trim();
      // Find exact match in options
      const found = options.find(opt => String(opt).toLowerCase() === sanitized.toLowerCase());
      return found || '';
    };

    // Immediately sync to local formData with ALL extracted fields
    setFormData(prev => {
      const updated = {
        ...prev,
        // Basics fields
        title: extracted.title || extracted.shipmentTitle || extracted.shipmentName || prev.title || '',
        mode: validateDropdownValue(extracted.mode, modes) || prev.mode || 'Air',
        shipmentType: validateDropdownValue(extracted.shipmentType, shipmentTypes) || prev.shipmentType || 'International',
        pickupType: validateDropdownValue(extracted.pickupType, pickupTypes) || prev.pickupType || 'Scheduled Pickup',
        
        // Pickup/Delivery fields
        pickupLocation: extracted.pickupLocation || extracted.pickupAddress || prev.pickupLocation || '',
        pickupDate: extracted.pickupDate || prev.pickupDate || '',
        pickupTimeEarliest: extracted.pickupTimeEarliest || extracted.pickupTimeStart || prev.pickupTimeEarliest || '',
        pickupTimeLatest: extracted.pickupTimeLatest || extracted.pickupTimeEnd || prev.pickupTimeLatest || '',
        estimatedDropoffDate: extracted.estimatedDropoffDate || extracted.dropoffDate || prev.estimatedDropoffDate || '',
        
        // Service fields
        serviceLevel: validateDropdownValue(extracted.serviceLevel, serviceLevels) || prev.serviceLevel || 'Standard',
        incoterm: validateDropdownValue(extracted.incoterm, incoterms) || prev.incoterm || 'FOB',
        currency: validateDropdownValue(extracted.currency, currencies) || prev.currency || 'USD',
        
        // Shipper and consignee
        shipper: merged.shipper || prev.shipper,
        consignee: merged.consignee || prev.consignee,
        
        // Packages and products
        packages: merged.packages || prev.packages,
        
        // Customs and value
        customsValue: merged.customsValue || prev.customsValue || 0,
        reasonForExport: validateDropdownValue(extracted.reasonForExport, reasonsForExport) || prev.reasonForExport || '',
        
        // Additional fields if available
        billTo: validateDropdownValue(extracted.billTo, billToOptions) || prev.billTo || 'Shipper',
        paymentTiming: validateDropdownValue(extracted.paymentTiming, paymentTimings) || prev.paymentTiming || 'Prepaid',
        paymentMethod: validateDropdownValue(extracted.paymentMethod, paymentMethods) || prev.paymentMethod || 'Credit Card',
        
        // Notes and references
        specialInstructions: extracted.specialInstructions || prev.specialInstructions || '',
        insuranceRequired: extracted.insuranceRequired !== undefined ? extracted.insuranceRequired : prev.insuranceRequired,
        dangerousGoods: extracted.dangerousGoods !== undefined ? extracted.dangerousGoods : prev.dangerousGoods,
      };
      console.log('[ShipmentForm] Updated formData with all extracted fields:', updated);
      return updated;
    });

    // Expand relevant sections to show filled data
    setExpandedSections(prev => ({ 
      ...prev, 
      basics: true, 
      shipper: true, 
      consignee: true, 
      packages: true,
      service: true,
    }));

    // Navigate to first step after extraction
    setCurrentStep(1);
    console.log('[ShipmentForm] Extraction applied, moved to step 1 with all fields populated');
  };

  // Calculate pricing and customs value
  useEffect(() => {
    const serviceLevelMultiplier = {
      'Standard': 1.0,
      'Express': 1.5,
      'Economy': 0.8,
      'Freight': 0.7,
    };
    
    // Auto-calculate customs value from package products
    let calculatedCustomsValue = 0;
    let lineItemCount = 0;
    if (formData.packages && Array.isArray(formData.packages)) {
      formData.packages.forEach(pkg => {
        if (pkg.products && Array.isArray(pkg.products)) {
          pkg.products.forEach(prod => {
            calculatedCustomsValue += parseFloat(prod.totalValue) || 0;
            lineItemCount += 1;
          });
        }
      });
    }
    
    // Update customs value in form data
    if (calculatedCustomsValue > 0 && formData.customsValue !== calculatedCustomsValue) {
      setFormData(prev => ({ ...prev, customsValue: calculatedCustomsValue }));
    }
    
    const customsValue = formData.customsValue || calculatedCustomsValue || 0;
    
    // Only calculate pricing if customs value is greater than zero (i.e., products exist)
    if (customsValue <= 0) {
      setPricing({
        basePrice: 0,
        serviceCharge: 0,
        customsClearance: 0,
        pickupCharge: 0,
        insurance: 0,
        subtotal: 0,
        tax: 0,
        total: 0
      });
      return;
    }
    
    const basePrice = customsValue * 0.05;
    const serviceCharge = basePrice * (serviceLevelMultiplier[formData.serviceLevel] || 1.0);
    
    // Calculate estimated customs clearance
    const destCountry = formData.consignee?.country || formData.shipper?.country || '';
    const isSpecialCommodity = formData.specialCommodity || false;
    const customsClearance = calculateClearance(destCountry, customsValue, lineItemCount, isSpecialCommodity);
    
    // Calculate pickup charge if scheduled pickup is selected
    const originCountry = formData.shipper?.country || '';
    let pickupCharge = 0;
    if (formData.pickupType === 'Scheduled Pickup') {
      pickupCharge = calculatePickupCharge(originCountry);
    }
    
    const subtotal = basePrice + serviceCharge + customsClearance + pickupCharge;
    const tax = subtotal * 0.18;
    const total = subtotal + tax;

    setPricing({
      basePrice,
      serviceCharge,
      customsClearance,
      pickupCharge,
      insurance: 0,
      subtotal,
      tax,
      total
    });
  }, [formData.packages, formData.customsValue, formData.serviceLevel, formData.consignee?.country, formData.shipper?.country, formData.specialCommodity, formData.pickupType]);

  // Load HS sections from backend dataset
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const resp = await fetch('/api/ai/hs/sections');
        if (!resp.ok) return;
        const body = await resp.json();
        if (!mounted) return;
        // body expected as array of { code, title }
        setHsSections(Array.isArray(body) ? body : []);
      } catch (err) {
        // ignore
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Trigger HS code suggestions when product name/description/category change (iterate packages -> products)
  useEffect(() => {
    if (!formData.packages) return;

    formData.packages.forEach(pkg => {
      if (!pkg.products) return;
      pkg.products.forEach(async (product) => {
        const productKey = product.id || `${pkg.id || 'pkg'}-${Math.random()}`;
        const triggerText = `${product.name || ''} ${product.description || ''} ${product.category || ''}`.trim();
        if (!triggerText || triggerText.length < 3) return;

        try {
          setLoadingHsSuggestions(prev => ({ ...prev, [productKey]: true }));
          const suggestions = await suggestHSCode(product.name || '', product.description || '', product.category || '');
          setHsSuggestions(prev => ({ ...prev, [productKey]: suggestions }));
        } catch (err) {
          console.error('HS suggestion error', err);
        } finally {
          setLoadingHsSuggestions(prev => ({ ...prev, [productKey]: false }));
        }
      });
    });
    // build dependency by concatenating product names/descriptions across packages
  }, [formData.packages ? formData.packages.map(pkg => (pkg.products || []).map(p => `${p.name}|${p.description}|${p.category}`).join('||')).join('|||') : '']);

  // Validate HS codes when changed (iterate packages -> products)
  useEffect(() => {
    if (!formData.packages) return;

    formData.packages.forEach(pkg => {
      if (!pkg.products) return;
      pkg.products.forEach(async (product) => {
        const productKey = product.id || `${pkg.id || 'pkg'}-${Math.random()}`;
        if (!product.hsCode || product.hsCode.trim().length < 4) return;
        try {
          const validation = await validateAndCheckHSCode(product.hsCode, formData.consignee?.country || formData.shipper?.country);
          setHsValidation(prev => ({ ...prev, [productKey]: validation }));
        } catch (err) {
          console.error('HS validation error', err);
        }
      });
    });
  }, [formData.packages ? formData.packages.map(pkg => (pkg.products || []).map(p => p.hsCode).join('|')).join('||') : '', formData.consignee?.country, formData.shipper?.country]);

  // Keep currency and product origin in sync with selected shipper country
  useEffect(() => {
    const selectedCountry = formData.shipper?.country;
    if (!selectedCountry) return;
    const code = resolveCountryCode(selectedCountry);
    const desiredCurrency = getCurrencyByCountry(code).code;

    setProfileCountry(code);
    setProfileCurrency(desiredCurrency);

    // Normalize country code if user entered full name
    if (code !== selectedCountry) {
      setFormData(prev => ({
        ...prev,
        shipper: { ...prev.shipper, country: code }
      }));
      return;
    }

    setFormData(prev => {
      let updated = prev;
      if (prev.currency !== desiredCurrency) {
        updated = { ...updated, currency: desiredCurrency };
      }
      // Update origin country for products within packages
      if (prev.packages && Array.isArray(prev.packages)) {
        const updatedPackages = prev.packages.map(pkg => {
          if (pkg.products && Array.isArray(pkg.products)) {
            const updatedProducts = pkg.products.map(p => ({
              ...p,
              originCountry: p.originCountry || code
            }));
            return { ...pkg, products: updatedProducts };
          }
          return pkg;
        });
        updated = { ...updated, packages: updatedPackages };
      }
      return updated;
    });
  }, [formData.shipper?.country]);

  const validateForm = () => {
    const newErrors = {};
    
    // Reference ID removed from shipper UI — backend will generate if missing
    if (!formData.title) newErrors.title = 'Shipment title is required';
    if (!formData.mode) newErrors.mode = 'Mode is required';
    if (!formData.shipmentType) newErrors.shipmentType = 'Shipment type is required';
    if (!formData.shipper?.company) newErrors.shipperCompany = 'Shipper company is required';
    if (!formData.consignee?.company) newErrors.consigneeCompany = 'Consignee company is required';
    if (formData.packages?.length === 0) newErrors.packages = 'At least one package is required';
    
    // Check that each package has at least one product
    if (formData.packages && formData.packages.length > 0) {
      formData.packages.forEach((pkg, idx) => {
        if (!pkg.products || pkg.products.length === 0) {
          newErrors[`package${idx}Products`] = `Package ${idx + 1} must have at least one product`;
        }
      });
    }
    
    // Calculate and validate customs value
    let calculatedCustomsValue = 0;
    if (formData.packages && Array.isArray(formData.packages)) {
      formData.packages.forEach(pkg => {
        if (pkg.products && Array.isArray(pkg.products)) {
          pkg.products.forEach(prod => {
            calculatedCustomsValue += parseFloat(prod.totalValue) || 0;
          });
        }
      });
    }
    
    if (calculatedCustomsValue <= 0) {
      newErrors.customsValue = 'Customs value must be greater than 0. Please add products with values.';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  const handleSubmit = async () => {
    // Clear previous validation errors
    setDocumentValidationError('');

    if (!validateForm()) {
      alert('Please fill in all required fields');
      return;
    }

    // STRICT VALIDATION: Check all required documents are uploaded
    const requiredDocs = requiredDocuments.filter(doc => doc.required);
    const notUploaded = requiredDocs.filter(doc => !doc.uploaded);
    
    if (notUploaded.length > 0) {
      setDocumentValidationError(`Cannot submit: ${notUploaded.length} required document(s) not uploaded: ${notUploaded.map(d => d.name).join(', ')}`);
      return;
    }

    // RE-CHECK upload status from backend if shipment has numeric ID (exists in DB)
    // Use the new document status endpoint for state-aware validation
    if (formData.id && /^\d+$/.test(formData.id)) {
      try {
        const documentStatus = await getDocumentStatus(formData.id);
        console.log('[ShipmentForm] Re-checking document status from backend:', documentStatus);
        
        // Verify all required documents have backend confirmation
        const missingDocs = requiredDocs.filter(doc => {
          const docTypeKey = doc.name.toLowerCase().replace(/\s+/g, '_');
          const isBackendUploaded = documentStatus[docTypeKey] || documentStatus[doc.name] || false;
          return !isBackendUploaded;
        });
        
        if (missingDocs.length > 0) {
          setDocumentValidationError(`The following documents are not confirmed uploaded in the system: ${missingDocs.map(d => d.name).join(', ')}. Please refresh the page and try again.`);
          return;
        }
      } catch (err) {
        console.error('[ShipmentForm] Failed to verify document status:', err);
        // Don't fail - proceed with submit if backend status check fails
        console.log('[ShipmentForm] Proceeding despite document status verification failure');
      }
    }

    // Calculate customs value from packages
    let calculatedCustomsValue = 0;
    if (formData.packages && Array.isArray(formData.packages)) {
      formData.packages.forEach(pkg => {
        if (pkg.products && Array.isArray(pkg.products)) {
          pkg.products.forEach(prod => {
            calculatedCustomsValue += parseFloat(prod.totalValue) || 0;
          });
        }
      });
    }

    // Map frontend mode values to backend enum (Air, Sea, Ground)
    const mapMode = (mode) => {
      const modeMap = {
        'Air': 'Air',
        'Sea': 'Sea',
        'Road': 'Ground',
        'Rail': 'Ground',
        'Courier': 'Air',
        'Multimodal': 'Ground'
      };
      return modeMap[mode] || 'Air';
    };

    // Prepare shipment payload for backend (matching UpsertShipmentDto structure with PascalCase)
    // Note: Carrier, InsuranceRequired, Incoterm removed per backend schema cleanup
    const shipmentPayload = {
      ShipmentName: formData.title || formData.shipmentName || '',
      Mode: mapMode(formData.mode || 'Air'),
      ShipmentType: formData.shipmentType || 'International',
      ServiceLevel: formData.serviceLevel || 'Standard',
      CustomsValue: calculatedCustomsValue,
      Currency: formData.currency || 'USD',
      PricingTotal: pricing.total || 0,
      BillTo: formData.billTo || 'Shipper',
      Status: 'draft',
      
      // Pickup information
      PickupType: formData.pickupType || null,
      PickupLocation: formData.pickupLocation || null,
      PickupDate: formData.pickupDate || null,
      PickupTimeEarliest: formData.pickupTimeEarliest || null,
      PickupTimeLatest: formData.pickupTimeLatest || null,
      EstimatedDropoffDate: formData.estimatedDropoffDate || null,
      
      // Shipper info (PartyType = shipper)
      Shipper: {
        PartyType: 'shipper',
        CompanyName: formData.shipper?.company || '',
        ContactName: formData.shipper?.contactName || '',
        Phone: formData.shipper?.phone || '',
        Email: formData.shipper?.email || '',
        Address1: formData.shipper?.address1 || '',
        Address2: formData.shipper?.address2 || '',
        City: formData.shipper?.city || '',
        State: formData.shipper?.state || '',
        PostalCode: formData.shipper?.postalCode || '',
        Country: formData.shipper?.country || '',
        TaxId: formData.shipper?.taxId || ''
      },
      
      // Consignee info (PartyType = consignee)
      Consignee: {
        PartyType: 'consignee',
        CompanyName: formData.consignee?.company || '',
        ContactName: formData.consignee?.contactName || '',
        Phone: formData.consignee?.phone || '',
        Email: formData.consignee?.email || '',
        Address1: formData.consignee?.address1 || '',
        Address2: formData.consignee?.address2 || '',
        City: formData.consignee?.city || '',
        State: formData.consignee?.state || '',
        PostalCode: formData.consignee?.postalCode || '',
        Country: formData.consignee?.country || '',
        TaxId: formData.consignee?.taxId || ''
      },
      
      // Other parties (if any)
      OtherParties: [],
      
      // Packages with products
      Packages: (formData.packages || []).map(pkg => ({
        PackageType: pkg.type || 'Box',
        Length: parseFloat(pkg.length) || 0,
        Width: parseFloat(pkg.width) || 0,
        Height: parseFloat(pkg.height) || 0,
        DimensionUnit: pkg.dimUnit || 'cm',
        Weight: parseFloat(pkg.weight) || 0,
        WeightUnit: pkg.weightUnit || 'kg',
        Stackable: pkg.stackable || false,
        Products: (pkg.products || []).map(prod => ({
          Name: prod.name || '',
          Description: prod.description || '',
          Category: prod.category || '',
          HsCode: prod.hsCode || '',
          Quantity: (Number.isFinite(parseFloat(prod.qty)) ? parseFloat(prod.qty) : (parseFloat(prod.quantity) || 0)) || 0,
          Unit: prod.uom || 'pcs',
          UnitPrice: (Number.isFinite(parseFloat(prod.unitPrice)) ? parseFloat(prod.unitPrice) : (parseFloat(prod.unitValue) || 0)) || 0,
          TotalValue: (() => {
            const qty = (Number.isFinite(parseFloat(prod.qty)) ? parseFloat(prod.qty) : (parseFloat(prod.quantity) || 0)) || 0;
            const unitPrice = (Number.isFinite(parseFloat(prod.unitPrice)) ? parseFloat(prod.unitPrice) : (parseFloat(prod.unitValue) || 0)) || 0;
            const providedTotal = parseFloat(prod.totalValue);
            return Number.isFinite(providedTotal) ? providedTotal : qty * unitPrice;
          })(),
          OriginCountry: prod.originCountry || formData.shipper?.country || '',
          ExportReason: prod.reasonForExport || prod.exportReason || 'Sale'
        }))
      })),
      
      // Services (if any additional services)
      Services: []
    };

    try {
      // Determine if this is a new shipment or update
      const isUpdate = formData.id && /^\d+$/.test(formData.id);

      console.log('[ShipmentForm] Sending shipment payload to backend:', JSON.stringify(shipmentPayload, null, 2));
      console.log('[ShipmentForm] Shipper data being sent:', shipmentPayload.Shipper);
      console.log('[ShipmentForm] formData.shipper before submit:', formData.shipper);
      
      // Use centralized axios-based shipments API; JWT is attached automatically.
      const apiResponse = isUpdate
        ? await updateShipment(formData.id, shipmentPayload)
        : await createShipment(shipmentPayload);
      
      console.log('[ShipmentForm] Backend API response:', apiResponse);
      
      // Backend returns ShipmentDetailDto: { Shipment: {...}, Parties: [...], Packages: [...], Items: [...] }
      // Extract the Shipment object which has the ID and other core fields
      const savedShipment = apiResponse?.Shipment || apiResponse?.shipment || apiResponse;
      console.log('[ShipmentForm] Extracted shipment from response:', savedShipment);
      
      // Prepare shipment object for local store and navigation (merge backend response with form data)
      const updatedShipment = {
        ...formData,
        id: savedShipment.Id || savedShipment.id || savedShipment.shipmentId,
        referenceId: savedShipment.ReferenceId || savedShipment.referenceId || savedShipment.reference_id || formData.referenceId,
        status: savedShipment.Status || savedShipment.status || 'ai-review',
        updatedAt: savedShipment.UpdatedAt || savedShipment.updatedAt || new Date().toISOString(),
        createdAt: savedShipment.CreatedAt || savedShipment.createdAt || formData.createdAt || new Date().toISOString(),
        customsValue: calculatedCustomsValue
      };
      
      console.log('[ShipmentForm] Prepared shipment for navigation:', updatedShipment);
      console.log('[ShipmentForm] Shipment numeric ID:', updatedShipment.id);
      console.log('[ShipmentForm] Shipment reference ID:', updatedShipment.referenceId);

      // Upload any files selected during step 6 now that we have a shipment ID
      if (updatedShipment.id) {
        try {
          await uploadPendingDocuments(updatedShipment.id);
        } catch (uploadErr) {
          console.error('Error uploading pending documents:', uploadErr);
          alert(`Shipment saved but document upload failed: ${uploadErr?.message || 'unknown error'}`);
        }
      }

      // Save to local store
      shipmentsStore.saveShipment(updatedShipment);
      
      // Navigate to details for AI evaluation - pass numeric ID
      console.log('[ShipmentForm] Navigating to shipment-details with ID:', updatedShipment.id);
      onNavigate('shipment-details', updatedShipment);
    } catch (err) {
      console.error('Error saving shipment to backend:', err);
      alert(`Failed to save shipment: ${err.message}. Please try again.`);
    }
  };

  // Check if all required documents are uploaded
  const allRequiredDocumentsUploaded = () => {
    const requiredDocs = requiredDocuments.filter(doc => doc.required);
    if (requiredDocs.length === 0) return true; // No required documents
    return requiredDocs.every(doc => doc.uploaded);
  };

  // Per-step validation for Next button enabling
  const canProceed = (step) => {
    if (step === 1) {
      return !!(formData.title && formData.mode && formData.shipmentType);
    }
    if (step === 2) {
      return !!(formData.shipper && formData.shipper.company);
    }
    if (step === 3) {
      return !!(formData.consignee && formData.consignee.company);
    }
    if (step === 4) {
      return !!(formData.packages && formData.packages.length > 0);
    }
    return true;
  };

  const handleNext = () => {
    if (!canProceed(currentStep)) {
      validateForm();
      return;
    }
    setCurrentStep((s) => Math.min(6, s + 1));
  };

  const handlePrev = () => {
    setCurrentStep((s) => Math.max(1, s - 1));
  };

  // Download the current shipment summary as a PDF.
  // Uses jsPDF via CDN (dynamically injected) so no build-time dependency required.
  const downloadSummaryPdf = async () => {
    try {
      const content = JSON.stringify(formData, null, 2);

      // Dynamically load jsPDF UMD if not already available
      if (!window.jspdf) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      // jsPDF exposes a `jspdf` global containing `jsPDF`
      const JsPDF = window.jspdf && (window.jspdf.jsPDF || window.jspdf);
      if (!JsPDF) throw new Error('jsPDF not available');

      const doc = new JsPDF();
      doc.setFontSize(10);

      // Split long JSON into lines that fit PDF width
      const lines = doc.splitTextToSize(content, 180);
      doc.text(lines, 10, 10);

      const fileName = `${(formData.title || 'shipment').replace(/[^a-z0-9-_]/gi, '_')}-summary.pdf`;
      doc.save(fileName);
    } catch (err) {
      console.error('PDF generation failed', err);
      // Fallback: download JSON if PDF generation fails
      const blob = new Blob([JSON.stringify(formData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${formData.title || 'shipment'}-summary.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="min-h-screen p-6" style={{ background: '#F5F5F5' }}>
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Step Navigation with Progress Line - Brown line, yellow current circle, brown completed circles with yellow numbers */}
          <div className="bg-white rounded-lg p-6 mb-6 shadow-sm">
            <div className="flex items-center justify-center w-full">
              <div className="flex items-center w-full max-w-4xl">
                {steps.map((s, idx) => {
                  const isCompleted = currentStep > s.number;
                  const isCurrent = currentStep === s.number;
                  return (
                    <div key={s.number} className="flex items-center flex-1">
                      <button
                        onClick={() => { setCurrentStep(s.number); setExpandedSections(prev => ({ ...prev, basics: s.number===1, shipper: s.number===2, consignee: s.number===3, packages: s.number===4, service: s.number===4, documents: s.number===5 })); }}
                        className="focus:outline-none transition-all"
                        aria-label={`Go to step ${s.number} ${s.title}`}
                      >
                        <div
                          className="flex items-center justify-center"
                          style={{
                            width: 56,
                            height: 56,
                            borderRadius: 9999,
                            background: isCurrent ? '#F2B705' : isCompleted ? '#6B4423' : '#E5E7EB',
                            color: isCurrent ? '#2F1B17' : isCompleted ? '#F2B705' : '#9CA3AF',
                            fontWeight: 700,
                            fontSize: '1.125rem',
                            boxShadow: isCurrent ? '0 4px 12px rgba(242,183,5,0.3)' : 'none',
                            transition: 'all 0.3s ease'
                          }}
                        >
                          {s.number}
                        </div>
                      </button>

                      {idx < steps.length - 1 && (
                        <div
                          aria-hidden
                          style={{
                            height: 3,
                            flex: 1,
                            margin: '0 16px',
                            background: isCompleted ? '#6B4423' : '#E5E7EB',
                            borderRadius: 2,
                            transition: 'background 0.3s ease'
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="text-center text-sm text-slate-500 mt-4">Step {currentStep} of {steps.length}</div>
          </div>

          {currentStep === 1 && (
            <div className="mb-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
                <div>
                  <p className="text-sm text-slate-600">Choose how to create your shipment:</p>
                </div>
                <AutoFillToggle mode={mode} onChange={setMode} />
              </div>
              {mode === 'auto' && (
                <div className="mt-4">
                  <DocumentUploadSection onExtracted={applyExtractedData} />
                </div>
              )}
            </div>
          )}
          {/* BASICS SECTION */}
          {currentStep === 1 && (
          <CollapsibleSection
            title="Shipment Basics"
            isOpen={true}
            onToggle={() => toggleSection('basics')}
            icon={Truck}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputField
                label="Shipment Title"
                name="title"
                value={formData.title || ''}
                onChange={handleChange}
                placeholder="Electronic Components Shipment"
                required
              />
              <SelectField
                label="Mode"
                name="mode"
                value={formData.mode || ''}
                onChange={handleChange}
                options={modes}
                required
              />
              <SelectField
                label="Shipment Type"
                name="shipmentType"
                value={formData.shipmentType || ''}
                onChange={handleChange}
                options={shipmentTypes}
                required
              />
              <SelectField
                label="Pickup Type"
                name="pickupType"
                value={formData.pickupType || ''}
                onChange={handleChange}
                options={pickupTypes}
              />
              {formData.pickupType === 'Drop-off' && (
                <InputField
                  label="Estimated Drop-off Date"
                  type="date"
                  name="estimatedDropoffDate"
                  value={formData.estimatedDropoffDate || ''}
                  onChange={handleChange}
                />
              )}
              {formData.pickupType === 'Scheduled Pickup' && (
                <>
                  <InputField
                    label="Pickup Location"
                    name="pickupLocation"
                    value={formData.pickupLocation || ''}
                    onChange={handleChange}
                    placeholder="Enter pickup address"
                  />
                  <InputField
                    label="Pickup Date"
                    type="date"
                    name="pickupDate"
                    value={formData.pickupDate || ''}
                    onChange={handleChange}
                  />
                  <InputField
                    label="Earliest Pickup Time"
                    type="time"
                    name="pickupTimeEarliest"
                    value={formData.pickupTimeEarliest || ''}
                    onChange={handleChange}
                  />
                  <InputField
                    label="Latest Pickup Time"
                    type="time"
                    name="pickupTimeLatest"
                    value={formData.pickupTimeLatest || ''}
                    onChange={handleChange}
                  />
                </>
              )}
            </div>
          </CollapsibleSection>
          )}

          {/* SHIPPER SECTION */}
          {currentStep === 2 && (
          <CollapsibleSection
            title="Shipper Information"
            isOpen={true}
            onToggle={() => toggleSection('shipper')}
            icon={Users}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-slate-600">Autofilled from Profile. Use edit to adjust.</p>
              <OvalButton
                type="button"
                onClick={() => setShipperEditable(prev => !prev)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg"
                style={yellowButtonStyle}
              >
                  <Pencil className="w-4 h-4" style={{ color: '#2F1B17' }} />
                <span style={{ color: '#2F1B17' }}>{shipperEditable ? 'Lock' : 'Edit'}</span>
              </OvalButton>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputField
                label="Company Name"
                name="company"
                value={formData.shipper?.company || profileData?.companyName || ''}
                onChange={(e) => handleNestedChange('shipper', 'company', e.target.value)}
                disabled={!shipperEditable}
                required
                placeholder="ABC Exports"
                highlight={isAutoFilled('shipper.company')}
              />
              <InputField
                label="Contact Name"
                name="contactName"
                value={formData.shipper?.contactName || (profileData ? `${profileData.firstName || ''} ${profileData.lastName || ''}`.trim() : '') || ''}
                onChange={(e) => handleNestedChange('shipper', 'contactName', e.target.value)}
                disabled={!shipperEditable}
                placeholder="John Smith"
              />
              <InputField
                label="Phone"
                type="tel"
                name="phone"
                value={formData.shipper?.phone || profileData?.phone || ''}
                onChange={(e) => handleNestedChange('shipper', 'phone', e.target.value)}
                disabled={!shipperEditable}
                placeholder="+1-555-0001"
              />
              <InputField
                label="Email"
                type="email"
                name="email"
                value={formData.shipper?.email || profileData?.email || ''}
                onChange={(e) => handleNestedChange('shipper', 'email', e.target.value)}
                disabled={!shipperEditable}
                placeholder="john@company.com"
              />
              <InputField
                label="Address Line 1"
                name="address1"
                value={formData.shipper?.address1 || profileData?.addressLine1 || ''}
                onChange={(e) => handleNestedChange('shipper', 'address1', e.target.value)}
                disabled={!shipperEditable}
                placeholder="123 Manufacturing St"
                highlight={isAutoFilled('shipper.address1')}
              />
              <InputField
                label="Address Line 2"
                name="address2"
                value={formData.shipper?.address2 || profileData?.addressLine2 || ''}
                onChange={(e) => handleNestedChange('shipper', 'address2', e.target.value)}
                disabled={!shipperEditable}
                placeholder="Suite 100"
              />
              <InputField
                label="City"
                name="city"
                value={formData.shipper?.city || profileData?.city || ''}
                onChange={(e) => handleNestedChange('shipper', 'city', e.target.value)}
                disabled={!shipperEditable}
                placeholder="Shanghai"
              />
              <InputField
                label="State/Province"
                name="state"
                value={formData.shipper?.state || profileData?.state || ''}
                onChange={(e) => handleNestedChange('shipper', 'state', e.target.value)}
                disabled={!shipperEditable}
                placeholder="State/Province"
              />
              <InputField
                label="Postal Code"
                name="postalCode"
                value={formData.shipper?.postalCode || profileData?.pinCode || ''}
                onChange={(e) => handleNestedChange('shipper', 'postalCode', e.target.value)}
                disabled={!shipperEditable}
                placeholder="200000"
              />
              <SelectField
                label="Country"
                name="country"
                value={formData.shipper?.country || profileData?.countryCode || profileCountry || ''}
                onChange={(e) => handleNestedChange('shipper', 'country', e.target.value)}
                disabled={!shipperEditable}
                options={countryOptions.map(c => ({ value: c.code, label: c.name }))}
              />

            </div>
          </CollapsibleSection>
          )}

          {/* CONSIGNEE SECTION */}
          {currentStep === 3 && (
          <CollapsibleSection
            title="Consignee Information"
            isOpen={true}
            onToggle={() => toggleSection('consignee')}
            icon={MapPin}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputField
                label="Company Name"
                name="company"
                value={formData.consignee?.company || ''}
                onChange={(e) => handleNestedChange('consignee', 'company', e.target.value)}
                required
                placeholder="Tech Imports Inc"
                highlight={isAutoFilled('consignee.company')}
              />
              <InputField
                label="Contact Name"
                name="contactName"
                value={formData.consignee?.contactName || ''}
                onChange={(e) => handleNestedChange('consignee', 'contactName', e.target.value)}
                placeholder="Jane Doe"
              />
              <InputField
                label="Phone"
                type="tel"
                name="phone"
                value={formData.consignee?.phone || ''}
                onChange={(e) => handleNestedChange('consignee', 'phone', e.target.value)}
                placeholder="+1-555-0101"
              />
              <InputField
                label="Email"
                type="email"
                name="email"
                value={formData.consignee?.email || ''}
                onChange={(e) => handleNestedChange('consignee', 'email', e.target.value)}
                placeholder="jane@company.com"
              />
              <InputField
                label="Address Line 1"
                name="address1"
                value={formData.consignee?.address1 || ''}
                onChange={(e) => handleNestedChange('consignee', 'address1', e.target.value)}
                placeholder="456 Import Ave"
                highlight={isAutoFilled('consignee.address1')}
              />
              <InputField
                label="Address Line 2"
                name="address2"
                value={formData.consignee?.address2 || ''}
                onChange={(e) => handleNestedChange('consignee', 'address2', e.target.value)}
                placeholder="Floor 5"
              />
              <InputField
                label="City"
                name="city"
                value={formData.consignee?.city || ''}
                onChange={(e) => handleNestedChange('consignee', 'city', e.target.value)}
                placeholder="New York"
              />
              <InputField
                label="State/Province"
                name="state"
                value={formData.consignee?.state || ''}
                onChange={(e) => handleNestedChange('consignee', 'state', e.target.value)}
                placeholder="State/Province"
              />
              <InputField
                label="Postal Code"
                name="postalCode"
                value={formData.consignee?.postalCode || ''}
                onChange={(e) => handleNestedChange('consignee', 'postalCode', e.target.value)}
                placeholder="10001"
              />
              <SelectField
                label="Country"
                name="country"
                value={formData.consignee?.country || ''}
                onChange={(e) => handleNestedChange('consignee', 'country', e.target.value)}
                options={countryOptions.map(c => ({ value: c.code, label: c.name }))}
                highlight={isAutoFilled('consignee.country')}
              />
              
            </div>
          </CollapsibleSection>
          )}

          {/* PACKAGE AND CONTENTS SECTION (step 4) - combined with Service & Billing */}
          {currentStep === 4 && (
          <>
          <CollapsibleSection
            title="Package and Contents"
            isOpen={true}
            onToggle={() => toggleSection('packages')}
            icon={Package}
          >
            <div className="space-y-6">
              {formData.packages && formData.packages.map((pkg, pkgIdx) => (
                <div key={pkgIdx} className="border border-slate-200 rounded-lg p-5 bg-white shadow-sm">
                  <div className="flex justify-between items-start mb-4">
                    <h4 className="font-semibold text-slate-900 text-lg">Package {pkgIdx + 1}</h4>
                    <OvalButton
                      onClick={() => removeArrayItem('packages', pkgIdx)}
                      className="p-2 rounded transition-colors"
                      style={{ background: 'transparent' }}
                      aria-label={`Remove package ${pkgIdx + 1}`}
                    >
                      <Trash2 className="w-5 h-5" style={{ color: '#dc2626' }} />
                    </OvalButton>
                  </div>
                  
                  {/* Package Details */}
                  <div className="mb-6 pb-6 border-b border-slate-200">
                    <h5 className="text-sm font-medium mb-3" style={{  color: '#131313ff', padding: '0.25rem 0.5rem', borderRadius: '0.25rem' }}>Package Details</h5>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <SelectField
                        label="Package Type"
                        name="type"
                        value={pkg.type || ''}
                        onChange={(e) => handleArrayChange('packages', pkgIdx, 'type', e.target.value)}
                        options={packageTypes}
                      />
                      <InputField
                        label="Length (cm)"
                        type="number"
                        name="length"
                        value={pkg.length || ''}
                        onChange={(e) => handleArrayChange('packages', pkgIdx, 'length', parseFloat(e.target.value))}
                        highlight={pkgIdx === 0 && isAutoFilled('packages[0].length')}
                      />
                      <InputField
                        label="Width (cm)"
                        type="number"
                        name="width"
                        value={pkg.width || ''}
                        onChange={(e) => handleArrayChange('packages', pkgIdx, 'width', parseFloat(e.target.value))}
                        highlight={pkgIdx === 0 && isAutoFilled('packages[0].width')}
                      />
                      <InputField
                        label="Height (cm)"
                        type="number"
                        name="height"
                        value={pkg.height || ''}
                        onChange={(e) => handleArrayChange('packages', pkgIdx, 'height', parseFloat(e.target.value))}
                        highlight={pkgIdx === 0 && isAutoFilled('packages[0].height')}
                      />
                      <InputField
                        label="Weight"
                        type="number"
                        name="weight"
                        value={pkg.weight || ''}
                        onChange={(e) => handleArrayChange('packages', pkgIdx, 'weight', parseFloat(e.target.value))}
                        highlight={pkgIdx === 0 && isAutoFilled('packages[0].weight')}
                      />
                      <SelectField
                        label="Weight Unit"
                        name="weightUnit"
                        value={pkg.weightUnit || 'kg'}
                        onChange={(e) => handleArrayChange('packages', pkgIdx, 'weightUnit', e.target.value)}
                        options={['kg', 'lb']}
                      />
                      <div className="md:col-span-3">
                        <CheckboxField
                          label="Stackable"
                          name="stackable"
                          checked={pkg.stackable || false}
                          onChange={(e) => handleArrayChange('packages', pkgIdx, 'stackable', e.target.checked)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Products within Package */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h5 className="text-sm font-medium" style={{ color: '#0f0e0eff', padding: '0.25rem 0.5rem', borderRadius: '0.25rem' }}>Product Contents</h5>
                      <OvalButton
                        type="button"
                        onClick={() => {
                          const currentProducts = pkg.products || [];
                          const newProduct = {
                            id: `PROD-${Date.now()}-${pkgIdx}`,
                            name: '',
                            description: '',
                            hsCode: '',
                            category: '',
                            uom: '',
                            qty: '',
                            unitPrice: '',
                            totalValue: '',
                            originCountry: formData.shipper?.country || profileCountry || '',
                            reasonForExport: '',
                          };
                          handleArrayChange('packages', pkgIdx, 'products', [...currentProducts, newProduct]);
                        }}
                        className="px-3 py-1.5 text-sm flex items-center gap-2"
                        style={yellowButtonStyle}
                      >
                        <Plus className="w-4 h-4" style={{ color: '#2F1B17' }} /> Add Product
                      </OvalButton>
                    </div>
                    
                    {pkg.products && pkg.products.length > 0 ? (
                      <div className="space-y-4">
                        {pkg.products.map((product, prodIdx) => (
                          <div key={product.id || prodIdx} className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                            <div className="flex justify-between items-start mb-3">
                              <h6 className="font-medium text-slate-900">Product {prodIdx + 1}</h6>
                              <OvalButton
                                type="button"
                                onClick={() => {
                                  const updatedProducts = pkg.products.filter((_, i) => i !== prodIdx);
                                  handleArrayChange('packages', pkgIdx, 'products', updatedProducts);
                                }}
                                className="rounded transition-colors p-1"
                                style={{ background: 'transparent' }}
                                aria-label={`Remove product ${prodIdx + 1}`}
                              >
                                <Trash2 className="w-4 h-4" style={{ color: '#dc2626' }} />
                              </OvalButton>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <InputField
                                label="Product Name"
                                name="name"
                                value={product.name || ''}
                                onChange={(e) => {
                                  const updatedProducts = [...pkg.products];
                                  updatedProducts[prodIdx] = { ...updatedProducts[prodIdx], name: e.target.value };
                                  handleArrayChange('packages', pkgIdx, 'products', updatedProducts);
                                }}
                                placeholder="Electronic Integrated Circuits"
                              />
                              <SelectField
                                label="Category (HS Section)"
                                name="category"
                                value={product.category || ''}
                                onChange={(e) => {
                                  const updatedProducts = [...pkg.products];
                                  updatedProducts[prodIdx] = { ...updatedProducts[prodIdx], category: e.target.value };
                                  handleArrayChange('packages', pkgIdx, 'products', updatedProducts);
                                }}
                                options={hsSections.map(section => ({
                                  value: section.code,
                                  label: `${section.code} - ${section.title}`
                                }))}
                                required={false}
                              />
                              <div className="md:col-span-2">
                                <InputField
                                  label="Description"
                                  name="description"
                                  value={product.description || ''}
                                  onChange={(e) => {
                                    const updatedProducts = [...pkg.products];
                                    updatedProducts[prodIdx] = { ...updatedProducts[prodIdx], description: e.target.value };
                                    handleArrayChange('packages', pkgIdx, 'products', updatedProducts);
                                  }}
                                  placeholder="Product description"
                                  highlight={pkgIdx === 0 && prodIdx === 0 && isAutoFilled('packages[0].products[0].description')}
                                />
                              </div>
                              <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                  HS Code
                                  <span className="text-red-600">*</span>
                                </label>
                                <div>
                                  <input
                                    type="text"
                                    value={product.hsCode || ''}
                                    onChange={(e) => {
                                      const updatedProducts = [...pkg.products];
                                      updatedProducts[prodIdx] = { ...updatedProducts[prodIdx], hsCode: e.target.value };
                                      handleArrayChange('packages', pkgIdx, 'products', updatedProducts);
                                    }}
                                    placeholder="8541.10.00"
                                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                      pkgIdx === 0 && prodIdx === 0 && isAutoFilled('packages[0].products[0].hsCode')
                                        ? 'border-amber-400 bg-amber-50'
                                        : 'border-slate-300'
                                    }`}
                                  />

                                  {/* HS code suggestions (AI) */}
                                  <HsSuggestionPanel
                                    suggestions={hsSuggestions[product.id] || []}
                                    loading={loadingHsSuggestions[product.id] || false}
                                    selectedCode={product.hsCode}
                                    onSelect={(code) => {
                                      const updatedProducts = [...pkg.products];
                                      updatedProducts[prodIdx] = { ...updatedProducts[prodIdx], hsCode: code };
                                      handleArrayChange('packages', pkgIdx, 'products', updatedProducts);
                                    }}
                                  />

                                  {hsValidation[product.id] && (
                                    <p className="text-xs mt-3">
                                      {hsValidation[product.id].valid ? (
                                        <span className="text-green-700 font-medium">✓ HS code looks valid</span>
                                      ) : (
                                        <span className="text-red-700 font-medium">⚠ HS code may be invalid or require review</span>
                                      )}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <SelectField
                                label="Unit of Measure"
                                name="uom"
                                value={product.uom || ''}
                                onChange={(e) => {
                                  const updatedProducts = [...pkg.products];
                                  updatedProducts[prodIdx] = { ...updatedProducts[prodIdx], uom: e.target.value };
                                  handleArrayChange('packages', pkgIdx, 'products', updatedProducts);
                                }}
                                options={uoms}
                              />
                              <InputField
                                label="Quantity"
                                type="number"
                                name="qty"
                                value={product.qty || ''}
                                onChange={(e) => {
                                  const qty = parseFloat(e.target.value) || 0;
                                  const unitPrice = parseFloat(product.unitPrice) || 0;
                                  const totalValue = qty * unitPrice;
                                  const updatedProducts = [...pkg.products];
                                  updatedProducts[prodIdx] = { 
                                    ...updatedProducts[prodIdx], 
                                    qty: qty,
                                    totalValue: totalValue
                                  };
                                  handleArrayChange('packages', pkgIdx, 'products', updatedProducts);
                                }}
                                highlight={pkgIdx === 0 && prodIdx === 0 && isAutoFilled('packages[0].products[0].qty')}
                              />
                              <InputField
                                label="Unit Price"
                                type="number"
                                name="unitPrice"
                                value={product.unitPrice || ''}
                                onChange={(e) => {
                                  const unitPrice = parseFloat(e.target.value) || 0;
                                  const qty = parseFloat(product.qty) || 0;
                                  const totalValue = qty * unitPrice;
                                  const updatedProducts = [...pkg.products];
                                  updatedProducts[prodIdx] = { 
                                    ...updatedProducts[prodIdx], 
                                    unitPrice: unitPrice,
                                    totalValue: totalValue
                                  };
                                  handleArrayChange('packages', pkgIdx, 'products', updatedProducts);
                                }}
                              />
                              <InputField
                                label="Total Value"
                                type="number"
                                name="totalValue"
                                value={product.totalValue || ''}
                                onChange={(e) => {
                                  const updatedProducts = [...pkg.products];
                                  updatedProducts[prodIdx] = { ...updatedProducts[prodIdx], totalValue: parseFloat(e.target.value) || 0 };
                                  handleArrayChange('packages', pkgIdx, 'products', updatedProducts);
                                }}
                                disabled
                                highlight={pkgIdx === 0 && prodIdx === 0 && isAutoFilled('packages[0].products[0].totalValue')}
                              />
                              <SelectField
                                label="Origin Country"
                                name="originCountry"
                                value={product.originCountry || formData.shipper?.country || profileCountry || ''}
                                onChange={(e) => {
                                  const updatedProducts = [...pkg.products];
                                  updatedProducts[prodIdx] = { ...updatedProducts[prodIdx], originCountry: e.target.value };
                                  handleArrayChange('packages', pkgIdx, 'products', updatedProducts);
                                }}
                                options={countryOptions.map(c => ({ value: c.code, label: c.name }))}
                              />
                              <SelectField
                                label="Reason for Export"
                                name="reasonForExport"
                                value={product.reasonForExport || ''}
                                onChange={(e) => {
                                  const updatedProducts = [...pkg.products];
                                  updatedProducts[prodIdx] = { ...updatedProducts[prodIdx], reasonForExport: e.target.value };
                                  handleArrayChange('packages', pkgIdx, 'products', updatedProducts);
                                }}
                                options={reasonsForExport}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-slate-500 text-sm">
                        No products added yet. Click "Add Product" to add product details to this package.
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <OvalButton
                onClick={() => addArrayItem('packages', {
                  id: `PKG-${Date.now()}`,
                  type: '',
                  length: '',
                  width: '',
                  height: '',
                  dimUnit: 'cm',
                  weight: '',
                  weightUnit: 'kg',
                  stackable: false,
                  products: [],
                })}
                className="w-full py-3 flex items-center justify-center gap-2 font-medium"
                style={{ ...yellowButtonStyle }}
              >
                <Plus className="w-5 h-5" style={{ color: '#2F1B17' }} /> Add Package
              </OvalButton>
            </div>
          </CollapsibleSection>
          </>
          )}


          {/* SERVICE & BILLING SECTION (step 5) */}
          {currentStep === 5 && (
          <CollapsibleSection
            title="Service & Billing"
            isOpen={true}
            onToggle={() => toggleSection('service')}
            icon={DollarSign}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SelectField
                label="Service Level"
                name="serviceLevel"
                value={formData.serviceLevel || ''}
                onChange={handleChange}
                options={serviceLevels}
              />
              <SelectField
                label="Currency"
                name="currency"
                value={formData.currency || ''}
                onChange={handleChange}
                options={currencies}
              />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Customs Value
                  <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  name="customsValue"
                  value={(() => {
                    // Auto-calculate as sum of all package product total values
                    if (!formData.packages || formData.packages.length === 0) return '';
                    let total = 0;
                    formData.packages.forEach(pkg => {
                      if (pkg.products && Array.isArray(pkg.products)) {
                        pkg.products.forEach(prod => {
                          total += parseFloat(prod.totalValue) || 0;
                        });
                      }
                    });
                    return total > 0 ? total : '';
                  })()}
                  onChange={handleChange}
                  disabled
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-100 text-slate-500 cursor-not-allowed"
                />
                <p className="mt-1 text-xs text-slate-500">Automatically calculated from package product values</p>
              </div>
            </div>
          </CollapsibleSection>
          )}

          {/* REQUIRED DOCUMENTS SECTION (step 6) */}
          {currentStep === 6 && (
          <CollapsibleSection
            title="Required Documents"
            isOpen={true}
            onToggle={() => toggleSection('documents')}
            icon={Sparkles}
          >
            <div className="space-y-6">
              <div className="border-2 rounded-xl p-6" style={{ background: '#EAD8C3', borderColor: '#2F1B17' }}>
                <div className="flex items-center gap-3 mb-4">
                  <Sparkles className="w-6 h-6" style={{ color: '#2F1B17' }} />
                  <h4 className="text-lg font-semibold" style={{ color: '#2F1B17' }}>AI-Powered Required Documents</h4>
                </div>
                <p className="text-sm mb-4" style={{ color: '#2F1B17' }}>
                  Based on your shipment details, the following documents are required for customs clearance:
                </p>

                {analyzingDocuments ? (
                  <div className="flex items-center gap-3 p-4 bg-white rounded-lg border border-slate-300">
                    <span className="inline-block w-3 h-3 rounded-full animate-pulse" style={{ background: '#2F1B17' }}></span>
                    <span className="text-sm" style={{ color: '#2F1B17' }}>Analyzing shipment details and product information...</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {requiredDocuments.length > 0 ? (
                      requiredDocuments.map((doc, idx) => (
                        <div key={idx} className="bg-white rounded-lg p-4 border border-slate-300 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <FileText className="w-5 h-5" style={{ color: '#2F1B17' }} />
                            <div>
                              <p className="font-medium text-slate-900">{doc.name}</p>
                              {doc.description && (
                                <p className="text-xs text-slate-600 mt-1">{doc.description}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {doc.required && (
                              <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded">Required</span>
                            )}
                            <input
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xlsx"
                              onChange={async (e) => {
                                const file = e.target.files[0];
                                if (file) {
                                  await uploadDocumentForShipment(doc.name, file);
                                }
                              }}
                              className="hidden"
                              id={`file-${idx}`}
                              disabled={uploadingDocuments[doc.name]}
                            />
                            <label
                              htmlFor={`file-${idx}`}
                              className={`px-4 py-2 transition-colors cursor-pointer text-sm flex items-center gap-2 text-white font-medium ${uploadingDocuments[doc.name] ? 'opacity-75 cursor-not-allowed' : ''}`}
                              style={{ ...yellowButtonStyle, outline: 'none', boxShadow: 'none' }}
                            >
                              <Upload className="w-4 h-4" style={{ color: '#2F1B17' }} />
                              {uploadingDocumentName === doc.name
                                ? 'Uploading...'
                                : doc.uploaded || documentFiles[doc.name]
                                  ? 'Change File'
                                  : 'Upload'}
                            </label>
                            {documentUploadErrors[doc.name] && (
                              <div className="text-xs text-red-700 ml-2">{documentUploadErrors[doc.name]}</div>
                            )}
                            {(doc.uploaded || documentFiles[doc.name]) && !documentUploadErrors[doc.name] && (
                              <span className="text-sm text-green-700 flex items-center gap-1">
                                <CheckCircle2 className="w-4 h-4" />
                                {documentFiles[doc.name] ? documentFiles[doc.name].name : 'Uploaded'}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="bg-white rounded-lg p-4 border border-slate-300 text-center">
                        <p className="text-sm" style={{ color: '#2F1B17' }}>No documents required for this shipment</p>
                      </div>
                    )}
                  </div>
                )}


              </div>

              {documentValidationError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-900">Upload Required</p>
                    <p className="text-sm text-red-700 mt-1">{documentValidationError}</p>
                  </div>
                </div>
              )}

              {documentUploadError && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Document Upload</p>
                    <p className="text-sm text-amber-700 mt-1">{documentUploadError}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 w-full">
                <OvalButton
                  onClick={() => onNavigate('dashboard')}
                  className="flex-1 py-3 font-semibold"
                  style={{ ...greyButtonStyle }}
                >
                  Cancel
                </OvalButton>

                <OvalButton
                  onClick={handleSubmit}
                  disabled={!allRequiredDocumentsUploaded()}
                  className="flex-1 py-3 font-semibold"
                  style={{
                    ...yellowButtonStyle,
                    color: '#2F1B17',
                    opacity: allRequiredDocumentsUploaded() ? 1 : 0.5,
                    cursor: allRequiredDocumentsUploaded() ? 'pointer' : 'not-allowed'
                  }}
                >
                  Submit for AI Review
                </OvalButton>
              </div>

            </div>
          </CollapsibleSection>
          )}

          {/* ACTION BUTTONS - Conditional render based on step */}
          {currentStep < 6 && (
          <div className="pt-8 border-t border-slate-200">
            {currentStep === 1 ? (
              <OvalButton
                onClick={handleNext}
                className="w-full py-4 font-semibold text-center"
                style={{ ...yellowButtonStyle }}
                disabled={!canProceed(currentStep)}
              >
                Next
              </OvalButton>
            ) : (
              <div className="flex items-center gap-4 w-full">
                <OvalButton
                  onClick={handlePrev}
                  className="flex-1 py-4 font-semibold text-center"
                  style={{ ...greyButtonStyle }}
                >
                  Previous
                </OvalButton>

                <OvalButton
                  onClick={handleNext}
                  className="flex-1 py-4 font-semibold text-center"
                  style={{ ...yellowButtonStyle }}
                  disabled={!canProceed(currentStep)}
                >
                  Next
                </OvalButton>
              </div>
            )}
          </div>
          )}
        </div>

        {/* RIGHT SIDEBAR - SUMMARY */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl shadow-lg sticky top-6 overflow-hidden">
            {/* Summary Cards */}
            <div className="p-6 space-y-6 max-h-[calc(100vh-100px)] overflow-y-auto">
              
              {/* Shipment Overview */}
              <div>
                <h3 className="font-semibold mb-3" style={{ background: '#EAD8C3', color: '#2F1B17', padding: '0.35rem 0.5rem', borderRadius: '0.25rem' }}>Shipment Overview</h3>
                <div className="space-y-2 text-sm">
                  {formData.title && formData.title.trim() !== '' && (
                    <div className="flex justify-between pb-2 border-b border-slate-200">
                      <span className="text-slate-600">Shipment Title:</span>
                      <span className="text-slate-900 font-semibold">{formData.title}</span>
                    </div>
                  )}
                  
                  <div className="flex justify-between">
                    <span className="text-slate-600">Mode:</span>
                    <span className="text-slate-900">{formData.mode && formData.mode.trim() !== '' ? formData.mode : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Type:</span>
                    <span className="text-slate-900">{formData.shipmentType && formData.shipmentType.trim() !== '' ? formData.shipmentType : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Service:</span>
                    <span className="text-slate-900">{formData.serviceLevel && formData.serviceLevel.trim() !== '' ? formData.serviceLevel : '—'}</span>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-6">
                <h3 className="font-semibold mb-3" style={{ background: '#EAD8C3', color: '#2F1B17', padding: '0.35rem 0.5rem', borderRadius: '0.25rem' }}>Parties</h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-slate-600 mb-1">Shipper:</p>
                    <p className="text-slate-900 font-medium">{formData.shipper?.company ? formData.shipper.company : '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-600 mb-1">Consignee:</p>
                    <p className="text-slate-900 font-medium">{formData.consignee?.company ? formData.consignee.company : '—'}</p>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-6">
                <h3 className="font-semibold mb-3" style={{ background: '#EAD8C3', color: '#2F1B17', padding: '0.35rem 0.5rem', borderRadius: '0.25rem' }}>Weight & Packages</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Packages:</span>
                    <span className="text-slate-900 font-semibold">
                      {(formData.packages?.length ?? 0) > 0 ? formData.packages.length : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Total Products:</span>
                    <span className="text-slate-900 font-semibold">
                      {(() => {
                        const totalProducts = formData.packages?.reduce((sum, pkg) => sum + (pkg.products?.length || 0), 0) || 0;
                        return totalProducts > 0 ? totalProducts : '—';
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Total Weight:</span>
                    <span className="text-slate-900">
                      {formData.weight && formData.weight !== '' && formData.weight !== '0' ? `${formData.weight} kg` : '—'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-6">
                <h3 className="font-semibold mb-3" style={{ background: '#EAD8C3', color: '#2F1B17', padding: '0.35rem 0.5rem', borderRadius: '0.25rem' }}>Pricing Summary</h3>
                <div className="space-y-2 text-sm">
                  
                  <div className="flex justify-between">
                    <span className="text-slate-600">Customs Value:</span>
                    <span className="text-slate-900">
                      {formData.customsValue && formData.customsValue > 0 ? `${formData.currency || 'USD'} ${parseFloat(formData.customsValue).toFixed(2)}` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Base Price:</span>
                    <span className="text-slate-900">{formData.currency} {(pricing.basePrice || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Service Charge:</span>
                    <span className="text-slate-900">{formData.currency } {(pricing.serviceCharge || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Estimated Clearance:</span>
                    <span className="text-slate-900">{formData.currency} {(pricing.customsClearance || 0).toFixed(2)}</span>
                  </div>
                  {pricing.pickupCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">Pickup Charge:</span>
                      <span className="text-slate-900">{formData.currency} {(pricing.pickupCharge || 0).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-2 border-t border-slate-200">
                    <span className="text-slate-600">Subtotal:</span>
                    <span className="text-slate-900">{formData.currency } {(pricing.subtotal || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Tax (18%):</span>
                    <span className="text-slate-900">{formData.currency } {(pricing.tax || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-3 border-t border-slate-200 text-base font-semibold">
                    <span className="text-slate-900">Total:</span>
                    <span className="text-blue-600">{formData.currency } {(pricing.total || 0).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <OvalButton
                  onClick={downloadSummaryPdf}
                  className="w-full py-2 transition-colors text-sm font-semibold"
                  style={{ ...yellowButtonStyle, color: '#2F1B17' }}
                >
                  Download Summary
                </OvalButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShipmentForm;
