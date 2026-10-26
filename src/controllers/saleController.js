const Sale = require('../models/Sale');
const Medicine = require('../models/Medicine');
const AuditLog = require('../models/AuditLog');

// Generate unique sequential / timestamped invoice number
const generateInvoiceNumber = async () => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const countToday = await Sale.countDocuments({
    createdAt: {
      $gte: new Date(today.setHours(0, 0, 0, 0)),
      $lte: new Date(today.setHours(23, 59, 59, 999))
    }
  });
  const seq = String(countToday + 1).padStart(4, '0');
  return `INV-${dateStr}-${seq}`;
};

// @desc    Process new sale / POS dispensing
// @route   POST /api/sales
// @access  Private (Admin, Pharmacist, Cashier)
const createSale = async (req, res, next) => {
  try {
    const {
      customerName,
      customerPhone,
      doctorName,
      paymentMethod,
      discountPercent = 0,
      taxPercent = 0,
      paidAmount = 0,
      items,
      notes
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty. Please add items to checkout.'
      });
    }

    const processedItems = [];
    let subtotal = 0;
    const now = new Date();

    // Validate inventory and prepare item deductions
    for (const item of items) {
      const { medicineId, batchNumber, quantity } = item;
      const numQty = Number(quantity);

      if (!numQty || numQty <= 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid quantity for item: ${item.medicineName || medicineId}`
        });
      }

      const medicine = await Medicine.findById(medicineId);
      if (!medicine) {
        return res.status(404).json({
          success: false,
          message: `Medicine not found for ID: ${medicineId}`
        });
      }

      const batch = medicine.batches.find(b => b.batchNumber === batchNumber.toUpperCase().trim());
      if (!batch) {
        return res.status(400).json({
          success: false,
          message: `Batch ${batchNumber} not found for ${medicine.name}`
        });
      }

      // Check expiry
      if (new Date(batch.expiryDate) < now) {
        return res.status(400).json({
          success: false,
          message: `Batch ${batchNumber} for ${medicine.name} has expired on ${new Date(batch.expiryDate).toLocaleDateString()}!`
        });
      }

      // Check stock sufficiency
      if (batch.quantity < numQty) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock in batch ${batchNumber} for ${medicine.name}. Available: ${batch.quantity}, Requested: ${numQty}`
        });
      }

      const itemSubtotal = batch.sellingPrice * numQty;
      subtotal += itemSubtotal;

      processedItems.push({
        medicineDoc: medicine,
        batchDoc: batch,
        medicine: medicine._id,
        medicineName: medicine.name,
        genericName: medicine.genericName,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        quantity: numQty,
        unitPrice: batch.sellingPrice,
        subtotal: itemSubtotal
      });
    }

    // Apply stock deductions
    for (const pItem of processedItems) {
      pItem.batchDoc.quantity -= pItem.quantity;
      if (pItem.batchDoc.quantity === 0) {
        pItem.batchDoc.status = 'depleted';
      }
      pItem.medicineDoc.updateStockStatus();
      await pItem.medicineDoc.save();

      // Stock Log
      await AuditLog.create({
        user: req.user._id,
        userName: req.user.name,
        userRole: req.user.role,
        action: 'SALE_DISPENSED',
        medicine: pItem.medicine,
        medicineName: pItem.medicineName,
        batchNumber: pItem.batchNumber,
        quantityChange: -pItem.quantity,
        details: `Dispensed ${pItem.quantity} units from batch ${pItem.batchNumber}`
      });
    }

    // Calculations
    const discPct = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
    const discountAmount = Number(((subtotal * discPct) / 100).toFixed(2));
    const taxableAmount = subtotal - discountAmount;
    const taxPct = Math.max(Number(taxPercent) || 0, 0);
    const taxAmount = Number(((taxableAmount * taxPct) / 100).toFixed(2));
    const grandTotal = Number((taxableAmount + taxAmount).toFixed(2));
    const paid = Number(paidAmount) || grandTotal;
    const changeAmount = paid >= grandTotal ? Number((paid - grandTotal).toFixed(2)) : 0;

    const invoiceNumber = await generateInvoiceNumber();

    const sale = new Sale({
      invoiceNumber,
      customerName: customerName ? customerName.trim() : 'Walk-in Customer',
      customerPhone: customerPhone ? customerPhone.trim() : '',
      doctorName: doctorName ? doctorName.trim() : '',
      items: processedItems.map(pi => ({
        medicine: pi.medicine,
        medicineName: pi.medicineName,
        genericName: pi.genericName,
        batchNumber: pi.batchNumber,
        expiryDate: pi.expiryDate,
        quantity: pi.quantity,
        unitPrice: pi.unitPrice,
        subtotal: pi.subtotal
      })),
      subtotal,
      discountPercent: discPct,
      discountAmount,
      taxPercent: taxPct,
      taxAmount,
      grandTotal,
      paymentMethod: paymentMethod || 'cash',
      paidAmount: paid,
      changeAmount,
      dispensedBy: req.user._id,
      notes
    });

    await sale.save();

    const populatedSale = await Sale.findById(sale._id)
      .populate('dispensedBy', 'name role email');

    res.status(201).json({
      success: true,
      message: 'Sale completed successfully',
      sale: populatedSale
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get sales history
// @route   GET /api/sales
// @access  Private
const getSales = async (req, res, next) => {
  try {
    const { search, startDate, endDate, page = 1, limit = 25 } = req.query;
    let query = {};

    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { invoiceNumber: regex },
        { customerName: regex },
        { customerPhone: regex }
      ];
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    // If role is cashier, cashier can optionally only view their own sales, or all sales
    // Typically in a pharmacy, cashiers can see their daily transactions
    const skip = (Number(page) - 1) * Number(limit);
    const total = await Sale.countDocuments(query);
    const sales = await Sale.find(query)
      .populate('dispensedBy', 'name role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({
      success: true,
      count: sales.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      sales
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get sale by ID (for receipt printing)
// @route   GET /api/sales/:id
// @access  Private
const getSaleById = async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id)
      .populate('dispensedBy', 'name role');

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: 'Sale/Invoice record not found'
      });
    }

    res.json({
      success: true,
      sale
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createSale,
  getSales,
  getSaleById
};
