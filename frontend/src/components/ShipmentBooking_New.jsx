import { useState, useEffect } from 'react';
import { 
  MapPin, Package, Truck, Clock, DollarSign, Info, AlertCircle, CheckCircle2, 
  AlertTriangle, ChevronDown, Plus, Trash2, FileText, Globe, Settings, Users
} from 'lucide-react';
import { shipmentsStore } from '../../store/shipmentsStore';
import AutoFillToggle from './AutoFillToggle';
import DocumentUploadSection from './DocumentUploadSection';

const modes = ['Air', 'Sea', 'Road', 'Rail', 'Courier', 'Multimodal'];
const shipmentTypes = ['Domestic', 'International'];
const pickupTypes = ['Scheduled Pickup', 'Drop-off'];
const serviceLevels = ['Standard', 'Express', 'Economy', 'Freight'];
const incoterms = ['FOB', 'CIF', 'DDP', 'EXW', 'CPT', 'DAP'];
const billToOptions = ['Shipper', 'Consignee', 'ThirdParty'];
const paymentTimings = ['Prepaid', 'Collect', 'COD'];
const paymentMethods = ['Credit Card', 'Bank Transfer', 'Wire Transfer', 'Check'];
const currencies = ['USD', 'EUR', 'GBP', 'INR', 'CNY'];
const packageTypes = ['Box', 'Pallet', 'Crate', 'Bag', 'Case', 'Envelope'];
const uoms = ['kg', 'lb', 'pieces', 'meters', 'units', 'sets'];
const countries = ['US', 'CN', 'IN', 'JP', 'DE', 'FR', 'UK', 'AU'];

const CollapsibleSection = ({ title, isOpen, onToggle, children, icon: Icon }) => (
  <div className="border border-slate-200 rounded-lg overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
    >
      <div className="flex items-center gap-3">
        {Icon && <Icon className="w-5 h-5 text-slate-600" />}
        <h3 className="text-slate-900 font-semibold">{title}</h3>
      </div>
      <ChevronDown 
        className={`w-5 h-5 text-slate-600 transition-transform ${isOpen ? 'rotate-180' : ''}`}
      />
    </button>
    {isOpen && (
      <div className="p-6 bg-white border-t border-slate-200 space-y-4">
        {children}
      </div>
    )}
  </div>
);

const InputField = ({ label, type = 'text', name, value, onChange, required = false, placeholder = '', highlight = false }) => (
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
      className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${highlight ? 'border-amber-300 bg-amber-50' : 'border-slate-300'}`}
    />
  </div>
);

const SelectField = ({ label, name, value, onChange, options, required = false, highlight = false }) => (
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
      className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${highlight ? 'border-amber-300 bg-amber-50' : 'border-slate-300'}`}
    >
      <option value="">-- Select {label} --</option>
      {options.map(opt => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  </div>
);

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

export function ShipmentBooking_New({ shipment, onNavigate }) {
  const [formData, setFormData] = useState(shipment || {});
  const [mode, setMode] = useState('manual'); // 'manual' | 'auto'
  const [expandedSections, setExpandedSections] = useState({
    basics: true,
    shipper: false,
    consignee: false,
    packages: false,
    products: false,
    service: false,
    compliance: false,
    documents: false,
  });
  const [errors, setErrors] = useState({});
  const [pricing, setPricing] = useState({
    basePrice: 2400,
    serviceCharge: 0,
    customsClearance: 450,
    insurance: 0,
    subtotal: 0,
    tax: 0,
    total: 0,
  });
  const [autoFilled, setAutoFilled] = useState({});

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;
    setFormData(prev => ({ ...prev, [name]: newValue }));
  };

  const handleNestedChange = (parent, field, value) => {
    setFormData(prev => ({
      ...prev,
      [parent]: { ...prev[parent], [field]: value }
    }));
  };

  const handleArrayChange = (arrayName, index, field, value) => {
    setFormData(prev => {
      const newArray = [...prev[arrayName]];
      newArray[index] = { ...newArray[index], [field]: value };
      return { ...prev, [arrayName]: newArray };
    });
  };

  const addArrayItem = (arrayName, template) => {
    setFormData(prev => ({
      ...prev,
      [arrayName]: [...prev[arrayName], template]
    }));
  };

  const removeArrayItem = (arrayName, index) => {
    setFormData(prev => ({
      ...prev,
      [arrayName]: prev[arrayName].filter((_, i) => i !== index)
    }));
  };

  const markAutoFilled = (paths) => {
    setAutoFilled(prev => {
      const next = { ...prev };
      paths.forEach(p => { next[p] = true; });
      return next;
    });
  };

  const isAutoFilled = (path) => !!autoFilled[path];

  const ensureArray = (arr) => Array.isArray(arr) ? arr : [];

  const parseDims = (dims) => {
    if (!dims) return {};
    // e.g., "120x100x150 cm" or "120 x 100 x 150"
    const match = String(dims).match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/);
    if (!match) return {};
    return { length: parseFloat(match[1]), width: parseFloat(match[2]), height: parseFloat(match[3]) };
  };

  const applyExtractedData = (extracted) => {
    if (!extracted) return;
    const updates = { ...formData };
    const filled = [];

    // Shipper
    if (extracted.shipper) {
      updates.shipper = {
        ...(updates.shipper || {}),
        company: extracted.shipper.name || updates.shipper?.company || '',
        address1: extracted.shipper.address || updates.shipper?.address1 || '',
      };
      if (extracted.shipper.name) filled.push('shipper.company');
      if (extracted.shipper.address) filled.push('shipper.address1');
    }

    // Consignee
    if (extracted.consignee) {
      updates.consignee = {
        ...(updates.consignee || {}),
        company: extracted.consignee.name || updates.consignee?.company || '',
        address1: extracted.consignee.address || updates.consignee?.address1 || '',
        country: extracted.consignee.country || updates.consignee?.country || '',
      };
      if (extracted.consignee.name) filled.push('consignee.company');
      if (extracted.consignee.address) filled.push('consignee.address1');
      if (extracted.consignee.country) filled.push('consignee.country');
    }

    // Products (first)
    if (extracted.product) {
      const products = ensureArray(updates.products);
      const first = products[0] || {};
      const qty = extracted.product.quantity ? parseFloat(extracted.product.quantity) : first.qty;
      const totalValue = extracted.product.value ? parseFloat(extracted.product.value) : first.totalValue;
      const name = first.name || 'Extracted Product';
      const newFirst = {
        ...first,
        name,
        description: extracted.product.description ?? first.description,
        hsCode: extracted.product.hsCode ?? first.hsCode,
        qty: qty ?? first.qty,
        totalValue: totalValue ?? first.totalValue,
      };
      if (!products.length) products.push(newFirst); else products[0] = newFirst;
      updates.products = products;
      if (extracted.product.description) filled.push('products[0].description');
      if (extracted.product.hsCode) filled.push('products[0].hsCode');
      if (extracted.product.quantity) filled.push('products[0].qty');
      if (extracted.product.value) filled.push('products[0].totalValue');
    }

    // Packages (first)
    if (extracted.package) {
      const packages = ensureArray(updates.packages);
      const first = packages[0] || {};
      const dims = parseDims(extracted.package.dimensions);
      const newFirst = {
        ...first,
        type: first.type || 'Pallet',
        weight: extracted.package.weight ? parseFloat(extracted.package.weight) : first.weight,
        weightUnit: first.weightUnit || 'kg',
        length: dims.length ?? first.length,
        width: dims.width ?? first.width,
        height: dims.height ?? first.height,
        dimUnit: first.dimUnit || 'cm',
      };
      if (!packages.length) packages.push(newFirst); else packages[0] = newFirst;
      updates.packages = packages;
      if (extracted.package.weight) filled.push('packages[0].weight');
      if (dims.length) filled.push('packages[0].length');
      if (dims.width) filled.push('packages[0].width');
      if (dims.height) filled.push('packages[0].height');
    }

    // Documents
    if (extracted.documents) {
      updates.documents = {
        ...(updates.documents || {}),
        invoiceNumber: extracted.documents.invoiceNumber || updates.documents?.invoiceNumber || '',
        invoiceDate: extracted.documents.invoiceDate || updates.documents?.invoiceDate || '',
      };
      if (extracted.documents.invoiceNumber) filled.push('documents.invoiceNumber');
      if (extracted.documents.invoiceDate) filled.push('documents.invoiceDate');
    }

    setFormData(updates);
    markAutoFilled(filled);
    // Optionally expand sections to show changes
    setExpandedSections(prev => ({ ...prev, shipper: true, consignee: true, products: true, packages: true, documents: true }));
  };

  // Calculate pricing
  useEffect(() => {
    const serviceLevelMultiplier = {
      'Standard': 1.0,
      'Express': 1.5,
      'Economy': 0.8,
      'Freight': 0.7,
    };
    
    const basePrice = formData.declaredValue ? formData.declaredValue * 0.05 : 2400;
    const serviceCharge = basePrice * (serviceLevelMultiplier[formData.serviceLevel] || 1.0);
    const insurance = formData.insuranceRequired ? (formData.declaredValue || 0) * 0.01 : 0;
    const subtotal = basePrice + serviceCharge + pricing.customsClearance + insurance;
    const tax = subtotal * 0.18;
    const total = subtotal + tax;

    setPricing({
      basePrice,
      serviceCharge,
      customsClearance: pricing.customsClearance,
      insurance,
      subtotal,
      tax,
      total
    });
  }, [formData.declaredValue, formData.serviceLevel, formData.insuranceRequired]);

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.referenceId) newErrors.referenceId = 'Reference ID is required';
    if (!formData.title) newErrors.title = 'Shipment title is required';
    if (!formData.mode) newErrors.mode = 'Mode is required';
    if (!formData.shipmentType) newErrors.shipmentType = 'Shipment type is required';
    if (!formData.shipper?.company) newErrors.shipperCompany = 'Shipper company is required';
    if (!formData.consignee?.company) newErrors.consigneeCompany = 'Consignee company is required';
    if (formData.packages?.length === 0) newErrors.packages = 'At least one package is required';
    if (formData.products?.length === 0) newErrors.products = 'At least one product is required';
    if (!formData.declaredValue || formData.declaredValue <= 0) newErrors.declaredValue = 'Declared value must be greater than 0';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) {
      alert('Please fill in all required fields');
      return;
    }

    // Update shipment in store
    const updatedShipment = {
      ...formData,
      updatedAt: new Date().toISOString(),
      lastModifiedBy: 'shipper-1'
    };
    
    shipmentsStore.saveShipment(updatedShipment);
    
    // Navigate to next step
    if (formData.status === 'token-generated') {
      onNavigate('booking', updatedShipment);
    } else {
      onNavigate('compliance-check', updatedShipment);
    }
  };

  if (!formData || Object.keys(formData).length === 0) {
    return (
      <div className="p-8 bg-red-50 rounded-xl border border-red-200">
        <p className="text-red-800">Shipment not found. Please go back and select a shipment.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-slate-900 mb-2 text-3xl font-bold">Shipment Details</h1>
            <p className="text-slate-600">Complete all sections to proceed with your shipment</p>
          </div>
          <AutoFillToggle mode={mode} onChange={setMode} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Form - 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {mode === 'auto' && (
            <DocumentUploadSection onExtracted={applyExtractedData} />
          )}
          
          {/* BASICS SECTION */}
          <CollapsibleSection
            title="Shipment Basics"
            isOpen={expandedSections.basics}
            onToggle={() => toggleSection('basics')}
            icon={FileText}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputField
                label="Reference ID"
                name="referenceId"
                value={formData.referenceId || ''}
                onChange={handleChange}
                required
                placeholder="REF-2024-001"
                highlight={isAutoFilled('referenceId')}
              />
              <InputField
                label="Shipment Title"
                name="title"
                value={formData.title || ''}
                onChange={handleChange}
                required
                placeholder="Electronic Components Shipment"
                highlight={isAutoFilled('title')}
              />
              <SelectField
                label="Mode of Transport"
                name="mode"
                value={formData.mode || ''}
                onChange={handleChange}
                options={modes}
                required
                highlight={isAutoFilled('mode')}
              />
              <SelectField
                label="Shipment Type"
                name="shipmentType"
                value={formData.shipmentType || ''}
                onChange={handleChange}
                options={shipmentTypes}
                required
                highlight={isAutoFilled('shipmentType')}
              />
              <SelectField
                label="Pickup Type"
                name="pickupType"
                value={formData.pickupType || ''}
                onChange={handleChange}
                options={pickupTypes}
                highlight={isAutoFilled('pickupType')}
              />
              <InputField
                label="Ship Date"
                type="date"
                name="shipDate"
                value={formData.shipDate || ''}
                onChange={handleChange}
                highlight={isAutoFilled('shipDate')}
              />
              <InputField
                label="Expected Delivery"
                type="date"
                name="expectedDelivery"
                value={formData.expectedDelivery || ''}
                onChange={handleChange}
                highlight={isAutoFilled('expectedDelivery')}
              />
            </div>
          </CollapsibleSection>

          {/* SHIPPER SECTION */}
          <CollapsibleSection
            title="Shipper Information"
            isOpen={expandedSections.shipper}
            onToggle={() => toggleSection('shipper')}
            icon={Users}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputField
                label="Company Name"
                name="company"
                value={formData.shipper?.company || ''}
                onChange={(e) => handleNestedChange('shipper', 'company', e.target.value)}
                required
                placeholder="ABC Exports"
                highlight={isAutoFilled('shipper.company')}
              />
              <InputField
                label="Contact Name"
                name="contactName"
                value={formData.shipper?.contactName || ''}
                onChange={(e) => handleNestedChange('shipper', 'contactName', e.target.value)}
                placeholder="John Smith"
                highlight={isAutoFilled('shipper.contactName')}
              />
              <InputField
                label="Phone"
                type="tel"
                name="phone"
                value={formData.shipper?.phone || ''}
                onChange={(e) => handleNestedChange('shipper', 'phone', e.target.value)}
                placeholder="+1-555-0001"
                highlight={isAutoFilled('shipper.phone')}
              />
              <InputField
                label="Email"
                type="email"
                name="email"
                value={formData.shipper?.email || ''}
                onChange={(e) => handleNestedChange('shipper', 'email', e.target.value)}
                placeholder="john@company.com"
                highlight={isAutoFilled('shipper.email')}
              />
              <InputField
                label="Address Line 1"
                name="address1"
                value={formData.shipper?.address1 || ''}
                onChange={(e) => handleNestedChange('shipper', 'address1', e.target.value)}
                placeholder="123 Manufacturing St"
                highlight={isAutoFilled('shipper.address1')}
              />
              <InputField
                label="Address Line 2"
                name="address2"
                value={formData.shipper?.address2 || ''}
                onChange={(e) => handleNestedChange('shipper', 'address2', e.target.value)}
                placeholder="Suite 100"
                highlight={isAutoFilled('shipper.address2')}
              />
              <InputField
                label="City"
                name="city"
                value={formData.shipper?.city || ''}
                onChange={(e) => handleNestedChange('shipper', 'city', e.target.value)}
                placeholder="Shanghai"
                highlight={isAutoFilled('shipper.city')}
              />
              <InputField
                label="State/Province"
                name="state"
                value={formData.shipper?.state || ''}
                onChange={(e) => handleNestedChange('shipper', 'state', e.target.value)}
                placeholder="SH"
                highlight={isAutoFilled('shipper.state')}
              />
              <InputField
                label="Postal Code"
                name="postalCode"
                value={formData.shipper?.postalCode || ''}
                onChange={(e) => handleNestedChange('shipper', 'postalCode', e.target.value)}
                placeholder="200000"
                highlight={isAutoFilled('shipper.postalCode')}
              />
              <SelectField
                label="Country"
                name="country"
                value={formData.shipper?.country || ''}
                onChange={(e) => handleNestedChange('shipper', 'country', e.target.value)}
                options={countries}
                highlight={isAutoFilled('shipper.country')}
              />
              <InputField
                label="Tax ID"
                name="taxId"
                value={formData.shipper?.taxId || ''}
                onChange={(e) => handleNestedChange('shipper', 'taxId', e.target.value)}
                placeholder="CN123456789"
                highlight={isAutoFilled('shipper.taxId')}
              />
              <div className="md:col-span-2">
                <CheckboxField
                  label="Exporter of Record"
                  name="exporterOfRecord"
                  checked={formData.shipper?.exporterOfRecord || false}
                  onChange={(e) => handleNestedChange('shipper', 'exporterOfRecord', e.target.checked)}
                />
              </div>
            </div>
          </CollapsibleSection>

          {/* CONSIGNEE SECTION */}
          <CollapsibleSection
            title="Consignee Information"
            isOpen={expandedSections.consignee}
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
                highlight={isAutoFilled('consignee.contactName')}
              />
              <InputField
                label="Phone"
                type="tel"
                name="phone"
                value={formData.consignee?.phone || ''}
                onChange={(e) => handleNestedChange('consignee', 'phone', e.target.value)}
                placeholder="+1-555-0101"
                highlight={isAutoFilled('consignee.phone')}
              />
              <InputField
                label="Email"
                type="email"
                name="email"
                value={formData.consignee?.email || ''}
                onChange={(e) => handleNestedChange('consignee', 'email', e.target.value)}
                placeholder="jane@company.com"
                highlight={isAutoFilled('consignee.email')}
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
                highlight={isAutoFilled('consignee.address2')}
              />
              <InputField
                label="City"
                name="city"
                value={formData.consignee?.city || ''}
                onChange={(e) => handleNestedChange('consignee', 'city', e.target.value)}
                placeholder="New York"
                highlight={isAutoFilled('consignee.city')}
              />
              <InputField
                label="State/Province"
                name="state"
                value={formData.consignee?.state || ''}
                onChange={(e) => handleNestedChange('consignee', 'state', e.target.value)}
                placeholder="NY"
                highlight={isAutoFilled('consignee.state')}
              />
              <InputField
                label="Postal Code"
                name="postalCode"
                value={formData.consignee?.postalCode || ''}
                onChange={(e) => handleNestedChange('consignee', 'postalCode', e.target.value)}
                placeholder="10001"
                highlight={isAutoFilled('consignee.postalCode')}
              />
              <SelectField
                label="Country"
                name="country"
                value={formData.consignee?.country || ''}
                onChange={(e) => handleNestedChange('consignee', 'country', e.target.value)}
                options={countries}
                highlight={isAutoFilled('consignee.country')}
              />
              <InputField
                label="Tax ID"
                name="taxId"
                value={formData.consignee?.taxId || ''}
                onChange={(e) => handleNestedChange('consignee', 'taxId', e.target.value)}
                placeholder="US987654321"
                highlight={isAutoFilled('consignee.taxId')}
              />
              <div className="md:col-span-2">
                <CheckboxField
                  label="Importer of Record"
                  name="importerOfRecord"
                  checked={formData.consignee?.importerOfRecord || false}
                  onChange={(e) => handleNestedChange('consignee', 'importerOfRecord', e.target.checked)}
                />
              </div>
            </div>
          </CollapsibleSection>

          {/* PACKAGES SECTION */}
          <CollapsibleSection
            title="Packages"
            isOpen={expandedSections.packages}
            onToggle={() => toggleSection('packages')}
            icon={Package}
          >
            <div className="space-y-4">
              {formData.packages && formData.packages.map((pkg, idx) => (
                <div key={idx} className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <div className="flex justify-between items-start mb-4">
                    <h4 className="font-semibold text-slate-900">Package {idx + 1}</h4>
                    <button
                      onClick={() => removeArrayItem('packages', idx)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <SelectField
                      label="Package Type"
                      name="type"
                      value={pkg.type || ''}
                      onChange={(e) => handleArrayChange('packages', idx, 'type', e.target.value)}
                      options={packageTypes}
                      highlight={isAutoFilled(`packages[${idx}].type`)}
                    />
                    <InputField
                      label="Length (cm)"
                      type="number"
                      name="length"
                      value={pkg.length || ''}
                      onChange={(e) => handleArrayChange('packages', idx, 'length', parseFloat(e.target.value))}
                      highlight={isAutoFilled(`packages[${idx}].length`)}
                    />
                    <InputField
                      label="Width (cm)"
                      type="number"
                      name="width"
                      value={pkg.width || ''}
                      onChange={(e) => handleArrayChange('packages', idx, 'width', parseFloat(e.target.value))}
                      highlight={isAutoFilled(`packages[${idx}].width`)}
                    />
                    <InputField
                      label="Height (cm)"
                      type="number"
                      name="height"
                      value={pkg.height || ''}
                      onChange={(e) => handleArrayChange('packages', idx, 'height', parseFloat(e.target.value))}
                      highlight={isAutoFilled(`packages[${idx}].height`)}
                    />
                    <InputField
                      label="Weight"
                      type="number"
                      name="weight"
                      value={pkg.weight || ''}
                      onChange={(e) => handleArrayChange('packages', idx, 'weight', parseFloat(e.target.value))}
                      highlight={isAutoFilled(`packages[${idx}].weight`)}
                    />
                    <SelectField
                      label="Weight Unit"
                      name="weightUnit"
                      value={pkg.weightUnit || 'kg'}
                      onChange={(e) => handleArrayChange('packages', idx, 'weightUnit', e.target.value)}
                      options={['kg', 'lb']}
                      highlight={isAutoFilled(`packages[${idx}].weightUnit`)}
                    />
                    <div className="md:col-span-3">
                      <CheckboxField
                        label="Stackable"
                        name="stackable"
                        checked={pkg.stackable || false}
                        onChange={(e) => handleArrayChange('packages', idx, 'stackable', e.target.checked)}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button
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
                })}
                className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-slate-400 hover:text-slate-700 flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Add Package
              </button>
            </div>
          </CollapsibleSection>

          {/* PRODUCTS SECTION */}
          <CollapsibleSection
            title="Products"
            isOpen={expandedSections.products}
            onToggle={() => toggleSection('products')}
            icon={Package}
          >
            <div className="space-y-4">
              {formData.products && formData.products.map((product, idx) => (
                <div key={idx} className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <div className="flex justify-between items-start mb-4">
                    <h4 className="font-semibold text-slate-900">Product {idx + 1}</h4>
                    <button
                      onClick={() => removeArrayItem('products', idx)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InputField
                      label="Product Name"
                      name="name"
                      value={product.name || ''}
                      onChange={(e) => handleArrayChange('products', idx, 'name', e.target.value)}
                      placeholder="Electronic Integrated Circuits"
                      highlight={isAutoFilled(`products[${idx}].name`)}
                    />
                    <InputField
                      label="Description"
                      name="description"
                      value={product.description || ''}
                      onChange={(e) => handleArrayChange('products', idx, 'description', e.target.value)}
                      placeholder="Product description"
                      highlight={isAutoFilled(`products[${idx}].description`)}
                    />
                    <InputField
                      label="HS Code"
                      name="hsCode"
                      value={product.hsCode || ''}
                      onChange={(e) => handleArrayChange('products', idx, 'hsCode', e.target.value)}
                      placeholder="8541.10.00"
                      highlight={isAutoFilled(`products[${idx}].hsCode`)}
                    />
                    <InputField
                      label="Category"
                      name="category"
                      value={product.category || ''}
                      onChange={(e) => handleArrayChange('products', idx, 'category', e.target.value)}
                      placeholder="Electronics"
                      highlight={isAutoFilled(`products[${idx}].category`)}
                    />
                    <InputField
                      label="Quantity"
                      type="number"
                      name="qty"
                      value={product.qty || ''}
                      onChange={(e) => handleArrayChange('products', idx, 'qty', parseFloat(e.target.value))}
                      highlight={isAutoFilled(`products[${idx}].qty`)}
                    />
                    <SelectField
                      label="Unit of Measure"
                      name="uom"
                      value={product.uom || ''}
                      onChange={(e) => handleArrayChange('products', idx, 'uom', e.target.value)}
                      options={uoms}
                      highlight={isAutoFilled(`products[${idx}].uom`)}
                    />
                    <InputField
                      label="Unit Price"
                      type="number"
                      name="unitPrice"
                      value={product.unitPrice || ''}
                      onChange={(e) => handleArrayChange('products', idx, 'unitPrice', parseFloat(e.target.value))}
                      highlight={isAutoFilled(`products[${idx}].unitPrice`)}
                    />
                    <InputField
                      label="Total Value"
                      type="number"
                      name="totalValue"
                      value={product.totalValue || ''}
                      onChange={(e) => handleArrayChange('products', idx, 'totalValue', parseFloat(e.target.value))}
                      highlight={isAutoFilled(`products[${idx}].totalValue`)}
                    />
                    <SelectField
                      label="Origin Country"
                      name="originCountry"
                      value={product.originCountry || ''}
                      onChange={(e) => handleArrayChange('products', idx, 'originCountry', e.target.value)}
                      options={countries}
                      highlight={isAutoFilled(`products[${idx}].originCountry`)}
                    />
                    <InputField
                      label="Reason for Export"
                      name="reasonForExport"
                      value={product.reasonForExport || ''}
                      onChange={(e) => handleArrayChange('products', idx, 'reasonForExport', e.target.value)}
                      placeholder="Commercial Trade"
                      highlight={isAutoFilled(`products[${idx}].reasonForExport`)}
                    />
                  </div>
                </div>
              ))}
              <button
                onClick={() => addArrayItem('products', {
                  id: `PROD-${Date.now()}`,
                  name: '',
                  description: '',
                  hsCode: '',
                  category: '',
                  qty: '',
                  uom: '',
                  unitPrice: '',
                  totalValue: '',
                  originCountry: '',
                  reasonForExport: '',
                })}
                className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-slate-400 hover:text-slate-700 flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Add Product
              </button>
            </div>
          </CollapsibleSection>

          {/* SERVICE & BILLING SECTION */}
          <CollapsibleSection
            title="Service & Billing"
            isOpen={expandedSections.service}
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
                highlight={isAutoFilled('serviceLevel')}
              />
              <SelectField
                label="Incoterm"
                name="incoterm"
                value={formData.incoterm || ''}
                onChange={handleChange}
                options={incoterms}
                highlight={isAutoFilled('incoterm')}
              />
              <SelectField
                label="Bill To"
                name="billTo"
                value={formData.billTo || ''}
                onChange={handleChange}
                options={billToOptions}
                highlight={isAutoFilled('billTo')}
              />
              <InputField
                label="Billing Account Number"
                name="billingAccountNumber"
                value={formData.billingAccountNumber || ''}
                onChange={handleChange}
                placeholder="ACC-12345678"
                highlight={isAutoFilled('billingAccountNumber')}
              />
              <SelectField
                label="Currency"
                name="currency"
                value={formData.currency || 'USD'}
                onChange={handleChange}
                options={currencies}
                highlight={isAutoFilled('currency')}
              />
              <InputField
                label="Declared Value"
                type="number"
                name="declaredValue"
                value={formData.declaredValue || ''}
                onChange={handleChange}
                required
                highlight={isAutoFilled('declaredValue')}
              />
              <SelectField
                label="Payment Timing"
                name="paymentTiming"
                value={formData.paymentTiming || ''}
                onChange={handleChange}
                options={paymentTimings}
                highlight={isAutoFilled('paymentTiming')}
              />
              <SelectField
                label="Payment Method"
                name="paymentMethod"
                value={formData.paymentMethod || ''}
                onChange={handleChange}
                options={paymentMethods}
                highlight={isAutoFilled('paymentMethod')}
              />
              <div className="md:col-span-2">
                <CheckboxField
                  label="Insurance Required"
                  name="insuranceRequired"
                  checked={formData.insuranceRequired || false}
                  onChange={handleChange}
                />
              </div>
            </div>
          </CollapsibleSection>

          {/* COMPLIANCE SECTION */}
          <CollapsibleSection
            title="Compliance & Restrictions"
            isOpen={expandedSections.compliance}
            onToggle={() => toggleSection('compliance')}
            icon={AlertTriangle}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CheckboxField
                label="Contains Dangerous Goods"
                name="dangerousGoods"
                checked={formData.dangerousGoods || false}
                onChange={handleChange}
              />
              <CheckboxField
                label="Contains Lithium Batteries"
                name="lithiumBattery"
                checked={formData.lithiumBattery || false}
                onChange={handleChange}
              />
              <CheckboxField
                label="Food/Pharma Product"
                name="foodPharmaFlag"
                checked={formData.foodPharmaFlag || false}
                onChange={handleChange}
              />
              <CheckboxField
                label="Temperature Controlled Required"
                name="temperatureControlled"
                checked={formData.temperatureControlled || false}
                onChange={handleChange}
              />
              <InputField
                label="ECCN (Export Control Classification Number)"
                name="eccn"
                value={formData.eccn || ''}
                onChange={handleChange}
                placeholder="0A919"
              />
              <CheckboxField
                label="Export License Required"
                name="exportLicenseRequired"
                checked={formData.exportLicenseRequired || false}
                onChange={handleChange}
              />
              {formData.exportLicenseRequired && (
                <InputField
                  label="License Number"
                  name="licenseNumber"
                  value={formData.licenseNumber || ''}
                  onChange={handleChange}
                  placeholder="EXP-LIC-12345"
                />
              )}
              <CheckboxField
                label="Item Contains Restricted Materials"
                name="restrictedFlag"
                checked={formData.restrictedFlag || false}
                onChange={handleChange}
              />
              <CheckboxField
                label="Suspected Sanctioned Country"
                name="sanctionedCountryFlag"
                checked={formData.sanctionedCountryFlag || false}
                onChange={handleChange}
              />
            </div>
          </CollapsibleSection>

          {/* DOCUMENTS SECTION */}
          <CollapsibleSection
            title="Required Documents"
            isOpen={expandedSections.documents}
            onToggle={() => toggleSection('documents')}
            icon={FileText}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CheckboxField
                label="Commercial Invoice"
                name="commercialInvoice"
                checked={formData.documents?.commercialInvoice || false}
                onChange={(e) => handleNestedChange('documents', 'commercialInvoice', e.target.checked)}
              />
              <InputField
                label="Invoice Number"
                name="invoiceNumber"
                value={formData.documents?.invoiceNumber || ''}
                onChange={(e) => handleNestedChange('documents', 'invoiceNumber', e.target.value)}
                placeholder="INV-xxxxx"
                highlight={isAutoFilled('documents.invoiceNumber')}
              />
              <InputField
                label="Invoice Date"
                type="date"
                name="invoiceDate"
                value={formData.documents?.invoiceDate || ''}
                onChange={(e) => handleNestedChange('documents', 'invoiceDate', e.target.value)}
                highlight={isAutoFilled('documents.invoiceDate')}
              />
              <CheckboxField
                label="Packing List"
                name="packingList"
                checked={formData.documents?.packingList || false}
                onChange={(e) => handleNestedChange('documents', 'packingList', e.target.checked)}
              />
              <CheckboxField
                label="Certificate of Origin"
                name="certificateOfOrigin"
                checked={formData.documents?.certificateOfOrigin || false}
                onChange={(e) => handleNestedChange('documents', 'certificateOfOrigin', e.target.checked)}
              />
              <CheckboxField
                label="Export License"
                name="exportLicense"
                checked={formData.documents?.exportLicense || false}
                onChange={(e) => handleNestedChange('documents', 'exportLicense', e.target.checked)}
              />
              <CheckboxField
                label="Import License"
                name="importLicense"
                checked={formData.documents?.importLicense || false}
                onChange={(e) => handleNestedChange('documents', 'importLicense', e.target.checked)}
              />
              <CheckboxField
                label="Safety Data Sheet (SDS)"
                name="sds"
                checked={formData.documents?.sds || false}
                onChange={(e) => handleNestedChange('documents', 'sds', e.target.checked)}
              />
              {/* Airway Bill (AWB) removed — AWB is not provided as a static document option */}
              <CheckboxField
                label="Bill of Lading (BOL)"
                name="bol"
                checked={formData.documents?.bol || false}
                onChange={(e) => handleNestedChange('documents', 'bol', e.target.checked)}
              />
              <CheckboxField
                label="CMR (International Road Transport)"
                name="cmr"
                checked={formData.documents?.cmr || false}
                onChange={(e) => handleNestedChange('documents', 'cmr', e.target.checked)}
              />
            </div>
          </CollapsibleSection>

          {/* ACTION BUTTONS */}
          <div className="flex gap-4 pt-8 border-t border-slate-200">
            <button
              onClick={handleSubmit}
              className="flex-1 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" />
              {formData.status === 'token-generated' ? 'Proceed to Booking' : 'Submit for Compliance Check'}
            </button>
            <button
              onClick={() => onNavigate('dashboard')}
              className="flex-1 py-4 bg-slate-200 text-slate-900 rounded-lg hover:bg-slate-300 font-semibold transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* RIGHT SIDEBAR - SUMMARY */}
        <div className="lg:col-span-1">
          <div className="bg-white border border-slate-200 rounded-lg sticky top-6 overflow-hidden">
            {/* Summary Cards */}
            <div className="p-6 space-y-6 max-h-[calc(100vh-100px)] overflow-y-auto">
              
              {/* Shipment Overview */}
              <div>
                <h3 className="font-semibold text-slate-900 mb-3">Shipment Overview</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Reference ID:</span>
                    <span className="text-slate-900 font-mono">{formData.referenceId || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Mode:</span>
                    <span className="text-slate-900">{formData.mode || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Type:</span>
                    <span className="text-slate-900">{formData.shipmentType || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Service:</span>
                    <span className="text-slate-900">{formData.serviceLevel || '—'}</span>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-6">
                <h3 className="font-semibold text-slate-900 mb-3">Parties</h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-slate-600 mb-1">Shipper:</p>
                    <p className="text-slate-900 font-medium">{formData.shipper?.company || 'Not specified'}</p>
                  </div>
                  <div>
                    <p className="text-slate-600 mb-1">Consignee:</p>
                    <p className="text-slate-900 font-medium">{formData.consignee?.company || 'Not specified'}</p>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-6">
                <h3 className="font-semibold text-slate-900 mb-3">Weight & Packages</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Packages:</span>
                    <span className="text-slate-900 font-semibold">{formData.packages?.length || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Total Weight:</span>
                    <span className="text-slate-900">{formData.totalWeight || '—'} kg</span>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-6">
                <h3 className="font-semibold text-slate-900 mb-3">Pricing Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Base Price:</span>
                    <span className="text-slate-900">${pricing.basePrice.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Service Charge:</span>
                    <span className="text-slate-900">${pricing.serviceCharge.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Clearance:</span>
                    <span className="text-slate-900">${pricing.customsClearance.toFixed(2)}</span>
                  </div>
                  {formData.insuranceRequired && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">Insurance:</span>
                      <span className="text-slate-900">${pricing.insurance.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-2 border-t border-slate-200">
                    <span className="text-slate-600">Subtotal:</span>
                    <span className="text-slate-900">${pricing.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Tax (18%):</span>
                    <span className="text-slate-900">${pricing.tax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-3 border-t border-slate-200 text-base font-semibold">
                    <span className="text-slate-900">Total:</span>
                    <span className="text-blue-600">${pricing.total.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Status Badge */}
              {formData.status && (
                <div className="border-t border-slate-200 pt-6">
                  <div className={`p-3 rounded-lg text-center text-sm font-semibold ${
                    formData.status === 'token-generated' 
                      ? 'bg-green-50 text-green-700'
                      : formData.status === 'token-generated'
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-slate-50 text-slate-700'
                  }`}>
                    Status: {formData.status.toUpperCase()}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShipmentBooking_New;
