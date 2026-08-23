const express = require('express');
const router = express.Router();

const { registerPatient, login, getMe, setPassword } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimiter');
const validate = require('../middleware/validateRequest');
const { registerSchema, loginSchema, setPasswordSchema } = require('../validators/schemas');

router.post('/register', authLimiter, validate(registerSchema), registerPatient);
router.post('/login', authLimiter, validate(loginSchema), login);
router.get('/me', protect, getMe);
router.post('/set-password', protect, validate(setPasswordSchema), setPassword);

module.exports = router;
