const User = require('../models/User');
const Supplier = require('../models/Supplier');
const AuditLog = require('../models/AuditLog');

// @desc    Get all users (Admin only)
// @route   GET /api/users
// @access  Private/Admin
const getUsers = async (req, res, next) => {
  try {
    const users = await User.find()
      .select('-password')
      .populate('supplierCompany', 'name email contactPerson')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: users.length,
      users
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a new user (Admin only)
// @route   POST /api/users
// @access  Private/Admin
const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role, phone, supplierCompany } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, password, and role are required'
      });
    }

    if (role === 'supplier' && !supplierCompany) {
      return res.status(400).json({
        success: false,
        message: 'Supplier accounts must be linked to a supplier company.'
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    let linkedCompany = null;
    if (supplierCompany) {
      const supExists = await Supplier.findById(supplierCompany);
      if (!supExists) {
        return res.status(400).json({ success: false, message: 'Specified supplier company does not exist.' });
      }
      linkedCompany = supExists._id;
    }

    const newUser = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      role,
      phone,
      supplierCompany: linkedCompany
    });

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'USER_MANAGEMENT',
      details: `Created new user account: ${newUser.email} with role: ${newUser.role}${linkedCompany ? ` linked to supplier ${linkedCompany}` : ''}`
    });

    res.status(201).json({
      success: true,
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        phone: newUser.phone,
        supplierCompany: newUser.supplierCompany,
        isActive: newUser.isActive
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update a user (Admin only)
// @route   PUT /api/users/:id
// @access  Private/Admin
const updateUser = async (req, res, next) => {
  try {
    const { name, role, phone, isActive, password, supplierCompany } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (name) user.name = name;
    if (role) {
      user.role = role;
      if (role === 'supplier' && supplierCompany) {
        user.supplierCompany = supplierCompany;
      } else if (role !== 'supplier') {
        user.supplierCompany = null;
      }
    }
    if (supplierCompany !== undefined && user.role === 'supplier') {
      user.supplierCompany = supplierCompany;
    }
    if (phone !== undefined) user.phone = phone;
    if (isActive !== undefined) {user.isActive = isActive;if(isActive===true && user.registrationStatus==='pending') user.registrationStatus='approved';}
    if (password && password.trim().length >= 6) {
      user.password = password;
    }

    if (user.role === 'supplier' && user.isActive && (!user.supplierCompany || !await Supplier.exists({_id:user.supplierCompany,isActive:{$ne:false}}))) return res.status(400).json({success:false,message:'Select a valid supplier company.'});
    await user.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'USER_MANAGEMENT',
      details: `Updated user account: ${user.email} (Role: ${user.role}, Active: ${user.isActive})`
    });

    res.json({
      success: true,
      message: 'User updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        supplierCompany: user.supplierCompany,
        isActive: user.isActive
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete/Deactivate user (Admin only)
// @route   DELETE /api/users/:id
// @access  Private/Admin
const deleteUser = async (req, res, next) => {
  try {
    if (req.user._id.toString() === req.params.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own admin account'
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.isActive = false;
    if(user.registrationStatus==='pending')user.registrationStatus='rejected';
    if (user.role === 'supplier' && user.isActive && (!user.supplierCompany || !await Supplier.exists({_id:user.supplierCompany,isActive:{$ne:false}}))) return res.status(400).json({success:false,message:'Select a valid supplier company.'});
    await user.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'USER_MANAGEMENT',
      details: `Deleted user: ${user.email}`
    });

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getUsers, createUser, updateUser, deleteUser };
