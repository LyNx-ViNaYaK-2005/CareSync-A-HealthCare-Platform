const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';

const generateToken = (id) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Signing with a hardcoded default would mean anyone who has read this
    // repository can mint an admin token against the deployed instance.
    throw new Error('JWT_SECRET is not configured on the server');
  }
  return jwt.sign({ id }, secret, { expiresIn: JWT_EXPIRY });
};

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone,
  mustResetPassword: user.mustResetPassword,
});

/** Mongoose queues operations when disconnected; surface that as 503, not 500. */
const isDbOffline = (error) =>
  error.message?.includes('buffering timed out') ||
  error.message?.includes('ECONNREFUSED') ||
  error.name === 'MongooseServerSelectionError';

const handleError = (res, error, context) => {
  console.error(`${context}:`, error.message);
  if (isDbOffline(error)) {
    return res.status(503).json({
      success: false,
      message: 'Database unavailable. Check MONGODB_URI and that the Atlas cluster allows this IP.',
    });
  }
  return res.status(500).json({ success: false, message: error.message });
};

/**
 * @desc    Register a patient account
 * @route   POST /api/auth/register
 * @access  Public
 *
 * Self-registration always produces a PATIENT. Doctor accounts are created by
 * an admin (which triggers an invite), and admin accounts are provisioned from
 * environment variables at boot - neither can be obtained through this route.
 */
const registerPatient = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (await User.findOne({ email })) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    }

    const user = await User.create({ name, email, password, phone, role: 'PATIENT' });

    return res.status(201).json({
      success: true,
      token: generateToken(user._id),
      user: publicUser(user),
    });
  } catch (error) {
    return handleError(res, error, 'Register Error');
  }
};

/**
 * @desc    Authenticate and issue a JWT
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');

    // One generic 401 for both "no such user" and "wrong password", so the
    // response cannot be used to enumerate which emails have accounts.
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    return res.json({
      success: true,
      token: generateToken(user._id),
      user: publicUser(user),
    });
  } catch (error) {
    return handleError(res, error, 'Login Error');
  }
};

/**
 * @desc    Current user profile
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.json({ success: true, user: publicUser(user) });
  } catch (error) {
    return handleError(res, error, 'Get Me Error');
  }
};

/**
 * @desc    Set a new password (invited doctors on first login, or any user)
 * @route   POST /api/auth/set-password
 * @access  Private
 */
const setPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;

    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (await user.matchPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'The new password must be different from your current password',
      });
    }

    user.password = newPassword;
    user.mustResetPassword = false;
    await user.save();

    return res.json({ success: true, message: 'Password updated', user: publicUser(user) });
  } catch (error) {
    return handleError(res, error, 'Set Password Error');
  }
};

module.exports = {
  registerPatient,
  login,
  getMe,
  setPassword,
};
