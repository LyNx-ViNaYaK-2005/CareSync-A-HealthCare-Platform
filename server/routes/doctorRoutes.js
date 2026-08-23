const express = require('express');
const router = express.Router();

const {
  createDoctor,
  getDoctors,
  getDoctorById,
  updateDoctorProfile,
  markDoctorLeave,
  cancelDoctorLeave,
  getDoctorLeaves,
} = require('../controllers/doctorController');
const { protect, authorize, requirePasswordSet } = require('../middleware/authMiddleware');
const validate = require('../middleware/validateRequest');
const {
  createDoctorSchema,
  updateDoctorSchema,
  markLeaveSchema,
  cancelLeaveSchema,
  doctorIdParamSchema,
} = require('../validators/schemas');

// Public: patients browse and search the roster before signing in.
router.get('/', getDoctors);
router.get('/:id', validate(doctorIdParamSchema), getDoctorById);

// Admin: provision a doctor account (sends the invite email).
router.post('/', protect, requirePasswordSet, authorize('ADMIN'), validate(createDoctorSchema), createDoctor);

// Profile, working hours, slot duration: admin or the doctor themselves.
router.put(
  '/:id',
  protect,
  requirePasswordSet,
  authorize('ADMIN', 'DOCTOR'),
  validate(updateDoctorSchema),
  updateDoctorProfile
);

// Leave management.
router.get('/:id/leave', protect, validate(doctorIdParamSchema), getDoctorLeaves);
router.post(
  '/:id/leave',
  protect,
  requirePasswordSet,
  authorize('ADMIN', 'DOCTOR'),
  validate(markLeaveSchema),
  markDoctorLeave
);
router.delete(
  '/:id/leave',
  protect,
  requirePasswordSet,
  authorize('ADMIN', 'DOCTOR'),
  validate(cancelLeaveSchema),
  cancelDoctorLeave
);

module.exports = router;
