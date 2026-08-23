const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Verify the bearer token and attach the live user document to the request.
 *
 * The user is re-read on every request rather than trusted from the token
 * payload, so a deleted account or a role change takes effect immediately
 * instead of lingering until the token expires.
 */
const protect = async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Not authorized: no token provided' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[Auth] JWT_SECRET is not configured - refusing to verify tokens.');
    return res.status(500).json({ success: false, message: 'Server authentication is not configured' });
  }

  try {
    const decoded = jwt.verify(header.split(' ')[1], secret);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Not authorized: user no longer exists' });
    }

    req.user = user;
    req.user.id = user._id.toString();
    return next();
  } catch (error) {
    const message =
      error.name === 'TokenExpiredError'
        ? 'Session expired. Please sign in again.'
        : 'Not authorized: invalid token';
    return res.status(401).json({ success: false, message });
  }
};

/** Restrict a route to one or more roles. Must run after `protect`. */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: `Role '${req.user.role}' is not permitted to access this resource`,
    });
  }
  return next();
};

/**
 * Block invited doctors from using the API until they have replaced their
 * temporary password, while still allowing the password-set route itself.
 */
const requirePasswordSet = (req, res, next) => {
  if (req.user?.mustResetPassword) {
    return res.status(403).json({
      success: false,
      code: 'PASSWORD_RESET_REQUIRED',
      message: 'Please set a new password before continuing',
    });
  }
  return next();
};

module.exports = { protect, authorize, requirePasswordSet };
