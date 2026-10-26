const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  path: { type: String, required: true },
  mimetype: { type: String, required: true },
  size: { type: Number, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now }
});

const supplierReturnSchema = new mongoose.Schema(
  {
    returnNumber: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    purchaseOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseOrder'
    },
    goodsReceipt: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GoodsReceipt'
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
      index: true
    },
    medicine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: true
    },
    medicineName: {
      type: String,
      required: true
    },
    batchNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    unitCost: {
      type: Number,
      required: true,
      min: 0
    },
    totalValue: {
      type: Number,
      required: true,
      min: 0
    },
    reason: {
      type: String,
      enum: ['Near Expiry', 'Expired', 'Damaged / Defective', 'Incorrect Item', 'Recall', 'Other'],
      required: true
    },
    status: {
      type: String,
      enum: ['Requested', 'Approved', 'Rejected', 'Sent Back', 'Supplier Received', 'Resolved'],
      default: 'Requested',
      index: true
    },
    resolution: {
      type: String,
      enum: ['Pending', 'Replacement', 'Credit Note', 'Refund'],
      default: 'Pending'
    },
    creditNoteReference: {
      type: String,
      default: ''
    },
    statusHistory: [
      {
        status: { type: String, required: true },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        changedByName: { type: String },
        changedAt: { type: Date, default: Date.now },
        notes: { type: String, default: '' }
      }
    ],
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    supplierNotes: {
      type: String,
      default: ''
    },
    attachments: [attachmentSchema]
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('SupplierReturn', supplierReturnSchema);
