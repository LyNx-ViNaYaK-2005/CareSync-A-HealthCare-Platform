import React, { useState, useEffect, useCallback } from 'react';
import api, { errorMessage } from '../api/client';
import { Calendar, Clock, AlertCircle, Loader2, RefreshCw } from 'lucide-react';

/**
 * Local calendar date as YYYY-MM-DD.
 * `toISOString()` would convert to UTC first, so before 05:30 IST it reports
 * yesterday and the date picker opens on an unbookable day.
 */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const SlotPicker = ({ doctor, onSlotSelected, busySlot }) => {
  const today = localToday();
  const [selectedDate, setSelectedDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [slotData, setSlotData] = useState(null);
  const [error, setError] = useState('');

  const fetchSlots = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/api/appointments/available-slots', {
        params: { doctorId: doctor.id, date: selectedDate },
      });
      if (res.data.success) setSlotData(res.data);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load available slots'));
      setSlotData(null);
    } finally {
      setLoading(false);
    }
  }, [doctor.id, selectedDate]);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  const openCount = slotData?.slots?.filter((s) => s.isAvailable).length || 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-sky-600" />
            Select appointment date
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">
            Dr. {doctor.name} &middot; {doctor.specialization}
            {slotData?.timezone && <span className="text-slate-400"> &middot; times in {slotData.timezone}</span>}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="date"
            min={today}
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3.5 py-2 border border-slate-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
          />
          <button
            type="button"
            onClick={fetchSlots}
            disabled={loading}
            title="Refresh availability"
            className="p-2.5 border border-slate-300 rounded-xl text-slate-500 hover:text-sky-600 hover:border-sky-300 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-10 text-slate-500 gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-sky-600" />
          <span className="text-sm font-medium">Checking availability...</span>
        </div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 my-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      ) : slotData?.onLeave ? (
        <div className="p-6 bg-amber-50 border border-amber-200 rounded-2xl text-center my-4">
          <div className="w-12 h-12 bg-amber-100 text-amber-800 rounded-full flex items-center justify-center mx-auto mb-2 font-bold text-xl">
            !
          </div>
          <h5 className="font-bold text-amber-900">Doctor on leave</h5>
          <p className="text-sm text-amber-700 mt-1">
            Dr. {doctor.name} is unavailable on {selectedDate}. Reason: {slotData.leaveReason}
          </p>
          <p className="text-xs text-amber-600 mt-2 font-medium">Please choose another date.</p>
        </div>
      ) : slotData?.isWorkingDay === false ? (
        <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center my-4">
          <h5 className="font-bold text-slate-800">Not a working day</h5>
          <p className="text-sm text-slate-600 mt-1">
            Dr. {doctor.name} does not hold clinic hours on {slotData.dayOfWeek}s.
          </p>
        </div>
      ) : (
        <div className="mt-5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-3">
            <span>
              {openCount} slot{openCount === 1 ? '' : 's'} available
            </span>
            <span className="text-slate-400">{slotData?.slotDurationMins || 30} min appointments</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {slotData?.slots?.map((slot) => {
              const isBusy = busySlot === slot.startTime;
              return (
                <button
                  key={slot.startTime}
                  type="button"
                  disabled={!slot.isAvailable || isBusy}
                  onClick={() => onSlotSelected({ date: selectedDate, ...slot })}
                  title={
                    slot.reason === 'BOOKED'
                      ? 'Already booked'
                      : slot.reason === 'PAST'
                        ? 'This time has passed'
                        : `Book ${slot.startTime} - ${slot.endTime}`
                  }
                  className={`py-2.5 px-3 rounded-xl border text-sm font-semibold flex items-center justify-center gap-1.5 transition ${
                    slot.isAvailable
                      ? 'border-sky-200 bg-sky-50/50 text-sky-800 hover:bg-sky-600 hover:text-white hover:border-sky-600 shadow-sm'
                      : 'border-slate-100 bg-slate-100 text-slate-400 cursor-not-allowed line-through'
                  } disabled:opacity-70`}
                >
                  {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
                  {slot.startTime}
                </button>
              );
            })}
          </div>

          {slotData?.slots?.length === 0 && (
            <p className="text-center py-6 text-sm text-slate-500 font-medium">No slots configured for this date.</p>
          )}
          {slotData?.slots?.length > 0 && openCount === 0 && (
            <p className="text-center py-4 text-sm text-slate-500 font-medium">
              Every slot on this date is taken or has passed. Try another day.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default SlotPicker;
