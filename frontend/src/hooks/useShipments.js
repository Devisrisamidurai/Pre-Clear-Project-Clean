import { useState, useEffect, useRef } from 'react';
import { shipmentsStore } from '../store/shipmentsStore';
import { getMyShipments, getShipmentById, pollShipmentStatus, brokerApprove as brokerApproveApi } from '../api/shipments';
import { uploadShipmentDocument, markShipmentDocument, requestShipmentDocuments } from '../api/documents';
import { getShipmentMessages, sendMessage as sendChatMessage } from '../components/api/chat';

export function useShipments() {
  const [shipments, setShipments] = useState(shipmentsStore.getAllShipments());
  const [importExportRules, setImportExportRules] = useState(shipmentsStore.getImportExportRules());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const pollIntervalRef = useRef(null);

  const mapBackendShipment = (s) => {
    const rawPackages = s?.packages ?? s?.Packages ?? [];
    const rawProducts = s?.products ?? s?.Products ?? [];
    const uploadedDocuments = s?.uploadedDocuments ?? s?.documents ?? s?.Documents ?? {};
    const customsValue = s?.customsValue ?? s?.value ?? 0;
    const pricingTotal = s?.pricingTotal ?? s?.PricingTotal ?? s?.pricing_total ?? s?.pricing?.total ?? null;
    const normalizeProduct = (p) => ({
      name: p?.name ?? p?.Name ?? null,
      description: p?.description ?? p?.Description ?? null,
      category: p?.category ?? p?.Category ?? null,
      hsCode: p?.hsCode ?? p?.HsCode ?? null,
      qty: p?.qty ?? p?.quantity ?? p?.Quantity ?? 0,
      uom: p?.uom ?? p?.unit ?? p?.Unit ?? 'pcs',
      unitPrice: p?.unitPrice ?? p?.UnitPrice ?? p?.unit_price ?? 0,
      totalValue: p?.totalValue ?? p?.TotalValue ?? (parseFloat(p?.unitPrice ?? p?.UnitPrice ?? p?.unit_price ?? 0) * parseFloat(p?.qty ?? p?.quantity ?? p?.Quantity ?? 0) || 0),
      originCountry: p?.originCountry ?? p?.OriginCountry ?? null,
      reasonForExport: p?.reasonForExport ?? p?.ExportReason ?? null,
    });

    const normalizePackage = (pkg) => ({
      type: pkg?.type ?? pkg?.PackageType ?? null,
      length: pkg?.length ?? pkg?.Length ?? 0,
      width: pkg?.width ?? pkg?.Width ?? 0,
      height: pkg?.height ?? pkg?.Height ?? 0,
      dimUnit: pkg?.dimUnit ?? pkg?.DimensionUnit ?? 'cm',
      weight: pkg?.weight ?? pkg?.Weight ?? 0,
      weightUnit: pkg?.weightUnit ?? pkg?.WeightUnit ?? 'kg',
      stackable: pkg?.stackable ?? pkg?.Stackable ?? false,
      products: (pkg?.products ?? pkg?.Products ?? []).map(normalizeProduct),
    });

    const packages = rawPackages.map(normalizePackage);
    const products = rawProducts.map(normalizeProduct);

    const totalWeight = s?.totalWeight ?? s?.weight ?? packages.reduce((sum, pkg) => sum + (parseFloat(pkg?.weight) || 0), 0);
    const totalQuantity = s?.totalQuantity ?? s?.quantity ?? packages.reduce((sum, pkg) => {
      if (Array.isArray(pkg?.products)) {
        return sum + pkg.products.reduce((inner, prod) => inner + (parseFloat(prod?.qty) || 0), 0);
      }
      return sum;
    }, 0);
    const firstProductName = s?.productName ?? products?.[0]?.name ?? null;
    const shipperCity = s?.shipper?.city ?? s?.originCity ?? s?.OriginCity;
    const shipperCountry = s?.shipper?.country ?? s?.originCountry ?? s?.OriginCountry;
    const consigneeCity = s?.consignee?.city ?? s?.destinationCity ?? s?.destCity ?? s?.DestinationCity;
    const consigneeCountry = s?.consignee?.country ?? s?.destinationCountry ?? s?.destCountry ?? s?.DestinationCountry;
    const shipperParty = s?.shipper || {};
    const consigneeParty = s?.consignee || {};

    return {
      id: s.id,
      referenceId: s.referenceId,
      title: s.title,
      mode: s.mode,
      shipmentType: s.shipmentType,
      value: s.value ?? s.customsValue,
      customsValue,
      currency: s.currency ?? s.Currency,
      serviceLevel: s.serviceLevel ?? s.ServiceLevel ?? s.service_level ?? null,
      pricingTotal,
      pickupType: s.pickupType ?? s.PickupType ?? s.pickup_type ?? null,
      pickupLocation: s.pickupLocation ?? s.PickupLocation ?? s.pickup_location ?? null,
      pickupDate: s.pickupDate ?? s.PickupDate ?? s.pickup_date ?? null,
      pickupTimeEarliest: s.pickupTimeEarliest ?? s.PickupTimeEarliest ?? s.pickup_time_earliest ?? null,
      pickupTimeLatest: s.pickupTimeLatest ?? s.PickupTimeLatest ?? s.pickup_time_latest ?? null,
      estimatedDropoffDate: s.estimatedDropoffDate ?? s.EstimatedDropoffDate ?? s.estimated_dropoff_date ?? null,
      paymentStatus: s.paymentStatus ?? s.PaymentStatus,
      paymentDate: s.paymentDate ?? s.PaymentDate ?? s.paidAt ?? s.PaidAt,
      bookingDate: s.bookingDate ?? s.BookingDate ?? s.paymentDate ?? s.PaymentDate ?? s.paidAt ?? s.PaidAt,
      aiScore: s.aiComplianceScore,
      aiApproval: s.aiApprovalStatus ?? s.AiApprovalStatus,
      brokerApproval: s.brokerApprovalStatus ?? s.BrokerApprovalStatus,
      status: s.status ?? s.Status,
      token: s.preclearToken ?? s.PreclearToken ?? s.token,
      preclearToken: s.preclearToken ?? s.PreclearToken ?? s.token,
      tokenGeneratedAt: s.tokenGeneratedAt ?? s.TokenGeneratedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt ?? s.UpdatedAt,
      assignedBrokerId: s.assignedBrokerId ?? s.AssignedBrokerId ?? null,
      packages,
      products,
      uploadedDocuments,
      totalWeight,
      totalQuantity,
      weight: totalWeight,
      quantity: totalQuantity,
      productName: firstProductName,
      shipper: {
        company: shipperParty.company ?? s.originCompany ?? s.shipperName,
        contactName: shipperParty.contactName ?? null,
        email: shipperParty.email ?? null,
        phone: shipperParty.phone ?? null,
        address1: shipperParty.address1 ?? null,
        address2: shipperParty.address2 ?? null,
        city: shipperCity,
        state: shipperParty.state ?? null,
        postalCode: shipperParty.postalCode ?? null,
        country: shipperCountry,
        taxId: shipperParty.taxId ?? null
      },
      consignee: {
        company: consigneeParty.company ?? s.destinationCompany ?? null,
        contactName: consigneeParty.contactName ?? null,
        email: consigneeParty.email ?? null,
        phone: consigneeParty.phone ?? null,
        address1: consigneeParty.address1 ?? null,
        address2: consigneeParty.address2 ?? null,
        city: consigneeCity,
        state: consigneeParty.state ?? null,
        postalCode: consigneeParty.postalCode ?? null,
        country: consigneeCountry,
        taxId: consigneeParty.taxId ?? null
      },
      originCountry: shipperCountry,
      destCountry: consigneeCountry
    };
  };

  // Fetch shipments from backend on mount
  useEffect(() => {
    const fetchShipments = async () => {
      try {
        setIsLoading(true);
        setError(null);
        // Ensure no stale shipments before fetching (preserve messages)
        shipmentsStore.resetShipmentsOnly();
        setShipments([]);
        
        // Fetch shipments for authenticated user; backend derives user from JWT and returns list DTO
        const backendShipments = await getMyShipments();

        // Replace local store shipments with backend source-of-truth (preserve messages)
        shipmentsStore.resetShipmentsOnly();

        if (Array.isArray(backendShipments)) {
          backendShipments.forEach(s => {
            const frontendShipment = mapBackendShipment(s);
            shipmentsStore.saveShipment(frontendShipment);
          });

          // Enrich with shipper/consignee from shipment_parties when missing
          try {
            const toEnrich = shipmentsStore
              .getAllShipments()
              .filter(x => (
                !x.shipper?.company || !x.consignee?.company ||
                !x.shipper?.city || !x.consignee?.city ||
                !x.shipper?.email || !x.consignee?.email ||
                !x.shipper?.address1 || !x.consignee?.address1
              ))
              .map(x => x.id);

            if (toEnrich.length > 0) {
              const details = await Promise.allSettled(toEnrich.map(id => getShipmentById(id)));
              details.forEach((res) => {
                if (res.status === 'fulfilled' && res.value) {
                  const mapped = mapBackendShipment(res.value);
                  shipmentsStore.saveShipment(mapped);
                }
              });
            }
          } catch { /* enrichment best-effort */ }
        }

        // Update local state with latest store
        setShipments(shipmentsStore.getAllShipments());
      } catch (err) {
        console.error('Error fetching shipments from backend:', err);
        const msg = err?.response?.data?.error || err?.message || 'fetch_failed';
        setError(msg);
        // Continue with local store data
      } finally {
        setIsLoading(false);
      }
    };

    fetchShipments();

    // Subscribe to local store changes
    const unsubscribe = shipmentsStore.subscribe(() => {
      setShipments(shipmentsStore.getAllShipments());
      setImportExportRules(shipmentsStore.getImportExportRules());
    });

    return unsubscribe;
  }, []);

  // Periodically refresh the shipments list from backend to avoid stale UI
  useEffect(() => {
    let intervalId;
    const refresh = async () => {
      try {
        const backendShipments = await getMyShipments();
        shipmentsStore.resetShipmentsOnly();
        if (Array.isArray(backendShipments)) {
          backendShipments.forEach(s => {
            const frontendShipment = mapBackendShipment(s);
            shipmentsStore.saveShipment(frontendShipment);
          });

          // Enrich parties on refresh as well
          try {
            const toEnrich = shipmentsStore
              .getAllShipments()
              .filter(x => (
                !x.shipper?.company || !x.consignee?.company ||
                !x.shipper?.city || !x.consignee?.city ||
                !x.shipper?.email || !x.consignee?.email ||
                !x.shipper?.address1 || !x.consignee?.address1
              ))
              .map(x => x.id);
            if (toEnrich.length > 0) {
              const details = await Promise.allSettled(toEnrich.map(id => getShipmentById(id)));
              details.forEach((res) => {
                if (res.status === 'fulfilled' && res.value) {
                  const mapped = mapBackendShipment(res.value);
                  shipmentsStore.saveShipment(mapped);
                }
              });
            }
          } catch { /* ignore */ }
        }
        setShipments(shipmentsStore.getAllShipments());
      } catch { /* ignore transient errors */ }
    };

    intervalId = setInterval(refresh, 5000);
    return () => { if (intervalId) clearInterval(intervalId); };
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Start polling shipment status for real-time updates
  const startPollingShipment = (shipmentId, intervalMs = 3000) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    const poll = async () => {
      try {
        const statusUpdate = await pollShipmentStatus(shipmentId);
        
        // Update shipment with new status fields
        const shipment = shipmentsStore.getShipmentById(shipmentId);
        if (shipment) {
          shipment.status = statusUpdate.status;
          shipment.aiApproval = statusUpdate.aiApprovalStatus;
          shipment.brokerApproval = statusUpdate.brokerApprovalStatus;
          shipment.token = statusUpdate.preclearToken;
          shipment.aiScore = statusUpdate.aiComplianceScore;
          shipment.assignedBrokerId = statusUpdate.assignedBrokerId ?? shipment.assignedBrokerId;
          shipmentsStore.saveShipment(shipment);
        }
      } catch (err) {
        console.warn(`Failed to poll shipment ${shipmentId}:`, err.message);
      }
    };

    // Poll immediately and then every intervalMs
    poll();
    pollIntervalRef.current = setInterval(poll, intervalMs);
  };

  // Stop polling
  const stopPollingShipment = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  return {
    shipments,
    importExportRules,
    isLoading,
    error,
    // Polling
    startPollingShipment,
    stopPollingShipment,
    // Shipment operations
    getShipmentById: (id) => shipmentsStore.getShipmentById(id),
    saveShipment: (shipment) => shipmentsStore.saveShipment(shipment),
    updateShipmentStatus: (id, status) => shipmentsStore.updateShipmentStatus(id, status),
    updateAIApproval: (id, approval, aiResults, score) => 
      shipmentsStore.updateAIApproval(id, approval, aiResults, score),
    requestBrokerApproval: (id) => shipmentsStore.requestBrokerApproval(id),
    // Backend-wired broker actions
    brokerApprove: async (id, notes) => {
      try {
        const updated = await brokerApproveApi(id, 'approved', notes);
        const mapped = mapBackendShipment(updated);
        shipmentsStore.saveShipment(mapped);
        return mapped;
      } catch (e) {
        throw e;
      }
    },
    brokerDeny: async (id, reason) => {
      try {
        const updated = await brokerApproveApi(id, 'rejected', reason);
        const mapped = mapBackendShipment(updated);
        shipmentsStore.saveShipment(mapped);
        return mapped;
      } catch (e) {
        throw e;
      }
    },
    brokerRequestDocuments: async (id, docs, message) => {
      try {
        const names = Array.isArray(docs) ? docs.map(d => d.name || d) : [];
        console.log('[useShipments.brokerRequestDocuments] Calling API with:', { shipmentId: id, names, message });
        const resp = await requestShipmentDocuments(id, names, message);
        console.log('[useShipments.brokerRequestDocuments] API response:', resp);
        
        // Refresh shipment from backend to get updated status
        try {
          const updatedShipment = await getShipmentById(id);
          if (updatedShipment) {
            shipmentsStore.saveShipment(updatedShipment);
          }
        } catch (refreshErr) {
          console.warn('[useShipments.brokerRequestDocuments] Could not refresh shipment:', refreshErr);
          // Fallback: update store manually
          const shipment = shipmentsStore.getShipmentById(id);
          if (shipment) {
            shipment.status = 'documents-requested';
            shipment.brokerApproval = 'documents-requested';
            shipment.brokerApprovalStatus = 'documents-requested';
            shipment.BrokerApprovalStatus = 'documents-requested';
            shipmentsStore.saveShipment(shipment);
          }
        }
        
        return resp; // { success: true, request }
      } catch (e) {
        console.error('[useShipments.brokerRequestDocuments] Error:', e);
        throw e;
      }
    },
    uploadDocument: async (shipmentId, file, docType) => {
      const uploaded = await uploadShipmentDocument(shipmentId, file, docType);
      // best-effort mark uploaded by name for backend tracking
      try {
        await markShipmentDocument(shipmentId, file.name);
      } catch { /* non-fatal */ }

      // reflect minimal metadata in store for legacy UI
      const shipment = shipmentsStore.getShipmentById(shipmentId);
      if (shipment) {
        const docName = file.name;
        shipmentsStore.uploadDocument(shipmentId, docName, docType || 'document');
      }

      return uploaded;
    },
    bookShipment: (id, bookingDate, estimatedDelivery, amount) => 
      shipmentsStore.bookShipment(id, bookingDate, estimatedDelivery, amount),
    completePayment: (id) => shipmentsStore.completePayment(id),
    // Chat (broker/shipper)
    loadShipmentMessages: async (shipmentId) => {
      if (!shipmentId) return [];
      const apiMessages = await getShipmentMessages(shipmentId);
      const mapped = (apiMessages || []).map((m) => ({
        id: m.id,
        shipmentId: m.shipmentId,
        senderId: m.senderId,
        senderRole: m.senderRole || null,
        sender: m.senderRole || undefined,
        senderName: m.senderName || (m.senderId ? `User #${m.senderId}` : 'User'),
        message: m.message,
        timestamp: m.createdAt,
        type: 'message'
      }));
      shipmentsStore.setMessagesForShipment(shipmentId, mapped);
      return mapped;
    },
    sendShipmentMessage: async (shipmentId, message, senderName) => {
      if (!shipmentId || !message) return null;
      const m = await sendChatMessage(shipmentId, message);
      const mapped = {
        id: m.id,
        shipmentId: m.shipmentId,
        senderId: m.senderId,
        senderRole: m.senderRole || null,
        sender: m.senderRole || undefined,
        senderName: m.senderName || senderName || (m.senderId ? `User #${m.senderId}` : 'User'),
        message: m.message,
        timestamp: m.createdAt,
        type: 'message'
      };
      shipmentsStore.addMessage(mapped);
      return mapped;
    },
    // Rules operations
    addImportExportRule: (rule) => shipmentsStore.addImportExportRule(rule),
    updateImportExportRule: (id, rule) => shipmentsStore.updateImportExportRule(id, rule),
    deleteImportExportRule: (id) => shipmentsStore.deleteImportExportRule(id),
  };
}

export function useShipment(id) {
  const [shipment, setShipment] = useState(
    id ? shipmentsStore.getShipmentById(id) : undefined
  );

  useEffect(() => {
    const unsubscribe = shipmentsStore.subscribe(() => {
      if (id) {
        setShipment(shipmentsStore.getShipmentById(id));
      }
    });

    return unsubscribe;
  }, [id]);

  return shipment;
}

export function useMessages(shipmentId) {
  const [messages, setMessages] = useState(
    shipmentsStore.getMessages(shipmentId)
  );

  useEffect(() => {
    const unsubscribe = shipmentsStore.subscribe(() => {
      setMessages(shipmentsStore.getMessages(shipmentId));
    });

    return unsubscribe;
  }, [shipmentId]);

  return messages;
}

export function useNotifications(role) {
  const [notifications, setNotifications] = useState(
    shipmentsStore.getNotifications(role)
  );

  // Fetch notifications from backend API on mount and every 15 seconds
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const data = await fetchNotificationsApi();
        console.log('[useNotifications] Fetched from API:', data);
        if (Array.isArray(data)) {
          // Clear old notifications and populate with fresh data from backend
          shipmentsStore.clearNotifications();
          
          // Populate store with backend notifications
          data.forEach(notif => {
            console.log('[useNotifications] Adding notification:', notif);
            shipmentsStore.addNotification(notif);
          });
          
          const allNotifs = shipmentsStore.getNotifications(role);
          setNotifications(allNotifs);
          console.log('[useNotifications] Store now has', allNotifs.length, 'notifications:', allNotifs);
        }
      } catch (error) {
        console.error('[useNotifications] Failed to fetch notifications:', error);
      }
    };

    fetchNotifications(); // Initial fetch
    const interval = setInterval(fetchNotifications, 15000); // Poll every 15s

    return () => clearInterval(interval);
  }, [role]);

  useEffect(() => {
    const unsubscribe = shipmentsStore.subscribe(() => {
      setNotifications(shipmentsStore.getNotifications(role));
    });

    return unsubscribe;
  }, [role]);

  return {
    notifications,
    addNotification: (notification) => shipmentsStore.addNotification(notification)
  };
}

