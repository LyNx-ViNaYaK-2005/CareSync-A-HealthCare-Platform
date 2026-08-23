import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { errorMessage } from '../../api/client';
import DoctorCard from '../../components/DoctorCard';
import SlotPicker from '../../components/SlotPicker';
import SymptomModal from '../../components/SymptomModal';
import { Search, Stethoscope, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';

const SPECIALIZATIONS = [
  'Cardiology',
  'Dermatology',
  'General Medicine',
  'Neurology',
  'Orthopedics',
  'Pediatrics',
];

const BookAppointment = () => {
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [holdData, setHoldData] = useState(null);
  const [holdingSlot, setHoldingSlot] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  const [slotRefreshKey, setSlotRefreshKey] = useState(0);

  const navigate = useNavigate();

  const fetchDoctors = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/api/doctors', {
        params: specialization ? { specialization } : {},
      });
      if (res.data.success) setDoctors(res.data.doctors);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load doctors'));
    } finally {
      setLoading(false);
    }
  }, [specialization]);

  useEffect(() => {
    fetchDoctors();
  }, [fetchDoctors]);

  /** Step 1: claim a short hold so nobody takes the slot mid-form. */
  const handleSlotSelect = async (slot) => {
    setError('');
    setHoldingSlot(slot.startTime);
    try {
      const res = await api.post('/api/appointments/hold', {
        doctorId: selectedDoctor.id,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
      });

      if (res.data.success) {
        setSelectedSlot(slot);
        setHoldData(res.data);
        setShowModal(true);
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not reserve that slot. Please try another.'));
      // Someone else took it: re-read availability so the grid reflects reality.
      setSlotRefreshKey((k) => k + 1);
    } finally {
      setHoldingSlot(null);
    }
  };

  /** Step 2: submit symptoms; the backend generates the AI summary and syncs the calendar. */
  const handleConfirmBooking = async ({ appointmentId, symptomsText }) => {
    const res = await api.post('/api/appointments/confirm', { appointmentId, symptomsText });
    if (res.data.success) {
      setShowModal(false);
      navigate('/patient/dashboard', { replace: true });
    }
  };

  const handleModalClose = () => {
    setShowModal(false);
    setHoldData(null);
    setSelectedSlot(null);
    // The hold is still live for a few minutes; refresh so it shows as taken.
    setSlotRefreshKey((k) => k + 1);
  };

  const filteredDoctors = doctors.filter((d) => {
    const needle = search.toLowerCase().trim();
    if (!needle) return true;
    return d.name.toLowerCase().includes(needle) || d.specialization.toLowerCase().includes(needle);
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2.5">
            <Stethoscope className="w-7 h-7 text-sky-600" />
            Book an appointment
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Pick a doctor and a slot, describe your symptoms, and we will prepare an AI summary for your doctor and
            add the visit to your calendar.
          </p>
        </div>

        {selectedDoctor && (
          <button
            onClick={() => {
              setSelectedDoctor(null);
              setSelectedSlot(null);
              setError('');
            }}
            className="flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-700 bg-sky-50 px-3.5 py-2 rounded-xl border border-sky-200 self-start"
          >
            <ArrowLeft className="w-4 h-4" /> Choose a different doctor
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700 font-medium flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {!selectedDoctor ? (
        <>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col sm:flex-row gap-3">
            <div className="relative grow">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by doctor name or specialization..."
                className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <select
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              className="px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium bg-white outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="">All specializations</option>
              {SPECIALIZATIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-sky-600" />
              <span className="text-sm font-medium">Loading doctors...</span>
            </div>
          ) : filteredDoctors.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <p className="text-slate-600 font-medium">No doctors match your search.</p>
              <p className="text-sm text-slate-400 mt-1">Try a different name or specialization.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredDoctors.map((doc) => (
                <DoctorCard key={doc.id} doctor={doc} onSelect={setSelectedDoctor} />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-6">
          <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-sky-600 text-white rounded-xl font-bold flex items-center justify-center text-lg shrink-0">
                Dr
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Dr. {selectedDoctor.name}</h3>
                <span className="text-xs font-medium text-sky-700">
                  {selectedDoctor.specialization} &middot; {selectedDoctor.roomNumber}
                </span>
              </div>
            </div>
            <span className="text-xs font-bold text-slate-500">Step 1 &mdash; pick a slot</span>
          </div>

          <SlotPicker
            key={`${selectedDoctor.id}-${slotRefreshKey}`}
            doctor={selectedDoctor}
            onSlotSelected={handleSlotSelect}
            busySlot={holdingSlot}
          />
        </div>
      )}

      {showModal && holdData && (
        <SymptomModal
          appointmentId={holdData.appointmentId}
          holdExpiresAt={holdData.holdExpiresAt}
          doctor={selectedDoctor}
          slot={selectedSlot}
          onConfirm={handleConfirmBooking}
          onClose={handleModalClose}
        />
      )}
    </div>
  );
};

export default BookAppointment;
