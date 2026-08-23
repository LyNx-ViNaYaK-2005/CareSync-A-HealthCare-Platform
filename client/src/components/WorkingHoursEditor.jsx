import React, { useState } from 'react';
import api, { errorMessage } from '../api/client';
import { Clock, Save, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const DEFAULT_HOURS = DAYS.map((day) => ({
  dayOfWeek: day,
  startTime: '09:00',
  endTime: day === 'Saturday' ? '13:00' : '17:00',
  isAvailable: day !== 'Sunday',
}));

/**
 * Edit a doctor's weekly schedule and slot duration.
 *
 * Used by both the admin console (managing any doctor) and the doctor's own
 * dashboard. The backend enforces the same rules the UI hints at, so a doctor
 * cannot flip `isActive` even if this component is rendered with the control.
 */
const WorkingHoursEditor = ({ doctor, canDeactivate = false, onSaved }) => {
  const [hours, setHours] = useState(() => {
    const existing = doctor.workingHours || [];
    // Normalise to all seven days so the grid is never partially rendered.
    return DAYS.map(
      (day) => existing.find((h) => h.dayOfWeek === day) || DEFAULT_HOURS.find((h) => h.dayOfWeek === day)
    );
  });
  const [slotDurationMins, setSlotDurationMins] = useState(doctor.slotDurationMins || 30);
  const [roomNumber, setRoomNumber] = useState(doctor.roomNumber || '');
  const [specialization, setSpecialization] = useState(doctor.specialization || '');
  const [isActive, setIsActive] = useState(doctor.isActive !== false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const updateDay = (day, field, value) => {
    setHours((prev) => prev.map((h) => (h.dayOfWeek === day ? { ...h, [field]: value } : h)));
    setMessage('');
  };

  const handleSave = async () => {
    // Catch reversed ranges here so the user sees which day is wrong, rather
    // than a generic 400 from the server's schema.
    const invalid = hours.find((h) => h.isAvailable && h.startTime >= h.endTime);
    if (invalid) {
      setError(`${invalid.dayOfWeek}: start time must be earlier than end time.`);
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        workingHours: hours.map(({ dayOfWeek, startTime, endTime, isAvailable }) => ({
          dayOfWeek,
          startTime,
          endTime,
          isAvailable,
        })),
        slotDurationMins: Number(slotDurationMins),
        roomNumber,
        specialization,
        ...(canDeactivate ? { isActive } : {}),
      };

      const res = await api.put(`/api/doctors/${doctor.id}`, payload);
      if (res.data.success) {
        setMessage('Schedule saved. New slots reflect these hours immediately.');
        onSaved?.(res.data.profile);
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to save schedule'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Specialization</label>
          <input
            type="text"
            value={specialization}
            onChange={(e) => setSpecialization(e.target.value)}
            className="w-full p-2 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Slot duration</label>
          <select
            value={slotDurationMins}
            onChange={(e) => setSlotDurationMins(e.target.value)}
            className="w-full p-2 border border-slate-300 rounded-xl text-xs font-medium bg-white outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {[15, 20, 30, 45, 60].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Consultation room</label>
          <input
            type="text"
            value={roomNumber}
            onChange={(e) => setRoomNumber(e.target.value)}
            className="w-full p-2 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-indigo-600" />
          <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Weekly working hours</span>
        </div>

        <div className="divide-y divide-slate-100">
          {hours.map((h) => (
            <div key={h.dayOfWeek} className="px-4 py-2.5 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 w-32 shrink-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={h.isAvailable}
                  onChange={(e) => updateDay(h.dayOfWeek, 'isAvailable', e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className={`text-xs font-semibold ${h.isAvailable ? 'text-slate-800' : 'text-slate-400'}`}>
                  {h.dayOfWeek}
                </span>
              </label>

              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={h.startTime}
                  disabled={!h.isAvailable}
                  onChange={(e) => updateDay(h.dayOfWeek, 'startTime', e.target.value)}
                  className="p-1.5 border border-slate-300 rounded-lg text-xs font-medium disabled:bg-slate-50 disabled:text-slate-400 outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="time"
                  value={h.endTime}
                  disabled={!h.isAvailable}
                  onChange={(e) => updateDay(h.dayOfWeek, 'endTime', e.target.value)}
                  className="p-1.5 border border-slate-300 rounded-lg text-xs font-medium disabled:bg-slate-50 disabled:text-slate-400 outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {!h.isAvailable && <span className="text-[11px] text-slate-400 italic">Closed</span>}
            </div>
          ))}
        </div>
      </div>

      {canDeactivate && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-xs font-semibold text-slate-700">
            Accepting appointments
            <span className="font-normal text-slate-500"> &mdash; unchecking hides this doctor from patients</span>
          </span>
        </label>
      )}

      {message && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5" />
          {message}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" />
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-sm transition disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        Save schedule
      </button>
    </div>
  );
};

export default WorkingHoursEditor;
export { DAYS, DEFAULT_HOURS };
