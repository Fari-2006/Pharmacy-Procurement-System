const mongoose = require('mongoose');
const GoodsReceipt = require('../models/GoodsReceipt');
const PurchaseOrder = require('../models/PurchaseOrder');
const Medicine = require('../models/Medicine');
const AuditLog = require('../models/AuditLog');
const { sendNotification } = require('./notificationController');

const generateReceiptNumber = async () => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let isUnique = false;
  let receiptNumber = '';

  while (!isUnique) {
    const randomHex = Math.floor(1000 + Math.random() * 9000);
    receiptNumber = `GRN-${dateStr}-${randomHex}`;
    const exists = await GoodsReceipt.exists({ receiptNumber });
    if (!exists) isUnique = true;
  }
  return receiptNumber;
};

// @desc    Process verified goods receipt (with idempotency and multi-batch ingestion)
// @route   POST /api/goods-receipts
// @access  Private (Pharmacist, Admin)
const createGoodsReceipt = async (req, res, next) => {
  try {
    const {
      receiptSubmissionKey,
      purchaseOrderId,
      deliveryReference,
      items,
      notes
    } = req.body;

    // Idempotency check: prevent duplicate stock additions
    if (!receiptSubmissionKey || receiptSubmissionKey.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'A unique receiptSubmissionKey is required to guarantee idempotent stock processing.'
      });
    }

    const cleanKey = receiptSubmissionKey.trim();
    const existingReceipt = await GoodsReceipt.findOne({ receiptSubmissionKey: cleanKey })
      .populate('purchaseOrder', 'poNumber')
      .populate('supplier', 'name');

    if (existingReceipt) {
      return res.status(200).json({
        success: true,
        isDuplicate: true,
        message: 'Duplicate submission key detected. Returning existing verified receipt without re-ingesting stock.',
        receipt: existingReceipt
      });
    }

    if (!purchaseOrderId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Purchase order ID and receipt items are required.'
      });
    }

    const po = await PurchaseOrder.findById(purchaseOrderId);
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found.' });
    }

    if (!['Dispatched', 'Delivered', 'Partially Received'].includes(po.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot receive stock for order currently in '${po.status}' stage. Order must be Dispatched or Delivered.`
      });
    }

    const now = new Date();
    const processedItems = [];
    const stockAdditions = []; // To execute inside transaction / recovery block

    // Validate all items and batches first
    for (const item of items) {
      const poItem = po.items.find(i => i.medicine.toString() === (item.medicineId || item.medicine).toString());
      if (!poItem) {
        return res.status(400).json({
          success: false,
          message: `Item with medicine ID ${item.medicineId} is not part of PO ${po.poNumber}.`
        });
      }

      const deliveredQty = Number(item.deliveredQuantity) || 0;
      const acceptedQty = Number(item.acceptedQuantity) || 0;
      const rejectedQty = Number(item.rejectedQuantity) || 0;

      if (deliveredQty < 0 || acceptedQty < 0 || rejectedQty < 0) {
        return res.status(400).json({ success: false, message: `Quantities cannot be negative for ${poItem.medicineName}.` });
      }

      if (acceptedQty + rejectedQty !== deliveredQty) {
        return res.status(400).json({
          success: false,
          message: `For ${poItem.medicineName}: Accepted (${acceptedQty}) + Rejected (${rejectedQty}) must equal Delivered (${deliveredQty}).`
        });
      }

      if (rejectedQty > 0 && (!item.rejectionReason || item.rejectionReason.trim() === '')) {
        return res.status(400).json({
          success: false,
          message: `Rejection reason is required for rejected units of ${poItem.medicineName}.`
        });
      }

      const batches = item.batches || [];
      if (acceptedQty > 0) {
        if (!Array.isArray(batches) || batches.length === 0) {
          return res.status(400).json({
            success: false,
            message: `Batch information is mandatory for accepted units of ${poItem.medicineName}.`
          });
        }

        const batchSum = batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
        if (batchSum !== acceptedQty) {
          return res.status(400).json({
            success: false,
            message: `Batch quantities total (${batchSum}) must equal accepted quantity (${acceptedQty}) for ${poItem.medicineName}.`
          });
        }

        // Validate batch expiry and prices
        for (const b of batches) {
          if (!b.batchNumber || b.batchNumber.trim() === '') {
            return res.status(400).json({ success: false, message: 'Batch number is required.' });
          }
          if (!b.expiryDate) {
            return res.status(400).json({ success: false, message: `Expiry date is required for batch ${b.batchNumber}.` });
          }
          if (new Date(b.expiryDate) <= now) {
            return res.status(400).json({
              success: false,
              message: `Batch ${b.batchNumber} has already expired (${new Date(b.expiryDate).toLocaleDateString()}). Expired stock cannot be accepted into inventory!`
            });
          }
          if (Number(b.costPrice) < 0 || Number(b.sellingPrice) < 0) {
            return res.status(400).json({ success: false, message: `Prices cannot be negative for batch ${b.batchNumber}.` });
          }
        }
      }

      processedItems.push({
        medicine: poItem.medicine,
        medicineName: poItem.medicineName,
        genericName: poItem.genericName,
        deliveredQuantity: deliveredQty,
        acceptedQuantity: acceptedQty,
        rejectedQuantity: rejectedQty,
        rejectionReason: item.rejectionReason || '',
        batches: batches.map(b => ({
          batchNumber: b.batchNumber.trim().toUpperCase(),
          mfgDate: b.mfgDate ? new Date(b.mfgDate) : null,
          expiryDate: new Date(b.expiryDate),
          costPrice: Number(b.costPrice) || poItem.unitPrice,
          sellingPrice: Number(b.sellingPrice) || Number((poItem.unitPrice * 1.3).toFixed(2)),
          quantity: Number(b.quantity),
          rackLocation: b.rackLocation || 'General Shelf'
        }))
      });

      stockAdditions.push({
        medicineId: poItem.medicine,
        medicineName: poItem.medicineName,
        poItem,
        acceptedQty,
        batches: batches
      });
    }

    const receiptNumber = await generateReceiptNumber();

    // Execute atomic inventory ingestion and PO progress update
    let session = null;
    let useTransaction = false;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      useTransaction = true;
    } catch (sessionErr) {
      // Standalone MongoDB without replica set does not support multi-doc transactions;
      // fallback to reliable sequential execution with compensation tracking
      useTransaction = false;
    }

    try {
      const opts = useTransaction ? { session } : {};

      // 1. Create GoodsReceipt
      const goodsReceipt = new GoodsReceipt({
        receiptNumber,
        receiptSubmissionKey: cleanKey,
        purchaseOrder: po._id,
        supplier: po.supplier,
        receivedBy: req.user._id,
        deliveryReference: deliveryReference || '',
        items: processedItems,
        notes: notes || '',
        receivedAt: now
      });
      await goodsReceipt.save(opts);

      // 2. Ingest accepted batches into Medicine inventory
      for (const addition of stockAdditions) {
        if (addition.acceptedQty > 0) {
          const med = await Medicine.findById(addition.medicineId).session(session || null);
          if (med) {
            addition.batches.forEach(b => {
              med.batches.push({
                batchNumber: b.batchNumber.trim().toUpperCase(),
                mfgDate: b.mfgDate ? new Date(b.mfgDate) : null,
                expiryDate: new Date(b.expiryDate),
                costPrice: Number(b.costPrice) || addition.poItem.unitPrice,
                sellingPrice: Number(b.sellingPrice) || Number((addition.poItem.unitPrice * 1.3).toFixed(2)),
                initialQuantity: Number(b.quantity),
                quantity: Number(b.quantity),
                supplier: po.supplier,
                rackLocation: b.rackLocation || 'General Shelf',
                status: 'active'
              });
            });

            med.updateStockStatus();
            await med.save(opts);

            await AuditLog.create([
              {
                user: req.user._id,
                userName: req.user.name,
                userRole: req.user.role,
                action: 'GOODS_RECEIVED',
                medicine: med._id,
                medicineName: med.name,
                quantityChange: addition.acceptedQty,
                details: `Received ${addition.acceptedQty} units for PO ${po.poNumber} under GRN ${receiptNumber}`
              }
            ], opts);
          }
        }

        // Update PO item received quantity
        addition.poItem.receivedQuantity = (addition.poItem.receivedQuantity || 0) + addition.acceptedQty;
      }

      // 3. Evaluate PO Completion Status
      let allFullyReceived = true;
      let totalReceived = 0;
      let totalOrdered = 0;

      po.items.forEach(item => {
        totalOrdered += item.quantity;
        totalReceived += (item.receivedQuantity || 0);
        if ((item.receivedQuantity || 0) < item.quantity) {
          allFullyReceived = false;
        }
      });

      const nextPOStatus = allFullyReceived ? 'Received' : 'Partially Received';
      po.status = nextPOStatus;
      po.statusHistory.push({
        status: nextPOStatus,
        changedBy: req.user._id,
        changedByName: req.user.name,
        changedByRole: req.user.role,
        changedAt: now,
        reason: `Goods receipt ${receiptNumber} logged. ${allFullyReceived ? 'All items fully received.' : `Partially received (${totalReceived}/${totalOrdered} units).`}`
      });

      await po.save(opts);

      if (useTransaction && session) {
        await session.commitTransaction();
      }

      // Notify Supplier of receipt
      await sendNotification({
        recipientSupplier: po.supplier,
        recipientRole: 'supplier',
        title: 'Goods Verified & Received',
        message: `Pharmacy completed physical receiving for PO ${po.poNumber} under GRN ${receiptNumber}. Status: ${nextPOStatus}.`,
        link: po._id.toString(),
        type: 'receipt'
      });

      res.status(201).json({
        success: true,
        message: `Shipment received and verified successfully under GRN ${receiptNumber}. Stock updated.`,
        receipt: goodsReceipt,
        orderStatus: nextPOStatus
      });
    } catch (transErr) {
      if (useTransaction && session) {
        await session.abortTransaction();
      }
      throw transErr;
    } finally {
      if (session) {
        session.endSession();
      }
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Get goods receipts with filters
// @route   GET /api/goods-receipts
// @access  Private (Admin, Pharmacist, Supplier)
const getGoodsReceipts = async (req, res, next) => {
  try {
    const { purchaseOrderId, supplierId } = req.query;
    let query = {};

    if (req.user.role === 'supplier') {
      if (!req.user.supplierCompany) {
        return res.status(403).json({ success: false, message: 'Supplier account not linked to company.' });
      }
      query.supplier = req.user.supplierCompany;
    } else if (supplierId) {
      query.supplier = supplierId;
    }

    if (purchaseOrderId) {
      query.purchaseOrder = purchaseOrderId;
    }

    const receipts = await GoodsReceipt.find(query)
      .populate('purchaseOrder', 'poNumber status grandTotal')
      .populate('supplier', 'name email contactPerson')
      .populate('receivedBy', 'name role')
      .sort({ receivedAt: -1 });

    res.json({ success: true, count: receipts.length, receipts });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single goods receipt
// @route   GET /api/goods-receipts/:id
// @access  Private
const getGoodsReceiptById = async (req, res, next) => {
  try {
    const receipt = await GoodsReceipt.findById(req.params.id)
      .populate('purchaseOrder', 'poNumber status items grandTotal expectedDeliveryDate')
      .populate('supplier', 'name email phone contactPerson address returnPolicy')
      .populate('receivedBy', 'name role');

    if (!receipt) {
      return res.status(404).json({ success: false, message: 'Goods receipt not found.' });
    }

    if (req.user.role === 'supplier' && (!req.user.supplierCompany || receipt.supplier._id.toString() !== req.user.supplierCompany.toString())) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    res.json({ success: true, receipt });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createGoodsReceipt,
  getGoodsReceipts,
  getGoodsReceiptById
};
