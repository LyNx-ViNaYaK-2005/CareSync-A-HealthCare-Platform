import React, { useState } from 'react';
import api, { errorMessage } from '../api/client';
import SlotPicker from './SlotPicker';
import { X, CalendarClock, AlertCircle, Loader2 } from 'lucide-react';

/**
 * Move a confirmed appointment to a different slot.
 * Reuses SlotPicker so the same availability, leave and past-slot rules apply
 * as on first booking; the backend re-validates all of them regardless.
 */
const RescheduleModal = ({ appointment, onDone, onClose }) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [busySlot, setBusySlot] = useState(null);

  const doctor = {
    id: appointment.doctor?._id || appointment.doctor,
    name: appointment.doctor?.name || 'your doctor',
    specialization: appointment.doctor?.specialization || 'Consultation',
  };

  const handleSelect = async (slot) => {
    if (slot.date === appointment.date && slot.startTime === appointment.startTime) {
      setError('That is the appointment\'s current time. Pick a different slot.');
      return;
    }

    setSubmitting(true);
    setBusySlot(slot.startTime);
    setError('');
    try {
      const res = await api.put(`/api/appointments/${appointment._id}/reschedule`, {
        newDate: slot.date,
        newStartTime: slot.startTime,
        newEndTime: slot.endTime,
      });
      if (res.data.success) onDone(res.data.message || 'Appointment rescheduled');
    } catch (err) {
      setError(errorMessage(err, 'Could not reschedule to that slot'));
    } finally {
      setSubmitting(false);
      setBusySlot(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 my-8 space-y-4">
        <div className="flex items-start justify-between pb-4 border-b border-slate-100">
          <div>
            <span className="text-xs font-bold text-amber-600 uppercase tracking-wider flex items-center gap-1.5">
              <CalendarClock className="w-4 h-4" /> Reschedule
            </span>
            <h3 className="text-xl font-bold text-slate-900 mt-1">Move your appointment</h3>
            <p className="text-xs text-slate-500 mt-1">
              Currently <strong>{appointment.date}</strong> at <strong>{appointment.startTime}</strong> with Dr.{' '}
              {doctor.name}. Both of you will be emailed and the calendar entry updated.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 font-medium flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {submitting && (
          <div className="p-3.5 bg-sky-50 border border-sky-200 rounded-2xl text-xs text-sky-800 font-medium flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Moving your appointment and updating the calendar...
          </div>
        )}

        <SlotPicker doctor={doctor} onSlotSelected={handleSelect} busySlot={busySlot} />
      </div>
    </div>
  );
};

export default RescheduleModal;
