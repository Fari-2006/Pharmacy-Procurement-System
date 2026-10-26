const {number,serial}=require('../services/workflow');
const PurchaseOrder = require('../models/PurchaseOrder');
const Medicine = require('../models/Medicine');
const Supplier = require('../models/Supplier');
const SystemSetting = require('../models/SystemSetting');
const AuditLog = require('../models/AuditLog');
const OrderDiscussion = require('../models/OrderDiscussion');
const { sendNotification } = require('./notificationController');

// Helper to generate unique concurrency-safe PO number
const generatePONumber = async () => serial('PO');

// @desc    Get all purchase orders with role & supplier scoping
// @route   GET /api/purchase-orders
// @access  Private (Admin, Pharmacist, Supplier)
const getPurchaseOrders = async (req, res, next) => {
  try {
    const { status, supplier, search, page = 1, limit = 20 } = req.query;
    let query = {};

    // Supplier can only see their own company's POs
    if (req.user.role === 'supplier') {
      if (!req.user.supplierCompany) {
        return res.status(403).json({ success: false, message: 'Supplier account not linked to company.' });
      }
      query.supplier = req.user.supplierCompany;
      // Do not show drafts or orders pending admin approval to supplier
      query.status = { $nin: ['Draft', 'Pending Admin Approval'] };
    } else if (supplier && supplier !== 'all') {
      query.supplier = supplier;
    }

    if (status && status !== 'all') {
      if(req.user.role==='supplier' && ['Draft','Pending Admin Approval'].includes(status)) return res.json({success:true,orders:[],total:0,pages:0,page:1});
      query.status = status;
    }

    if(req.query.tracking==='true') query.status={$in:['Accepted','Packed','Dispatched','Delivered','Partially Received']};
    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { poNumber: regex },
        { 'items.medicineName': regex },
        { 'items.genericName': regex }
      ];
    }

    const total = await PurchaseOrder.countDocuments(query);
    const orders = await PurchaseOrder.find(query)
      .populate('supplier', 'name email phone contactPerson')
      .populate('createdBy', 'name role')
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    res.json({
      success: true,
      count: orders.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      orders
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single purchase order details
// @route   GET /api/purchase-orders/:id
// @access  Private (Admin, Pharmacist, Assigned Supplier)
const getPurchaseOrderById = async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id)
      .populate('supplier', 'name email phone contactPerson address returnPolicy paymentTerms leadTimeDays bankDetails')
      .populate('createdBy', 'name role')
      .populate('statusHistory.changedBy', 'name role')
      .populate('adminApproval.approvedBy', 'name role');

    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found.' });
    }

    // Role security check
    if (req.user.role === 'supplier') {
      if (!req.user.supplierCompany || po.supplier._id.toString() !== req.user.supplierCompany.toString()) {
        return res.status(403).json({ success: false, message: 'Forbidden: Access denied to other suppliers\' orders.' });
      }
      // Supplier cannot view drafts or pending admin approval
      if (['Draft', 'Pending Admin Approval'].includes(po.status)) {
        return res.status(403).json({ success: false, message: 'Order is not yet available to supplier.' });
      }
    }

    res.json({ success: true, order: po });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new purchase order (Draft or Submitted)
// @route   POST /api/purchase-orders
// @access  Private (Admin, Pharmacist)
const createPurchaseOrder = async (req, res, next) => {
  try {
    const {
      supplierId,
      items,
      discountPercent = 0,
      taxPercent = 0,
      expectedDeliveryDate,
      notes,
      isDraft = false
    } = req.body;

    if (!supplierId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Supplier and at least one item are required.' });
    }

    const supplierDoc = await Supplier.findById(supplierId);
    if (!supplierDoc) {
      return res.status(404).json({ success: false, message: 'Selected supplier not found.' });
    }

    // Process line items
    const processedItems = [];
    let itemsTotal = 0;

    for (const item of items) {
      const med = await Medicine.findById(item.medicineId || item.medicine);
      if (!med) {
        return res.status(400).json({ success: false, message: `Medicine not found for ID: ${item.medicineId}` });
      }

      const qty = number(item.quantity,'quantity',{integer:true,positive:true});
      const price = number(item.unitPrice,'unit price');
      if (qty <= 0 || price < 0) {
        return res.status(400).json({ success: false, message: `Invalid quantity or price for ${med.name}` });
      }

      const lineTotal = Number((qty * price).toFixed(2));
      itemsTotal += lineTotal;

      processedItems.push({
        medicine: med._id,
        medicineName: med.name,
        genericName: med.genericName,
        unit: med.unit || 'Strips',
        quantity: qty,
        unitPrice: price,
        lineTotal,
        receivedQuantity: 0
      });
    }

    const discPct = number(discountPercent,'discount'); if(discPct>100) return res.status(400).json({success:false,message:'Discount must be between 0 and 100.'});
    const discAmount = Number(((itemsTotal * discPct) / 100).toFixed(2));
    const taxable = itemsTotal - discAmount;
    const taxPct = number(taxPercent,'tax');
    const taxAmt = Number(((taxable * taxPct) / 100).toFixed(2));
    const grandTotal = Number((taxable + taxAmt).toFixed(2));

    const poNumber = await generatePONumber();
    const settings = await SystemSetting.getSettings();

    let initialStatus = 'Draft';
    let approvalNeeded = false;

    if (!isDraft) {
      // Evaluate Admin Approval configuration
      if (settings.approvalRequired && settings.approvalThreshold !== null && grandTotal >= settings.approvalThreshold) {
        initialStatus = 'Pending Admin Approval';
        approvalNeeded = true;
      } else {
        initialStatus = 'Submitted';
      }
    }

    const po = new PurchaseOrder({
      poNumber,
      supplier: supplierDoc._id,
      items: processedItems,
      itemsTotal,
      discountPercent: discPct,
      discountAmount: discAmount,
      taxPercent: taxPct,
      taxAmount: taxAmt,
      grandTotal,
      status: initialStatus,
      statusHistory: [
        {
          status: initialStatus,
          changedBy: req.user._id,
          changedByName: req.user.name,
          changedByRole: req.user.role,
          changedAt: new Date(),
          reason: isDraft ? 'Draft order created' : (approvalNeeded ? 'Exceeds approval threshold; pending admin review' : 'Order submitted to supplier')
        }
      ],
      adminApproval: {
        required: approvalNeeded
      },
      expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : new Date(Date.now() + (supplierDoc.leadTimeDays || 5) * 24 * 60 * 60 * 1000),
      notes: notes || '',
      createdBy: req.user._id
    });

    await po.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'PO_CREATED',
      details: `Created Purchase Order ${po.poNumber} (${initialStatus}) for ${supplierDoc.name}. Grand Total: ${settings.currencySymbol}${po.grandTotal}`
    });

    // Send notifications
    if (initialStatus === 'Pending Admin Approval') {
      await sendNotification({
        recipientRole: 'admin',
        title: 'New PO Requires Approval',
        message: `Order ${po.poNumber} for ₹${po.grandTotal.toFixed(2)} requires administrative approval.`,
        link: po._id.toString(),
        type: 'approval'
      });
    } else if (initialStatus === 'Submitted') {
      await sendNotification({
        recipientSupplier: supplierDoc._id,
        recipientRole: 'supplier',
        title: 'New Purchase Order Received',
        message: `MediVault Pharmacy has issued Purchase Order ${po.poNumber} for ₹${po.grandTotal.toFixed(2)}.`,
        link: po._id.toString(),
        type: 'order'
      });
    }

    res.status(201).json({
      success: true,
      message: `Purchase Order ${po.poNumber} created successfully.`,
      order: po
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Edit draft purchase order
// @route   PUT /api/purchase-orders/:id/draft
// @access  Private (Admin, Pharmacist)
const editDraftPurchaseOrder = async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Order not found.' });

    if (po.status !== 'Draft') {
      return res.status(400).json({ success: false, message: 'Only Draft orders can be modified via this action.' });
    }

    const { items, supplierId, discountPercent, taxPercent, expectedDeliveryDate, notes } = req.body;

    if (supplierId) {
      const supplierDoc = await Supplier.findById(supplierId);
      if (!supplierDoc) return res.status(404).json({ success: false, message: 'Supplier not found.' });
      po.supplier = supplierDoc._id;
    }

    if (items && Array.isArray(items)) {
      if(!items.length) return res.status(400).json({success:false,message:'At least one item is required.'});
      const processed = [];
      let total = 0;
      for (const item of items) {
        const med = await Medicine.findById(item.medicineId || item.medicine);
        if (!med) return res.status(400).json({success:false,message:'Medicine not found.'});
        const qty = number(item.quantity,'quantity',{integer:true,positive:true});
        const price = number(item.unitPrice,'unit price');
        const line = Number((qty * price).toFixed(2));
        total += line;
        processed.push({
          medicine: med._id,
          medicineName: med.name,
          genericName: med.genericName,
          unit: med.unit || 'Strips',
          quantity: qty,
          unitPrice: price,
          lineTotal: line,
          receivedQuantity: 0
        });
      }
      po.items = processed;
      po.itemsTotal = total;
    }

    if (discountPercent !== undefined) {po.discountPercent = number(discountPercent,'discount');if(po.discountPercent>100)return res.status(400).json({success:false,message:'Discount cannot exceed 100.'});}
    if (taxPercent !== undefined) po.taxPercent = number(taxPercent,'tax');
    if (expectedDeliveryDate) po.expectedDeliveryDate = new Date(expectedDeliveryDate);
    if (notes !== undefined) po.notes = notes;

    po.calculateTotals();
    await po.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'PO_DRAFT_EDITED',
      details: `Edited draft PO ${po.poNumber}. New Grand Total: ₹${po.grandTotal}`
    });

    res.json({ success: true, message: 'Draft order updated.', order: po });
  } catch (error) {
    next(error);
  }
};

// @desc    Submit draft purchase order
// @route   POST /api/purchase-orders/:id/submit
// @access  Private (Admin, Pharmacist)
const submitDraftPurchaseOrder = async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Order not found.' });

    if (po.status !== 'Draft') {
      return res.status(400).json({ success: false, message: 'Only Draft orders can be submitted.' });
    }

    if (!po.items || po.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order must contain at least one item before submission.' });
    }

    const settings = await SystemSetting.getSettings();
    let newStatus = 'Submitted';
    let approvalNeeded = false;

    if (settings.approvalRequired && settings.approvalThreshold !== null && po.grandTotal >= settings.approvalThreshold) {
      newStatus = 'Pending Admin Approval';
      approvalNeeded = true;
    }

    po.status = newStatus;
    po.adminApproval.required = approvalNeeded;
    po.statusHistory.push({
      status: newStatus,
      changedBy: req.user._id,
      changedByName: req.user.name,
      changedByRole: req.user.role,
      changedAt: new Date(),
      reason: approvalNeeded ? 'Exceeds approval threshold; pending admin review' : 'Draft submitted to supplier'
    });

    await po.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'PO_SUBMITTED',
      details: `Submitted PO ${po.poNumber} (${newStatus})`
    });

    if (newStatus === 'Pending Admin Approval') {
      await sendNotification({
        recipientRole: 'admin',
        title: 'PO Pending Approval',
        message: `PO ${po.poNumber} requires approval (Total: ₹${po.grandTotal}).`,
        link: po._id.toString(),
        type: 'approval'
      });
    } else {
      await sendNotification({
        recipientSupplier: po.supplier,
        recipientRole: 'supplier',
        title: 'New Purchase Order Received',
        message: `Order ${po.poNumber} has been submitted to your company.`,
        link: po._id.toString(),
        type: 'order'
      });
    }

    res.json({ success: true, message: `PO ${po.poNumber} has been ${newStatus}.`, order: po });
  } catch (error) {
    next(error);
  }
};

// @desc    Cancel purchase order (Pharmacist or Admin)
// @route   PUT /api/purchase-orders/:id/cancel
// @access  Private (Admin, Pharmacist)
const cancelPurchaseOrder = async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason || reason.trim() === '') {
      return res.status(400).json({ success: false, message: 'Cancellation reason is required.' });
    }

    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Order not found.' });

    // Cancellation guard: Not allowed if already dispatched, delivered, or received
    if (['Dispatched', 'Delivered', 'Partially Received', 'Received', 'Rejected', 'Cancelled'].includes(po.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel order in '${po.status}' stage. Order is already in transit or received.`
      });
    }

    po.status = 'Cancelled';
    po.statusHistory.push({
      status: 'Cancelled',
      changedBy: req.user._id,
      changedByName: req.user.name,
      changedByRole: req.user.role,
      changedAt: new Date(),
      reason
    });

    await po.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'PO_CANCELLED',
      details: `Cancelled PO ${po.poNumber}. Reason: ${reason}`
    });

    await sendNotification({
      recipientSupplier: po.supplier,
      recipientRole: 'supplier',
      title: 'Order Cancelled',
      message: `Purchase Order ${po.poNumber} was cancelled by pharmacy. Reason: ${reason}`,
      link: po._id.toString(),
      type: 'order'
    });

    res.json({ success: true, message: `Order ${po.poNumber} cancelled.`, order: po });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin approve or reject purchase order
// @route   PUT /api/purchase-orders/:id/admin-approval
// @access  Private (Admin only)
const handleAdminApproval = async (req, res, next) => {
  try {
    const { decision, reason } = req.body;
    if (!decision || !['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision must be either "approve" or "reject".' });
    }

    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Order not found.' });

    if (po.status !== 'Pending Admin Approval') {
      return res.status(400).json({ success: false, message: 'Order is not pending admin approval.' });
    }

    if (decision === 'approve') {
      po.status = 'Submitted';
      po.adminApproval.approvedBy = req.user._id;
      po.adminApproval.approvedAt = new Date();
      po.statusHistory.push({
        status: 'Submitted',
        changedBy: req.user._id,
        changedByName: req.user.name,
        changedByRole: req.user.role,
        changedAt: new Date(),
        reason: 'Approved by Administrator; dispatched to supplier.'
      });

      await po.save();

      await sendNotification({
        recipientSupplier: po.supplier,
        recipientRole: 'supplier',
        title: 'New Purchase Order Received',
        message: `Order ${po.poNumber} has been approved by admin and submitted to your company.`,
        link: po._id.toString(),
        type: 'order'
      });
    } else {
      if (!reason || reason.trim() === '') {
        return res.status(400).json({ success: false, message: 'Rejection reason is mandatory.' });
      }

      po.status = 'Rejected';
      po.adminApproval.rejectionReason = reason;
      po.statusHistory.push({
        status: 'Rejected',
        changedBy: req.user._id,
        changedByName: req.user.name,
        changedByRole: req.user.role,
        changedAt: new Date(),
        reason: `Rejected by Administrator: ${reason}`
      });

      await po.save();

      await sendNotification({
        recipientUser: po.createdBy,
        recipientRole: 'pharmacist',
        title: 'PO Rejected by Admin',
        message: `Purchase Order ${po.poNumber} was rejected by admin. Reason: ${reason}`,
        link: po._id.toString(),
        type: 'approval'
      });
    }

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'PO_ADMIN_APPROVAL',
      details: `Admin ${decision}d PO ${po.poNumber}. Notes: ${reason || 'Approved'}`
    });

    res.json({ success: true, message: `Order ${po.poNumber} ${decision === 'approve' ? 'approved and submitted' : 'rejected'}.`, order: po });
  } catch (error) {
    next(error);
  }
};

// @desc    Supplier accept or reject purchase order
// @route   PUT /api/purchase-orders/:id/supplier-response
// @access  Private (Supplier, Admin)
const handleSupplierResponse = async (req, res, next) => {
  try {
    const { decision, reason } = req.body;
    if (!decision || !['accept', 'reject'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision must be either "accept" or "reject".' });
    }

    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Order not found.' });

    // Verify company ownership if supplier
    if (req.user.role === 'supplier' && (!req.user.supplierCompany || po.supplier.toString() !== req.user.supplierCompany.toString())) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied to other companies\' orders.' });
    }

    if (!['Submitted', 'Changes Proposed'].includes(po.status)) {
      return res.status(400).json({ success: false, message: `Cannot respond to order in '${po.status}' status.` });
    }

    if (decision === 'accept') {
      po.status = 'Accepted';
      po.statusHistory.push({
        status: 'Accepted',
        changedBy: req.user._id,
        changedByName: req.user.name,
        changedByRole: req.user.role,
        changedAt: new Date(),
        reason: 'Order accepted by supplier under agreed terms.'
      });
      await po.save();

      await sendNotification({
        recipientRole: 'pharmacist',
        title: 'Order Accepted by Supplier',
        message: `Supplier has accepted PO ${po.poNumber}.`,
        link: po._id.toString(),
        type: 'order'
      });
    } else {
      if (!reason || reason.trim() === '') {
        return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
      }
      po.status = 'Rejected';
      po.statusHistory.push({
        status: 'Rejected',
        changedBy: req.user._id,
        changedByName: req.user.name,
        changedByRole: req.user.role,
        changedAt: new Date(),
        reason: `Rejected by supplier: ${reason}`
      });
      await po.save();

      await sendNotification({
        recipientRole: 'pharmacist',
        title: 'Order Rejected by Supplier',
        message: `PO ${po.poNumber} was rejected by supplier. Reason: ${reason}`,
        link: po._id.toString(),
        type: 'order'
      });
    }

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'PO_SUPPLIER_RESPONSE',
      details: `Supplier ${decision}ed PO ${po.poNumber}. Reason: ${reason || 'Accepted'}`
    });

    res.json({ success: true, message: `Order ${decision}ed successfully.`, order: po });
  } catch (error) {
    next(error);
  }
};

// @desc    Supplier proposes changes to quantity, price, or delivery date
// @route   PUT /api/purchase-orders/:id/propose-changes
// @access  Private (Supplier, Admin)
const proposeChanges = async (req, res, next) => {
  try {
    const { proposedDeliveryDate, proposedItems, reason } = req.body;
    if (!reason || reason.trim() === '') {
      return res.status(400).json({ success: false, message: 'Reason for proposed changes is required.' });
    }

    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Order not found.' });

    if (req.user.role === 'supplier' && (!req.user.supplierCompany || po.supplier.toString() !== req.user.supplierCompany.toString())) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied.' });
    }

    if (!['Submitted', 'Accepted'].includes(po.status)) {
      return res.status(400).json({ success: false, message: `Cannot propose changes to order in '${po.status}' stage.` });
    }

    const validatedProposedItems = [];
    if (proposedItems && Array.isArray(proposedItems)) {
      for (const pItem of proposedItems) {
        const origItem = po.items.find(i => i.medicine.toString() === (pItem.medicineId || pItem.medicine).toString());
        if (!origItem) return res.status(400).json({success:false,message:'Proposed medicine is not in the order.'});

        const qty = pItem.quantity===undefined?origItem.quantity:number(pItem.quantity,'proposed quantity',{integer:true,positive:true});
        const price = pItem.unitPrice===undefined?origItem.unitPrice:number(pItem.unitPrice,'proposed price');
        const lineTotal = Number((qty * price).toFixed(2));

        validatedProposedItems.push({
          medicineId: origItem.medicine,
          medicineName: origItem.medicineName,
          quantity: qty,
          unitPrice: price,
          lineTotal
        });
      }
    }

    po.supplierProposedChanges = {
      proposedDeliveryDate: proposedDeliveryDate ? new Date(proposedDeliveryDate) : po.expectedDeliveryDate,
      proposedItems: validatedProposedItems,
      reason,
      proposedAt: new Date(),
      status: 'pending'
    };

    po.status = 'Changes Proposed';
    po.statusHistory.push({
      status: 'Changes Proposed',
      changedBy: req.user._id,
      changedByName: req.user.name,
      changedByRole: req.user.role,
      changedAt: new Date(),
      reason: `Supplier proposed revisions: ${reason}`
    });

    await po.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'PO_CHANGES_PROPOSED',
      details: `Supplier proposed modifications for PO ${po.poNumber}: ${reason}`
    });

    await sendNotification({
      recipientRole: 'pharmacist',
      title: 'Supplier Proposed Order Changes',
      message: `Revisions proposed for PO ${po.poNumber}. Review requested.`,
      link: po._id.toString(),
      type: 'order'
    });

    res.json({ success: true, message: 'Proposed modifications submitted for pharmacist review.', order: po });
  } catch (error) {
    next(error);
  }
};

// @desc    Pharmacist confirms or declines supplier-proposed changes
// @route   PUT /api/purchase-orders/:id/review-proposed-changes
// @access  Private (Pharmacist, Admin)
const reviewProposedChanges = async (req, res, next) => {
  try {
    const { decision, notes } = req.body; // 'confirm' or 'decline'
    if (!decision || !['confirm', 'decline'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision must be "confirm" or "decline".' });
    }

    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Order not found.' });

    if (po.status !== 'Changes Proposed') {
      return res.status(400).json({ success: false, message: 'Order has no pending proposed changes.' });
    }

    const settings = await SystemSetting.getSettings();

    if (decision === 'confirm') {
      const changes = po.supplierProposedChanges;
      if (changes.proposedDeliveryDate) {
        po.expectedDeliveryDate = changes.proposedDeliveryDate;
      }

      if (changes.proposedItems && changes.proposedItems.length > 0) {
        changes.proposedItems.forEach(pItem => {
          const orig = po.items.find(i => i.medicine.toString() === pItem.medicineId.toString());
          if (orig) {
            orig.quantity = pItem.quantity;
            orig.unitPrice = pItem.unitPrice;
            orig.lineTotal = Number((pItem.quantity * pItem.unitPrice).toFixed(2));
          }
        });
      }

      po.calculateTotals();
      po.supplierProposedChanges.status = 'confirmed';

      // CRITICAL RE-APPROVAL RULE: Check if new grandTotal triggers or re-triggers approval requirement
      let nextStatus = 'Accepted';
      let reApprovalNeeded = false;

      if (settings.approvalRequired && settings.approvalThreshold !== null && po.grandTotal >= settings.approvalThreshold) {
        nextStatus = 'Pending Admin Approval';
        reApprovalNeeded = true;
      }

      po.status = nextStatus;
      po.adminApproval.required = reApprovalNeeded;
      po.statusHistory.push({
        status: nextStatus,
        changedBy: req.user._id,
        changedByName: req.user.name,
        changedByRole: req.user.role,
        changedAt: new Date(),
        reason: reApprovalNeeded
          ? `Confirmed changes increased order total to ₹${po.grandTotal}, exceeding threshold. Pending Admin Re-Approval.`
          : 'Pharmacist confirmed supplier-proposed changes. Order accepted.'
      });

      await po.save();

      if (reApprovalNeeded) {
        await sendNotification({
          recipientRole: 'admin',
          title: 'PO Changes Require Re-Approval',
          message: `Revised PO ${po.poNumber} total of ₹${po.grandTotal} exceeds threshold. Re-approval needed.`,
          link: po._id.toString(),
          type: 'approval'
        });
      } else {
        await sendNotification({
          recipientSupplier: po.supplier,
          recipientRole: 'supplier',
          title: 'Order Terms Confirmed',
          message: `Pharmacist confirmed your proposed changes for PO ${po.poNumber}.`,
          link: po._id.toString(),
          type: 'order'
        });
      }
    } else {
      po.supplierProposedChanges.status = 'declined';
      po.status = 'Submitted'; // Reverts to submitted for supplier reconsideration
      po.statusHistory.push({
        status: 'Submitted',
        changedBy: req.user._id,
        changedByName: req.user.name,
        changedByRole: req.user.role,
        changedAt: new Date(),
        reason: `Pharmacist declined proposed changes. Reason/Notes: ${notes || 'Terms rejected'}`
      });

      await po.save();

      await sendNotification({
        recipientSupplier: po.supplier,
        recipientRole: 'supplier',
        title: 'Proposed Changes Declined',
        message: `Pharmacist declined proposed changes for PO ${po.poNumber}. ${notes ? `Notes: ${notes}` : ''}`,
        link: po._id.toString(),
        type: 'order'
      });
    }

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'PO_CHANGES_REVIEWED',
      details: `Pharmacist ${decision}ed proposed changes for PO ${po.poNumber}. Status now ${po.status}`
    });

    res.json({ success: true, message: `Proposed changes have been ${decision}ed.`, order: po });
  } catch (error) {
    next(error);
  }
};

// @desc    Supplier updates packing, dispatch, or delivery progress
// @route   PUT /api/purchase-orders/:id/shipping
// @access  Private (Supplier, Admin)
const updateShippingProgress = async (req, res, next) => {
  try {
    const { stage, carrier, trackingReference, notes, expectedDeliveryDate } = req.body;
    // stage: 'packed', 'dispatched', 'delivered'
    if (!stage || !['packed', 'dispatched', 'delivered', 'delay'].includes(stage)) {
      return res.status(400).json({ success: false, message: 'Stage must be "packed", "dispatched", or "delivered".' });
    }

    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Order not found.' });

    if (req.user.role === 'supplier' && (!req.user.supplierCompany || po.supplier.toString() !== req.user.supplierCompany.toString())) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied.' });
    }

    const now = new Date();

    if(stage==='delay'){
      if(!['Accepted','Packed','Dispatched','Partially Received'].includes(po.status)||!notes?.trim()||!Number.isFinite(+new Date(expectedDeliveryDate))) return res.status(400).json({success:false,message:'Provide a revised date and reason for an in-progress order.'});
      po.expectedDeliveryDate=new Date(expectedDeliveryDate);po.shippingDetails.notes=notes;
      po.statusHistory.push({status:po.status,changedBy:req.user._id,changedByName:req.user.name,reason:'Delivery delayed: '+notes});
      await po.save();await sendNotification({recipientRole:'pharmacist',title:'Delivery delayed',message:po.poNumber+': '+notes,link:String(po._id),type:'delivery'});
      return res.json({success:true,order:po});
    }
    if (stage === 'packed') {
      if (!['Accepted'].includes(po.status)) {
        return res.status(400).json({ success: false, message: `Cannot mark packed from '${po.status}' stage.` });
      }
      po.status = 'Packed';
      po.statusHistory.push({
        status: 'Packed',
        changedBy: req.user._id,
        changedByName: req.user.name,
        changedByRole: req.user.role,
        changedAt: now,
        reason: 'Consignment packed and staged for courier handover.'
      });
    } else if (stage === 'dispatched') {
      if (!['Packed'].includes(po.status)) {
        return res.status(400).json({ success: false, message: `Cannot dispatch from '${po.status}' stage.` });
      }
      po.status = 'Dispatched';
      po.shippingDetails.carrier = carrier || po.shippingDetails.carrier || '';
      po.shippingDetails.trackingReference = trackingReference || po.shippingDetails.trackingReference || '';
      po.shippingDetails.dispatchedAt = now;
      if (notes) po.shippingDetails.notes = notes;

      po.statusHistory.push({
        status: 'Dispatched',
        changedBy: req.user._id,
        changedByName: req.user.name,
        changedByRole: req.user.role,
        changedAt: now,
        reason: `Dispatched via ${po.shippingDetails.carrier} (Ref: ${po.shippingDetails.trackingReference})`
      });

      await sendNotification({
        recipientRole: 'pharmacist',
        title: 'Shipment Dispatched',
        message: `Order ${po.poNumber} has been dispatched via ${po.shippingDetails.carrier} (Tracking: ${po.shippingDetails.trackingReference}).`,
        link: po._id.toString(),
        type: 'delivery'
      });
    } else if (stage === 'delivered') {
      if (!['Dispatched'].includes(po.status)) {
        return res.status(400).json({ success: false, message: `Cannot mark delivered from '${po.status}' stage.` });
      }
      po.status = 'Delivered';
      po.shippingDetails.deliveredAt = now;
      if (notes) po.shippingDetails.notes = notes;

      po.statusHistory.push({
        status: 'Delivered',
        changedBy: req.user._id,
        changedByName: req.user.name,
        changedByRole: req.user.role,
        changedAt: now,
        reason: 'Supplier reported delivery completion. Awaiting pharmacist physical verification.'
      });

      await sendNotification({
        recipientRole: 'pharmacist',
        title: 'Shipment Delivered',
        message: `Supplier reports delivery of PO ${po.poNumber}. Please perform verified receiving.`,
        link: po._id.toString(),
        type: 'receipt'
      });
    }

    await po.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'PO_SHIPPING_UPDATED',
      details: `Updated shipping stage to ${po.status} for PO ${po.poNumber}`
    });

    res.json({ success: true, message: `Shipping progress updated to ${po.status}.`, order: po });
  } catch (error) {
    next(error);
  }
};

// @desc    Post order discussion message
// @route   POST /api/purchase-orders/:id/discussion
// @access  Private (Admin, Pharmacist, Assigned Supplier)
const addDiscussionMessage = async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message || message.trim() === '') {
      return res.status(400).json({ success: false, message: 'Message content is required.' });
    }

    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Order not found.' });

    if (req.user.role === 'supplier' && (!req.user.supplierCompany || po.supplier.toString() !== req.user.supplierCompany.toString())) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    const discussion = await OrderDiscussion.create({
      purchaseOrder: po._id,
      sender: req.user._id,
      senderName: req.user.name,
      senderRole: req.user.role,
      senderSupplier: req.user.supplierCompany || null,
      message: message.trim()
    });

    // Notify counterparty
    if (req.user.role === 'supplier') {
      await sendNotification({
        recipientRole: 'pharmacist',
        title: 'New Message on PO',
        message: `${req.user.name} posted on PO ${po.poNumber}: "${message.substring(0, 50)}..."`,
        link: po._id.toString(),
        type: 'discussion'
      });
    } else {
      await sendNotification({
        recipientSupplier: po.supplier,
        recipientRole: 'supplier',
        title: 'New Message from Pharmacy',
        message: `${req.user.name} posted on PO ${po.poNumber}: "${message.substring(0, 50)}..."`,
        link: po._id.toString(),
        type: 'discussion'
      });
    }

    res.status(201).json({ success: true, discussion });
  } catch (error) {
    next(error);
  }
};

// @desc    Get order discussion messages
// @route   GET /api/purchase-orders/:id/discussion
// @access  Private (Admin, Pharmacist, Assigned Supplier)
const getDiscussionMessages = async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Order not found.' });

    if (req.user.role === 'supplier' && (!req.user.supplierCompany || po.supplier.toString() !== req.user.supplierCompany.toString())) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    const messages = await OrderDiscussion.find({ purchaseOrder: po._id }).sort({ createdAt: 1 });
    res.json({ success: true, messages });
  } catch (error) {
    next(error);
  }
};

// @desc    Check open POs for a medicine to warn about duplicates
// @route   GET /api/purchase-orders/check-open
// @access  Private (Admin, Pharmacist)
const checkOpenPOs = async (req, res, next) => {
  try {
    const { medicineId } = req.query;
    if (!medicineId) return res.json({ success: true, openPOs: [] });

    const openOrders = await PurchaseOrder.find({
      status: { $in: ['Submitted', 'Accepted', 'Changes Proposed', 'Packed', 'Dispatched', 'Delivered', 'Partially Received'] },
      'items.medicine': medicineId
    }).select('poNumber status expectedDeliveryDate items supplier').populate('supplier', 'name');

    const result = openOrders.map(o => {
      const item = o.items.find(i => i.medicine.toString() === medicineId.toString());
      return {
        poNumber: o.poNumber,
        status: o.status,
        supplierName: o.supplier?.name || 'Unknown',
        expectedDeliveryDate: o.expectedDeliveryDate,
        orderedQuantity: item ? item.quantity : 0,
        outstandingQuantity: item ? (item.quantity - (item.receivedQuantity || 0)) : 0
      };
    });

    res.json({ success: true, openPOs: result });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  editDraftPurchaseOrder,
  submitDraftPurchaseOrder,
  cancelPurchaseOrder,
  handleAdminApproval,
  handleSupplierResponse,
  proposeChanges,
  reviewProposedChanges,
  updateShippingProgress,
  addDiscussionMessage,
  getDiscussionMessages,
  checkOpenPOs
};
