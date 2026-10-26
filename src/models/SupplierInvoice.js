const mongoose = require('mongoose');

const paymentEntrySchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },
  paymentDate: {
    type: Date,
    default: Date.now
  },
  paymentMethod: {
    type: String,
    enum: ['bank_transfer', 'cheque', 'upi', 'cash', 'wire', 'other'],
    default: 'bank_transfer'
  },
  referenceNumber: {
    type: String,
    default: ''
  },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: {
    type: String,
    default: ''
  }
});

const attachmentSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  path: { type: String, required: true },
  mimetype: { type: String, required: true },
  size: { type: Number, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now }
});

const supplierInvoiceSchema = new mongoose.Schema(
  {
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
      index: true
    },
    invoiceNumber: {
      type: String,
      required: true,
      trim: true
    },
    purchaseOrders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PurchaseOrder'
      }
    ],
    goodsReceipts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GoodsReceipt'
      }
    ],
    invoiceDate: {
      type: Date,
      required: true
    },
    dueDate: {
      type: Date,
      required: true
    },
    itemsTotal: {
      type: Number,
      required: true,
      min: 0
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0
    },
    creditNotesApplied: {
      type: Number,
      default: 0,
      min: 0
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    balanceDue: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: ['Unpaid', 'Partially Paid', 'Paid', 'Overdue'],
      default: 'Unpaid',
      index: true
    },
    payments: [paymentEntrySchema],
    attachments: [attachmentSchema],
    notes: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

// Compound unique index prevents duplicate invoice numbers for the same supplier
supplierInvoiceSchema.index({ supplier: 1, invoiceNumber: 1 }, { unique: true });

// Dynamic recalculation of balance and payment status
supplierInvoiceSchema.methods.recalculateBalance = function () {
  const totalPaid = this.payments.reduce((acc, p) => acc + (p.amount || 0), 0);
  this.paidAmount = Number(totalPaid.toFixed(2));

  const totalCredits = Number((this.creditNotesApplied || 0).toFixed(2));
  const remaining = Number((this.totalAmount - totalCredits - this.paidAmount).toFixed(2));
  this.balanceDue = Math.max(remaining, 0);

  const now = new Date();
  if (this.balanceDue <= 0) {
    this.status = 'Paid';
  } else if (this.paidAmount > 0 || totalCredits > 0) {
    this.status = 'Partially Paid';
  } else if (now > new Date(this.dueDate)) {
    this.status = 'Overdue';
  } else {
    this.status = 'Unpaid';
  }
};

supplierInvoiceSchema.pre('save', function () {
  this.recalculateBalance();
});

module.exports = mongoose.model('SupplierInvoice', supplierInvoiceSchema);
