import React, { useState } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, parseISO, isWithinInterval, startOfDay, setMonth, setYear } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';

interface Job {
  id: string;
  title: string;
  mode: 'expense' | 'budget';
  start_date?: string | null;
  end_date?: string | null;
  [key: string]: any;
}

interface CalendarViewProps {
  jobs: Job[];
  onDateClick?: (date: string) => void;
}

const JobPill: React.FC<{ job: Job; onClick: () => void }> = ({ job, onClick }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const textRef = React.useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = React.useState(false);

  React.useEffect(() => {
    if (containerRef.current && textRef.current) {
      setIsOverflowing(textRef.current.scrollWidth > containerRef.current.clientWidth);
    }
  }, [job.title]);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`relative overflow-hidden text-[10px] sm:text-xs py-1 rounded-md cursor-pointer transition-all mb-0.5 group ${
        job.mode === 'budget' 
          ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20' 
          : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20'
      }`}
      title={job.title}
      ref={containerRef}
    >
      <div className={`whitespace-nowrap px-1.5 ${isOverflowing ? 'animate-marquee' : ''}`}>
        <span ref={textRef} className={`inline-block ${isOverflowing ? 'pr-4' : ''}`}>{job.title}</span>
        {isOverflowing && <span className="inline-block pr-4">{job.title}</span>}
      </div>
    </motion.div>
  );
};

export default function CalendarView({ jobs, onDateClick }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const navigate = useNavigate();

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const goToToday = () => setCurrentDate(new Date());

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Parse job dates
  const jobsWithParsedDates = jobs.filter(j => j.start_date).map(job => {
    const start = startOfDay(parseISO(job.start_date!));
    const end = job.end_date ? startOfDay(parseISO(job.end_date)) : start;
    return { ...job, parsedStart: start, parsedEnd: end };
  });

  return (
    <div className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 backdrop-blur-md overflow-hidden flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-[#7c3bed]">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div className="flex items-center gap-2">
            <select 
              value={currentDate.getMonth()}
              onChange={(e) => setCurrentDate(setMonth(currentDate, parseInt(e.target.value)))}
              className="bg-transparent text-xl font-bold text-white focus:outline-none cursor-pointer hover:bg-white/5 rounded px-1"
            >
              {Array.from({ length: 12 }).map((_, i) => (
                <option key={i} value={i} className="bg-[#1c172d] text-base">{format(new Date(2000, i, 1), 'MMMM')}</option>
              ))}
            </select>
            <select
              value={currentDate.getFullYear()}
              onChange={(e) => setCurrentDate(setYear(currentDate, parseInt(e.target.value)))}
              className="bg-transparent text-xl font-bold text-white focus:outline-none cursor-pointer hover:bg-white/5 rounded px-1"
            >
              {Array.from({ length: 10 }).map((_, i) => {
                const year = new Date().getFullYear() - 5 + i;
                return <option key={year} value={year} className="bg-[#1c172d] text-base">{year}</option>;
              })}
            </select>
          </div>
        </div>
        
        <div className="flex items-center gap-2 bg-black/20 p-1 rounded-xl border border-white/5">
          <button 
            onClick={prevMonth}
            className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button 
            onClick={goToToday}
            className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors flex items-center justify-center"
            title="Go to Today"
          >
            <div className="w-4 h-4 rounded-full border-2 border-current flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-current rounded-full"></div>
            </div>
          </button>
          <button 
            onClick={nextMonth}
            className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {weekDays.map(day => (
          <div key={day} className="text-center text-xs font-bold text-gray-500 uppercase tracking-wider py-2">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px bg-white/5 border border-white/5 rounded-2xl overflow-hidden flex-1">
        {days.map((day, dayIdx) => {
          const isCurrentMonth = isSameMonth(day, monthStart);
          const isToday = isSameDay(day, new Date());
          
          // Find jobs active on this day
          const dayJobs = jobsWithParsedDates.filter(job => {
             return isSameDay(day, job.parsedStart) || 
                    isSameDay(day, job.parsedEnd) || 
                    isWithinInterval(day, { start: job.parsedStart, end: job.parsedEnd });
          });

          return (
            <div 
              key={day.toString()} 
              onClick={() => onDateClick?.(format(day, 'yyyy-MM-dd'))}
              className={`min-h-[100px] bg-[#1c172d] p-1.5 sm:p-2 transition-colors cursor-pointer hover:bg-white/5 ${!isCurrentMonth ? 'opacity-50 bg-black/20' : ''}`}
            >
              <div className={`flex justify-between items-start mb-1`}>
                <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${isToday ? 'bg-[#7c3bed] text-white shadow-lg shadow-[#7c3bed]/30' : 'text-gray-400'}`}>
                  {format(day, 'd')}
                </span>
              </div>
              
              <div className="space-y-1 overflow-y-auto max-h-[80px] pr-1 custom-scrollbar">
                {dayJobs.map(job => {
                  const isStart = isSameDay(day, job.parsedStart);
                  const isEnd = isSameDay(day, job.parsedEnd);
                  
                  return (
                    <JobPill 
                      key={job.id} 
                      job={job} 
                      onClick={() => navigate(`/jobs/${job.id}`)} 
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
