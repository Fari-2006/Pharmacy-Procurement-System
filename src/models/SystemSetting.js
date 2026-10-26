const mongoose = require('mongoose');

const systemSettingSchema = new mongoose.Schema(
  {
    currencySymbol: {
      type: String,
      default: '₹'
    },
    approvalRequired: {
      type: Boolean,
      default: false
    },
    approvalThreshold: {
      type: Number,
      default: null,
      min: 0
    },
    defaultExpiryAlertDays: {
      type: Number,
      default: 60,
      min: 1
    },
    lowStockThresholdDefault: {
      type: Number,
      default: 20,
      min: 1
    },
    companyName: {
      type: String,
      default: 'MediVault Pharmacy'
    },
    pharmacyLicense: {
      type: String,
      default: 'DL-KA-2026-98442X'
    },
    gstNumber: {
      type: String,
      default: '29ABCDE1234F1Z5'
    },
    address: {
      type: String,
      default: '100 Healthcare Parkway, Medical Zone, Bengaluru, Karnataka 560001'
    },
    phone: {
      type: String,
      default: '+91-80-5550-199'
    },
    email: {
      type: String,
      default: 'procurement@medivault.com'
    }
  },
  {
    timestamps: true
  }
);

// Helper method to get or initialize settings singleton
systemSettingSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

module.exports = mongoose.model('SystemSetting', systemSettingSchema);
