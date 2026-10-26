const Supplier = require('../models/Supplier');

// Called only from admin account management. A public request cannot claim a company.
module.exports = async function resolveSupplierCompany(companyName, profile = {}) {
  const name = typeof companyName === 'string' ? companyName.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 120) {
    const error = new Error('Enter a supplier company name of 1–120 characters.');
    error.statusCode = 400;
    throw error;
  }
  const companyKey = name.toLowerCase();
  await Supplier.init();
  let company = await Supplier.findOne({ companyKey });
  if (!company) {
    const escaped = name.split(' ').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    company = await Supplier.findOne({ name: new RegExp('^' + escaped + '$', 'i') });
  }
  if (company) {
    if (!company.isActive) {
      const error = new Error('This supplier company is inactive. Activate it in Suppliers Directory before approving the account.');
      error.statusCode = 400;
      throw error;
    }
    return company;
  }
  try {
    return await Supplier.findOneAndUpdate({ companyKey }, { $setOnInsert: {
      name, companyKey, contactPerson: profile.name, email: profile.email, phone: profile.phone
    } }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true });
  } catch (error) {
    if (error.code === 11000) return Supplier.findOne({ companyKey });
    throw error;
  }
};
