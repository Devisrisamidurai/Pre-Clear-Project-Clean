import { PackagePlus, Package, Clock, CheckCircle, XCircle, AlertTriangle, TrendingUp, Upload, DollarSign, Eye, Edit, Filter, MessageSquare } from 'lucide-react';
import { ShipmentChatPanel } from '../ShipmentChatPanel';
import { NotificationPanel } from '../NotificationPanel';
import { shipmentsStore, createDefaultShipment } from '../../store/shipmentsStore';
import { useState } from 'react';
import { useShipments } from '../../hooks/useShipments';
import { getCurrencyByCountry, formatCurrency } from '../../utils/validation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';


export function ShipperDashboard({ onNavigate }) {
  const { shipments: allShipments } = useShipments();
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewingDocuments, setViewingDocuments] = useState(null);
  const [selectedShipmentForChat, setSelectedShipmentForChat] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  
  // Exclude paid shipments from all categories
  const activeShipments = allShipments.filter(s => 
    s.status !== 'paid' && s.Status !== 'paid' && s.paymentStatus !== 'completed'
  );
  
  // Categorize shipments
  const pendingReview = activeShipments.filter(s => 
    s.status === 'draft' || 
    s.status === 'documents-uploaded' || 
    s.status === 'document-requested'
  );
  
  const documentsRequested = activeShipments.filter(s => 
    s.status === 'documents-requested' || 
    s.brokerApproval === 'documents-requested'
  );
  
  const documentsUploaded = activeShipments.filter(s => 
    s.status === 'documents-uploaded'
  );
  
  const inReview = activeShipments.filter(s => 
    s.status === 'awaiting-ai' || 
    s.status === 'awaiting-broker' ||
    (s.aiApproval === 'pending' || s.brokerApproval === 'pending')
  );
  
  const cleared = activeShipments.filter(s => 
    s.status === 'token-generated' || 
    (s.aiApproval === 'approved' && s.brokerApproval === 'approved')
  );
  
  const cancelled = activeShipments.filter(s => s.status === 'cancelled');
  
  // Filter shipments based on selected status
  const getFilteredShipments = () => {
    if (filterStatus === 'all') return activeShipments;
    if (filterStatus === 'pending') return pendingReview;
    if (filterStatus === 'documents-requested') return documentsRequested;
    if (filterStatus === 'documents-uploaded') return documentsUploaded;
    if (filterStatus === 'review') return inReview;
    if (filterStatus === 'cleared') return cleared;
    if (filterStatus === 'cancelled') return cancelled;
    return activeShipments;
  };
  
  let filteredShipments = getFilteredShipments();

  // Apply search filter
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    filteredShipments = filteredShipments.filter(s => 
      (s.referenceId && s.referenceId.toLowerCase().includes(query)) ||
      (s.id && s.id.toString().includes(query)) ||
      (s.title && s.title.toLowerCase().includes(query)) ||
      (s.productName && s.productName.toLowerCase().includes(query)) ||
      (s.shipper?.company && s.shipper.company.toLowerCase().includes(query)) ||
      (s.shipperName && s.shipperName.toLowerCase().includes(query))
    );
  }

  const getStatusBadge = (shipment) => {
    if (shipment.status === 'cancelled') {
      return (
        <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-sm flex items-center gap-1">
          <XCircle className="w-3 h-3" />
          Cancelled
        </span>
      );
    }
    if (shipment.status === 'documents-requested' || shipment.brokerApproval === 'documents-requested') {
      return (
        <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Documents Requested
        </span>
      );
    }
    if (shipment.status === 'documents-uploaded') {
      return (
        <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm flex items-center gap-1">
          <Upload className="w-3 h-3" />
          Documents Uploaded
        </span>
      );
    }
    if (shipment.token && shipment.status === 'token-generated') {
      return (
        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm flex items-center gap-1">
          <CheckCircle className="w-3 h-3" />
          Cleared
        </span>
      );
    }
    if (shipment.aiApproval === 'approved' && shipment.brokerApproval === 'approved') {
      return (
        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm flex items-center gap-1">
          <CheckCircle className="w-3 h-3" />
          Cleared
        </span>
      );
    }
    if (shipment.status === 'awaiting-broker' || shipment.brokerApproval === 'pending') {
      return (
        <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Broker Review
        </span>
      );
    }
    if (shipment.status === 'awaiting-ai' || shipment.aiApproval === 'pending') {
      return (
        <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm flex items-center gap-1">
          <Clock className="w-3 h-3" />
          AI Processing
        </span>
      );
    }
    if (shipment.aiApproval === 'rejected' || shipment.brokerApproval === 'rejected') {
      return (
        <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm flex items-center gap-1">
          <XCircle className="w-3 h-3" />
          Rejected
        </span>
      );
    }
    return (
      <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm flex items-center gap-1">
        <Clock className="w-3 h-3" />
        Pending Review
      </span>
    );
  };

  const getActionButton = (shipment) => {
    if (shipment.status === 'cancelled') return null;

    const hasUploadedDocuments = shipment.uploadedDocuments && Object.keys(shipment.uploadedDocuments).length > 0;
    const aiApproved = shipment.aiApproval === 'approved';
    const brokerApproved = shipment.brokerApproval === 'approved';
    const hasToken = shipment.token && shipment.token !== '';

    // Draft / Documents requested: show View + Upload/Uploaded
    if (shipment.status === 'draft' || shipment.status === 'documents-requested' || shipment.brokerApproval === 'documents-requested') {
      return (
        <div className="flex gap-2">
          <button
            onClick={() => {
              const latest = allShipments.find(s => s.id === shipment.id) || shipment;
              console.log('[ShipperDashboard] View button clicked (draft/doc-requested) for shipment:', latest);
              console.log('[ShipperDashboard] - Shipment numeric ID:', latest.id);
              console.log('[ShipperDashboard] - Shipment reference ID:', latest.referenceId);
              onNavigate('shipment-details', latest);
            }}
            className="px-3 py-1.5 bg-yellow-500 text-yellow-900 rounded-lg hover:bg-yellow-600 hover:shadow-md transition-all text-sm flex items-center gap-1"
            title="View shipment details"
          >
            <Eye className="w-3.5 h-3.5" />
            View
          </button>
        </div>
      );
    }

    // Both approvals complete but no token yet: show Generate Token
    if (aiApproved && brokerApproved && !hasToken) {
      return (
        <div className="flex gap-2">
          <button
            onClick={() => {
              const latest = allShipments.find(s => s.id === shipment.id) || shipment;
              console.log('[ShipperDashboard] View button clicked (approvals complete) for shipment:', latest);
              console.log('[ShipperDashboard] - Shipment numeric ID:', latest.id);
              console.log('[ShipperDashboard] - Shipment reference ID:', latest.referenceId);
              onNavigate('shipment-details', latest);
            }}
            className="px-3 py-1.5 bg-yellow-500 text-yellow-900 rounded-lg hover:bg-yellow-600 hover:shadow-md transition-all text-sm flex items-center gap-1"
            title="View shipment details"
          >
            <Eye className="w-3.5 h-3.5" />
            View
          </button>
          <button
            onClick={() => {
              const latest = allShipments.find(s => s.id === shipment.id) || shipment;
              onNavigate('generate-token', latest);
            }}
            className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-1"
            title="Generate Pre-Clear Token"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            Generate Token
          </button>
        </div>
      );
    }

    // Token generated but payment not completed: show Pay Now (no $ symbol for multi-currency)
    if (hasToken && !shipment.paymentStatus) {
      return (
        <button
          onClick={() => onNavigate('payment', shipment)}
          className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm flex items-center gap-1"
          title="Proceed to payment"
        >
          Pay Now
        </button>
      );
    }

    // Default: just View details
    return (
      <div className="flex gap-2">
        <button
          onClick={() => {
            const latest = allShipments.find(s => s.id === shipment.id) || shipment;
            console.log('[ShipperDashboard] View button clicked (default) for shipment:', latest);
            console.log('[ShipperDashboard] - Shipment numeric ID:', latest.id);
            console.log('[ShipperDashboard] - Shipment reference ID:', latest.referenceId);
            onNavigate('shipment-details', latest);
          }}
          className="px-3 py-1.5 bg-yellow-500 text-yellow-900 rounded-lg hover:bg-yellow-600 hover:shadow-md transition-all text-sm flex items-center gap-1"
          title="View shipment details"
        >
          <Eye className="w-3.5 h-3.5" />
          View
        </button>
      </div>
    );
  };

  const UnifiedShipmentTable = ({ shipments }) => {
    if (shipments.length === 0) {
      return (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-8 text-center">
            <Package className="w-12 h-12 mx-auto mb-4 text-slate-400" />
            <p className="text-slate-500 text-base">No shipments found</p>
            <p className="text-slate-500 text-sm mt-1">Try adjusting your filters or create a new shipment</p>
          </div>
      );
    }

    return (
      <div className="bg-white rounded-lg overflow-hidden" style={{ border: '2px solid #3A2B28' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: '#D4AFA0' }}>
                <th className="p-4 text-left font-semibold text-sm" style={{ color: '#2F1B17', width: '10%' }}>Reference ID</th>
                <th className="p-4 text-left font-semibold text-sm" style={{ color: '#2F1B17', width: '12%' }}>Title</th>
                <th className="p-4 text-left font-semibold text-sm" style={{ color: '#2F1B17', width: '14%' }}>Origin → Destination</th>
                <th className="p-4 text-left font-semibold text-sm" style={{ color: '#2F1B17', width: '11%' }}>Value</th>
                <th className="p-4 text-left font-semibold text-sm" style={{ color: '#2F1B17', width: '11%' }}>AI Score</th>
                <th className="p-4 text-left font-semibold text-sm" style={{ color: '#2F1B17', width: '13%' }}>Status</th>
                <th className="p-4 text-left font-semibold text-sm" style={{ color: '#2F1B17', width: '12%' }}>Date Created</th>
                <th className="p-4 text-right font-semibold text-sm" style={{ color: '#2F1B17', width: '17%' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
                {shipments.map((shipment, index) => {
                // prefer explicit shipment.currency, otherwise infer from shipper country
                const currency = shipment.currency ? { symbol: (getCurrencyByCountry(shipment.currency) || {}).symbol || '$', code: shipment.currency } : getCurrencyByCountry(shipment.shipper?.country || 'US');
                const aiScore = shipment.aiScore || 0;
                const isEvenRow = index % 2 === 0;

                return (
                  <tr key={shipment.id} className={`${isEvenRow ? 'bg-white' : 'bg-slate-50'} hover:bg-slate-100` }>
                    <td className="p-4 text-slate-900 font-semibold text-sm">{shipment.referenceId || `#${shipment.id}`}</td>
                    <td className="p-4 text-slate-900 text-sm">
                      <div className="max-w-[150px] truncate">{shipment.title || shipment.productName}</div>
                    </td>
                    <td className="p-4 text-slate-900 text-sm">
                      <div className="text-sm"><strong>{shipment.shipper?.city || shipment.shipper?.company || ''}</strong> → <strong>{shipment.consignee?.city || shipment.consignee?.company || ''}</strong></div>
                      <div className="text-xs text-slate-500 mt-1">{shipment.mode || ''} • {shipment.shipmentType || ''}</div>
                    </td>
                    <td className="p-4 text-slate-900 font-medium text-sm">{shipment.value != null ? formatCurrency(shipment.value, shipment.currency || currency.code) : ''}</td>
                    <td className="p-4">
                      {aiScore != null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className={`${aiScore >= 85 ? 'bg-green-500' : aiScore >= 70 ? 'bg-amber-500' : 'bg-red-500'} h-full`}
                              style={{ width: `${aiScore}%` }}
                            />
                          </div>
                          <span className={`${aiScore >= 85 ? 'text-green-700' : aiScore >= 70 ? 'text-amber-700' : 'text-red-700'} text-sm font-semibold`}>{aiScore}%</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-sm"></span>
                      )}
                    </td>
                    <td className="p-4">{getStatusBadge(shipment)}</td>
                    <td className="p-4 text-slate-600 text-sm">{new Date(shipment.createdAt).toLocaleDateString()}</td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {getActionButton(shipment)}
                        <button
                          onClick={() => { setSelectedShipmentForChat(shipment.id); setChatOpen(true); }}
                          disabled={!shipment.assignedBrokerId}
                          className="px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 disabled:opacity-60"
                          style={{ background: '#FFF4DC', color: '#2F1B17', border: '2px solid #E6B800' }}
                          title={shipment.assignedBrokerId ? 'Open chat' : 'Chat available after broker assignment'}
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-cream-50 min-h-screen p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-yellow-900 text-3xl font-bold mb-2">Shipper Dashboard</h1>
        <p className="text-slate-600 text-base opacity-80">Manage your shipments and track pre-clearance approvals</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl p-5 border border-slate-200 transition-all hover:shadow-lg cursor-pointer">
          <div className="flex items-center justify-between mb-3">
            <p className="text-slate-600 text-sm font-medium opacity-80">Pending Review</p>
            <Clock className="text-yellow-500 w-5 h-5" />
          </div>
          <p className="text-yellow-900 text-3xl font-bold">{pendingReview.length}</p>
        </div>
        
        <div className="bg-white rounded-xl p-5 border border-slate-200 transition-all hover:shadow-lg cursor-pointer">
          <div className="flex items-center justify-between mb-3">
            <p className="text-slate-600 text-sm font-medium opacity-80">In Review</p>
            <TrendingUp className="text-blue-500 w-5 h-5" />
          </div>
          <p className="text-yellow-900 text-3xl font-bold">{inReview.length}</p>
        </div>
        
        <div className="bg-white rounded-xl p-5 border border-slate-200 transition-all hover:shadow-lg cursor-pointer">
          <div className="flex items-center justify-between mb-3">
            <p className="text-slate-600 text-sm font-medium opacity-80">Cleared</p>
            <CheckCircle className="text-green-500 w-5 h-5" />
          </div>
          <p className="text-yellow-900 text-3xl font-bold">{cleared.length}</p>
        </div>
        
        <div className="bg-white rounded-xl p-5 border border-slate-200 transition-all hover:shadow-lg cursor-pointer">
          <div className="flex items-center justify-between mb-3">
            <p className="text-slate-600 text-sm font-medium opacity-80">Cancelled</p>
            <XCircle className="text-gray-500 w-5 h-5" />
          </div>
          <p className="text-yellow-900 text-3xl font-bold">{cancelled.length}</p>
        </div>
      </div>

      {/* Search and Filter Controls */}
      <div className="mb-6 space-y-4">
        {/* Search Bar */}
        <div className="bg-white rounded-lg p-4 border-2" style={{ borderColor: '#3A2B28' }}>
          <label className="block text-sm font-medium mb-2" style={{ color: '#2F1B17' }}>Search Shipments</label>
          <input
            type="text"
            placeholder="Search by reference ID, title, or shipper..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2"
            style={{ borderColor: '#EADFD8', background: '#FFFFFF' }}
          />
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center gap-3 flex-wrap">
          {[
            { label: 'All Shipments', value: 'all' },
            { label: 'Pending Review', value: 'pending' },
            { label: 'Docs Requested', value: 'documents-requested' },
            { label: 'Docs Uploaded', value: 'documents-uploaded' },
            { label: 'In Review', value: 'review' },
            { label: 'Cleared', value: 'cleared' },
            { label: 'Cancelled', value: 'cancelled' }
          ].map(filter => (
            <button
              key={filter.value}
              onClick={() => setFilterStatus(filter.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                filterStatus === filter.value 
                  ? 'bg-yellow-500 text-yellow-900' 
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
            {filter.label}
          </button>
        ))}
        </div>
      </div>

      {/* Unified Shipments Table */}
      <div>
        <h2 className="text-yellow-900 text-lg font-bold mb-4">
          {filterStatus === 'all' ? 'All Shipments' : 
           filterStatus === 'pending' ? 'Pending Review' : 
           filterStatus === 'documents-requested' ? 'Documents Requested' : 
           filterStatus === 'documents-uploaded' ? 'Documents Uploaded' : 
           filterStatus === 'review' ? 'In Review' : 
           filterStatus === 'cleared' ? 'Cleared' : 
           'Cancelled'} ({filteredShipments.length})
        </h2>
        <UnifiedShipmentTable shipments={filteredShipments} />
      </div>

      {/* Documents Viewer Modal */}
      {viewingDocuments && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-slate-900 text-lg font-semibold">Documents - Shipment #{viewingDocuments.id}</h3>
              <button onClick={() => setViewingDocuments(null)} className="text-slate-500 hover:text-slate-700">✕</button>
            </div>

            <div className="space-y-4 max-h-96 overflow-y-auto">
              {/* Form Documents */}
              {viewingDocuments.uploadedDocuments && Object.values(viewingDocuments.uploadedDocuments).filter(d => d.source === 'form').length > 0 && (
                <div>
                  <h4 className="font-semibold text-slate-900 mb-2 text-sm">Documents from Form</h4>
                  <div className="space-y-2">
                    {Object.entries(viewingDocuments.uploadedDocuments)
                      .filter(([_, doc]) => doc.source === 'form')
                      .map(([key, doc]) => (
                        <div key={key} className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                          <div className="flex items-center gap-3">
                            <FileText className="w-4 h-4 text-green-600" />
                            <div>
                              <p className="text-sm text-slate-900">{doc.name || key}</p>
                              {doc.fileName && <p className="text-xs text-slate-500">File: {doc.fileName}</p>}
                            </div>
                          </div>
                          <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">Form</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Chat Documents */}
              {viewingDocuments.uploadedDocuments && Object.values(viewingDocuments.uploadedDocuments).filter(d => !d.source || d.source !== 'form').length > 0 && (
                <div>
                  <h4 className="font-semibold text-slate-900 mb-2 text-sm">Documents from Chat</h4>
                  <div className="space-y-2">
                    {Object.entries(viewingDocuments.uploadedDocuments)
                      .filter(([_, doc]) => !doc.source || doc.source !== 'form')
                      .map(([key, doc]) => (
                        <div key={key} className="flex items-center justify-between p-3 bg-purple-50 border border-purple-200 rounded-lg">
                          <div className="flex items-center gap-3">
                            <FileText className="w-4 h-4 text-purple-600" />
                            <div>
                              <p className="text-sm text-slate-900">{doc.name || key}</p>
                              {doc.uploadedAt && <p className="text-xs text-slate-500">Uploaded: {new Date(doc.uploadedAt).toLocaleDateString()}</p>}
                            </div>
                          </div>
                          <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full">Chat</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {!viewingDocuments.uploadedDocuments || Object.keys(viewingDocuments.uploadedDocuments).length === 0 && (
                <p className="text-slate-600 text-center py-8">No documents uploaded yet</p>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setViewingDocuments(null)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat Panel */}
      {selectedShipmentForChat && (
        <ShipmentChatPanel
          shipmentId={selectedShipmentForChat}
          isOpen={chatOpen}
          onClose={() => { setChatOpen(false); setSelectedShipmentForChat(null); }}
          userRole="shipper"
          userName="Shipper"
        />
      )}
    </div>
  );
}