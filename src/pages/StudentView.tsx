import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, BookOpen, Brain, CheckCircle, Clock, FileText, LogOut } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { db, collection, query, orderBy, limit, onSnapshot, setDoc, doc, addDoc } from '@/lib/db';

interface StudentViewProps {
  user: any;
  onLogout: () => void;
}

export default function StudentView({ user, onLogout }: StudentViewProps) {
  const [comprehension, setComprehension] = useState(50);
  const [question, setQuestion] = useState('');
  const [notes, setNotes] = useState('');
  const [summary, setSummary] = useState('');
  const [quiz, setQuiz] = useState<{ id: number, questions: any[] } | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [attendanceSubmitted, setAttendanceSubmitted] = useState(false);
  const [activeTab, setActiveTab] = useState<'feedback' | 'notes'>('feedback');
  const [aiLoading, setAiLoading] = useState(false);

  // Real-time state updates via Firebase
  useEffect(() => {
    let unsubs: (() => void)[] = [];
    
      // Notes
      const notesQ = query(collection(db, 'notes'), orderBy('createdAt', 'desc'), limit(1));
      unsubs.push(onSnapshot(notesQ, (snap) => {
        if (!snap.empty) {
            setNotes(snap.docs[0].data().content);
        } else {
            setNotes('');
            setSummary('');
        }
      }));

      // Active Quiz
      const quizQ = query(collection(db, 'active_quizzes'), orderBy('createdAt', 'desc'), limit(1));
      unsubs.push(onSnapshot(quizQ, (snap) => {
        if (!snap.empty) {
            const data = snap.docs[0].data();
            const fetchedQuizId = snap.docs[0].id as any;
            
            setQuiz(prev => {
                if (!prev || prev.id !== fetchedQuizId) {
                     setQuizAnswers(new Array(JSON.parse(data.data).length).fill(-1));
                     setQuizScore(null);
                     setActiveTab('notes');
                     console.log('Преподаватель запустил новый квиз!');
                     return { id: fetchedQuizId, questions: JSON.parse(data.data) };
                }
                return prev;
            });
        } else {
            setQuiz(null);
            setQuizScore(null);
        }
      }));

      // Attendance
      const attQ = query(collection(db, 'attendance_sessions'), orderBy('createdAt', 'desc'), limit(1));
      unsubs.push(onSnapshot(attQ, (snap) => {
        if (!snap.empty) {
            const isActive = snap.docs[0].data().isActive;
            setAttendanceOpen(prev => {
                if (isActive && !prev) {
                    setAttendanceSubmitted(false);
                    return true;
                } else if (!isActive && prev) {
                    return false;
                }
                return prev;
            });
        }
      }));
    
    return () => {
        unsubs.forEach(u => u());
    };
  }, []);

  // Heartbeat for comprehension feedback
  useEffect(() => {
     let interval: any;
     const heartbeat = () => {
         if (user?.id) {
             setDoc(doc(db, 'active_students', user.id.toString()), {
                 name: user.name,
                 feedback: comprehension,
                 lastActive: Date.now()
             }).catch(console.error);
         }
     };
     heartbeat(); // Initial call
     interval = setInterval(heartbeat, 5000); // 5 seconds
     return () => clearInterval(interval);
  }, [user?.id, user?.name, comprehension]);

  const handleComprehensionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setComprehension(val);
  };

  const sendQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    
    try {
        await addDoc(collection(db, 'questions'), {
             text: question,
             author_name: user.name,
             createdAt: Date.now()
        });
        setQuestion('');
        console.log('Вопрос отправлен!');
    } catch (e) {
        console.error('Ошибка отправки вопроса', e);
    }
  };

  const markAttendance = async () => {
    try {
        await addDoc(collection(db, 'attendance_records'), {
             session_id: 'active', // Placeholder, properly handled in a more complex setup
             student_id: user.id,
             student_name: user.name,
             group_id: user.group_id,
             createdAt: Date.now()
        });
        setAttendanceSubmitted(true);
    } catch (e) {
        console.error('Ошибка отправки посещаемости', e);
    }
  };

  const getSummary = async () => {
    if (!notes) return;
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: notes }),
      });
      const data = await res.json();
      setSummary(data.summary);
    } catch (e) {
      console.error(e);
    } finally {
      setAiLoading(false);
    }
  };

  const submitQuiz = async () => {
    if (!quiz) return;
    let score = 0;
    quiz.questions.forEach((q, i) => {
      if (q.correctIndex === quizAnswers[i]) score++;
    });
    setQuizScore(score);

    // Submit to Firebase if it's a lecturer-published quiz
    if (quiz.id) {
      try {
        await addDoc(collection(db, 'quiz_responses'), {
             quiz_id: quiz.id,
             user_id: user.id || Date.now().toString(),
             user_name: user.name,
             score: score,
             total: quiz.questions.length,
             answers: JSON.stringify(quizAnswers),
             createdAt: Date.now()
        });
      } catch (e) {
        console.error("Failed to submit quiz results:", e);
      }
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10 px-4 py-3 flex justify-between items-center">
        <div>
          <h1 className="font-serif font-bold text-lg text-stone-900">Лекториум</h1>
          <p className="text-xs text-stone-500">{user.name} • {user.group_id}</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setActiveTab('feedback')}
            className={cn("px-3 py-1.5 rounded-full text-sm font-medium transition-colors", activeTab === 'feedback' ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600")}
          >
            Пульт
          </button>
          <button 
            onClick={() => setActiveTab('notes')}
            className={cn("px-3 py-1.5 rounded-full text-sm font-medium transition-colors", activeTab === 'notes' ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600")}
          >
            Конспект
          </button>
          
          <button 
            onClick={onLogout}
            className="p-1.5 rounded-full text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors ml-2"
            title="Выйти"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 flex gap-6">
        
        {/* Main Content Area */}
        <div className="flex-1 space-y-6 min-w-0">
            {/* Attendance Alert */}
            <AnimatePresence>
            {attendanceOpen && !attendanceSubmitted && (
                <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-emerald-500 text-white p-4 rounded-xl shadow-lg flex items-center justify-between mb-6"
                >
                <div className="flex items-center gap-2">
                    <Clock className="animate-pulse" />
                    <span className="font-bold">Отметить присутствие!</span>
                </div>
                <button 
                    onClick={markAttendance}
                    className="bg-white text-emerald-600 px-4 py-2 rounded-lg font-bold shadow-sm hover:bg-emerald-50 active:scale-95 transition-transform"
                >
                    Я здесь
                </button>
                </motion.div>
            )}
            </AnimatePresence>

            {activeTab === 'feedback' && (
            <div className="space-y-8">
                {/* Ask Question */}
                <section className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
                <h2 className="text-lg font-medium text-stone-800 mb-4">Задать вопрос</h2>
                <form onSubmit={sendQuestion} className="flex gap-2">
                    <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Что такое..."
                    className="flex-1 px-4 py-3 rounded-xl bg-stone-50 border border-stone-200 focus:ring-2 focus:ring-stone-900 focus:border-transparent outline-none"
                    />
                    <button 
                    type="submit"
                    className="bg-stone-900 text-white p-3 rounded-xl hover:bg-stone-800 transition-colors"
                    >
                    <Send size={20} />
                    </button>
                </form>
                </section>
            </div>
            )}

            {activeTab === 'notes' && (
            <div className="space-y-6">
                <section className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100 min-h-[200px]">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-medium text-stone-800 flex items-center gap-2">
                    <FileText size={20} />
                    Материалы лекции
                    </h2>
                    {notes && (
                    <div className="flex gap-2">
                        <button 
                        onClick={getSummary}
                        disabled={aiLoading}
                        className="p-2 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors"
                        title="Саммари"
                        >
                        <BookOpen size={20} />
                        </button>
                    </div>
                    )}
                </div>
                
                {notes ? (
                    <div className="prose prose-stone prose-sm max-w-none">
                    <ReactMarkdown>{notes}</ReactMarkdown>
                    </div>
                ) : (
                    <p className="text-stone-400 italic text-center py-8">Преподаватель еще не загрузил заметки</p>
                )}
                </section>

                {/* AI Summary Output */}
                {summary && (
                <motion.section 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100"
                >
                    <h3 className="font-bold text-indigo-900 mb-2 flex items-center gap-2">
                    <BookOpen size={16} />
                    Краткое содержание (AI)
                    </h3>
                    <div className="prose prose-indigo prose-sm">
                    <ReactMarkdown>{summary}</ReactMarkdown>
                    </div>
                </motion.section>
                )}

                {/* Quiz Output */}
                {quiz && quiz.id && (
                <motion.section 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-amber-50 p-6 rounded-2xl border border-amber-100"
                >
                    <h3 className="font-bold text-amber-900 mb-4 flex items-center gap-2">
                    <Brain size={16} />
                    Квиз от преподавателя
                    </h3>
                    
                    {quizScore === null ? (
                    <div className="space-y-6">
                        {quiz.questions.map((q, qIdx) => (
                        <div key={qIdx} className="space-y-2">
                            <p className="font-medium text-amber-900">{qIdx + 1}. {q.question}</p>
                            <div className="space-y-1">
                            {q.options.map((opt: string, oIdx: number) => (
                                <label key={oIdx} className="flex items-center gap-2 p-2 rounded-lg hover:bg-amber-100 cursor-pointer">
                                <input 
                                    type="radio" 
                                    name={`q-${qIdx}`}
                                    checked={quizAnswers[qIdx] === oIdx}
                                    onChange={() => {
                                    const newAnswers = [...quizAnswers];
                                    newAnswers[qIdx] = oIdx;
                                    setQuizAnswers(newAnswers);
                                    }}
                                    className="accent-amber-600"
                                />
                                <span className="text-sm text-amber-800">{opt}</span>
                                </label>
                            ))}
                            </div>
                        </div>
                        ))}
                        <button 
                        onClick={submitQuiz}
                        className="w-full bg-amber-600 text-white py-2 rounded-lg font-bold hover:bg-amber-700 transition-colors"
                        >
                        Проверить
                        </button>
                    </div>
                    ) : (
                    <div className="text-center py-4">
                        <p className="text-2xl font-bold text-amber-900 mb-2">
                        Результат: {quizScore} / {quiz.questions.length}
                        </p>
                        <p className="text-sm text-amber-700">
                        {quizScore === quiz.questions.length ? 'Отлично!' : 'Можно лучше.'}
                        </p>
                    </div>
                    )}
                </motion.section>
                )}
            </div>
            )}
        </div>

        {/* Persistent Vertical Slider Sidebar */}
        <div className="hidden md:flex flex-col items-center bg-white p-4 rounded-2xl shadow-sm border border-stone-200 h-[calc(100vh-100px)] sticky top-20 w-32">
            <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-4 text-center">Понимание</h3>
            <span className="text-3xl mb-4">🤩</span>
            <div className="flex-1 py-2">
                <input
                    type="range"
                    min="0"
                    max="100"
                    value={comprehension}
                    onChange={handleComprehensionChange}
                    className="vertical-slider"
                />
            </div>
            <span className="text-3xl mt-4">😰</span>
            <div className="mt-4 text-2xl font-mono font-bold text-stone-900">
                {comprehension}%
            </div>
        </div>

        {/* Mobile Floating Slider Button/Overlay? Or just put it at the bottom? */}
        {/* For mobile, let's keep it simple and put it at the bottom fixed or inline if screen is small */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 p-4 z-50 flex items-center gap-4">
            <span className="text-2xl">😰</span>
            <input
                type="range"
                min="0"
                max="100"
                value={comprehension}
                onChange={handleComprehensionChange}
                className="flex-1 h-2 bg-stone-200 rounded-lg appearance-none accent-stone-900"
            />
            <span className="text-2xl">🤩</span>
        </div>

      </main>
    </div>
  );
}
