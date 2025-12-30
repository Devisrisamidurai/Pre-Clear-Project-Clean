import { MapPin, Package, User, ChevronDown, ChevronUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import { getAllShipments } from '../../api/shipments';

export function ShipmentTracking() {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedShipmentId, setExpandedShipmentId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [brokerFilter, setBrokerFilter] = useState('all');

  useEffect(() => {
    const fetchShipments = async () => {
      try {
        setLoading(true);
        const data = await getAllShipments();
        setShipments(data || []);
      } catch (error) {
        console.error('Error fetching shipments:', error);
        setShipments([]);
      } finally {
        setLoading(false);
      }
    };
    fetchShipments();
  }, []);

  const getStatusDisplay = (shipment) => {
    // Check shipment status first
    if (shipment.status === 'documents-requested') {
      return 'Documents Requested';
    }
    if (shipment.status === 'documents-uploaded') {
      return 'Documents Uploaded';
    }
    
    const aiStatus = shipment.aiApprovalStatus === 'approved' ? 'AI Approved' : 
                    shipment.aiApprovalStatus === 'rejected' ? 'AI Rejected' : 'AI Pending';
    const brokerStatus = shipment.brokerApprovalStatus === 'approved' ? 'Broker Approved' : 
                        shipment.brokerApprovalStatus === 'documents-requested' ? 'Docs Requested' : 'Broker Pending';
    
    return `${aiStatus} | ${brokerStatus}`;
  };

  const getAssignedBroker = (shipment) => {
    return shipment.assignedBrokerId ? `Broker #${shipment.assignedBrokerId}` : 'Not Assigned';
  };

  const calculateTotalValue = (shipment) => {
    if (shipment.customsValue) {
      return shipment.customsValue;
    }
    // Calculate from products if available
    if (shipment.packages && shipment.packages.length > 0) {
      let total = 0;
      shipment.packages.forEach(pkg => {
        if (pkg.products && pkg.products.length > 0) {
          pkg.products.forEach(product => {
            total += (product.totalValue || 0);
          });
        }
      });
      return total > 0 ? total : 0;
    }
    return 0;
  };

  const toggleExpanded = (shipmentId) => {
    setExpandedShipmentId(expandedShipmentId === shipmentId ? null : shipmentId);
  };

  // Apply filters
  let filteredShipments = [...shipments];
  
  // Status filter
  if (statusFilter !== 'all') {
    if (statusFilter === 'ai-approved') {
      filteredShipments = filteredShipments.filter(s => s.aiApprovalStatus === 'approved');
    } else if (statusFilter === 'broker-approved') {
      filteredShipments = filteredShipments.filter(s => s.brokerApprovalStatus === 'approved');
    } else if (statusFilter === 'pending') {
      filteredShipments = filteredShipments.filter(s => 
        s.aiApprovalStatus === 'pending' || s.brokerApprovalStatus === 'pending'
      );
    } else if (statusFilter === 'documents-requested') {
      filteredShipments = filteredShipments.filter(s => 
        s.status === 'documents-requested' || s.brokerApprovalStatus === 'documents-requested'
      );
    } else if (statusFilter === 'documents-uploaded') {
      filteredShipments = filteredShipments.filter(s => 
        s.status === 'documents-uploaded'
      );
    } else if (statusFilter === 'paid') {
      filteredShipments = filteredShipments.filter(s => s.status === 'paid');
    }
  }

  // Broker filter
  if (brokerFilter !== 'all') {
    if (brokerFilter === 'assigned') {
      filteredShipments = filteredShipments.filter(s => s.assignedBrokerId);
    } else if (brokerFilter === 'unassigned') {
      filteredShipments = filteredShipments.filter(s => !s.assignedBrokerId);
    }
  }

  // Search filter
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    filteredShipments = filteredShipments.filter(s => 
      (s.referenceId && s.referenceId.toLowerCase().includes(query)) ||
      (s.id && s.id.toString().includes(query)) ||
      (s.title && s.title.toLowerCase().includes(query)) ||
      (s.shipper?.company && s.shipper.company.toLowerCase().includes(query)) ||
      (s.consignee?.company && s.consignee.company.toLowerCase().includes(query))
    );
  }

  return (
    <div style={{ background: '#FBF9F6', minHeight: '100vh', padding: 24 }}>
      <h1 className="mb-2" style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10, fontSize: '1.5rem' }}>
        <MapPin className="w-6 h-6" style={{ color: '#3A2B28' }} />
        <span>Shipment Tracking Overview</span>
      </h1>
      <p className="text-slate-600 mb-4">Complete list of all shipments with detailed information</p>
      
      {/* Filters */}
      <div className="mb-6 bg-white rounded-lg p-4 border-2" style={{ borderColor: '#3A2B28' }}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: '#2F1B17' }}>Search</label>
            <input
              type="text"
              placeholder="Search by reference, title, or company..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2"
              style={{ borderColor: '#EADFD8', background: '#FFFFFF' }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: '#2F1B17' }}>Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2"
              style={{ borderColor: '#EADFD8', background: '#FFFFFF', color: '#2F1B17' }}
            >
              <option value="all">All Status</option>
              <option value="ai-approved">AI Approved</option>
              <option value="broker-approved">Broker Approved</option>
              <option value="pending">Pending</option>
              <option value="documents-requested">Documents Requested</option>
              <option value="documents-uploaded">Documents Uploaded</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: '#2F1B17' }}>Broker Assignment</label>
            <select
              value={brokerFilter}
              onChange={(e) => setBrokerFilter(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2"
              style={{ borderColor: '#EADFD8', background: '#FFFFFF', color: '#2F1B17' }}
            >
              <option value="all">All </option>
              <option value="assigned">Assigned</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
        </div>
      </div>
      
      {loading ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <div className="inline-block">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
          </div>
          <p className="text-slate-600 mt-4">Loading shipments...</p>
        </div>
      ) : (
        <div className="space-y-3">
        {filteredShipments.map((shipment) => {
          const isExpanded = expandedShipmentId === shipment.id;
          const currencyCode = shipment.currency || 'USD';
          const currencySymbol = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'C$', INR: '₹', CNY: '¥', AUD: 'A$' }[currencyCode] || currencyCode;

          return (
            <div key={shipment.id} className="bg-white rounded-xl overflow-hidden border-2" style={{ borderColor: '#3A2B28' }}>
              {/* Main Row - Clickable */}
              <div
                onClick={() => toggleExpanded(shipment.id)}
                className="p-4 cursor-pointer hover:bg-slate-50 transition-colors"
                style={{ background: isExpanded ? '#F5F0ED' : 'white' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1">
                    <button className="p-1 hover:bg-slate-200 rounded">
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5" style={{ color: '#3A2B28' }} />
                      ) : (
                        <ChevronDown className="w-5 h-5" style={{ color: '#3A2B28' }} />
                      )}
                    </button>
                    
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#D4AFA0' }}>
                        <Package className="w-5 h-5" style={{ color: '#2F1B17' }} />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">Ref: {shipment.referenceId || `#${shipment.id}`}</p>
                        <p className="text-sm text-slate-700">{shipment.title || 'Untitled Shipment'}</p>
                        <p className="text-sm text-slate-600">
                          {shipment.shipper?.city || 'N/A'}, {shipment.shipper?.country || ''} → {shipment.consignee?.city || 'N/A'}, {shipment.consignee?.country || ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 ml-auto">
                      <div className="text-right hidden md:block">
                        <p className="text-xs text-slate-500">Mode</p>
                        <p className="text-sm font-medium text-slate-900">{shipment.mode || 'N/A'}</p>
                      </div>
                      <div className="text-right hidden lg:block">
                        <p className="text-xs text-slate-500">Broker</p>
                        <div className="flex items-center gap-1">
                          <User className="w-4 h-4 text-slate-700" />
                          <p className="text-sm font-medium text-slate-900">{getAssignedBroker(shipment)}</p>
                        </div>
                      </div>
                      <div className="text-right hidden lg:block">
                        <p className="text-xs text-slate-500">Status</p>
                        <p className="text-xs font-medium text-slate-700">{getStatusDisplay(shipment)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Expanded Details Section */}
              {isExpanded && (
                <div className="border-t-2" style={{ borderColor: '#E6B6A0' }}>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Shipper Details */}
                    <div className="space-y-4">
                      <div>
                        <h3 className="font-semibold text-slate-900 mb-4" style={{ color: '#2F1B17' }}>Shipper Details</h3>
                        <div className="space-y-3 bg-slate-50 p-4 rounded-lg">
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Company</p>
                            <p className="text-slate-900 font-medium">{shipment.shipper?.company || shipment.shipperName || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Contact Person</p>
                            <p className="text-slate-900">{shipment.shipper?.contactName || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Email</p>
                            <p className="text-slate-900">{shipment.shipper?.email || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Phone</p>
                            <p className="text-slate-900">{shipment.shipper?.phone || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Address</p>
                            <p className="text-slate-900">
                              {shipment.shipper?.address || 'N/A'}, {shipment.shipper?.city || ''}, {shipment.shipper?.state || ''} {shipment.shipper?.postalCode || ''}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Country</p>
                            <p className="text-slate-900">{shipment.shipper?.country || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Consignee Details */}
                    <div className="space-y-4">
                      <div>
                        <h3 className="font-semibold text-slate-900 mb-4" style={{ color: '#2F1B17' }}>Consignee Details</h3>
                        <div className="space-y-3 bg-slate-50 p-4 rounded-lg">
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Company</p>
                            <p className="text-slate-900 font-medium">{shipment.consignee?.company || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Contact Person</p>
                            <p className="text-slate-900">{shipment.consignee?.contactName || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Email</p>
                            <p className="text-slate-900">{shipment.consignee?.email || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Phone</p>
                            <p className="text-slate-900">{shipment.consignee?.phone || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Address</p>
                            <p className="text-slate-900">
                              {shipment.consignee?.address || 'N/A'}, {shipment.consignee?.city || ''}, {shipment.consignee?.state || ''} {shipment.consignee?.postalCode || ''}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Country</p>
                            <p className="text-slate-900">{shipment.consignee?.country || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Shipment Details */}
                    <div className="space-y-4">
                      <div>
                        <h3 className="font-semibold text-slate-900 mb-4" style={{ color: '#2F1B17' }}>Shipment Details</h3>
                        <div className="space-y-3 bg-slate-50 p-4 rounded-lg">
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Reference ID</p>
                            <p className="text-slate-900 font-mono">{shipment.referenceId || `#${shipment.id}`}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Shipment ID</p>
                            <p className="text-slate-900 font-mono">#{shipment.id}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Title</p>
                            <p className="text-slate-900">{shipment.title || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Mode</p>
                            <p className="text-slate-900">{shipment.mode || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Total Value</p>
                            <p className="text-slate-900 font-medium">{currencySymbol}{parseFloat(calculateTotalValue(shipment)).toLocaleString()} {currencyCode}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Service Level</p>
                            <p className="text-slate-900">{shipment.serviceLevel || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Destination</p>
                            <p className="text-slate-900">
                              {shipment.consignee?.city || 'N/A'}, {shipment.consignee?.country || 'N/A'}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Token</p>
                            <p className="text-slate-900 font-mono text-sm">{shipment.preclearToken || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-600 uppercase tracking-wide">Created Date</p>
                            <p className="text-slate-900">{shipment.createdAt ? new Date(shipment.createdAt).toLocaleDateString() : 'N/A'}</p>
                          </div>
                          <div className="pt-2">
                            <p className="text-xs text-slate-600 uppercase tracking-wide mb-2">Approval Status</p>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-700">AI Review:</span>
                                <span className={`px-2 py-1 rounded text-xs font-medium ${
                                  shipment.aiApprovalStatus === 'approved' ? 'bg-green-100 text-green-700' :
                                  shipment.aiApprovalStatus === 'rejected' ? 'bg-red-100 text-red-700' :
                                  'bg-yellow-100 text-yellow-700'
                                }`}>
                                  {shipment.aiApprovalStatus === 'approved' ? 'Approved' :
                                   shipment.aiApprovalStatus === 'rejected' ? 'Rejected' : 'Pending'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-700">Broker Review:</span>
                                <span className={`px-2 py-1 rounded text-xs font-medium ${
                                  shipment.brokerApprovalStatus === 'approved' ? 'bg-green-100 text-green-700' :
                                  shipment.brokerApprovalStatus === 'documents-requested' ? 'bg-blue-100 text-blue-700' :
                                  shipment.brokerApprovalStatus === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-slate-100 text-slate-700'
                                }`}>
                                  {shipment.brokerApprovalStatus === 'approved' ? 'Approved' :
                                   shipment.brokerApprovalStatus === 'documents-requested' ? 'Docs Requested' :
                                   shipment.brokerApprovalStatus === 'pending' ? 'Pending' : 'Not Started'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-700">Status:</span>
                                <span className={`px-2 py-1 rounded text-xs font-medium ${
                                  shipment.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                                }`}>
                                  {shipment.status}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filteredShipments.length === 0 && (
          <div className="bg-white rounded-xl p-8 text-center">
            <Package className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-600">{searchQuery || statusFilter !== 'all' || brokerFilter !== 'all' ? 'No shipments match your filters' : 'No shipments found'}</p>
          </div>
        )}
        </div>
      )}
    </div>
  );
}

