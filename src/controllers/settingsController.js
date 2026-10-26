const SystemSetting = require('../models/SystemSetting');
const AuditLog = require('../models/AuditLog');

// @desc    Get pharmacy system settings
// @route   GET /api/settings
// @access  Private
const getSettings = async (req, res, next) => {
  try {
    const settings = await SystemSetting.getSettings();
    res.json({
      success: true,
      settings
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update pharmacy system settings (Admin only)
// @route   PUT /api/settings
// @access  Private (Admin only)
const updateSettings = async (req, res, next) => {
  try {
    let settings = await SystemSetting.findOne();
    if (!settings) {
      settings = new SystemSetting();
    }

    const {
      currencySymbol,
      approvalRequired,
      approvalThreshold,
      defaultExpiryAlertDays,
      lowStockThresholdDefault,
      companyName,
      pharmacyLicense,
      gstNumber,
      address,
      phone,
      email
    } = req.body;

    if (currencySymbol !== undefined) settings.currencySymbol = currencySymbol;
    if (approvalRequired !== undefined) settings.approvalRequired = Boolean(approvalRequired);
    if (approvalThreshold !== undefined) {
      settings.approvalThreshold = approvalThreshold === null || approvalThreshold === '' ? null : Number(approvalThreshold);
    }
    if (defaultExpiryAlertDays !== undefined) settings.defaultExpiryAlertDays = Number(defaultExpiryAlertDays);
    if (lowStockThresholdDefault !== undefined) settings.lowStockThresholdDefault = Number(lowStockThresholdDefault);
    if (companyName) settings.companyName = companyName;
    if (pharmacyLicense) settings.pharmacyLicense = pharmacyLicense;
    if (gstNumber) settings.gstNumber = gstNumber;
    if (address) settings.address = address;
    if (phone) settings.phone = phone;
    if (email) settings.email = email;

    if (settings.approvalRequired && (settings.approvalThreshold === null || !Number.isFinite(settings.approvalThreshold) || settings.approvalThreshold <= 0)) return res.status(400).json({success:false,message:'Set a positive approval threshold before enabling approval.'});
    settings.currencySymbol = '₹';
    await settings.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'SETTINGS_UPDATED',
      details: `Updated system settings. Approval Required: ${settings.approvalRequired}, Threshold: ${settings.approvalThreshold !== null ? settings.currencySymbol + settings.approvalThreshold : 'None'}`
    });

    res.json({
      success: true,
      message: 'System settings updated successfully',
      settings
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getSettings, updateSettings };
