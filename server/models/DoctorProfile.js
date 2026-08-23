const mongoose = require('mongoose');

const workingHourSchema = new mongoose.Schema({
  dayOfWeek: {
    type: String,
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    required: true,
  },
  startTime: {
    type: String, // HH:mm format, e.g. "09:00"
    default: '09:00',
  },
  endTime: {
    type: String, // HH:mm format, e.g. "17:00"
    default: '17:00',
  },
  isAvailable: {
    type: Boolean,
    default: true,
  },
});

const doctorProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    specialization: {
      type: String,
      required: [true, 'Specialization is required'],
      trim: true,
    },
    slotDurationMins: {
      type: Number,
      default: 30,
      min: 15,
      max: 120,
    },
    roomNumber: {
      type: String,
      default: 'Consultation Room 1',
    },
    bio: {
      type: String,
      default: '',
    },
    workingHours: {
      type: [workingHourSchema],
      default: [
        { dayOfWeek: 'Monday', startTime: '09:00', endTime: '17:00', isAvailable: true },
        { dayOfWeek: 'Tuesday', startTime: '09:00', endTime: '17:00', isAvailable: true },
        { dayOfWeek: 'Wednesday', startTime: '09:00', endTime: '17:00', isAvailable: true },
        { dayOfWeek: 'Thursday', startTime: '09:00', endTime: '17:00', isAvailable: true },
        { dayOfWeek: 'Friday', startTime: '09:00', endTime: '17:00', isAvailable: true },
        { dayOfWeek: 'Saturday', startTime: '09:00', endTime: '13:00', isAvailable: true },
        { dayOfWeek: 'Sunday', startTime: '09:00', endTime: '13:00', isAvailable: false },
      ],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('DoctorProfile', doctorProfileSchema);
