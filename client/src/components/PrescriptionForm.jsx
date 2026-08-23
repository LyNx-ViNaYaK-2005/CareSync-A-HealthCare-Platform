import React, { useState } from 'react';
import { Plus, Trash2, Pill, Sparkles, Send, Loader2, Clock, AlertCircle } from 'lucide-react';

/**
 * Spread N doses evenly across waking hours (08:00-22:00).
 * These become the times the reminder cron emails the patient at, so they
 * must be real clock times rather than a vague "twice daily".
 */
const suggestTimes = (frequencyPerDay) => {
  const n = Math.max(1, Math.min(Number(frequencyPerDay) || 1, 6));
  if (n === 1) return ['09:00'];
  const start = 8 * 60;
  const end = 22 * 60;
  const step = Math.floor((end - start) / (n - 1));
  return Array.from({ length: n }, (_, i) => {
    const t = start + step * i;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  });
};

const blankMedication = () => ({
  medicineName: '',
  dosage: '500mg',
  frequencyPerDay: 2,
  times: suggestTimes(2),
  durationDays: 5,
  instructions: 'After meals',
});

const PrescriptionForm = ({ appointment, onSubmit, onCancel }) => {
  const [clinicalNotes, setClinicalNotes] = useState(appointment.postVisitNotes || '');
  const [prescription, setPrescription] = useState(
    appointment.prescription?.length > 0 ? appointment.prescription.map((p) => ({ ...p })) : [blankMedication()]
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const addMedication = () => setPrescription((prev) => [...prev, blankMedication()]);

  const removeMedication = (index) => setPrescription((prev) => prev.filter((_, i) => i !== index));

  const updateMedication = (index, field, value) => {
    setPrescription((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item, [field]: value };
        // Changing frequency re-derives the dose times so the two never disagree.
        if (field === 'frequencyPerDay') next.times = suggestTimes(value);
        return next;
      })
    );
  };

  const updateTime = (medIndex, timeIndex, value) => {
    setPrescription((prev) =>
      prev.map((item, i) =>
        i === medIndex ? { ...item, times: item.times.map((t, ti) => (ti === timeIndex ? value : t)) } : item
      )
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (clinicalNotes.trim().length < 10) {
      setError('Please enter your clinical notes (at least 10 characters).');
      return;
    }

    // A row with a dosage but no name would be silently dropped server-side;
    // flag it here instead so the doctor knows the medicine was not saved.
    const partial = prescription.find((p) => !p.medicineName?.trim() && (p.dosage?.trim() || p.instructions?.trim()));
    if (partial) {
      setError('One medication row has no name. Enter a name or remove the row.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await onSubmit({ clinicalNotes, prescription });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit consultation');
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Consultation notes</h3>
          <p className="text-xs text-slate-500">
            {appointment.patient?.name} &middot; {appointment.date} at {appointment.startTime}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1 bg-sky-50 text-sky-700 border border-sky-200 rounded-full self-start">
          <Sparkles className="w-3.5 h-3.5" /> AI summary on submit
        </span>
      </div>

      {appointment.symptomsText && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-xs text-slate-600">
          <strong className="text-slate-700">Patient reported:</strong> {appointment.symptomsText}
        </div>
      )}

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 font-medium flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
          Clinical notes &amp; diagnosis
        </label>
        <textarea
          rows={4}
          value={clinicalNotes}
          onChange={(e) => setClinicalNotes(e.target.value)}
          placeholder="E.g. Acute pharyngitis. Throat inflamed with mild exudate, lungs clear. Advised hydration and a full antibiotic course. Review in one week if symptoms persist."
          className="w-full p-3.5 border border-slate-300 rounded-2xl text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
        />
        <p className="text-[11px] text-slate-500 mt-1.5">
          These notes are converted into a plain-language summary for the patient. They see the summary, not this text.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <Pill className="w-4 h-4 text-sky-600" />
            Prescription
          </label>
          <button
            type="button"
            onClick={addMedication}
            className="text-xs font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1 bg-sky-50 hover:bg-sky-100 px-3 py-1 rounded-lg transition"
          >
            <Plus className="w-3.5 h-3.5" /> Add medicine
          </button>
        </div>

        <div className="space-y-3">
          {prescription.map((item, idx) => (
            <div key={idx} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Medicine</label>
                  <input
                    type="text"
                    value={item.medicineName}
                    onChange={(e) => updateMedication(idx, 'medicineName', e.target.value)}
                    placeholder="Amoxicillin"
                    className="w-full p-2 border border-slate-300 rounded-xl text-xs font-medium focus:ring-1 focus:ring-sky-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Dosage</label>
                  <input
                    type="text"
                    value={item.dosage}
                    onChange={(e) => updateMedication(idx, 'dosage', e.target.value)}
                    placeholder="500mg"
                    className="w-full p-2 border border-slate-300 rounded-xl text-xs font-medium focus:ring-1 focus:ring-sky-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Per day</label>
                  <select
                    value={item.frequencyPerDay}
                    onChange={(e) => updateMedication(idx, 'frequencyPerDay', Number(e.target.value))}
                    className="w-full p-2 border border-slate-300 rounded-xl text-xs font-medium bg-white focus:ring-1 focus:ring-sky-500 outline-none"
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}&times; daily
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Days</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={item.durationDays}
                    onChange={(e) => updateMedication(idx, 'durationDays', Number(e.target.value))}
                    className="w-full p-2 border border-slate-300 rounded-xl text-xs font-medium focus:ring-1 focus:ring-sky-500 outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="grow min-w-[200px]">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Reminder times
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(item.times || []).map((t, ti) => (
                      <input
                        key={ti}
                        type="time"
                        value={t}
                        onChange={(e) => updateTime(idx, ti, e.target.value)}
                        className="p-1.5 border border-slate-300 rounded-lg text-xs font-medium focus:ring-1 focus:ring-sky-500 outline-none"
                      />
                    ))}
                  </div>
                </div>

                <div className="grow min-w-[160px]">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Instructions</label>
                  <input
                    type="text"
                    value={item.instructions}
                    onChange={(e) => updateMedication(idx, 'instructions', e.target.value)}
                    placeholder="After meals"
                    className="w-full p-2 border border-slate-300 rounded-xl text-xs font-medium focus:ring-1 focus:ring-sky-500 outline-none"
                  />
                </div>

                {prescription.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeMedication(idx)}
                    title="Remove this medicine"
                    className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-slate-200 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-slate-500 mt-2">
          The patient receives an email at each reminder time until the course finishes. Leave the medicine name blank
          to record notes with no prescription.
        </p>
      </div>

      <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold shadow-md transition flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating patient summary...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Submit &amp; generate summary
            </>
          )}
        </button>
      </div>
    </form>
  );
};

export default PrescriptionForm;
