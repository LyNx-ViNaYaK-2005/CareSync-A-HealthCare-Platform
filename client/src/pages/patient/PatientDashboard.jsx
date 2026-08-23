import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api, { errorMessage } from '../../api/client';
import UrgencyBadge from '../../components/UrgencyBadge';
import RescheduleModal from '../../components/RescheduleModal';
import {
  Calendar,
  Clock,
  Sparkles,
  Pill,
  PlusCircle,
  ExternalLink,
  Loader2,
  CalendarClock,
  CheckCircle,
  ListChecks,
  AlertCircle,
} from 'lucide-react';

const STATUS_STYLES = {
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  COMPLETED: 'bg-blue-50 text-blue-700 border-blue-200',
  CANCELLED_BY_PATIENT: 'bg-slate-100 text-slate-600 border-slate-200',
  CANCELLED_BY_DOCTOR: 'bg-red-50 text-red-700 border-red-200',
  EXPIRED: 'bg-slate-100 text-slate-500 border-slate-200',
};

const STATUS_LABELS = {
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED_BY_PATIENT: 'Cancelled by you',
  CANCELLED_BY_DOCTOR: 'Cancelled by clinic',
  EXPIRED: 'Expired',
};

const PatientDashboard = () => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [rescheduling, setRescheduling] = useState(null);
  const [tab, setTab] = useState('upcoming');

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/appointments');
      if (res.data.success) setAppointments(res.data.appointments);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load your appointments'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const handleCancel = async (appt) => {
    if (!window.confirm(`Cancel your appointment with Dr. ${appt.doctor?.name} on ${appt.date} at ${appt.startTime}?`))
      return;

    setBusyId(appt._id);
    try {
      const res = await api.put(`/api/appointments/${appt._id}/cancel`, { reason: 'Cancelled by patient' });
      if (res.data.success) {
        setNotice('Appointment cancelled. Your doctor has been notified and the calendar entry removed.');
        fetchAppointments();
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to cancel appointment'));
    } finally {
      setBusyId(null);
    }
  };

  const { upcoming, history } = useMemo(() => {
    const isOpen = (a) => a.status === 'CONFIRMED';
    return {
      upcoming: appointments.filter(isOpen).sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)),
      history: appointments.filter((a) => !isOpen(a)),
    };
  }, [appointments]);

  const visible = tab === 'upcoming' ? upcoming : history;

  const renderAppointment = (appt) => (
    <div key={appt._id} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-sky-100 border border-sky-200 text-sky-700 flex items-center justify-center font-bold text-lg shrink-0">
            Dr
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-base">Dr. {appt.doctor?.name}</h3>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-semibold mt-0.5">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-sky-600" /> {appt.date}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-sky-600" /> {appt.startTime} &ndash; {appt.endTime}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${STATUS_STYLES[appt.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
            {STATUS_LABELS[appt.status] || appt.status}
          </span>

          {appt.googleEventLink && (
            <a
              href={appt.googleEventLink}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-slate-100 rounded-lg transition"
              title="Open in Google Calendar"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}

          {appt.status === 'CONFIRMED' && (
            <>
              <button
                onClick={() => setRescheduling(appt)}
                disabled={busyId === appt._id}
                className="text-xs font-bold text-amber-700 hover:text-amber-800 bg-amber-50 px-3 py-1 rounded-lg transition border border-amber-200 flex items-center gap-1 disabled:opacity-50"
              >
                <CalendarClock className="w-3.5 h-3.5" /> Reschedule
              </button>
              <button
                onClick={() => handleCancel(appt)}
                disabled={busyId === appt._id}
                className="text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 px-3 py-1 rounded-lg transition border border-red-100 disabled:opacity-50 flex items-center gap-1"
              >
                {busyId === appt._id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {appt.status === 'CANCELLED_BY_DOCTOR' && appt.cancellationReason && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-3.5 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {appt.cancellationReason}. Please book a new slot at your convenience.
          </span>
        </div>
      )}

      {appt.preVisitSummary?.chiefComplaint && (
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-sky-600" /> Pre-visit symptom assessment
            </span>
            <UrgencyBadge level={appt.preVisitSummary.urgencyLevel} />
          </div>

          <p className="text-sm font-semibold text-slate-800">
            Chief complaint: <span className="font-normal text-slate-600">{appt.preVisitSummary.chiefComplaint}</span>
          </p>

          {appt.preVisitSummary.suggestedQuestions?.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-bold text-slate-500">Questions to raise with your doctor:</span>
              <ul className="list-disc list-inside text-xs text-slate-600 space-y-0.5">
                {appt.preVisitSummary.suggestedQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          {appt.preVisitSummary.llmStatus === 'FAILED_FALLBACK' && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 inline-block">
              AI analysis was unavailable; your symptoms were passed to the doctor unchanged.
            </p>
          )}
        </div>
      )}

      {appt.status === 'COMPLETED' && appt.postVisitSummary?.patientFriendlySummary && (
        <div className="bg-sky-50/70 rounded-2xl p-4 border border-sky-200 space-y-3">
          <span className="text-xs font-bold text-sky-800 uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-sky-600" /> Your visit summary
          </span>
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
            {appt.postVisitSummary.patientFriendlySummary}
          </p>

          {appt.postVisitSummary.followUpSteps?.length > 0 && (
            <div className="pt-3 border-t border-sky-200/60">
              <span className="text-xs font-bold text-sky-900 uppercase tracking-wider flex items-center gap-1 mb-2">
                <ListChecks className="w-3.5 h-3.5" /> Follow-up steps
              </span>
              <ul className="space-y-1">
                {appt.postVisitSummary.followUpSteps.map((step, i) => (
                  <li key={i} className="text-xs text-slate-700 flex items-start gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-sky-600 shrink-0 mt-0.5" />
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {appt.prescription?.length > 0 && (
            <div className="pt-3 border-t border-sky-200/60">
              <span className="text-xs font-bold text-sky-900 uppercase tracking-wider flex items-center gap-1 mb-2">
                <Pill className="w-3.5 h-3.5" /> Prescription &amp; reminder schedule
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {appt.prescription.map((med, i) => (
                  <div key={i} className="bg-white p-3 rounded-xl border border-sky-100 text-xs space-y-0.5">
                    <div className="font-bold text-slate-900">
                      {med.medicineName} {med.dosage && <span className="font-medium text-slate-500">({med.dosage})</span>}
                    </div>
                    <div className="text-slate-500">
                      {med.durationDays} day{med.durationDays === 1 ? '' : 's'}
                      {med.instructions ? ` · ${med.instructions}` : ''}
                    </div>
                    {med.times?.length > 0 && (
                      <div className="text-sky-700 font-semibold">Reminders at {med.times.join(', ')}</div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                You will receive an email reminder at each scheduled time until the course finishes.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Your health portal</h1>
          <p className="text-sm text-slate-500 mt-1">
            Appointments, AI symptom assessments, visit summaries, and medication reminders.
          </p>
        </div>

        <Link
          to="/patient/book"
          className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm px-4 py-2.5 rounded-xl shadow-md transition self-start sm:self-auto"
        >
          <PlusCircle className="w-4 h-4" /> Book an appointment
        </Link>
      </div>

      {notice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-sm text-emerald-800 font-medium flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            {notice}
          </span>
          <button onClick={() => setNotice('')} className="text-emerald-600 hover:text-emerald-800 text-xs font-bold">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700 font-medium">{error}</div>
      )}

      {!loading && appointments.length > 0 && (
        <div className="flex gap-2 border-b border-slate-200">
          {[
            ['upcoming', `Upcoming (${upcoming.length})`],
            ['history', `History (${history.length})`],
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
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
          <Loader2 className="w-8 h-8 animate-spin text-sky-600" />
          <span className="text-sm font-medium">Loading your appointments...</span>
        </div>
      ) : appointments.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center max-w-lg mx-auto space-y-4">
          <div className="w-16 h-16 bg-sky-50 text-sky-600 rounded-2xl flex items-center justify-center mx-auto">
            <Calendar className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">No appointments yet</h3>
          <p className="text-sm text-slate-500">
            Book your first appointment to get an AI symptom summary for your doctor and an automatic calendar invite.
          </p>
          <Link
            to="/patient/book"
            className="inline-block bg-sky-600 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-md hover:bg-sky-700 transition"
          >
            Find a doctor
          </Link>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center text-slate-500">
          {tab === 'upcoming' ? 'No upcoming appointments.' : 'Nothing in your history yet.'}
        </div>
      ) : (
        <div className="space-y-6">{visible.map(renderAppointment)}</div>
      )}

      {rescheduling && (
        <RescheduleModal
          appointment={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={(message) => {
            setRescheduling(null);
            setNotice(message);
            fetchAppointments();
          }}
        />
      )}
    </div>
  );
};

export default PatientDashboard;
