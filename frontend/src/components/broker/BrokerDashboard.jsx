import { 
  Clock, 
  CheckCircle, 
  FileText, 
  AlertTriangle, 
  TrendingUp, 
  MessageCircle, 
  RefreshCw, 
  Eye,
  Zap
} from 'lucide-react';
import { ShipmentChatPanel } from '../ShipmentChatPanel';
import { shipmentsStore } from '../../store/shipmentsStore';
import { useState, useEffect } from 'react';
import { useShipments } from '../../hooks/useShipments';
import { getCurrencyByCountry } from '../../utils/validation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

export function BrokerDashboard({ onNavigate }) {
  const { shipments = [] } = useShipments();
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Filter out completed shipments (paid, broker-approved, or token-generated) and draft shipments for the working table
  let activeShipments = shipments.filter(s => 
    s.status !== 'paid' && 
    s.status !== 'token-generated' && 
    s.status !== 'draft' &&
    s.brokerApproval !== 'approved'
  );

  // Apply status filter
  if (statusFilter !== 'all') {
    if (statusFilter === 'pending-review') {
      activeShipments = activeShipments.filter(s => 
        s.aiApproval === 'approved' && 
        (s.brokerApproval === 'pending' || s.brokerApproval === 'not-started')
      );
    } else if (statusFilter === 'new-submissions') {
      activeShipments = activeShipments.filter(s => 
        s.status === 'documents-uploaded' || s.status === 'awaiting-ai'
      );
    } else if (statusFilter === 'documents-requested') {
      activeShipments = activeShipments.filter(s => 
        s.status === 'documents-requested' || s.brokerApproval === 'documents-requested'
      );
    } else if (statusFilter === 'documents-uploaded') {
      activeShipments = activeShipments.filter(s => 
        s.status === 'documents-uploaded'
      );
    } else if (statusFilter === 'docs-requested') {
      activeShipments = activeShipments.filter(s => 
        s.status === 'document-requested' || s.brokerApproval === 'documents-requested'
      );
    } else if (statusFilter === 'docs-resubmitted') {
      activeShipments = activeShipments.filter(s => 
        s.status === 'awaiting-broker' && s.brokerApproval === 'documents-requested'
      );
    }
  }

  // Apply search filter
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    activeShipments = activeShipments.filter(s => 
      (s.referenceId && s.referenceId.toLowerCase().includes(query)) ||
      (s.id && s.id.toString().includes(query)) ||
      (s.title && s.title.toLowerCase().includes(query)) ||
      (s.productName && s.productName.toLowerCase().includes(query)) ||
      (s.shipper?.company && s.shipper.company.toLowerCase().includes(query)) ||
      (s.shipperName && s.shipperName.toLowerCase().includes(query))
    );
  }

  // Counts use the full dataset for accuracy (excluding drafts)
  const nonDraftShipments = shipments.filter(s => s.status !== 'draft');
  const pendingShipments = nonDraftShipments.filter(s =>
    s.aiApproval === 'approved' &&
    (s.brokerApproval === 'pending' || s.brokerApproval === 'not-started')
  );
  const newShipments = nonDraftShipments.filter(s =>
    s.status === 'documents-uploaded' || s.status === 'awaiting-ai'
  );
  const documentsRequested = nonDraftShipments.filter(s => s.status === 'document-requested' || s.brokerApproval === 'documents-requested');
  const documentsResubmitted = nonDraftShipments.filter(s =>
    s.status === 'awaiting-broker' && s.brokerApproval === 'documents-requested'
  );

  // Chat state
  const [selectedShipmentForChat, setSelectedShipmentForChat] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);

  // Notifications removed from dashboard header per user request

  const todayStr = new Date().toDateString();
  const approvedToday = (shipments || []).filter(s =>
    s.brokerApproval === 'approved' &&
    s.updatedAt &&
    new Date(s.updatedAt).toDateString() === todayStr
  ).length;

  const handleOpenChat = (shipmentId) => {
    setSelectedShipmentForChat(shipmentId);
    setChatOpen(true);
  };

  const getStatusBadge = (shipment) => {
    if (shipment.status === 'documents-requested' || shipment.brokerApproval === 'documents-requested') {
      return <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm">Documents Requested</span>;
    }
    if (shipment.status === 'documents-uploaded') {
      return <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Documents Uploaded</span>;
    }
    if (shipment.status === 'awaiting-broker' && shipment.brokerApproval === 'documents-requested') {
      return <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Documents Resubmitted</span>;
    }
    if (shipment.aiApproval === 'approved' && shipment.brokerApproval === 'pending') {
      return <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm">Pending Review</span>;
    }
    if (shipment.status === 'awaiting-ai') {
      return <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">New - Awaiting AI</span>;
    }
    return <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-sm">{shipment.status}</span>;
  };

  // Unified table component that lists all shipments
  const UnifiedShipmentTable = ({ shipmentsList }) => {
    if (!shipmentsList || shipmentsList.length === 0) {
      return (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-center">
          <p className="text-slate-600">No shipments to show.</p>
        </div>
      );
    }

    return (
      <div className="bg-white rounded-lg overflow-hidden" style={{ border: '2px solid #3A2B28' }}>
        <Table>
          <TableHeader>
            <TableRow style={{ background: '#D4AFA0' }}>
              <TableHead style={{ width: '12%', color: '#2F1B17', fontWeight: '600' }}>Reference ID</TableHead>
              <TableHead style={{ width: '12%', color: '#2F1B17', fontWeight: '600' }}>Title</TableHead>
              <TableHead style={{ width: '14%', color: '#2F1B17', fontWeight: '600' }}>Route</TableHead>
              <TableHead style={{ width: '12%', color: '#2F1B17', fontWeight: '600' }}>Shipper</TableHead>
              <TableHead style={{ width: '12%', color: '#2F1B17', fontWeight: '600' }}>Value</TableHead>
              <TableHead style={{ width: '12%', color: '#2F1B17', fontWeight: '600' }}>AI Score</TableHead>
              <TableHead style={{ width: '12%', color: '#2F1B17', fontWeight: '600' }}>Status</TableHead>
              <TableHead style={{ width: '10%', textAlign: 'right', color: '#2F1B17', fontWeight: '600' }}>Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {shipmentsList.map((shipment) => {
              const aiScore = shipment.aiScore || 0;
              const currencyCode = shipment.currency || 'USD';
              const currencySymbol = { 
                USD: '$', 
                EUR: '€', 
                GBP: '£', 
                JPY: '¥', 
                CAD: 'C$', 
                INR: '₹',
                CNY: '¥',
                AUD: 'A$'
              }[currencyCode] || currencyCode;

              return (
                <TableRow key={shipment.id} className="hover:bg-slate-50">
                  <TableCell><span className="text-slate-900">{shipment.referenceId || `#${shipment.id}`}</span></TableCell>
                  <TableCell><span className="text-slate-900">{shipment.title || shipment.productName}</span></TableCell>
                  <TableCell><span className="text-slate-900 text-sm">{shipment.shipper?.city || shipment.shipperName || 'N/A'}, {shipment.shipper?.country || ''} → {shipment.consignee?.city || 'N/A'}, {shipment.consignee?.country || ''}</span></TableCell>
                  <TableCell><span className="text-slate-900">{shipment.shipper?.company || shipment.shipperName || 'N/A'}</span></TableCell>
                  <TableCell><span className="text-slate-900">{currencySymbol}{parseFloat(shipment.value).toLocaleString()} {currencyCode}</span></TableCell>

                  <TableCell>
                    {aiScore > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${aiScore >= 80 ? 'bg-green-500' : aiScore >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${aiScore}%` }}
                          />
                        </div>
                        <span className={`text-sm ${aiScore >= 80 ? 'text-green-700' : aiScore >= 60 ? 'text-amber-700' : 'text-red-700'}`}>{aiScore}%</span>
                      </div>
                    ) : <span className="text-slate-400 text-sm">-</span>}
                  </TableCell>

                  <TableCell>{getStatusBadge(shipment)}</TableCell>

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* REVIEW button - light coffee brown with white text */}
                      <button
                        onClick={() => onNavigate('broker-review', shipment)}
                        className="px-3 py-1.5 rounded-lg text-sm flex items-center gap-1"
                        style={{ background: '#7A5B52', color: '#ffffff' }}
                      >
                        <Eye className="w-3.5 h-3.5 text-white" />
                        Review
                      </button>

                      {/* CHAT button - also yellow outline */}
                      <button
                        onClick={() => handleOpenChat(shipment.id)}
                        className="px-3 py-1.5 rounded-lg text-sm flex items-center gap-1"
                        style={{ background: '#FFF4DC', color: '#2F1B17', border: '2px solid #E6B800' }}
                        title="Open chat"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  };

  // Use activeShipments array as the single combined table source
  const allShipments = activeShipments;

  return (
    <div style={{ background: '#FBF9F6', minHeight: '100vh', paddingBottom: 48 }}>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[#2F1B17] mb-2 text-2xl font-semibold">Broker Dashboard</h1>
          <p className="text-[#7A5B52]">Review and approve shipments pending broker verification</p>
        </div>

        {/* notifications removed */}
      </div>

      {/* Stats (kept as quick overview) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 px-0">
        <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-orange-50 rounded-xl flex items-center justify-center">
              <Clock className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <p className="text-slate-500 text-sm">Pending Review</p>
              <p className="text-slate-900 text-2xl font-semibold">{pendingShipments.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
              <FileText className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-slate-500 text-sm">New Submissions</p>
              <p className="text-slate-900 text-2xl font-semibold">{newShipments.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <p className="text-slate-500 text-sm">Docs Requested</p>
              <p className="text-slate-900 text-2xl font-semibold">{documentsRequested.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-slate-500 text-sm">Approved Today</p>
              <p className="text-slate-900 text-2xl font-semibold">{approvedToday}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Unified table showing all shipments */}
      <div className="mb-8">
        <div className="mb-4">
          <h2 className="text-[#2F1B17]">All Shipments</h2>
          <p className="text-[#7A5B52] text-sm">Combined list of all shipments</p>
        </div>

        {/* Filters */}
        <div className="mb-4 bg-white rounded-lg p-4 border-2" style={{ borderColor: '#3A2B28' }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: '#2F1B17' }}>Search</label>
              <input
                type="text"
                placeholder="Search by reference ID, title, or shipper..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2"
                style={{ borderColor: '#EADFD8', background: '#FFFFFF' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: '#2F1B17' }}>Filter by Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2"
                style={{ borderColor: '#EADFD8', background: '#FFFFFF', color: '#2F1B17' }}
              >
                <option value="all">All Shipments</option>
                <option value="pending-review">Pending Review</option>
                <option value="new-submissions">New Submissions</option>
                <option value="documents-requested">Documents Requested</option>
                <option value="documents-uploaded">Documents Uploaded</option>
              </select>
            </div>
          </div>
        </div>

        <UnifiedShipmentTable shipmentsList={allShipments} />
      </div>

      {/* Empty state when no shipments */}
      {(!allShipments || allShipments.length === 0) && (
        <div className="bg-white rounded-xl p-12 text-center border border-slate-200">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h3 className="text-slate-900 mb-2">All Caught Up!</h3>
          <p className="text-slate-500">No shipments available right now.</p>
        </div>
      )}

      {/* Chat Panel */}
      {selectedShipmentForChat && (
        <ShipmentChatPanel
          shipmentId={selectedShipmentForChat}
          isOpen={chatOpen}
          onClose={() => {
            setChatOpen(false);
            setSelectedShipmentForChat(null);
          }}
          userRole="broker"
          userName="Customs Broker"
        />
      )}
    </div>
  );
}

export default BrokerDashboard;
