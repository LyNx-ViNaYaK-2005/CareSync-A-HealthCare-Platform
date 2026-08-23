import React, { useState, useEffect, useCallback } from 'react';
import api, { errorMessage } from '../../api/client';
import WorkingHoursEditor from '../../components/WorkingHoursEditor';
import {
  ShieldCheck,
  UserPlus,
  Stethoscope,
  Mail,
  Clock,
  MapPin,
  CheckCircle,
  AlertCircle,
  Loader2,
  Settings2,
  Palmtree,
  Trash2,
  CalendarDays,
  Activity,
  MailWarning,
} from 'lucide-react';

const SPECIALIZATIONS = [
  'Cardiology',
  'Dermatology',
  'General Medicine',
  'Neurology',
  'Orthopedics',
  'Pediatrics',
];

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyForm = {
  name: '',
  email: '',
  specialization: 'General Medicine',
  phone: '',
  slotDurationMins: 30,
  roomNumber: 'Consultation Room 1',
  bio: '',
};

// Full class strings, not interpolated: Tailwind's JIT scans source text and
// would never generate a class built as `text-${tone}-600`.
const TONES = {
  indigo: 'text-indigo-600',
  sky: 'text-sky-600',
  emerald: 'text-emerald-600',
  amber: 'text-amber-600',
  red: 'text-red-600',
};

const StatCard = ({ icon: Icon, label, value, tone = 'indigo' }) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
    <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
      <Icon className={`w-4 h-4 ${TONES[tone]}`} />
      {label}
    </div>
    <div className="text-2xl font-extrabold text-slate-900 mt-1.5">{value ?? 0}</div>
  </div>
);

const AdminDashboard = () => {
  const [doctors, setDoctors] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [expandedDoctor, setExpandedDoctor] = useState(null);
  const [leaveState, setLeaveState] = useState({}); // doctorId -> { leaves, date, reason, busy }
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchDoctors = useCallback(async () => {
    setLoading(true);
    try {
      // includeInactive: an admin needs to see doctors they have deactivated.
      const [docRes, statRes] = await Promise.all([
        api.get('/api/doctors', { params: { includeInactive: 'true' } }),
        api.get('/api/appointments/stats').catch(() => null),
      ]);
      if (docRes.data.success) setDoctors(docRes.data.doctors);
      if (statRes?.data?.success) setStats(statRes.data.stats);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the clinic roster'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDoctors();
  }, [fetchDoctors]);

  const handleCreateDoctor = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setMsg('');
    try {
      const res = await api.post('/api/doctors', formData);
      if (res.data.success) {
        setMsg(res.data.message);
        setShowModal(false);
        setFormData(emptyForm);
        fetchDoctors();
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to create the doctor account'));
    } finally {
      setSubmitting(false);
    }
  };

  const loadLeaves = useCallback(async (doctorId) => {
    try {
      const res = await api.get(`/api/doctors/${doctorId}/leave`);
      if (res.data.success) {
        setLeaveState((prev) => ({
          ...prev,
          [doctorId]: { ...(prev[doctorId] || {}), leaves: res.data.leaves, date: '', reason: '' },
        }));
      }
    } catch {
      /* the panel simply shows no leave days */
    }
  }, []);

  const toggleDoctor = (doctorId) => {
    const next = expandedDoctor === doctorId ? null : doctorId;
    setExpandedDoctor(next);
    if (next && !leaveState[next]?.leaves) loadLeaves(next);
  };

  const setLeaveField = (doctorId, field, value) =>
    setLeaveState((prev) => ({ ...prev, [doctorId]: { ...(prev[doctorId] || {}), [field]: value } }));

  const handleMarkLeave = async (doctorId, doctorName) => {
    const state = leaveState[doctorId] || {};
    if (!state.date) return;

    setLeaveField(doctorId, 'busy', true);
    setError('');
    try {
      const res = await api.post(`/api/doctors/${doctorId}/leave`, {
        date: state.date,
        reason: state.reason || 'Scheduled Leave',
      });
      if (res.data.success) {
        setMsg(`Dr. ${doctorName}: ${res.data.message}`);
        await loadLeaves(doctorId);
        fetchDoctors();
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to record leave'));
    } finally {
      setLeaveField(doctorId, 'busy', false);
    }
  };

  const handleWithdrawLeave = async (doctorId, date) => {
    if (!window.confirm(`Withdraw the leave day on ${date}? Slots will reopen for booking.`)) return;
    try {
      const res = await api.delete(`/api/doctors/${doctorId}/leave`, { data: { date } });
      if (res.data.success) {
        setMsg(res.data.message);
        loadLeaves(doctorId);
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to withdraw leave'));
    }
  };

  const urgency = stats?.urgencyBreakdown || {};
  const byStatus = stats?.appointmentsByStatus || {};

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-indigo-600" />
            Clinic administration
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Create doctor accounts, set working hours and slot durations, and manage leave days.
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm px-4 py-2.5 rounded-xl shadow-md transition self-start"
        >
          <UserPlus className="w-4 h-4" /> Add doctor
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard icon={CalendarDays} label="Today" value={stats.todayCount} tone="sky" />
          <StatCard icon={Clock} label="Upcoming" value={stats.upcomingCount} tone="indigo" />
          <StatCard icon={CheckCircle} label="Completed" value={byStatus.COMPLETED} tone="emerald" />
          <StatCard icon={Activity} label="High urgency" value={urgency.HIGH} tone="amber" />
          <StatCard icon={MailWarning} label="Failed emails" value={stats.failedNotifications} tone="red" />
        </div>
      )}

      {msg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-sm text-emerald-800 font-medium flex items-start justify-between gap-2">
          <span className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            {msg}
          </span>
          <button onClick={() => setMsg('')} className="text-emerald-600 hover:text-emerald-800 text-xs font-bold shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700 font-medium flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
        <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Stethoscope className="w-5 h-5 text-indigo-600" />
          Doctor roster ({doctors.length})
        </h3>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-2">
            <Loader2 className="w-7 h-7 animate-spin text-indigo-600" />
            <span className="text-sm font-medium">Loading roster...</span>
          </div>
        ) : doctors.length === 0 ? (
          <p className="text-center py-8 text-slate-500">No doctors yet. Use &ldquo;Add doctor&rdquo; to create one.</p>
        ) : (
          <div className="space-y-3">
            {doctors.map((doc) => {
              const state = leaveState[doc.id] || {};
              const isOpen = expandedDoctor === doc.id;

              return (
                <div key={doc.id} className="border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="p-4 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-slate-900">Dr. {doc.name}</h4>
                        <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {doc.specialization}
                        </span>
                        {doc.isActive === false && (
                          <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-600">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span className="flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-indigo-600" /> {doc.email}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-indigo-600" /> {doc.slotDurationMins} min slots
                        </span>
                        <span className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-indigo-600" /> {doc.roomNumber}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => toggleDoctor(doc.id)}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3.5 py-2 rounded-xl border border-indigo-200 transition self-start"
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                      {isOpen ? 'Close' : 'Manage schedule & leave'}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="p-5 border-t border-slate-200 grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2">
                        <WorkingHoursEditor
                          doctor={doc}
                          canDeactivate
                          onSaved={() => {
                            setMsg(`Dr. ${doc.name}'s schedule was updated.`);
                            fetchDoctors();
                          }}
                        />
                      </div>

                      <div className="space-y-3">
                        <h5 className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                          <Palmtree className="w-3.5 h-3.5 text-amber-600" /> Leave days
                        </h5>
                        <p className="text-[11px] text-slate-500">
                          Marking leave cancels every booking on that date and emails the affected patients.
                        </p>

                        <input
                          type="date"
                          min={localToday()}
                          value={state.date || ''}
                          onChange={(e) => setLeaveField(doc.id, 'date', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        <input
                          type="text"
                          value={state.reason || ''}
                          onChange={(e) => setLeaveField(doc.id, 'reason', e.target.value)}
                          placeholder="Reason (conference, PTO...)"
                          className="w-full p-2 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        <button
                          type="button"
                          disabled={!state.date || state.busy}
                          onClick={() => handleMarkLeave(doc.id, doc.name)}
                          className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                          {state.busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          Mark leave
                        </button>

                        {state.leaves?.length > 0 ? (
                          <div className="space-y-1.5 pt-2 border-t border-slate-100">
                            <span className="text-[10px] font-bold text-slate-500 uppercase">Scheduled</span>
                            {state.leaves.map((l) => (
                              <div
                                key={l._id}
                                className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] flex justify-between items-center gap-2 text-amber-900"
                              >
                                <span className="font-bold">{l.date}</span>
                                <span className="text-amber-700 truncate grow">{l.reason}</span>
                                <button
                                  onClick={() => handleWithdrawLeave(doc.id, l.date)}
                                  title="Withdraw this leave day"
                                  className="text-amber-600 hover:text-red-600 shrink-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-100">
                            No upcoming leave days.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 my-8">
            <h3 className="text-xl font-bold text-slate-900">New doctor account</h3>
            <p className="text-xs text-slate-500">
              An invite with a temporary password is emailed automatically. The doctor sets their own password on first
              sign-in.
            </p>

            <form onSubmit={handleCreateDoctor} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Full name</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Gregory House"
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Email address</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="house@clinic.com"
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Specialization</label>
                  <select
                    value={formData.specialization}
                    onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
                    className="w-full p-2.5 border border-slate-300 rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {SPECIALIZATIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Slot duration</label>
                  <select
                    value={formData.slotDurationMins}
                    onChange={(e) => setFormData({ ...formData, slotDurationMins: Number(e.target.value) })}
                    className="w-full p-2.5 border border-slate-300 rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {[15, 20, 30, 45, 60].map((m) => (
                      <option key={m} value={m}>
                        {m} minutes
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Consultation room</label>
                  <input
                    type="text"
                    value={formData.roomNumber}
                    onChange={(e) => setFormData({ ...formData, roomNumber: e.target.value })}
                    placeholder="Room 102"
                    className="w-full p-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Phone</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+91 98765 43210"
                    className="w-full p-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Bio (optional)</label>
                <textarea
                  rows={2}
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  placeholder="Short description shown to patients when they browse doctors."
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                Default hours are Mon&ndash;Fri 09:00&ndash;17:00 and Sat 09:00&ndash;13:00. Adjust them from the
                roster after creating the account.
              </p>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl shadow-md transition flex items-center gap-2 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create &amp; send invite
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
