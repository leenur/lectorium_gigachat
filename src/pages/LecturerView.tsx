import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';
import { Users, MessageSquare, Upload, Clock, Activity, FileText, Brain, LogOut, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { analyzePdf, AnalysisResult } from '../services/ai';

interface LecturerViewProps {
  onLogout: () => void;
}

export default function LecturerView({ onLogout }: LecturerViewProps) {
  const [stats, setStats] = useState<{ average: number, count: number, values: number[] }>({ average: 0, count: 0, values: [] });
  const [questions, setQuestions] = useState<any[]>([]);
  const [notesContent, setNotesContent] = useState('');
  const [attendanceCount, setAttendanceCount] = useState<number | null>(null);
  const [attendanceActive, setAttendanceActive] = useState(false);
  const [timeSeriesData, setTimeSeriesData] = useState<{ time: string, average: number }[]>([]);
  const [aiStatus, setAiStatus] = useState<{ status: string, message: string, provider?: string, model?: string } | null>(null);

  useEffect(() => {
    const checkAi = async () => {
      try {
        const res = await fetch('/api/health/ai');
        const data = await res.json();
        setAiStatus(data);
      } catch (e) {
        setAiStatus({ status: 'error', message: 'Не удалось проверить статус AI' });
      }
    };
    checkAi();
  }, []);

  const [quizGenerating, setQuizGenerating] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [activeQuizId, setActiveQuizId] = useState<number | null>(null);
  const [activeQuizQuestions, setActiveQuizQuestions] = useState<any[]>([]);
  const [quizResults, setQuizResults] = useState<any[]>([]);
  const [expandedResultId, setExpandedResultId] = useState<number | null>(null);

  useEffect(() => {
    // Initial fetch
    fetch('/api/notes').then(res => res.json()).then(data => {
        if (data.content) setNotesContent(data.content);
    });
    fetch('/api/quiz/active').then(res => res.json()).then(data => {
        if (data) {
            setActiveQuizId(data.id);
            setActiveQuizQuestions(data.questions || []);
        }
    });

    // Polling
    const pollState = async () => {
        try {
            // Heartbeat as lecturer
            await fetch('/api/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: 0, name: 'Lecturer', role: 'lecturer' })
            });

            const res = await fetch('/api/state');
            const data = await res.json();

            setStats(data.feedbackStats);
            setQuestions(data.questions);
            
            if (data.attendance.active) {
                setAttendanceActive(true);
                setAttendanceCount(data.attendance.count);
            } else {
                setAttendanceActive(false);
                // Keep last count visible if just finished? 
                // For simplicity, we just follow server state.
                if (attendanceActive) {
                    // Transition from active to inactive
                    setAttendanceCount(data.attendance.count);
                }
            }

            // Update time series
            setTimeSeriesData(prev => {
                const newData = [...prev, { time: new Date().toLocaleTimeString(), average: data.feedbackStats.average }];
                return newData.slice(-20);
            });

        } catch (e) {
            console.error("Polling error:", e);
        }
    };

    const interval = setInterval(pollState, 2000);
    pollState();

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!activeQuizId) return;

    const pollQuizResults = async () => {
        try {
            const res = await fetch(`/api/quiz/results/${activeQuizId}`);
            const data = await res.json();
            setQuizResults(data);
        } catch (e) {
            console.error(e);
        }
    };

    const interval = setInterval(pollQuizResults, 3000);
    pollQuizResults();

    return () => clearInterval(interval);
  }, [activeQuizId]);

  const uploadNotes = async () => {
    if (!notesContent.trim()) {
        alert("Заметки не могут быть пустыми");
        return;
    }
    setUploading(true);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: notesContent }),
      });
      
      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }
      
      alert('Заметки обновлены');
    } catch (error) {
      console.error("Failed to upload notes:", error);
      alert('Ошибка при сохранении заметок');
    } finally {
      setUploading(false);
    }
  };

  const publishQuiz = async () => {
    if (!analysisResult?.quiz) return;
    setQuizGenerating(true);
    try {
        const res = await fetch('/api/quiz/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quiz: analysisResult.quiz }),
        });
        const data = await res.json();
        if (res.ok) {
            setActiveQuizId(data.id);
            setActiveQuizQuestions(analysisResult.quiz);
            setQuizResults([]);
            alert('Квиз опубликован и отправлен студентам!');
        } else {
            alert('Ошибка публикации квиза');
        }
    } catch (e) {
        console.error(e);
        alert('Ошибка сети');
    } finally {
        setQuizGenerating(false);
    }
  };


  const startAttendance = async () => {
    await fetch('/api/attendance/start', { method: 'POST' });
  };

  // Prepare histogram data from raw values
  const histogramData = Array.from({ length: 5 }, (_, i) => {
    const min = i * 20;
    const max = (i + 1) * 20;
    const values = stats.values || [];
    const count = values.filter(v => v >= min && (i === 4 ? v <= max : v < max)).length;
    return { name: `${min}-${max}`, count };
  });

  return (
    <div className="min-h-screen bg-stone-100 p-6">
      <header className="max-w-7xl mx-auto mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-serif font-bold text-stone-900">Панель преподавателя</h1>
          <p className="text-stone-500">Активных студентов: {stats.count}</p>
        </div>
        <div className="flex gap-4">
           {/* AI Status Indicator */}
           <div 
             className="flex flex-col items-start justify-center px-3 py-1.5 rounded-xl bg-white shadow-sm border border-stone-200 cursor-help" 
             onClick={() => {
               if (aiStatus?.status !== 'ok') {
                 alert(`Статус AI: Отключен\n${aiStatus?.message || 'Пожалуйста, настройте ключи API.'}`);
               } else {
                 alert(`Текущий AI:\nПровайдер: ${aiStatus?.provider}\nМодель: ${aiStatus?.model}`);
               }
             }}
             title={aiStatus?.message || 'Проверка статуса AI...'}
           >
             <div className="flex items-center gap-2">
               <div className={cn("w-2 h-2 rounded-full", aiStatus?.status === 'ok' ? "bg-emerald-500" : "bg-red-500 animate-pulse")} />
               <span className="text-stone-600 text-xs font-medium font-mono uppercase tracking-tight">
                 {aiStatus?.provider || 'AI'}: {aiStatus?.status === 'ok' ? 'Online' : 'Offline'}
               </span>
             </div>
             {aiStatus?.model && (
               <span className="text-[9px] text-stone-400 pl-4 uppercase tracking-wider">{aiStatus.model}</span>
             )}
           </div>

           {/* Attendance Button */}
           <div className="flex items-center gap-4 bg-white p-2 rounded-xl shadow-sm border border-stone-200">
             {attendanceActive ? (
                <div className="px-4 py-2 flex items-center gap-2 text-emerald-600 font-bold animate-pulse">
                    <Clock size={20} />
                    Сбор данных... {attendanceCount}
                </div>
             ) : (
                <div className="flex items-center gap-4">
                    {attendanceCount !== null && (
                        <span className="text-stone-600 font-mono text-sm px-2">
                            Присутствовало: {attendanceCount}
                        </span>
                    )}
                    <button 
                        onClick={startAttendance}
                        className="bg-stone-900 text-white px-4 py-2 rounded-lg hover:bg-stone-800 transition-colors flex items-center gap-2"
                    >
                        <Clock size={18} />
                        Проверка посещаемости
                    </button>
                </div>
             )}
           </div>
           
           <button 
             onClick={onLogout}
             className="bg-white p-3 rounded-xl shadow-sm border border-stone-200 text-stone-600 hover:text-red-600 hover:bg-red-50 transition-colors"
             title="Выйти"
           >
             <LogOut size={20} />
           </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Analytics */}
        <div className="lg:col-span-2 space-y-6">
          {/* Main Stats Cards */}
          <div className="grid grid-cols-2 gap-4">
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                <h3 className="text-stone-500 text-sm font-medium uppercase tracking-wider mb-2">Среднее понимание</h3>
                <div className="flex items-end gap-2">
                    <span className={cn("text-5xl font-mono font-bold", stats.average < 50 ? "text-red-500" : "text-emerald-600")}>
                        {Math.round(stats.average)}%
                    </span>
                    <span className="text-stone-400 mb-2">текущее</span>
                </div>
             </div>
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                <h3 className="text-stone-500 text-sm font-medium uppercase tracking-wider mb-2">Активность</h3>
                <div className="flex items-end gap-2">
                    <span className="text-5xl font-mono font-bold text-stone-800">
                        {stats.count}
                    </span>
                    <span className="text-stone-400 mb-2">студентов</span>
                </div>
             </div>
          </div>

          {/* Charts */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
            <h3 className="text-lg font-medium text-stone-800 mb-6 flex items-center gap-2">
                <Activity size={20} />
                Распределение понимания
            </h3>
            <div className="h-64 w-full" style={{ minHeight: '250px' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histogramData}>
                        <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip 
                            cursor={{fill: 'transparent'}}
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        />
                        <Bar dataKey="count" fill="#1c1917" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
            <h3 className="text-lg font-medium text-stone-800 mb-6">Динамика (среднее)</h3>
            <div className="h-48 w-full" style={{ minHeight: '192px' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timeSeriesData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                        <XAxis dataKey="time" hide />
                        <YAxis domain={[0, 100]} hide />
                        <Tooltip />
                        <Line type="monotone" dataKey="average" stroke="#059669" strokeWidth={3} dot={false} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Right Column: Questions & Notes */}
        <div className="space-y-6">
            {/* Questions Feed */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 h-[400px] flex flex-col">
                <h3 className="text-lg font-medium text-stone-800 mb-4 flex items-center gap-2">
                    <MessageSquare size={20} />
                    Вопросы ({questions.length})
                </h3>
                <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                    {questions.length === 0 ? (
                        <p className="text-stone-400 text-center mt-10">Вопросов пока нет</p>
                    ) : (
                        questions.map((q) => (
                            <div key={q.id} className="bg-stone-50 p-3 rounded-lg border border-stone-100">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="font-bold text-xs text-stone-600">{q.user_name}</span>
                                    <span className="text-[10px] text-stone-400">{new Date(q.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                </div>
                                <p className="text-sm text-stone-800">{q.content}</p>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Notes Upload */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                <h3 className="text-lg font-medium text-stone-800 mb-4 flex items-center gap-2">
                    <Upload size={20} />
                    Материалы лекции
                </h3>
                
                <div className="mb-4">
                  <div className="block w-full cursor-pointer bg-stone-50 border-2 border-dashed border-stone-300 rounded-lg p-4 text-center hover:bg-stone-100 transition-colors">
                    <input 
                      type="file" 
                      accept=".pdf" 
                      id="pdf-upload"
                      className="hidden" 
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        
                        if (file.size > 30 * 1024 * 1024) {
                          alert("Файл слишком большой (макс 30МБ)");
                          return;
                        }

                        setUploading(true);
                        try {
                          const base64 = await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.readAsDataURL(file);
                            reader.onload = () => resolve((reader.result as string).split(',')[1]);
                            reader.onerror = error => reject(error);
                          });

                          // Analyze PDF on client
                          const result = await analyzePdf(base64);
                          setAnalysisResult(result);
                          setSummary(result.summary);
                          setNotesContent(result.summary); // Pre-fill notes with summary

                          // Optionally save summary to server as notes
                          await fetch('/api/notes', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ content: result.summary })
                          });
                          
                          alert('PDF проанализирован: саммари и квиз готовы!');

                        } catch (err) {
                          console.error(err);
                          alert(err instanceof Error ? err.message : 'Ошибка при анализе PDF');
                        } finally {
                          setUploading(false);
                        }
                      }}
                    />
                    <label htmlFor="pdf-upload" className="cursor-pointer w-full h-full block">
                        <span className="text-stone-500 text-sm">
                        {uploading ? 'Анализ PDF...' : 'Загрузить PDF для анализа'}
                        </span>
                    </label>
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-stone-200" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-stone-500">Или редактировать текст</span>
                  </div>
                </div>

                <textarea
                    value={notesContent}
                    onChange={(e) => setNotesContent(e.target.value)}
                    className="w-full h-32 p-3 rounded-lg bg-stone-50 border border-stone-200 text-sm focus:ring-2 focus:ring-stone-900 outline-none resize-none my-3"
                    placeholder="Вставьте текст лекции или ссылку на Google Doc..."
                />
                <button 
                    onClick={uploadNotes}
                    disabled={uploading}
                    className="w-full bg-stone-900 text-white py-2 rounded-lg font-medium hover:bg-stone-800 transition-colors disabled:opacity-50"
                >
                    {uploading ? 'Сохранение...' : 'Обновить материалы'}
                </button>

                {summary && (
                    <div className="mt-4 bg-indigo-50 p-4 rounded-xl border border-indigo-100 text-sm text-indigo-900">
                        <h4 className="font-bold mb-2">Краткое содержание:</h4>
                        <p className="whitespace-pre-wrap">{summary}</p>
                    </div>
                )}
            </div>

            {/* Quiz Generator (Only if Analysis Result exists) */}
            {analysisResult && analysisResult.quiz && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                    <h3 className="text-lg font-medium text-stone-800 mb-4 flex items-center gap-2">
                        <Brain size={20} />
                        Квиз готов ({analysisResult.quiz.length} вопросов)
                    </h3>
                    <div className="bg-stone-50 p-4 rounded-xl border border-stone-100">
                        <p className="text-xs text-stone-500 mb-3">
                            Квиз сгенерирован на основе PDF. Нажмите кнопку ниже, чтобы отправить его студентам.
                        </p>
                        
                        <div className="space-y-2 mb-4">
                            {analysisResult.quiz.map((q, i) => (
                                <div key={i} className="text-xs text-stone-600 border-b border-stone-200 pb-2 last:border-0">
                                    <span className="font-bold">{i + 1}. {q.question}</span>
                                </div>
                            ))}
                        </div>

                        <button 
                            onClick={publishQuiz}
                            disabled={quizGenerating}
                            className="w-full bg-indigo-600 text-white py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 text-sm"
                        >
                            {quizGenerating ? 'Публикация...' : 'Опубликовать квиз для студентов'}
                        </button>
                    </div>
                </div>
            )}

            {/* Quiz Results Feed */}
            {activeQuizId && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 flex flex-col" style={{ minHeight: '400px' }}>
                    <h3 className="text-lg font-medium text-stone-800 mb-4 flex items-center gap-2">
                        <CheckCircle size={20} className="text-emerald-500" />
                        Результаты квиза ({quizResults.length})
                    </h3>
                    <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                        {quizResults.length === 0 ? (
                            <p className="text-stone-400 text-center mt-10">Ответов пока нет</p>
                        ) : (
                            quizResults.map((r, idx) => {
                                const parsedAnswers = typeof r.answers === 'string' ? JSON.parse(r.answers) : (r.answers || []);
                                const isExpanded = expandedResultId === r.id;

                                return (
                                <div key={idx} className="bg-stone-50 rounded-lg border border-stone-100 overflow-hidden">
                                    <div 
                                        className="p-3 flex justify-between items-center cursor-pointer hover:bg-stone-100 transition-colors"
                                        onClick={() => setExpandedResultId(isExpanded ? null : r.id)}
                                    >
                                        <div>
                                            <span className="font-bold text-sm text-stone-700">{r.user_name}</span>
                                            <p className="text-[10px] text-stone-400">
                                                {r.created_at ? new Date(r.created_at).toLocaleTimeString() : 'Только что'}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className={cn(
                                                "px-3 py-1 rounded-full text-xs font-bold w-16 text-center",
                                                (r.score / r.total) >= 0.7 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                                            )}>
                                                {r.score} / {r.total}
                                            </div>
                                            <div className="text-stone-400">
                                                <svg 
                                                    className={cn("w-4 h-4 transition-transform", isExpanded && "rotate-180")} 
                                                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                                >
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </div>
                                        </div>
                                    </div>

                                    {isExpanded && activeQuizQuestions.length > 0 && (
                                        <div className="p-4 border-t border-stone-200 bg-white space-y-4">
                                            <h4 className="text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-2">Ответы студента</h4>
                                            {activeQuizQuestions.map((q, qIdx) => {
                                                const studentAnswerIdx = parsedAnswers[qIdx];
                                                const isCorrect = studentAnswerIdx === q.correctIndex;
                                                
                                                return (
                                                    <div key={qIdx} className="text-sm">
                                                        <p className="font-medium text-stone-800 mb-1.5 leading-snug">
                                                            {qIdx + 1}. {q.question}
                                                        </p>
                                                        <div className="space-y-1.5 border-l-2 pl-3 ml-1 border-stone-200">
                                                            <div className={cn(
                                                                "text-xs p-1.5 rounded",
                                                                isCorrect ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                                                            )}>
                                                                <span className="font-semibold">Студент {isCorrect ? '(Верно)' : '(Ошибка)'}: </span> 
                                                                {studentAnswerIdx !== undefined && studentAnswerIdx !== -1 && q.options[studentAnswerIdx] 
                                                                    ? q.options[studentAnswerIdx] 
                                                                    : 'Нет ответа'
                                                                }
                                                            </div>
                                                            {!isCorrect && (
                                                                <div className="text-xs p-1.5 rounded bg-stone-50 text-stone-600">
                                                                    <span className="font-semibold">Правильный: </span>
                                                                    {q.options[q.correctIndex]}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )})
                        )}
                    </div>
                </div>
            )}
        </div>

      </main>
    </div>
  );
}
