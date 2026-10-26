const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Authenticate JWT Token
const authenticate = async (req, res, next) => {
  try {
    let token;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. No token provided.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_pharmacy_jwt_key_2026_xyz');
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User belonging to this token no longer exists.'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact an administrator.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.'
    });
  }
};

// Role-Based Access Control Middleware
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Access restricted to [${roles.join(', ')}] roles. Your role is '${req.user ? req.user.role : 'none'}'.`
      });
    }
    next();
  };
};

// Enforce Supplier Company Ownership
const enforceSupplierOwnership = (req, res, next) => {
  if (req.user && req.user.role === 'supplier') {
    if (!req.user.supplierCompany) {
      return res.status(403).json({
        success: false,
        message: 'Supplier account is not linked to any supplier company.'
      });
    }
    req.supplierCompanyId = req.user.supplierCompany.toString();
  }
  next();
};

module.exports = { authenticate, authorizeRoles, enforceSupplierOwnership };
