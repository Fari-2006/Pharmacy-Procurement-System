const mongoose = require('mongoose');

const poItemSchema = new mongoose.Schema({
  medicine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Medicine',
    required: true
  },
  medicineName: {
    type: String,
    required: true
  },
  genericName: {
    type: String,
    default: ''
  },
  unit: {
    type: String,
    default: 'Strips'
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  lineTotal: {
    type: Number,
    required: true,
    min: 0
  },
  receivedQuantity: {
    type: Number,
    default: 0,
    min: 0
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

const purchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
      index: true
    },
    items: [poItemSchema],
    itemsTotal: {
      type: Number,
      required: true,
      min: 0
    },
    discountPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    taxPercent: {
      type: Number,
      default: 0,
      min: 0
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    grandTotal: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: [
        'Draft',
        'Pending Admin Approval',
        'Submitted',
        'Accepted',
        'Changes Proposed',
        'Rejected',
        'Packed',
        'Dispatched',
        'Delivered',
        'Partially Received',
        'Received',
        'Cancelled'
      ],
      default: 'Draft',
      index: true
    },
    statusHistory: [
      {
        status: { type: String, required: true },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        changedByName: { type: String },
        changedByRole: { type: String },
        changedAt: { type: Date, default: Date.now },
        reason: { type: String, default: '' }
      }
    ],
    adminApproval: {
      required: { type: Boolean, default: false },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      approvedAt: { type: Date },
      rejectionReason: { type: String, default: '' }
    },
    supplierProposedChanges: {
      proposedDeliveryDate: { type: Date },
      proposedItems: [
        {
          medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine' },
          medicineName: { type: String },
          quantity: { type: Number },
          unitPrice: { type: Number },
          lineTotal: { type: Number }
        }
      ],
      reason: { type: String },
      proposedAt: { type: Date },
      status: {
        type: String,
        enum: ['none', 'pending', 'confirmed', 'declined'],
        default: 'none'
      }
    },
    expectedDeliveryDate: {
      type: Date,
      required: true
    },
    shippingDetails: {
      carrier: { type: String, default: '' },
      trackingReference: { type: String, default: '' },
      dispatchedAt: { type: Date },
      deliveredAt: { type: Date },
      notes: { type: String, default: '' }
    },
    attachments: [attachmentSchema],
    notes: {
      type: String,
      default: ''
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Method to calculate line items total and grand total
purchaseOrderSchema.methods.calculateTotals = function () {
  let itemsTotal = 0;
  this.items.forEach(item => {
    item.lineTotal = Number((item.quantity * item.unitPrice).toFixed(2));
    itemsTotal += item.lineTotal;
  });

  this.itemsTotal = Number(itemsTotal.toFixed(2));
  const discPct = Math.min(Math.max(Number(this.discountPercent) || 0, 0), 100);
  this.discountAmount = Number(((this.itemsTotal * discPct) / 100).toFixed(2));

  const taxable = this.itemsTotal - this.discountAmount;
  const taxPct = Math.max(Number(this.taxPercent) || 0, 0);
  this.taxAmount = Number(((taxable * taxPct) / 100).toFixed(2));

  this.grandTotal = Number((taxable + this.taxAmount).toFixed(2));
};

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
