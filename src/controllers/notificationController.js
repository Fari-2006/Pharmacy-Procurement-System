const Notification = require('../models/Notification');

// Internal helper function for creating notifications across modules
const sendNotification = async ({ recipientUser, recipientRole, recipientSupplier, title, message, link, type }) => {
  try {
    return await Notification.create({
      recipientUser: recipientUser || null,
      recipientRole: recipientRole || null,
      recipientSupplier: recipientSupplier || null,
      title,
      message,
      link: link || '',
      type: type || 'order'
    });
  } catch (err) {
    console.error('[Notification Error]:', err.message);
  }
};

// @desc    Get notifications for logged-in user / role / supplier
// @route   GET /api/notifications
// @access  Private
const getNotifications = async (req, res, next) => {
  try {
    let query = {};
    const { page = 1, limit = 20 } = req.query;

    if (req.user.role === 'supplier') {
      const orConditions = [
        { recipientUser: req.user._id },
        { recipientRole: 'supplier' }
      ];
      if (req.user.supplierCompany) {
        orConditions.push({ recipientSupplier: req.user.supplierCompany });
      }
      query.$or = orConditions;
    } else {
      query.$or = [
        { recipientUser: req.user._id },
        { recipientRole: req.user.role },
        { recipientRole: 'staff' }
      ];
    }

    const unreadCount = await Notification.countDocuments({ ...query, isRead: false });

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    res.json({
      success: true,
      unreadCount,
      count: notifications.length,
      notifications
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark single notification as read
// @route   PUT /api/notifications/:id/read
// @access  Private
const markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.json({ success: true, notification });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark all user's notifications as read
// @route   PUT /api/notifications/read-all
// @access  Private
const markAllAsRead = async (req, res, next) => {
  try {
    let query = {};
    if (req.user.role === 'supplier') {
      const orConditions = [
        { recipientUser: req.user._id },
        { recipientRole: 'supplier' }
      ];
      if (req.user.supplierCompany) {
        orConditions.push({ recipientSupplier: req.user.supplierCompany });
      }
      query.$or = orConditions;
    } else {
      query.$or = [
        { recipientUser: req.user._id },
        { recipientRole: req.user.role },
        { recipientRole: 'staff' }
      ];
    }

    await Notification.updateMany({ ...query, isRead: false }, { isRead: true });

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendNotification,
  getNotifications,
  markAsRead,
  markAllAsRead
};
