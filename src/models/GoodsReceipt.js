const mongoose = require('mongoose');

const receiptBatchSchema = new mongoose.Schema({
  batchNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  mfgDate: {
    type: Date
  },
  expiryDate: {
    type: Date,
    required: true
  },
  costPrice: {
    type: Number,
    required: true,
    min: 0
  },
  sellingPrice: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  rackLocation: {
    type: String,
    default: 'General Shelf'
  }
});

const receiptItemSchema = new mongoose.Schema({
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
    type: String
  },
  deliveredQuantity: {
    type: Number,
    required: true,
    min: 0
  },
  acceptedQuantity: {
    type: Number,
    required: true,
    min: 0
  },
  rejectedQuantity: {
    type: Number,
    default: 0,
    min: 0
  },
  rejectionReason: {
    type: String,
    default: ''
  },
  batches: [receiptBatchSchema]
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

const goodsReceiptSchema = new mongoose.Schema(
  {
    requestHash: String,
    receiptNumber: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    receiptSubmissionKey: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    purchaseOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseOrder',
      required: true,
      index: true
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
      index: true
    },
    receivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    deliveryReference: {
      type: String,
      default: ''
    },
    items: [receiptItemSchema],
    attachments: [attachmentSchema],
    notes: {
      type: String,
      default: ''
    },
    receivedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('GoodsReceipt', goodsReceiptSchema);
