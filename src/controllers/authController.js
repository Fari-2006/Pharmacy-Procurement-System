const User = require('../models/User');

// @desc    Login user & get JWT token
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() })
      .populate('supplierCompany', 'name email phone isActive');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: user.registrationStatus === 'pending' ? 'Your registration is pending admin approval.' : 'Account is inactive. Please contact an administrator.'
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const token = user.generateAuthToken();

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        supplierCompany: user.supplierCompany || null
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res, next) => {
  try {
    res.json({
      success: true,
      user: req.user
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Change current user password
// @route   PUT /api/auth/change-password
// @access  Private
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both current and new password'
      });
    }

    const user = await User.findById(req.user._id);
    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password does not match'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters'
      });
    }

    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Public requests cannot choose administrator privileges or attach themselves to a supplier.
const register = async (req,res,next) => {
  try {
    const {name,email,password,phone,role,companyName}=req.body;
    if(typeof name!=='string'||!name.trim()||typeof email!=='string'||typeof password!=='string') return res.status(400).json({success:false,message:'Full name, email and password are required.'});
    if(!['pharmacist','cashier','supplier'].includes(role)) return res.status(400).json({success:false,message:'Choose Pharmacist, Cashier or Supplier. Admin accounts are managed by an administrator.'});
    if(password.length<8||password.length>128) return res.status(400).json({success:false,message:'Password must contain 8–128 characters.'});
    if(role==='supplier' && (typeof companyName!=='string'||!companyName.trim()||companyName.trim().length>120)) return res.status(400).json({success:false,message:'Supplier company name is required.'});
    await User.init();
    const normalized=email.trim().toLowerCase();
    if(await User.exists({email:normalized})) return res.status(409).json({success:false,message:'This email is already registered. Please log in or contact your administrator.'});
    const user=await User.create({name:name.trim(),email:normalized,password,phone:typeof phone==='string'?phone.trim():'',role,isActive:false,registrationStatus:'pending',requestedCompanyName:role==='supplier'?companyName.trim():undefined,supplierCompany:null});
    await require('./notificationController').sendNotification({recipientRole:'admin',title:'New registration request',message:`${user.name} requested ${role} access. Review in Staff & Security.`,link:'users',type:'approval'});
    await require('../models/AuditLog').create({user:user._id,userName:user.name,userRole:user.role,action:'USER_MANAGEMENT',details:'New registration request for '+user.email+' ('+role+')'});
    res.status(201).json({success:true,message:'Registration submitted successfully. The pharmacy administrator will review your request before you can log in.'});
  } catch(error) {if(error.code===11000)return res.status(409).json({success:false,message:'This email is already registered.'});next(error);}
};

module.exports = { login, register, getMe, changePassword };
