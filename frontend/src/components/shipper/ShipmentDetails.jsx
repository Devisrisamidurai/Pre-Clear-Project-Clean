import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { 
  Package, 
  Calendar, 
  DollarSign, 
  Upload, 
  FileText, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Zap, 
  UserCheck, 
  Shield, 
  Clock, 
  ArrowRight,
  MessageCircle,
  Loader,
  TrendingUp,
  Box,
  RefreshCw,
  Send,
  Trash2,
  Pencil,
  Download,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { useShipments } from '../../hooks/useShipments';
import { getShipmentById, pollShipmentStatus, submitAi, updateShipmentStatus as apiUpdateShipmentStatus, generateToken as apiGenerateToken, assignBroker, deleteShipment } from '../../api/shipments';
import http, { getAuthToken } from '../../api/http';
import { uploadShipmentDocument, listShipmentDocuments, downloadShipmentDocument, getDocumentRequests } from '../../api/documents';
import { ShipmentChatPanel } from '../ShipmentChatPanel';
import { shipmentsStore } from '../../store/shipmentsStore';
import { getCurrencyByCountry, formatCurrency } from '../../utils/validation';
// ShipmentDocumentsPanel removed per new flow; documents now listed read-only above AI section

// Helper function to format time to 12-hour format with AM/PM
const formatTimeWithAmPm = (timeString) => {
  if (!timeString) return 'N/A';
  const [hours, minutes] = timeString.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

export function ShipmentDetails({ shipment, onNavigate, loadingOverride = false, errorOverride = null }) {
  const { id: routeId } = useParams();

  if (!routeId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6">
        <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-slate-900 mb-2">Invalid Route</h2>
        <p className="text-slate-600">Shipment ID is missing from the URL.</p>
      </div>
    );
  }

  const { updateShipmentStatus, updateAIApproval, requestBrokerApproval, uploadDocument } = useShipments();
  const [currentShipment, setCurrentShipment] = useState(null);
  const [isLoading, setIsLoading] = useState(!!loadingOverride);
  const [error, setError] = useState(errorOverride);
  const [chatOpen, setChatOpen] = useState(false);
  const [showBrokerAlert, setShowBrokerAlert] = useState(false);
  const [viewingDocument, setViewingDocument] = useState(null);
  const [s3Docs, setS3Docs] = useState([]);
  const [viewerUrl, setViewerUrl] = useState(null);
  const [uploadingDocKey, setUploadingDocKey] = useState(null);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [requestingBroker, setRequestingBroker] = useState(false);
  const [showTokenNotification, setShowTokenNotification] = useState(false);
  const [resubmittingToBroker, setResubmittingToBroker] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [reuploadingDocId, setReuploadingDocId] = useState(null);
  const [uploadingAdditionalDoc, setUploadingAdditionalDoc] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [deletingDocId, setDeletingDocId] = useState(null);
  const [documentRequests, setDocumentRequests] = useState([]);
  const [loadingDocumentRequests, setLoadingDocumentRequests] = useState(false);
  
  // Initialize from props and set loading state
  // Sync loading/error overrides from parent route
  useEffect(() => {
    setIsLoading(!!loadingOverride);
  }, [loadingOverride]);

  useEffect(() => {
    if (errorOverride) {
      setError(errorOverride);
    }
  }, [errorOverride]);

  // Initialize shipment by fetching from backend (DB is source of truth)
  useEffect(() => {
    if (loadingOverride) return;
    let cancelled = false;

    const init = async () => {
      try {
        setIsLoading(true);
        setError(null);
        if (routeId) {
          const data = await getShipmentById(routeId);
          // API returns normalized shipment; use it directly
          if (!cancelled) {
            console.log('[ShipmentDetails] Loaded shipment data:', data);
            console.log('[ShipmentDetails] Shipper data:', data?.shipper);
            console.log('[ShipmentDetails] Shipper company:', data?.shipper?.company);
            console.log('[ShipmentDetails] Shipper contactName:', data?.shipper?.contactName);
            console.log('[ShipmentDetails] Shipper email:', data?.shipper?.email);
            console.log('[ShipmentDetails] Shipper phone:', data?.shipper?.phone);
            setCurrentShipment(data);
            setIsLoading(false);
          }
        } else {
          if (!cancelled) {
            setCurrentShipment(null);
            setIsLoading(false);
            setError('Shipment ID not found');
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load shipment');
          setIsLoading(false);
        }
      }
    };

    init();
    return () => { cancelled = true; };
  }, [routeId, loadingOverride]);
    // Load S3 documents list for viewer mapping
    useEffect(() => {
      const loadDocs = async () => {
        if (!currentShipment?.id) return;
        try {
          const docs = await listShipmentDocuments(currentShipment.id);
          setS3Docs(Array.isArray(docs) ? docs : []);
        } catch (e) {
          console.warn('[ShipmentDetails] Failed to list shipment documents:', e);
          setS3Docs([]);
        }
      };
      loadDocs();
    }, [currentShipment?.id]);

    // Resolve and preview the selected document inside modal
    useEffect(() => {
      let revoked = false;
      const resolveAndLoad = async () => {
        if (!viewingDocument || !currentShipment?.id) return;
        try {
          const match = s3Docs.find(d => {
            if (viewingDocument.id) return d.id === viewingDocument.id;
            if (d.fileName && viewingDocument.name && d.fileName === viewingDocument.name) return true;
            if (d.documentType && viewingDocument.name && d.documentType === viewingDocument.name) return true;
            return false;
          });
          if (!match?.id) {
            console.warn('[ShipmentDetails] Could not find S3 doc for viewing:', viewingDocument);
            setViewerUrl(null);
            return;
          }
          const { blob } = await downloadShipmentDocument(match.id);
          const url = URL.createObjectURL(blob);
          if (!revoked) setViewerUrl(url);
        } catch (e) {
          console.error('[ShipmentDetails] Failed to load document for viewing:', e);
          setViewerUrl(null);
        }
      };
      resolveAndLoad();
      return () => {
        revoked = true;
        if (viewerUrl) URL.revokeObjectURL(viewerUrl);
        setViewerUrl(null);
      };
    }, [viewingDocument, s3Docs]);
  
  // currency/approval normalization moved below hard guard
  
  // Poll backend while approvals are pending
  useEffect(() => {
    if (!currentShipment?.id) return;
    let intervalId;

    const shouldPoll = (s) => {
      return s?.AiApprovalStatus === 'pending' || 
             s?.BrokerApprovalStatus === 'pending' || 
             s?.aiApprovalStatus === 'pending' || 
             s?.brokerApprovalStatus === 'pending' || 
             s?.brokerApprovalStatus === 'documents-requested' ||
             s?.BrokerApprovalStatus === 'documents-requested' ||
             s?.status === 'ai-review' ||
             s?.status === 'documents-requested' ||
             s?.status === 'documents-uploaded' ||
             s?.status === 'awaiting-broker';
    };

    const poll = async () => {
      try {
        const status = await pollShipmentStatus(currentShipment.id);
        setCurrentShipment(prev => ({ ...(prev || {}),
          Status: status.status,
          status: status.status,
          AiApprovalStatus: status.aiApprovalStatus,
          aiApprovalStatus: status.aiApprovalStatus,
          BrokerApprovalStatus: status.brokerApprovalStatus,
          brokerApprovalStatus: status.brokerApprovalStatus,
          PreclearToken: status.preclearToken,
          preclearToken: status.preclearToken,
          AiComplianceScore: status.aiComplianceScore,
          aiComplianceScore: status.aiComplianceScore,
        }));
      } catch { /* ignore transient poll errors */ }
    };

    if (shouldPoll(currentShipment)) {
      poll();
      intervalId = setInterval(poll, 3000);
    }

    return () => { if (intervalId) clearInterval(intervalId); };
  }, [currentShipment?.id, currentShipment?.AiApprovalStatus, currentShipment?.BrokerApprovalStatus, currentShipment?.status]);

  // Fetch document requests from backend
  useEffect(() => {
    if (!currentShipment?.id) return;
    
    const fetchDocumentRequests = async () => {
      try {
        setLoadingDocumentRequests(true);
        const requests = await getDocumentRequests(currentShipment.id);
        setDocumentRequests(Array.isArray(requests) ? requests : []);
      } catch (err) {
        console.error('Failed to fetch document requests:', err);
        setDocumentRequests([]);
      } finally {
        setLoadingDocumentRequests(false);
      }
    };

    fetchDocumentRequests();
    // Poll every 10 seconds for new document requests
    const interval = setInterval(fetchDocumentRequests, 10000);
    return () => clearInterval(interval);
  }, [currentShipment?.id]);

  // aiProcessing effect moved below guard after aiApproval is defined

  // Required documents - use shipment.documents (populated by model) when available
  const [documents, setDocuments] = useState(() => {
    const shipmentDocs = currentShipment?.documents || [];
    const uploadedDocs = currentShipment?.uploadedDocuments || {};

    if (Array.isArray(shipmentDocs) && shipmentDocs.length > 0) {
      return shipmentDocs.map((d, idx) => {
        const key = d.key || (d.name || `doc_${idx}`).toString().replace(/\s+/g, '').toLowerCase();
        return {
          name: d.name || d,
          key,
          uploaded: uploadedDocs[key]?.uploaded || false,
          fileName: uploadedDocs[key]?.name || '',
          required: d.required ?? true
        };
      });
    }

    // If documents is an object of flags (legacy), convert to array
    if (shipmentDocs && typeof shipmentDocs === 'object' && !Array.isArray(shipmentDocs)) {
      return Object.keys(shipmentDocs).filter(k => shipmentDocs[k]).map(k => ({
        name: k,
        key: k,
        uploaded: uploadedDocs[k]?.uploaded || false,
        fileName: uploadedDocs[k]?.name || '',
        required: true
      }));
    }

    return [];
  });

  useEffect(() => {
    if (!Array.isArray(documents) || documents.length === 0) return;
    if (!Array.isArray(s3Docs) || s3Docs.length === 0) return;

    setDocuments(prev => prev.map(doc => {
      const match = s3Docs.find(d => {
        const typeMatch = d.documentType && doc.name && d.documentType.toLowerCase() === doc.name.toLowerCase();
        const fileMatch = d.fileName && doc.fileName && d.fileName.toLowerCase() === doc.fileName.toLowerCase();
        return typeMatch || fileMatch;
      });

      if (!match) return doc;

      return {
        ...doc,
        uploaded: true,
        fileName: match.fileName || doc.fileName,
      };
    }));
  }, [s3Docs]);

  // Download handler for documents
  const handleDownloadDocument = async (doc) => {
    try {
      const { blob, fileName } = await downloadShipmentDocument(doc.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || doc.fileName || doc.documentType || `document-${doc.id}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading document:', err);
      alert('Failed to download document. Please try again.');
    }
  };

  // Handle file selection and upload for a document
  const handleFileSelect = async (docIndex, e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const docKey = documents[docIndex].key;
    const docName = documents[docIndex].name;
    console.log(`[handleFileSelect] Uploading ${docName} (${docKey}):`, file.name);
    setUploadingDocKey(docKey);

    try {
      console.log(`[handleFileSelect] Calling API to upload to S3 for shipment ${currentShipment.id}`);
      // Upload to S3 via API so it appears in ShipmentDocumentsPanel
      await uploadShipmentDocument(currentShipment.id, file, docName);
      console.log(`[handleFileSelect] Upload successful for ${docName}`);

      // Update local state
      const updatedDocs = [...documents];
      updatedDocs[docIndex].uploaded = true;
      updatedDocs[docIndex].fileName = file.name;
      setDocuments(updatedDocs);

      // Persist uploaded document metadata into the shipment object
      const shipmentFromStore = shipmentsStore.getShipmentById(currentShipment.id) || { ...currentShipment };
      shipmentFromStore.uploadedDocuments = shipmentFromStore.uploadedDocuments || {};
      shipmentFromStore.uploadedDocuments[docKey] = {
        uploaded: true,
        name: file.name,
        uploadedAt: new Date().toISOString()
      };

      // Also mark the original documents object (if it was an object of flags) for backward compatibility
      if (shipmentFromStore.documents && typeof shipmentFromStore.documents === 'object' && !Array.isArray(shipmentFromStore.documents)) {
        shipmentFromStore.documents[docKey] = true;
      }

      shipmentsStore.saveShipment(shipmentFromStore);
      const refreshed = shipmentsStore.getShipmentById(currentShipment.id) || shipmentFromStore;
      setCurrentShipment(refreshed);
      console.log('[handleFileSelect] State updated, doc marked as uploaded:', docKey);
      
      // Refresh shipment status from backend to get documents-uploaded status
      try {
        const freshData = await getShipmentById(currentShipment.id);
        if (freshData) {
          setCurrentShipment(prev => ({ ...prev, ...freshData, status: freshData.status, brokerApprovalStatus: freshData.brokerApprovalStatus }));
          shipmentsStore.saveShipment(freshData);
        }
      } catch (refreshErr) {
        console.warn('[handleFileSelect] Could not refresh shipment status:', refreshErr);
      }
    } catch (err) {
      console.error('[handleFileSelect] Upload failed:', err);
      setError(`Failed to upload ${docName}: ${err.message}`);
    } finally {
      setUploadingDocKey(null);
    }
  };

  // Delete an uploaded document (remove metadata from shipment and UI)
  // Handle re-uploading an existing S3 document (replaces old with new)
  const handleReuploadDocument = async (docId, e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || !currentShipment?.id) return;

    setReuploadingDocId(docId);
    try {
      // Find the doc to get its type for proper naming
      const docToReplace = s3Docs.find(d => d.id === docId);
      const docType = docToReplace?.documentType || 'Document';

      console.log(`[handleReuploadDocument] Re-uploading document ${docId} with new file:`, file.name);

      // Upload new file to S3
      await uploadShipmentDocument(currentShipment.id, file, docType);
      console.log(`[handleReuploadDocument] New file uploaded successfully`);

      // Refresh the documents list from backend to show the new file
      const updatedDocs = await listShipmentDocuments(currentShipment.id);
      setS3Docs(Array.isArray(updatedDocs) ? updatedDocs : []);
      console.log(`[handleReuploadDocument] Documents list refreshed`);
    } catch (err) {
      console.error('[handleReuploadDocument] Re-upload failed:', err);
      setError(`Failed to re-upload document: ${err.message}`);
    } finally {
      setReuploadingDocId(null);
    }
  };

  // Delete a document from S3 and database
  const handleDeleteS3Document = async (docId) => {
    if (!currentShipment?.id || !docId) return;
    
    const confirmDelete = window.confirm('Are you sure you want to delete this document? This action cannot be undone.');
    if (!confirmDelete) return;

    setDeletingDocId(docId);
    try {
      console.log(`[handleDeleteS3Document] Deleting document ${docId}`);
      console.log(`[handleDeleteS3Document] API call: DELETE /Documents/${docId}`);
      
      // Call backend to delete the document (removes from both S3 and database)
      await http.delete(`/Documents/${docId}`);
      console.log(`[handleDeleteS3Document] Document deleted successfully from S3 and database`);

      // Close viewer if this document was being viewed
      if (viewingDocument?.id === docId) {
        setViewingDocument(null);
        setZoomLevel(100);
      }

      // Immediately remove from UI state for instant feedback
      setS3Docs(prevDocs => {
        const filtered = prevDocs.filter(d => d.id !== docId);
        console.log(`[handleDeleteS3Document] Removed document ${docId} from UI. Remaining docs:`, filtered.length);
        return filtered;
      });

      // Also refresh from backend to ensure consistency
      try {
        const updatedDocs = await listShipmentDocuments(currentShipment.id);
        setS3Docs(Array.isArray(updatedDocs) ? updatedDocs : []);
        console.log(`[handleDeleteS3Document] Refreshed document list from backend`);
      } catch (refreshErr) {
        console.warn('[handleDeleteS3Document] Could not refresh document list, but delete was successful:', refreshErr);
      }
    } catch (err) {
      console.error('[handleDeleteS3Document] Delete failed:', err);
      console.error('[handleDeleteS3Document] Error response:', err?.response);
      console.error('[handleDeleteS3Document] Error status:', err?.response?.status);
      console.error('[handleDeleteS3Document] Error data:', err?.response?.data);
      console.error('[handleDeleteS3Document] Request URL:', err?.config?.url);
      const errorMessage = err?.response?.data?.error || err?.response?.data?.detail || err.message || 'Failed to delete document';
      setError(`Failed to delete document: ${errorMessage}`);
      alert(`Error deleting document: ${errorMessage}. Please check console for details.`);
    } finally {
      setDeletingDocId(null);
    }
  };

  // Handle uploading additional documents (not from the required list)
  const handleUploadAdditionalDocument = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || !currentShipment?.id) return;

    setUploadingAdditionalDoc(true);
    try {
      console.log(`[handleUploadAdditionalDocument] Uploading additional document:`, file.name);
      
      // Upload to S3 with the actual file name (without extension) as document type
      const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
      await uploadShipmentDocument(currentShipment.id, file, fileNameWithoutExt);
      console.log(`[handleUploadAdditionalDocument] Upload successful`);

      // Refresh the documents list
      const updatedDocs = await listShipmentDocuments(currentShipment.id);
      setS3Docs(Array.isArray(updatedDocs) ? updatedDocs : []);
      
      // Refresh shipment status to reflect documents-uploaded status
      try {
        const freshData = await getShipmentById(currentShipment.id);
        if (freshData) {
          setCurrentShipment(prev => ({ ...prev, ...freshData, status: freshData.status, brokerApprovalStatus: freshData.brokerApprovalStatus }));
          shipmentsStore.saveShipment(freshData);
        }
      } catch (refreshErr) {
        console.warn('[handleUploadAdditionalDocument] Could not refresh shipment status:', refreshErr);
      }
    } catch (err) {
      console.error('[handleUploadAdditionalDocument] Upload failed:', err);
      setError(`Failed to upload additional document: ${err.message}`);
    } finally {
      setUploadingAdditionalDoc(false);
    }
  };

  const handleDeleteDocument = (docIndex) => {
    const doc = documents[docIndex];
    if (!doc) return;

    // Update UI
    const updatedDocs = [...documents];
    updatedDocs[docIndex].uploaded = false;
    updatedDocs[docIndex].fileName = '';
    setDocuments(updatedDocs);

    // Remove from store
    const shipmentFromStore = shipmentsStore.getShipmentById(currentShipment.id) || { ...currentShipment };
    shipmentFromStore.uploadedDocuments = shipmentFromStore.uploadedDocuments || {};
    const docKey = doc.key;
    if (shipmentFromStore.uploadedDocuments[docKey]) {
      delete shipmentFromStore.uploadedDocuments[docKey];
    }

    // Keep documents flag for backward compatibility as false
    if (shipmentFromStore.documents && typeof shipmentFromStore.documents === 'object') {
      shipmentFromStore.documents[docKey] = false;
    }

    shipmentsStore.saveShipment(shipmentFromStore);
    const refreshed = shipmentsStore.getShipmentById(currentShipment.id) || shipmentFromStore;
    setCurrentShipment(refreshed);
  };

  const handleReRunAICheck = () => {
    setAiProcessing(true);
    setTimeout(() => {
      updateAIApproval(currentShipment.id, 'approved');
      const updated = shipmentsStore.getShipmentById(currentShipment.id);
      setCurrentShipment(updated);
      setAiProcessing(false);
    }, 3000);
  };

  const handleSendBackToBroker = () => {
    setResubmittingToBroker(true);
    setTimeout(() => {
      // Update status to awaiting broker after docs are uploaded
      updateShipmentStatus(currentShipment.id, 'awaiting-broker');
      requestBrokerApproval(currentShipment.id);
      const updated = shipmentsStore.getShipmentById(currentShipment.id);
      if (updated) {
        setCurrentShipment(updated);
      }
      setResubmittingToBroker(false);
    }, 2000);
  };

  const handleRequestAIEvaluation = async () => {
    console.log('[handleRequestAIEvaluation] Starting AI evaluation...');
    console.log('[handleRequestAIEvaluation] Current shipment:', currentShipment?.id);
    console.log('[handleRequestAIEvaluation] All required docs uploaded:', allRequiredDocsUploaded);
    console.log('[handleRequestAIEvaluation] Documents state:', documents);
    
    if (!currentShipment?.id) {
      console.error('[handleRequestAIEvaluation] No shipment ID!');
      return;
    }
    if (!allRequiredDocsUploaded) {
      console.error('[handleRequestAIEvaluation] Not all required docs uploaded!');
      setError('Please upload all required documents before running AI evaluation.');
      return;
    }
    setAiProcessing(true);
    setError(null);
    console.log('[handleRequestAIEvaluation] AI processing started...');
    
    try {
      // Prefer centralized token getter used by axios interceptors
      const token = getAuthToken();
      console.log('[handleRequestAIEvaluation] Token present:', !!token);
      if (!token) {
        console.error('[handleRequestAIEvaluation] No auth token in any key!');
        setError('You must be signed in to run AI validation. Please log in and try again.');
        setAiProcessing(false);
        return;
      }

      console.log('[handleRequestAIEvaluation] Calling validation API for shipment:', currentShipment.id);
      // Use shared axios client so baseURL and Authorization are applied
      const resp = await http.post(`/Documents/shipments/${currentShipment.id}/validate`, {});
      const data = resp?.data || {};
      console.log('[handleRequestAIEvaluation] ✅ Validation Result:', data);

      // Extract approval status and compliance score from response
      const isApproved = (data.success !== undefined) ? !!data.success : true;
      const complianceScore = data.validationScore || 0;
      const packingNotes = data.packingNotes || data.message || '';
      const issues = data.issues || [];

      console.log('[handleRequestAIEvaluation] Extracted results:', {
        isApproved,
        complianceScore,
        packingNotes,
        issues
      });

      // Update shipment with AI results
      const updated = {
        ...currentShipment,
        aiApprovalStatus: isApproved ? 'approved' : 'rejected',
        AiApprovalStatus: isApproved ? 'approved' : 'rejected',
        aiComplianceScore: complianceScore,
        AiComplianceScore: complianceScore,
        status: isApproved ? 'ai-approved' : 'ai-rejected',
        packingNotes: packingNotes,
        validationIssues: issues,
        validationResult: data,
        brokerApprovalStatus: currentShipment?.brokerApprovalStatus ?? currentShipment?.BrokerApprovalStatus ?? 'not-started',
        BrokerApprovalStatus: currentShipment?.BrokerApprovalStatus ?? currentShipment?.brokerApprovalStatus ?? 'not-started'
      };

      console.log('[handleRequestAIEvaluation] Updating shipment state:', updated);
      // Persist to store so dashboard reflects changes immediately
      shipmentsStore.saveShipment(updated);
      setCurrentShipment(updated);
      console.log('[handleRequestAIEvaluation] State updated successfully');

      // Fetch fresh data from backend to ensure sync
      try {
        console.log('[handleRequestAIEvaluation] Refreshing shipment data from backend...');
        const freshData = await getShipmentById(currentShipment.id);
        const freshShipment = freshData?.shipment || freshData?.Shipment || freshData;
        if (freshShipment) {
          console.log('[handleRequestAIEvaluation] Fresh data received:', freshShipment);
          shipmentsStore.saveShipment(freshShipment);
          setCurrentShipment(freshShipment);
        }
      } catch (fetchErr) {
        console.warn('[handleRequestAIEvaluation] Could not refresh shipment from backend:', fetchErr);
        // Continue with local data if refresh fails
      }

      if (!isApproved) {
        const errorMessages = issues?.map(i => `${i.category}: ${i.message}`).join('\n') || packingNotes || 'Validation failed';
        console.log('[handleRequestAIEvaluation] ❌ Validation rejected:', errorMessages);
        setError(`Validation failed:\n${errorMessages}`);
      } else {
        console.log('[handleRequestAIEvaluation] ✅ Validation approved!');
      }
    } catch (err) {
      console.error('[handleRequestAIEvaluation] ❌ AI evaluation error:', err);
      console.error('[handleRequestAIEvaluation] Error stack:', err.stack);
      // Extract backend-provided details for failed validation (400)
      const data = err?.response?.data;
      if (data) {
        const issues = data.issues || [];
        const packingNotes = data.packingNotes || data.message || '';
        const complianceScore = typeof data.validationScore === 'number' ? data.validationScore : 0;

        const updated = {
          ...currentShipment,
          aiApprovalStatus: 'rejected',
          AiApprovalStatus: 'rejected',
          aiComplianceScore: complianceScore,
          AiComplianceScore: complianceScore,
          status: 'ai-rejected',
          packingNotes: packingNotes,
          validationIssues: issues,
          validationResult: data
        };
        shipmentsStore.saveShipment(updated);
        setCurrentShipment(updated);

        const errorMessages = issues.map(i => {
          const suggestion = i.suggestedAction ? `\n→ Suggestion: ${i.suggestedAction}` : '';
          return `${i.category}: ${i.message}${suggestion}`;
        }).join('\n');
        setError(errorMessages || (data.message || 'Validation failed'));
      } else {
        setError(err?.message || 'Failed to run AI evaluation. Please try again.');
      }
    } finally {
      console.log('[handleRequestAIEvaluation] AI processing completed, setting aiProcessing to false');
      setAiProcessing(false);
    }
  };

  const handleRequestBrokerApproval = async () => {
    // Safety: Only allow broker assignment after AI approval
    if (!currentShipment?.id) return;
    if (aiApproval !== 'approved') {
      setError('Complete AI evaluation before requesting broker review.');
      return;
    }
    try {
      setRequestingBroker(true);
      setError(null);
      
      // First assign broker based on origin country and HS code
      const assignmentResponse = await assignBroker(currentShipment.id);
      
      // Check if a broker was actually assigned
      if (!assignmentResponse?.shipment?.assignedBrokerId && !assignmentResponse?.assignedBrokerId) {
        setError('No eligible broker found for this shipment. Please check the origin country, destination country, and HS codes.');
        setRequestingBroker(false);
        return;
      }
      
      // Then update status to awaiting-broker
      await apiUpdateShipmentStatus(currentShipment.id, 'awaiting-broker');
      
      // Fetch updated shipment data
      const data = await getShipmentById(currentShipment.id);
      const s = data?.shipment || data?.Shipment || data;
      
      if (s) {
        setCurrentShipment(s);
        // Persist into store so broker and shipper views see assignment immediately
        shipmentsStore.saveShipment({
          ...s,
          assignedBrokerId: s.assignedBrokerId ?? s.AssignedBrokerId,
          brokerApprovalStatus: s.brokerApprovalStatus ?? s.BrokerApprovalStatus ?? 'pending',
          status: s.status ?? s.Status ?? 'awaiting-broker'
        });
      } else {
        setError('Failed to refresh shipment data');
      }
    } catch (e) {
      console.error('Broker approval error:', e);
      const errorMsg = e?.response?.data?.error || e?.message || 'Failed to request broker review';
      setError(errorMsg);
    } finally {
      setRequestingBroker(false);
    }
  };

  const handleGenerateToken = async () => {
    if (!currentShipment?.id) return;
    try {
      await apiGenerateToken(currentShipment.id);
      const data = await getShipmentById(currentShipment.id);
      const s = data?.shipment || data?.Shipment;
      setCurrentShipment(s);
    } catch (e) {
      setError(e?.message || 'Failed to generate token');
    }
  };

  const handleCancelShipment = async () => {
    if (!currentShipment?.id) return;
    try {
      // Delete shipment from database
      await deleteShipment(currentShipment.id);
      
      // Remove from local store
      shipmentsStore.removeShipment(currentShipment.id);
      
      setShowCancelConfirm(false);
      onNavigate('dashboard');
    } catch (error) {
      console.error('Error deleting shipment:', error);
      setError('Failed to delete shipment. Please try again.');
      setShowCancelConfirm(false);
    }
  };

  const handleViewDocument = (docName) => {
    setViewingDocument({
      name: docName,
      message: `Viewing document: ${docName}`
    });
  };

  // Derive approval status fields EARLY - BEFORE they are used in computed state below
  // This prevents temporal dead zone errors from referencing them before declaration
  const aiApproval =
    currentShipment?.aiApprovalStatus ??
    currentShipment?.AiApprovalStatus ??
    'not-started';

  const brokerApproval =
    currentShipment?.brokerApprovalStatus ??
    currentShipment?.BrokerApprovalStatus ??
    'not-started';

  const assignedBrokerId = currentShipment?.assignedBrokerId ?? currentShipment?.AssignedBrokerId ?? null;

  const tokenVal =
    currentShipment?.token ??
    currentShipment?.PreclearToken ??
    currentShipment?.preclearToken ??
    null;

  const requiredDocs = documents.filter(d => d.required !== false);
  const allRequiredDocsUploaded = requiredDocs.length === 0
    ? (Array.isArray(s3Docs) ? s3Docs.length > 0 : true)
    : requiredDocs.every(d => d.uploaded);
  console.log('[ShipmentDetails] Document check:', {
    documents,
    totalDocs: documents.length,
    requiredDocs: documents.filter(d => d.required),
    requiredDocsCount: documents.filter(d => d.required).length,
    allRequiredDocsUploaded,
    aiApproval,
    currentShipmentId: currentShipment?.id
  });
  const canRequestAI = currentShipment && allRequiredDocsUploaded && (aiApproval !== 'approved');
  const canRequestBroker = currentShipment && aiApproval === 'approved' && 
    (brokerApproval === 'not-started' || !brokerApproval);
  // Token section should be visible when both approvals are complete
  // or when a token has already been generated/present on the shipment.
  const canGenerateToken = !!currentShipment && (
    (aiApproval === 'approved' && brokerApproval === 'approved') ||
    currentShipment?.status === 'token-generated' ||
    !!tokenVal
  );

  // Keep documents in sync if shipment updates (e.g., after upload)
  useEffect(() => {
    if (!currentShipment) return;
    const shipmentDocs = currentShipment?.documents || {};
    const uploadedDocs = currentShipment?.uploadedDocuments || {};
    const documentsList = [
      { name: 'Commercial Invoice', key: 'commercialInvoice', uploaded: uploadedDocs.commercialInvoice?.uploaded || false, fileName: uploadedDocs.commercialInvoice?.name || '', required: true },
      { name: 'Packing List', key: 'packingList', uploaded: uploadedDocs.packingList?.uploaded || false, fileName: uploadedDocs.packingList?.name || '', required: true },
      { name: 'Certificate of Origin', key: 'certificateOfOrigin', uploaded: uploadedDocs.certificateOfOrigin?.uploaded || false, fileName: uploadedDocs.certificateOfOrigin?.name || '', required: false },
      { name: 'Export License', key: 'exportLicense', uploaded: uploadedDocs.exportLicense?.uploaded || false, fileName: uploadedDocs.exportLicense?.name || '', required: false },
      { name: 'Import License', key: 'importLicense', uploaded: uploadedDocs.importLicense?.uploaded || false, fileName: uploadedDocs.importLicense?.name || '', required: false },
      { name: 'Safety Data Sheet (SDS)', key: 'sds', uploaded: uploadedDocs.sds?.uploaded || false, fileName: uploadedDocs.sds?.name || '', required: false },
      // Airway Bill (AWB) intentionally removed here as well
      { name: 'Bill of Lading (BOL)', key: 'bol', uploaded: uploadedDocs.bol?.uploaded || false, fileName: uploadedDocs.bol?.name || '', required: false },
      { name: 'CMR (International Road Transport)', key: 'cmr', uploaded: uploadedDocs.cmr?.uploaded || false, fileName: uploadedDocs.cmr?.name || '', required: false },
    ];
    console.log('[ShipmentDetails] Document update:', { totalDocs: documentsList.length, required: documentsList.filter(d => d.required).length });
    // Include ALL documents, don't filter - always show required docs for upload
    setDocuments(documentsList);
  }, [currentShipment?.id, currentShipment?.uploadedDocuments]);

  // Reflect backend AI running state based on currentShipment
  useEffect(() => {
    if (!currentShipment) return;
    const running = aiApproval === 'pending' || currentShipment.status === 'ai-review';
    console.log(
      '[ShipmentDetails] aiProcessing effect:',
      { aiApproval, status: currentShipment.status, running }
    );
    setAiProcessing(!!running);
  }, [aiApproval, currentShipment?.status]);

  // HARD GUARD: If shipment is null, do not render anything that accesses it
  if (!currentShipment) {
    console.log('[ShipmentDetails] HARD GUARD triggered: currentShipment is null/undefined');
    console.log('[ShipmentDetails] isLoading:', isLoading);
    console.log('[ShipmentDetails] error:', error);
    console.log('[ShipmentDetails] shipment prop:', shipment);
    console.log('[ShipmentDetails] routeId:', routeId);
    
    // Show error if there's one
    if (error && !isLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-12 px-6">
          <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Failed to Load Shipment</h2>
          <p className="text-slate-600 mb-4">{error}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    
    // Show loading
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="w-8 h-8 text-blue-600 animate-spin" />
        <span className="ml-3 text-slate-600">Loading shipment details...</span>
      </div>
    );
  }

  // After guard: safe to access shipment fields directly without optional chaining
  const shipmentData = currentShipment;
  const canChatWithBroker = Boolean(shipmentData.assignedBrokerId);
  const currency = getCurrencyByCountry(shipmentData.originCountry || 'US');

  const handleOpenChat = () => {
    if (!canChatWithBroker) {
      setShowBrokerAlert(true);
      return;
    }
    setChatOpen(true);
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-slate-900 mb-2">Shipment Details</h1>
            {/* <p className="text-slate-600">Complete shipment ID: {shipmentData.id}</p> */}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate && onNavigate('shipment-form', currentShipment)}
              title="Edit Shipment"
              className="px-3 py-2 bg-slate-100 text-slate-800 rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-2 border border-slate-300"
            >
              <Pencil className="w-4 h-4" />
              Edit
            </button>
            <button
              onClick={handleOpenChat}
              disabled={!canChatWithBroker}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-60"
            >
              <MessageCircle className="w-4 h-4" />
              Chat with Broker
            </button>
          </div>
        </div>
      </div>

      {/* Workflow Progress */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <h2 className="text-slate-900 mb-6">Workflow Progress</h2>
        <div className="flex items-center gap-4">
          {/* Step 1: Documents */}
          <div className="flex-1">
            <div className={`w-full h-2 rounded-full ${allRequiredDocsUploaded ? 'bg-green-500' : 'bg-orange-500'}`} />
            <p className="text-sm text-slate-600 mt-2">Documents</p>
            <p className="text-xs text-slate-500">{allRequiredDocsUploaded ? 'Complete' : 'Pending'}</p>
          </div>
          {/* Step 2: AI Approval */}
          <div className="flex-1">
            <div className={`w-full h-2 rounded-full ${aiApproval === 'approved' ? 'bg-green-500' : aiProcessing ? 'bg-blue-500' : 'bg-slate-200'}`} />
            <p className="text-sm text-slate-600 mt-2">AI Evaluation</p>
            <p className="text-xs text-slate-500">{aiApproval === 'approved' ? 'Approved' : aiApproval === 'pending' || aiProcessing ? 'Evaluating...' : 'Not Started'}</p>
          </div>
          {/* Step 3: Broker Approval */}
          <div className="flex-1">
            <div className={`w-full h-2 rounded-full ${
              brokerApproval === 'approved' ? 'bg-green-500' : 
              brokerApproval === 'pending' || currentShipment?.status === 'documents-uploaded' ? 'bg-blue-500' : 
              brokerApproval === 'documents-requested' || currentShipment?.status === 'documents-requested' ? 'bg-red-500' : 
              'bg-slate-200'
            }`} />
            <p className="text-sm text-slate-600 mt-2">Broker Review</p>
            <p className="text-xs text-slate-500">{
              brokerApproval === 'approved' ? 'Approved' : 
              brokerApproval === 'pending' ? 'In Review' : 
              currentShipment?.status === 'documents-uploaded' ? 'Docs Uploaded' :
              brokerApproval === 'documents-requested' || currentShipment?.status === 'documents-requested' ? 'Docs Requested' : 
              'Not Started'
            }</p>
          </div>
          {/* Step 4: Token */}
          <div className="flex-1">
            <div className={`w-full h-2 rounded-full ${currentShipment?.status === 'token-generated' ? 'bg-green-500' : 'bg-slate-200'}`} />
            <p className="text-sm text-slate-600 mt-2">Token</p>
            <p className="text-xs text-slate-500">{currentShipment?.status === 'token-generated' ? 'Complete' : 'Pending'}</p>
          </div>
        </div>
      </div>

      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Main Workflow */}
        <div className="lg:col-span-2 space-y-6">

          {/* Comprehensive Shipment Details */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-slate-900 mb-6">Shipment Details</h2>
                    {/* <p className="text-slate-900">{shipmentData.consignee?.contactName || 'N/A'}</p> */}
            {/* Basics Section */}
            <div className="mb-8 pb-6 border-b border-slate-200">
              <h3 className="text-slate-900 font-semibold mb-4">Shipment Basics</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-slate-500 text-sm mb-1">Title</p>
                  <p className="text-slate-900">{shipmentData.title || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-sm mb-1">Mode</p>
                  <p className="text-slate-900">{shipmentData.mode || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-sm mb-1">Shipment Type</p>
                  <p className="text-slate-900">{shipmentData.shipmentType || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-sm mb-1">Service Level</p>
                  <p className="text-slate-900">{shipmentData.serviceLevel || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-sm mb-1">Currency</p>
                  <p className="text-slate-900">{shipmentData.currency || currency?.code || 'USD'}</p>
                </div>
                
                <div>
                  <p className="text-slate-500 text-sm mb-1">Pickup</p>
                  <p className="text-slate-900">{shipmentData.pickupType || 'N/A'}</p>
                  {shipmentData.pickupType === 'Drop-off' && shipmentData.estimatedDropoffDate && (
                    <p className="text-xs text-slate-500 mt-1">Estimated Drop-off: {new Date(shipmentData.estimatedDropoffDate).toLocaleDateString()}</p>
                  )}
                  {shipmentData.pickupType === 'Scheduled Pickup' && (
                    <div className="text-xs text-slate-500 mt-1">
                      {shipmentData.pickupLocation && <div>Location: {shipmentData.pickupLocation}</div>}
                      {shipmentData.pickupDate && <div>Pickup Date: {new Date(shipmentData.pickupDate).toLocaleDateString()}</div>}
                      {(shipmentData.pickupTimeEarliest || shipmentData.pickupTimeLatest) && (
                        <div>Time: {formatTimeWithAmPm(shipmentData.pickupTimeEarliest)} — {formatTimeWithAmPm(shipmentData.pickupTimeLatest)}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Shipper Section */}
            <div className="mb-8 pb-6 border-b border-slate-200">
              <h3 className="text-slate-900 font-semibold mb-4">Shipper Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-slate-500 text-sm mb-1">Company</p>
                  <p className="text-slate-900">{shipmentData.shipper?.company || <span className="text-red-500">Missing</span>}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-sm mb-1">Contact Name</p>
                  <p className="text-slate-900">{shipmentData.shipper?.contactName || <span className="text-red-500">Missing</span>}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-sm mb-1">Email</p>
                  <p className="text-slate-900">{shipmentData.shipper?.email || <span className="text-red-500">Missing</span>}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-sm mb-1">Phone</p>
                  <p className="text-slate-900">{shipmentData.shipper?.phone || <span className="text-red-500">Missing</span>}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-slate-500 text-sm mb-1">Address</p>
                  <p className="text-slate-900">
                    {(() => {
                      const parts = [shipmentData.shipper?.address1, shipmentData.shipper?.address2, shipmentData.shipper?.city, shipmentData.shipper?.state, shipmentData.shipper?.postalCode].filter(Boolean);
                      return parts.length > 0 ? parts.join(', ') : <span className="text-red-500">Missing</span>;
                    })()}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500 text-sm mb-1">Country</p>
                  <p className="text-slate-900">{shipmentData.shipper?.country || <span className="text-red-500">Missing</span>}</p>
                </div>
                
              </div>
            </div>

            {/* Consignee Section */}
            <div className="mb-8 pb-6 border-b border-slate-200">
              <h3 className="text-slate-900 font-semibold mb-4">Consignee Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-slate-500 text-sm mb-1">Company</p>
                  <p className="text-slate-900">{shipmentData.consignee?.company || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-sm mb-1">Contact Name</p>
                  <p className="text-slate-900">{shipmentData.consignee?.contactName || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-sm mb-1">Email</p>
                  <p className="text-slate-900">{shipmentData.consignee?.email || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-sm mb-1">Phone</p>
                  <p className="text-slate-900">{shipmentData.consignee?.phone || 'N/A'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-slate-500 text-sm mb-1">Address</p>
                  <p className="text-slate-900">
                    {[shipmentData.consignee?.address1, shipmentData.consignee?.address2].filter(Boolean).join(' ')}, {shipmentData.consignee?.city}, {shipmentData.consignee?.state} {shipmentData.consignee?.postalCode}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500 text-sm mb-1">Country</p>
                  <p className="text-slate-900">{shipmentData.consignee?.country || 'N/A'}</p>
                </div>
                
              </div>
            </div>

            {/* Packages & Products Section */}
            <div className="mb-8 pb-6 border-b border-slate-200">
              <h3 className="text-slate-900 font-semibold mb-4">Packages & Products</h3>
              {currentShipment?.packages && currentShipment.packages.length > 0 ? (
                <div className="space-y-6">
                  {currentShipment.packages.map((pkg, pkgIdx) => (
                    <div key={pkgIdx} className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                      <h4 className="text-slate-900 font-medium mb-4">Package {pkgIdx + 1}</h4>
                      <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-slate-200">
                        <div>
                          <p className="text-slate-500 text-sm mb-1">Type</p>
                          <p className="text-slate-900">{pkg.type || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-sm mb-1">Dimensions</p>
                          <p className="text-slate-900">{pkg.length} x {pkg.width} x {pkg.height} {pkg.dimUnit || 'cm'}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-sm mb-1">Weight</p>
                          <p className="text-slate-900">{pkg.weight} {pkg.weightUnit || 'kg'}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-sm mb-1">Stackable</p>
                          <p className="text-slate-900">{pkg.stackable ? 'Yes' : 'No'}</p>
                        </div>
                      </div>
                      
                      {/* Products in Package */}
                      {pkg.products && pkg.products.length > 0 && (
                        <div>
                          <h5 className="text-slate-900 font-medium text-sm mb-3">Products</h5>
                          <div className="space-y-3">
                            {pkg.products.map((product, prodIdx) => (
                              <div key={prodIdx} className="bg-white p-3 rounded border border-slate-200">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">Name</p>
                                    <p className="text-slate-900 text-sm">{product.name || 'N/A'}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">HS Code</p>
                                    <p className="text-slate-900 text-sm">{product.hsCode || 'N/A'}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">Category</p>
                                    <p className="text-slate-900 text-sm">{product.category}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">UOM</p>
                                    <p className="text-slate-900 text-sm">{product.uom || 'N/A'}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">Quantity</p>
                                    <p className="text-slate-900 text-sm">{product.qty || product.quantity || 'N/A'}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">Unit Price</p>
                                    <p className="text-slate-900 text-sm">{formatCurrency(parseFloat(product.unitPrice || product.unit_price || 0), currentShipment.currency || currency.code)}</p>
                                  </div>
                                  <div className="col-span-2">
                                    <p className="text-slate-500 text-xs mb-1">Total Value</p>
                                    <p className="text-slate-900 text-sm">{formatCurrency(product.totalValue || 0, currentShipment.currency || currency.code)}</p>
                                  </div>
                                  <div className="col-span-2">
                                    <p className="text-slate-500 text-xs mb-1">Description</p>
                                    <p className="text-slate-900 text-sm">{product.description || 'N/A'}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">Origin Country</p>
                                    <p className="text-slate-900 text-sm">{product.originCountry || 'N/A'}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 text-xs mb-1">Reason for Export</p>
                                    <p className="text-slate-900 text-sm">{product.reasonForExport || 'N/A'}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-600">No packages available</p>
              )}
            </div>
          </div>

          {/* Uploaded Documents Section (read-only, listed above AI section) */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-slate-900">Uploaded Documents</h2>
              <div className="flex items-center gap-3">
                {allRequiredDocsUploaded && (
                  <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    All Required Uploaded
                  </span>
                )}
                <button
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.onchange = (e) => handleUploadAdditionalDocument(e);
                    input.click();
                  }}
                  disabled={uploadingAdditionalDoc}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  title="Upload additional documents"
                >
                  <Upload className="w-4 h-4" />
                  Upload
                </button>
              </div>
            </div>

            {(!Array.isArray(s3Docs) || s3Docs.length === 0) && (
              <div className="p-4 border border-slate-200 bg-slate-50 rounded-lg text-slate-600">
                No documents available. Please upload required documents during shipment creation.
              </div>
            )}

            {Array.isArray(s3Docs) && s3Docs.length > 0 && (
              <div className="space-y-3">
                {s3Docs
                  .sort((a, b) => new Date(b.uploadedAt || b.createdAt || 0) - new Date(a.uploadedAt || a.createdAt || 0))
                  .map((doc) => {
                    const displayName = doc.documentType || doc.fileName || `Document ${doc.id}`;
                    return (
                      <div
                        key={doc.id || displayName}
                        className="w-full p-4 rounded-lg border-2 border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors flex items-center justify-between group"
                      >
                        <button
                          onClick={() => setViewingDocument({ id: doc.id, name: doc.fileName || doc.documentType || displayName })}
                          className="flex-1 text-left flex items-center gap-3 cursor-pointer"
                          title="Click to view document"
                        >
                          <FileText className="w-5 h-5 text-slate-500" />
                          <div>
                            <span className="text-slate-900 font-medium hover:text-blue-600">{displayName}</span>
                            <p className="text-xs text-slate-500 mt-1">
                              {doc.fileName ? `File: ${doc.fileName}` : 'File attached'}{doc.uploadedAt ? ` • Uploaded: ${new Date(doc.uploadedAt).toLocaleString()}` : ''}
                            </p>
                          </div>
                        </button>
                        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadDocument(doc);
                            }}
                            className="flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 hover:bg-green-200 transition-colors"
                            title="Download document"
                          >
                            <Download className="w-5 h-5 text-green-700" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.onchange = (fileEvent) => handleReuploadDocument(doc.id, fileEvent);
                              input.click();
                            }}
                            disabled={reuploadingDocId === doc.id}
                            className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 hover:bg-amber-200 transition-colors disabled:opacity-50"
                            title="Re-upload document (replaces old file)"
                          >
                            <RefreshCw className={`w-5 h-5 text-amber-700 ${reuploadingDocId === doc.id ? 'animate-spin' : ''}`} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* AI Evaluation Section - Improved Design */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border-2 border-blue-200 p-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-600 rounded-lg">
                  <Zap className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-slate-900 font-bold text-lg">AI Compliance Evaluation</h2>
                  <p className="text-slate-600 text-sm">Automated customs clearance analysis</p>
                </div>
              </div>
              {aiApproval === 'approved' && (
                <div className="px-4 py-2 bg-green-100 text-green-700 rounded-full text-sm font-bold flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  ✓ APPROVED
                </div>
              )}
            </div>

            {!allRequiredDocsUploaded && (
              <div className="p-4 bg-amber-100 border border-amber-300 rounded-lg">
                <p className="text-amber-900 text-sm font-medium">
                  ⚠️ Upload all required documents to proceed with AI evaluation
                </p>
              </div>
            )}

            {aiApproval !== 'approved' && !aiProcessing && (
              <div className="space-y-4">
                <p className="text-slate-700">
                  Your documents are ready. Let our AI analyze compliance rules and regulations for your shipment.
                </p>
                <button
                  onClick={() => {
                    console.log('[Start AI Evaluation Button] Clicked!', {
                      allRequiredDocsUploaded,
                      documents,
                      shipmentId: currentShipment?.id
                    });
                    if (!allRequiredDocsUploaded) {
                      console.error('[Start AI Evaluation Button] Not all required docs uploaded!');
                      setError('Please upload all required documents before running AI evaluation.');
                      return;
                    }
                    console.log('[Start AI Evaluation Button] Calling handleRequestAIEvaluation...');
                    handleRequestAIEvaluation();
                  }}
                  disabled={!allRequiredDocsUploaded}
                  className={`w-full px-6 py-4 rounded-lg font-bold flex items-center justify-center gap-2 shadow-lg transition-all ${
                    allRequiredDocsUploaded
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 transform hover:scale-105'
                      : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <Zap className="w-5 h-5" />
                  Start AI Evaluation
                </button>
              </div>
            )}

            {aiProcessing && (
              <div className="p-6 bg-white rounded-lg border border-blue-200 text-center space-y-3">
                <div className="flex justify-center">
                  <div className="relative w-12 h-12">
                    <div className="absolute inset-0 bg-blue-200 rounded-full animate-pulse"></div>
                    <Loader className="w-12 h-12 text-blue-600 animate-spin relative" />
                  </div>
                </div>
                <p className="text-blue-900 font-bold">AI Evaluation in Progress</p>
                <p className="text-blue-700 text-sm">Analyzing documents against compliance rules...</p>
              </div>
            )}

            {aiApproval === 'approved' && (
              <div className="space-y-4">
                <div className="p-4 bg-white rounded-lg border-2 border-green-300">
                  <p className="text-green-700 font-bold flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    ✓ All compliance checks passed
                  </p>
                  <p className="text-slate-600 text-sm mt-2">
                    Your shipment meets all customs regulations and is approved for broker review.
                  </p>
                  {currentShipment?.aiComplianceScore && (
                    <p className="text-slate-600 text-xs mt-3">Compliance Score: {currentShipment.aiComplianceScore}%</p>
                  )}
                </div>
                {currentShipment?.packingNotes && (
                  <div className="p-4 bg-blue-50 rounded-lg border-2 border-blue-200">
                    <p className="text-blue-900 font-semibold mb-2">📋 AI Analysis & Packing Notes:</p>
                    <p className="text-blue-800 text-sm whitespace-pre-wrap">{currentShipment.packingNotes}</p>
                  </div>
                )}
              </div>
            )}

            {aiApproval === 'rejected' && (
              <div className="space-y-4">
                <div className="p-4 bg-red-50 rounded-lg border-2 border-red-300">
                  <p className="text-red-700 font-bold flex items-center gap-2">
                    <XCircle className="w-5 h-5" />
                    ✗ Validation failed
                  </p>
                  <p className="text-red-600 text-sm mt-2">
                    Your shipment did not pass compliance checks. Review the details below and resubmit.
                  </p>
                  {currentShipment?.aiComplianceScore && (
                    <p className="text-red-600 text-xs mt-3">Compliance Score: {currentShipment.aiComplianceScore}%</p>
                  )}
                </div>
                {currentShipment?.packingNotes && (
                  <div className="p-4 bg-amber-50 rounded-lg border-2 border-amber-200">
                    <p className="text-amber-900 font-semibold mb-2">⚠️ Issues Found:</p>
                    <p className="text-amber-800 text-sm whitespace-pre-wrap">{currentShipment.packingNotes}</p>
                  </div>
                )}
                {Array.isArray(currentShipment?.validationIssues) && currentShipment.validationIssues.length > 0 && (
                  <div className="p-4 bg-white rounded-lg border-2 border-amber-300">
                    <p className="text-slate-900 font-semibold mb-3">Detailed Issues</p>
                    <ul className="space-y-3">
                      {currentShipment.validationIssues.map((issue, idx) => (
                        <li key={idx} className="border border-slate-200 rounded p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-slate-900">{issue.category || 'general'}</span>
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              issue.severity === 'error' ? 'bg-red-100 text-red-700' : issue.severity === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                            }`}>
                              {issue.severity || 'info'}
                            </span>
                          </div>
                          <p className="text-slate-800 text-sm mt-1">{issue.message}</p>
                          {issue.details && (
                            <p className="text-slate-600 text-xs mt-1 whitespace-pre-wrap">{issue.details}</p>
                          )}
                          {issue.suggestedAction && (
                            <p className="text-slate-900 text-xs mt-2">Suggestion: <span className="text-slate-700">{issue.suggestedAction}</span></p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {allRequiredDocsUploaded && (
                  <button
                    onClick={handleRequestAIEvaluation}
                    disabled={aiProcessing}
                    className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Re-run AI Evaluation
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Broker Approval Section - Only available after AI approval */}
          {aiApproval === 'approved' && (
            <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border-2 border-purple-200 p-8">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-purple-600 rounded-lg">
                    <UserCheck className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-slate-900 font-bold text-lg">Broker Review & Approval</h2>
                    <p className="text-slate-600 text-sm">Get professional customs broker assistance</p>
                  </div>
                </div>
                {brokerApproval === 'approved' && (
                  <div className="px-4 py-2 bg-green-100 text-green-700 rounded-full text-sm font-bold flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    ✓ APPROVED
                  </div>
                )}
                {brokerApproval === 'pending' && (
                  <div className="px-4 py-2 bg-blue-100 text-blue-700 rounded-full text-sm font-bold flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    IN REVIEW
                  </div>
                )}
              </div>

              {canRequestBroker && !requestingBroker && (
                <div className="space-y-4">
                  {error && (
                    <div className="p-4 bg-red-50 border-l-4 border-red-500 rounded">
                      <p className="text-red-900 font-medium">Error</p>
                      <p className="text-red-700 text-sm mt-1">{error}</p>
                    </div>
                  )}
                  <p className="text-slate-700">
                    AI evaluation passed! Submit your shipment to a professional customs broker for final review and approval.
                  </p>
                  {/* Broker Assignment Status */}
      {(shipmentData.assignedBrokerId || brokerApproval === 'pending' || brokerApproval === 'approved') && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {brokerApproval === 'approved' ? (
                <>
                  <CheckCircle className="w-6 h-6 text-green-600" />
                  <div>
                    <p className="text-slate-900 font-semibold">Broker Assigned & Approved</p>
                    <p className="text-slate-600 text-sm">Your shipment has been successfully assigned and approved.</p>
                    <p className="text-slate-500 text-xs mt-1">Assigned Broker: {assignedBrokerId ? `#${assignedBrokerId}` : 'Pending assignment'}</p>
                  </div>
                </>
              ) : brokerApproval === 'pending' ? (
                <>
                  <Clock className="w-6 h-6 text-blue-600" />
                  <div>
                    <p className="text-slate-900 font-semibold">Broker Assigned & Under Review</p>
                    <p className="text-slate-600 text-sm">A customs broker is reviewing your shipment. You'll be notified once the review is complete.</p>
                    <p className="text-slate-500 text-xs mt-1">Assigned Broker: {assignedBrokerId ? `#${assignedBrokerId}` : 'Pending assignment'}</p>
                  </div>
                </>
              ) : shipmentData.assignedBrokerId ? (
                <>
                  <UserCheck className="w-6 h-6 text-purple-600" />
                  <div>
                    <p className="text-slate-900 font-semibold">Broker Assigned</p>
                    <p className="text-slate-600 text-sm">Your shipment has been automatically assigned to a qualified broker.</p>
                    <p className="text-slate-500 text-xs mt-1">Assigned Broker: #{assignedBrokerId}</p>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

                  {!shipmentData.assignedBrokerId && (
                    <button
                      onClick={handleRequestBrokerApproval}
                      className="w-full px-6 py-4 text-white rounded-lg hover:bg-purple-700 transition-all transform hover:scale-105 font-bold flex items-center justify-center gap-2 shadow-lg"
                      style={{ background: '#7C3AED' }}
                    >
                      
                      <UserCheck className="w-5 h-5" />
                      Request Broker Review
                    </button>
                  )}
                </div>
              )}
              

              {requestingBroker && (
                <div className="p-6 bg-white rounded-lg border border-purple-200 text-center space-y-3">
                  <div className="flex justify-center">
                    <Loader className="w-8 h-8 text-purple-600 animate-spin" />
                  </div>
                  <p className="text-purple-900 font-bold">Sending to Broker</p>
                  <p className="text-purple-700 text-sm">Your shipment is being assigned to a customs broker...</p>
                </div>
              )}

              {brokerApproval === 'pending' && !requestingBroker && (
                <div className="p-4 bg-white rounded-lg border-l-4 border-blue-500">
                  <p className="text-blue-900 font-medium">📋 Under Review by Broker</p>
                  <p className="text-blue-700 text-sm mt-2">A customs broker is reviewing your documentation. You'll be notified once review is complete.</p>
                </div>
              )}

              {brokerApproval === 'approved' && (
                <div className="p-4 bg-green-100 rounded-lg border-2 border-green-400">
                  <p className="text-green-700 font-bold flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    ✓ Broker Approved - Ready for Booking
                  </p>
                  <p className="text-green-700 text-sm mt-2">All approvals complete. You can now proceed with shipment booking.</p>
                </div>
              )}
            </div>
          )}

          {/* Token Generation Section */}
          {canGenerateToken && (
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border-2 border-green-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-slate-900 flex items-center gap-2 mb-2">
                    <Shield className="w-6 h-6 text-green-600" />
                    Generate Shipment Token
                  </h2>
                  <p className="text-slate-600 text-sm">
                    All approvals complete! Generate your unique shipment token to proceed with booking.
                  </p>
                </div>
              </div>
              
              {currentShipment?.status !== 'token-generated' && !tokenVal ? (
                <button
                  onClick={handleGenerateToken}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all shadow-lg flex items-center gap-2"
                >
                  <Shield className="w-5 h-5" />
                  Generate Token
                  <ArrowRight className="w-5 h-5" />
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-white rounded-lg border border-green-300">
                    <p className="text-slate-600 text-sm mb-2">Your Shipment Token</p>
                    <p className="text-2xl text-green-700 font-mono tracking-wider">
                      {tokenVal || (currentShipment?.id ? 'UPS-' + String(currentShipment.id).toUpperCase() : 'UPS-')}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => currentShipment && onNavigate('booking', currentShipment)}
                      className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                    >
                      <Box className="w-5 h-5" />
                      Book & Pay
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column - Summary & Actions */}
        <div className="space-y-6">
          {/* Status Summary */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-slate-900 mb-4">Status Summary</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="text-slate-600 text-sm">Documents</span>
                <span className={`px-2 py-1 rounded text-xs ${
                  allRequiredDocsUploaded ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                }`}>
                  {allRequiredDocsUploaded ? 'Complete' : 'Pending'}
                </span>
              </div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="text-slate-600 text-sm">AI Evaluation</span>
                <span className={`px-2 py-1 rounded text-xs ${
                  aiApproval === 'approved' ? 'bg-green-100 text-green-700' : aiApproval === 'pending' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {aiApproval === 'approved' ? 'Approved' : aiApproval === 'pending' ? 'In Review' : 'Pending'}
                </span>
              </div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="text-slate-600 text-sm">Broker Review</span>
                <span className={`px-2 py-1 rounded text-xs ${
                  brokerApproval === 'approved' ? 'bg-green-100 text-green-700' : 
                  brokerApproval === 'pending' || currentShipment?.status === 'documents-uploaded' ? 'bg-blue-100 text-blue-700' :
                  brokerApproval === 'documents-requested' || currentShipment?.status === 'documents-requested' ? 'bg-red-100 text-red-700' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {brokerApproval === 'approved' ? 'Approved' : 
                   brokerApproval === 'pending' ? 'In Review' :
                   currentShipment?.status === 'documents-uploaded' ? 'Docs Uploaded' :
                   brokerApproval === 'documents-requested' || currentShipment?.status === 'documents-requested' ? 'Docs Requested' :
                   'Pending'}
                </span>
              </div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="text-slate-600 text-sm">Token Generation</span>
                <span className={`px-2 py-1 rounded text-xs ${
                  currentShipment?.status === 'token-generated' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {currentShipment?.status === 'token-generated' ? 'Generated' : 'Pending'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 text-sm">Payment Status</span>
                <span className={`px-2 py-1 rounded text-xs ${
                  currentShipment?.status === 'paid' || currentShipment?.paymentStatus === 'completed' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {currentShipment?.status === 'paid' || currentShipment?.paymentStatus === 'completed' ? 'Completed' : 'Pending'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 text-sm">Token Status</span>
                <span className={`px-2 py-1 rounded text-xs ${
                  currentShipment.status === 'token-generated' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {currentShipment.status === 'token-generated' ? 'Generated' : 'Pending'}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-slate-900 mb-4">Quick Actions</h3>
            <div className="space-y-2">
              <button
                onClick={handleOpenChat}
                disabled={!canChatWithBroker}
                className="w-full px-4 py-3 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors flex items-center justify-between group disabled:opacity-60"
              >
                <span className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" />
                  Chat with Broker
                </span>
                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
              <button
                onClick={() => onNavigate('dashboard')}
                className="w-full px-4 py-3 bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors flex items-center justify-between group"
              >
                <span className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  View All Shipments
                </span>
                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
              {currentShipment.status !== 'cancelled' && currentShipment.status !== 'token-generated' && (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  className="w-full px-4 py-3 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors flex items-center justify-between group"
                >
                  <span className="flex items-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    Cancel Shipment
                  </span>
                  <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-slate-900 mb-4">Activity Timeline</h3>
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Package className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-slate-900 text-sm">Shipment Created</p>
                  <p className="text-slate-500 text-xs">{currentShipment.date}</p>
                </div>
              </div>
              {allRequiredDocsUploaded && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <p className="text-slate-900 text-sm">Documents Uploaded</p>
                    <p className="text-slate-500 text-xs">All required documents</p>
                  </div>
                </div>
              )}
              {currentShipment?.aiApproval === 'approved' && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <Zap className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <p className="text-slate-900 text-sm">AI Approved</p>
                    <p className="text-slate-500 text-xs">Compliance verified</p>
                  </div>
                </div>
              )}
              {currentShipment?.brokerApproval === 'approved' && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <UserCheck className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <p className="text-slate-900 text-sm">Broker Approved</p>
                    <p className="text-slate-500 text-xs">Ready for token</p>
                  </div>
                </div>
              )}
              {currentShipment.status === 'token-generated' && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <Shield className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <p className="text-slate-900 text-sm">Token Generated</p>
                    <p className="text-slate-500 text-xs">Ready to book</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Chat Panel */}
      {canChatWithBroker && (
        <ShipmentChatPanel
          shipmentId={currentShipment.id}
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
          userRole="shipper"
          userName="ABC Exports"
        />
      )}

      {showBrokerAlert && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Broker not assigned yet</h3>
            <p className="text-slate-600 mb-4">Chat will be available once a broker is assigned to this shipment.</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowBrokerAlert(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Viewer Modal */}
      {viewingDocument && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-4xl w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-slate-900 text-lg font-semibold">{viewingDocument.name}</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setZoomLevel(prev => Math.min(prev + 25, 200))}
                  disabled={zoomLevel >= 200}
                  className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4 text-slate-700" />
                </button>
                <span className="text-xs text-slate-600 min-w-[3rem] text-center">{zoomLevel}%</span>
                <button
                  onClick={() => setZoomLevel(prev => Math.max(prev - 25, 50))}
                  disabled={zoomLevel <= 50}
                  className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4 text-slate-700" />
                </button>
                <button
                  onClick={() => {
                    setViewingDocument(null);
                    setZoomLevel(100);
                  }}
                  className="text-slate-500 hover:text-slate-700 text-2xl ml-2"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="bg-slate-50 rounded-lg overflow-auto" style={{ height: '75vh' }}>
              {!viewerUrl && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-slate-600">
                    <Loader className="w-6 h-6 animate-spin mx-auto mb-2" />
                    <p>Loading preview...</p>
                  </div>
                </div>
              )}
              {viewerUrl && (
                <div className="flex items-start justify-center p-4">
                  <div style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top center', transition: 'transform 0.2s' }}>
                    <iframe 
                      src={viewerUrl} 
                      className="rounded border border-slate-200 bg-white"
                      style={{ width: '700px', height: '900px' }}
                      title="Document Preview"
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-between">
              <button
                onClick={() => viewingDocument?.id && handleDeleteS3Document(viewingDocument.id)}
                disabled={deletingDocId === viewingDocument?.id}
                className="flex items-center justify-center w-10 h-10 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                title={deletingDocId === viewingDocument?.id ? 'Deleting document...' : 'Delete document'}
              >
                <Trash2 className={`w-5 h-5 ${deletingDocId === viewingDocument?.id ? 'animate-pulse' : ''}`} />
              </button>
              <button 
                onClick={() => {
                  setViewingDocument(null);
                  setZoomLevel(100);
                }} 
                className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-slate-900 mb-2">Cancel Shipment?</h3>
                <p className="text-slate-600 text-sm">
                  Are you sure you want to cancel this shipment? This action cannot be undone.
                </p>
                <p className="text-slate-600 text-sm mt-2">
                  Shipment ID: <span className="text-slate-900">{currentShipment.id}</span>
                </p>
              </div>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 px-4 py-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
              >
                No, Keep It
              </button>
              <button
                onClick={handleCancelShipment}
                className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}




