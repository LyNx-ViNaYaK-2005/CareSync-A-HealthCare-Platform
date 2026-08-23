const mongoose = require('mongoose');

const doctorLeaveSchema = new mongoose.Schema(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    date: {
      type: String, // YYYY-MM-DD format
      required: [true, 'Leave date is required'],
    },
    reason: {
      type: String,
      default: 'Scheduled Leave',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'CANCELLED'],
      default: 'ACTIVE',
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate leave entries for the same doctor on the same date
doctorLeaveSchema.index({ doctor: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DoctorLeave', doctorLeaveSchema);
