import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api, { errorMessage } from '../../api/client';
import UrgencyBadge from '../../components/UrgencyBadge';
import PrescriptionForm from '../../components/PrescriptionForm';
import WorkingHoursEditor from '../../components/WorkingHoursEditor';
import { useAuth } from '../../context/AuthContext';
import {
  Calendar,
  Sparkles,
  User,
  FileText,
  Palmtree,
  Loader2,
  CheckCircle,
  AlertCircle,
  Trash2,
  Settings2,
  XCircle,
} from 'lucide-react';

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const STATUS_STYLES = {
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  COMPLETED: 'bg-blue-50 text-blue-700 border-blue-200',
  CANCELLED_BY_PATIENT: 'bg-slate-100 text-slate-600 border-slate-200',
  CANCELLED_BY_DOCTOR: 'bg-red-50 text-red-700 border-red-200',
};

const URGENCY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

const DoctorDashboard = () => {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedAppt, setSelectedAppt] = useState(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [leaveDate, setLeaveDate] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('today');

  const fetchDoctorData = useCallback(async () => {
    setLoading(true);
    try {
      const [apptRes, leaveRes, profileRes] = await Promise.all([
        api.get('/api/appointments'),
        api.get(`/api/doctors/${user.id}/leave`),
        api.get(`/api/doctors/${user.id}`),
      ]);

      if (apptRes.data.success) setAppointments(apptRes.data.appointments);
      if (leaveRes.data.success) setLeaves(leaveRes.data.leaves);
      if (profileRes.data.success) setProfile(profileRes.data.doctor);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load your schedule'));
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    fetchDoctorData();
  }, [fetchDoctorData]);

  const handleMarkLeave = async (e) => {
    e.preventDefault();
    if (!leaveDate) return;

    setLeaveBusy(true);
    setError('');
    try {
      const res = await api.post(`/api/doctors/${user.id}/leave`, {
        date: leaveDate,
        reason: leaveReason || 'Scheduled Leave',
      });
      if (res.data.success) {
        setNotice(res.data.message);
        setLeaveDate('');
        setLeaveReason('');
        fetchDoctorData();
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to mark leave'));
    } finally {
      setLeaveBusy(false);
    }
  };

  const handleWithdrawLeave = async (date) => {
    if (!window.confirm(`Withdraw your leave on ${date}? Your slots will reopen for booking.`)) return;
    try {
      const res = await api.delete(`/api/doctors/${user.id}/leave`, { data: { date } });
      if (res.data.success) {
        setNotice(res.data.message);
        fetchDoctorData();
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to withdraw leave'));
    }
  };

  const handleConsultationSubmit = async ({ clinicalNotes, prescription }) => {
    const res = await api.post(`/api/appointments/${selectedAppt._id}/consultation`, {
      clinicalNotes,
      prescription: prescription.filter((p) => p.medicineName?.trim()),
    });
    if (res.data.success) {
      setSelectedAppt(null);
      setNotice('Consultation recorded. The patient can now see their summary and will get medication reminders.');
      fetchDoctorData();
    }
  };

  const handleCancelAppointment = async (appt) => {
    const reason = window.prompt(
      `Cancel the appointment with ${appt.patient?.name} on ${appt.date} at ${appt.startTime}?\n\nReason (shown to the patient):`,
      'Clinical scheduling conflict'
    );
    if (reason === null) return;

    try {
      const res = await api.put(`/api/appointments/${appt._id}/cancel`, { reason });
      if (res.data.success) {
        setNotice('Appointment cancelled and the patient notified by email.');
        fetchDoctorData();
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to cancel appointment'));
    }
  };

  const today = localToday();

  const grouped = useMemo(() => {
    const sortByUrgencyThenTime = (a, b) => {
      const ua = URGENCY_ORDER[a.preVisitSummary?.urgencyLevel] ?? 3;
      const ub = URGENCY_ORDER[b.preVisitSummary?.urgencyLevel] ?? 3;
      return ua !== ub ? ua - ub : a.startTime.localeCompare(b.startTime);
    };

    return {
      today: appointments.filter((a) => a.date === today && a.status === 'CONFIRMED').sort(sortByUrgencyThenTime),
      upcoming: appointments
        .filter((a) => a.date > today && a.status === 'CONFIRMED')
        .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)),
      past: appointments.filter((a) => a.status !== 'CONFIRMED'),
    };
  }, [appointments, today]);

  const visible = grouped[tab] || [];

  const renderAppointment = (appt) => (
    <div key={appt._id} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-700 font-bold flex items-center justify-center shrink-0">
            <User className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-slate-900">{appt.patient?.name}</h4>
            <span className="text-xs font-semibold text-slate-500">
              {appt.date} at {appt.startTime} &ndash; {appt.endTime}
              {appt.patient?.phone && <span className="text-slate-400"> &middot; {appt.patient.phone}</span>}
            </span>
          </div>
        </div>

        <span
          className={`px-3 py-1 rounded-full text-xs font-bold border self-start ${
            STATUS_STYLES[appt.status] || 'bg-slate-100 text-slate-600 border-slate-200'
          }`}
        >
          {appt.status.replace(/_/g, ' ')}
        </span>
      </div>

      {appt.preVisitSummary?.chiefComplaint && (
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-sky-600" /> Pre-visit assessment
            </span>
            <UrgencyBadge level={appt.preVisitSummary.urgencyLevel} />
          </div>

          <p className="text-xs text-slate-700 font-medium">
            <strong>Chief complaint:</strong> {appt.preVisitSummary.chiefComplaint}
          </p>
          <p className="text-xs text-slate-600">
            <strong>Reported symptoms:</strong> {appt.symptomsText}
          </p>

          {appt.preVisitSummary.suggestedQuestions?.length > 0 && (
            <div className="pt-2 border-t border-slate-200">
              <span className="text-[11px] font-bold text-slate-500 uppercase">Suggested questions</span>
              <ul className="list-disc list-inside text-xs text-slate-600 mt-1 space-y-0.5">
                {appt.preVisitSummary.suggestedQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          {appt.preVisitSummary.llmStatus === 'FAILED_FALLBACK' && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 inline-block">
              AI triage was unavailable for this booking &mdash; review the raw symptoms above.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        {appt.status === 'CONFIRMED' && (
          <>
            <button
              onClick={() => handleCancelAppointment(appt)}
              className="text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 border border-red-100 px-3.5 py-2 rounded-xl transition flex items-center gap-1.5"
            >
              <XCircle className="w-3.5 h-3.5" /> Cancel
            </button>
            <button
              onClick={() => setSelectedAppt(appt)}
              className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-sm transition flex items-center gap-1.5"
            >
              <FileText className="w-4 h-4" /> Start consultation
            </button>
          </>
        )}
        {appt.status === 'COMPLETED' && (
          <button
            onClick={() => setSelectedAppt(appt)}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-4 py-2 rounded-xl transition flex items-center gap-1.5"
          >
            <FileText className="w-4 h-4" /> Edit notes
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Doctor portal</h1>
          <p className="text-sm text-slate-500 mt-1">
            Dr. {user.name} &middot; AI pre-visit assessments, consultation notes, and leave management.
          </p>
        </div>

        {profile && (
          <button
            onClick={() => setShowSchedule((s) => !s)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3.5 py-2.5 rounded-xl border border-indigo-200 transition self-start"
          >
            <Settings2 className="w-4 h-4" />
            {showSchedule ? 'Hide my schedule' : 'My working hours'}
          </button>
        )}
      </div>

      {notice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-sm text-emerald-800 font-medium flex items-start justify-between gap-2">
          <span className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {notice}
          </span>
          <button onClick={() => setNotice('')} className="text-emerald-600 hover:text-emerald-800 text-xs font-bold shrink-0">
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

      {showSchedule && profile && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h3 className="text-base font-bold text-slate-900">My working hours &amp; slot duration</h3>
          <p className="text-xs text-slate-500">
            Changes take effect immediately for new bookings. Existing appointments are not affected.
          </p>
          <WorkingHoursEditor
            doctor={profile}
            onSaved={() => {
              setNotice('Your schedule was updated.');
              fetchDoctorData();
            }}
          />
        </div>
      )}

      {selectedAppt ? (
        <PrescriptionForm
          appointment={selectedAppt}
          onSubmit={handleConsultationSubmit}
          onCancel={() => setSelectedAppt(null)}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="flex gap-2 border-b border-slate-200">
              {[
                ['today', `Today (${grouped.today.length})`],
                ['upcoming', `Upcoming (${grouped.upcoming.length})`],
                ['past', `Past (${grouped.past.length})`],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-4 py-2 text-sm font-bold transition border-b-2 -mb-px ${
                    tab === key ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2 bg-white rounded-3xl border border-slate-200">
                <Loader2 className="w-8 h-8 animate-spin text-sky-600" />
                <span className="text-sm font-medium">Loading your schedule...</span>
              </div>
            ) : visible.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center text-slate-500">
                {tab === 'today'
                  ? 'No appointments scheduled for today.'
                  : tab === 'upcoming'
                    ? 'No upcoming appointments.'
                    : 'No past appointments yet.'}
              </div>
            ) : (
              <div className="space-y-4">{visible.map(renderAppointment)}</div>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Palmtree className="w-5 h-5 text-amber-600" />
                Leave days
              </h3>
              <p className="text-xs text-slate-500">
                Marking leave cancels every booking on that date and emails the affected patients automatically.
              </p>

              <form onSubmit={handleMarkLeave} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Date</label>
                  <input
                    type="date"
                    required
                    min={today}
                    value={leaveDate}
                    onChange={(e) => setLeaveDate(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Reason</label>
                  <input
                    type="text"
                    value={leaveReason}
                    onChange={(e) => setLeaveReason(e.target.value)}
                    placeholder="Conference, PTO, personal..."
                    className="w-full p-2.5 border border-slate-300 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={leaveBusy || !leaveDate}
                  className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {leaveBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Mark leave
                </button>
              </form>

              {leaves.length > 0 && (
                <div className="pt-4 border-t border-slate-100 space-y-2">
                  <span className="text-xs font-bold text-slate-700 uppercase">Upcoming leave</span>
                  <div className="space-y-1.5">
                    {leaves.map((l) => (
                      <div
                        key={l._id}
                        className="p-2 bg-amber-50 border border-amber-200 rounded-xl text-xs flex justify-between items-center gap-2 text-amber-900 font-medium"
                      >
                        <span className="font-bold">{l.date}</span>
                        <span className="text-amber-700 truncate grow">{l.reason}</span>
                        <button
                          onClick={() => handleWithdrawLeave(l.date)}
                          title="Withdraw this leave day"
                          className="text-amber-600 hover:text-red-600 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {profile && (
              <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-2">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-sky-600" />
                  Clinic hours
                </h3>
                <div className="space-y-1">
                  {profile.workingHours?.map((h) => (
                    <div key={h.dayOfWeek} className="flex justify-between text-xs">
                      <span className={h.isAvailable ? 'font-semibold text-slate-700' : 'text-slate-400'}>
                        {h.dayOfWeek}
                      </span>
                      <span className={h.isAvailable ? 'text-slate-600' : 'text-slate-400 italic'}>
                        {h.isAvailable ? `${h.startTime} - ${h.endTime}` : 'Closed'}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                  {profile.slotDurationMins} minute appointments &middot; {profile.roomNumber}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DoctorDashboard;
