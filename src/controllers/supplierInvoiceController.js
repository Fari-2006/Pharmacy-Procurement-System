const SupplierInvoice = require('../models/SupplierInvoice');
const Supplier = require('../models/Supplier');
const AuditLog = require('../models/AuditLog');
const { sendNotification } = require('./notificationController');

// @desc    Record new supplier invoice (with duplicate invoice # check per supplier)
// @route   POST /api/supplier-invoices
// @access  Private (Pharmacist, Admin)
const createInvoice = async (req, res, next) => {
  try {
    const {
      supplierId,
      invoiceNumber,
      purchaseOrderIds,
      goodsReceiptIds,
      invoiceDate,
      dueDate,
      itemsTotal,
      taxAmount = 0,
      notes
    } = req.body;

    if (!supplierId || !invoiceNumber || !itemsTotal || !dueDate) {
      return res.status(400).json({
        success: false,
        message: 'Supplier, invoice number, items total, and due date are required.'
      });
    }

    const supplierDoc = await Supplier.findById(supplierId);
    if (!supplierDoc) return res.status(404).json({ success: false, message: 'Supplier not found.' });

    const cleanInvoiceNum = invoiceNumber.trim().toUpperCase();

    // Prevent duplicate invoices for the same supplier
    const duplicate = await SupplierInvoice.findOne({
      supplier: supplierDoc._id,
      invoiceNumber: cleanInvoiceNum
    });

    if (duplicate) {
      return res.status(400).json({
        success: false,
        message: `An invoice with number "${cleanInvoiceNum}" already exists for supplier "${supplierDoc.name}". Duplicate invoice entry rejected.`
      });
    }

    const itemsTot = Number(Number(itemsTotal).toFixed(2));
    const taxAmt = Number(Number(taxAmount || 0).toFixed(2));
    const totalAmount = Number((itemsTot + taxAmt).toFixed(2));

    const invoice = new SupplierInvoice({
      supplier: supplierDoc._id,
      invoiceNumber: cleanInvoiceNum,
      purchaseOrders: Array.isArray(purchaseOrderIds) ? purchaseOrderIds : (purchaseOrderIds ? [purchaseOrderIds] : []),
      goodsReceipts: Array.isArray(goodsReceiptIds) ? goodsReceiptIds : (goodsReceiptIds ? [goodsReceiptIds] : []),
      invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
      dueDate: new Date(dueDate),
      itemsTotal: itemsTot,
      taxAmount: taxAmt,
      totalAmount,
      creditNotesApplied: 0,
      paidAmount: 0,
      balanceDue: totalAmount,
      status: new Date() > new Date(dueDate) ? 'Overdue' : 'Unpaid',
      notes: notes || '',
      payments: []
    });

    await invoice.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'INVOICE_RECORDED',
      details: `Recorded invoice ${invoice.invoiceNumber} for ${supplierDoc.name}. Total: ₹${invoice.totalAmount}, Due: ${new Date(invoice.dueDate).toLocaleDateString()}`
    });

    // Notify supplier of invoice logged
    await sendNotification({
      recipientSupplier: supplierDoc._id,
      recipientRole: 'supplier',
      title: 'Invoice Registered',
      message: `Invoice ${invoice.invoiceNumber} (Total: ₹${invoice.totalAmount}) logged in MediVault system. Due: ${new Date(invoice.dueDate).toLocaleDateString()}.`,
      link: invoice._id.toString(),
      type: 'invoice'
    });

    res.status(201).json({
      success: true,
      message: `Invoice ${invoice.invoiceNumber} recorded successfully.`,
      invoice
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all supplier invoices with role scoping and balance recalculation
// @route   GET /api/supplier-invoices
// @access  Private (Admin, Pharmacist, Supplier)
const getInvoices = async (req, res, next) => {
  try {
    const { status, supplierId, search, page = 1, limit = 25 } = req.query;
    let query = {};

    if (req.user.role === 'supplier') {
      if (!req.user.supplierCompany) {
        return res.status(403).json({ success: false, message: 'Supplier account not linked to company.' });
      }
      query.supplier = req.user.supplierCompany;
    } else if (supplierId) {
      query.supplier = supplierId;
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (search && search.trim() !== '') {
      query.invoiceNumber = new RegExp(search.trim(), 'i');
    }

    const total = await SupplierInvoice.countDocuments(query);
    const invoices = await SupplierInvoice.find(query)
      .populate('supplier', 'name email phone contactPerson paymentTerms bankDetails')
      .populate('purchaseOrders', 'poNumber grandTotal status')
      .populate('payments.recordedBy', 'name role')
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    // Ensure status is fresh (check overdue)
    const now = new Date();
    for (const inv of invoices) {
      if (inv.balanceDue > 0 && now > new Date(inv.dueDate) && inv.status !== 'Overdue') {
        inv.status = 'Overdue';
        await inv.save();
      }
    }

    res.json({
      success: true,
      count: invoices.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      invoices
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single invoice detail
// @route   GET /api/supplier-invoices/:id
// @access  Private
const getInvoiceById = async (req, res, next) => {
  try {
    const invoice = await SupplierInvoice.findById(req.params.id)
      .populate('supplier', 'name email phone contactPerson address returnPolicy paymentTerms bankDetails')
      .populate('purchaseOrders', 'poNumber status items grandTotal expectedDeliveryDate')
      .populate('goodsReceipts', 'receiptNumber receivedAt deliveryReference items')
      .populate('payments.recordedBy', 'name role');

    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    if (req.user.role === 'supplier' && (!req.user.supplierCompany || invoice.supplier._id.toString() !== req.user.supplierCompany.toString())) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    res.json({ success: true, invoice });
  } catch (error) {
    next(error);
  }
};

// @desc    Record payment for supplier invoice (Pharmacy staff only)
// @route   POST /api/supplier-invoices/:id/payments
// @access  Private (Admin, Pharmacist only - Suppliers CANNOT mark themselves paid)
const recordPayment = async (req, res, next) => {
  try {
    const { amount, paymentDate, paymentMethod, referenceNumber, notes } = req.body;
    const payAmt = Number(Number(amount).toFixed(2));

    if (!payAmt || payAmt <= 0) {
      return res.status(400).json({ success: false, message: 'Valid positive payment amount is required.' });
    }

    const invoice = await SupplierInvoice.findById(req.params.id).populate('supplier', 'name');
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    if (payAmt > invoice.balanceDue) {
      return res.status(400).json({
        success: false,
        message: `Payment amount (₹${payAmt}) exceeds current outstanding balance of ₹${invoice.balanceDue}.`
      });
    }

    invoice.payments.push({
      amount: payAmt,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      paymentMethod: paymentMethod || 'bank_transfer',
      referenceNumber: referenceNumber || '',
      recordedBy: req.user._id,
      notes: notes || ''
    });

    invoice.recalculateBalance();
    await invoice.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'PAYMENT_RECORDED',
      details: `Recorded payment of ₹${payAmt} via ${paymentMethod} (Ref: ${referenceNumber || 'N/A'}) for invoice ${invoice.invoiceNumber}. New balance: ₹${invoice.balanceDue}`
    });

    // Notify supplier of recorded payment
    await sendNotification({
      recipientSupplier: invoice.supplier._id,
      recipientRole: 'supplier',
      title: 'Payment Disbursed',
      message: `Pharmacy recorded payment of ₹${payAmt} for invoice ${invoice.invoiceNumber}. Remaining balance: ₹${invoice.balanceDue}.`,
      link: invoice._id.toString(),
      type: 'payment'
    });

    res.json({
      success: true,
      message: `Payment of ₹${payAmt} recorded successfully. Invoice status: ${invoice.status}.`,
      invoice
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Apply return credit note to supplier invoice
// @route   POST /api/supplier-invoices/:id/apply-credit
// @access  Private (Admin, Pharmacist only)
const applyCreditNote = async (req, res, next) => {
  try {
    const { creditNoteReference, creditAmount } = req.body;
    const creditAmt = Number(Number(creditAmount).toFixed(2));

    if (!creditAmt || creditAmt <= 0 || !creditNoteReference) {
      return res.status(400).json({ success: false, message: 'Valid credit amount and credit note reference are required.' });
    }

    const invoice = await SupplierInvoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    if (creditAmt > invoice.balanceDue) {
      return res.status(400).json({
        success: false,
        message: `Credit amount (₹${creditAmt}) exceeds invoice outstanding balance of ₹${invoice.balanceDue}.`
      });
    }

    invoice.creditNotesApplied = Number(((invoice.creditNotesApplied || 0) + creditAmt).toFixed(2));
    invoice.recalculateBalance();
    await invoice.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'PAYMENT_RECORDED',
      details: `Applied credit note ${creditNoteReference} for ₹${creditAmt} to invoice ${invoice.invoiceNumber}. New balance: ₹${invoice.balanceDue}`
    });

    res.json({
      success: true,
      message: `Credit note ${creditNoteReference} for ₹${creditAmt} applied. New balance: ₹${invoice.balanceDue}.`,
      invoice
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createInvoice,
  getInvoices,
  getInvoiceById,
  recordPayment,
  applyCreditNote
};
