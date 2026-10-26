const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Supplier name is required'],
      trim: true,
      maxlength: 120
    },
    contactPerson: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    phone: {
      type: String,
      trim: true
    },
    address: {
      type: String,
      trim: true
    },
    suppliedCategories: {
      type: [String],
      default: []
    },
    notes: {
      type: String,
      trim: true
    },
    leadTimeDays: {
      type: Number,
      default: 5,
      min: 1
    },
    safetyStockDays: {
      type: Number,
      default: 7,
      min: 0
    },
    paymentTerms: {
      type: String,
      default: 'Net 30'
    },
    bankDetails: {
      accountName: { type: String, default: '' },
      accountNumber: { type: String, default: '' },
      ifscCode: { type: String, default: '' },
      bankName: { type: String, default: '' },
      upiId: { type: String, default: '' }
    },
    returnPolicy: {
      acceptsNearExpiryReturns: { type: Boolean, default: true },
      minimumDaysBeforeExpiry: { type: Number, default: 45 },
      acceptsDamagedReturns: { type: Boolean, default: true },
      policyNotes: { type: String, default: 'Returns accepted within window subject to batch inspection.' }
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Supplier', supplierSchema);
