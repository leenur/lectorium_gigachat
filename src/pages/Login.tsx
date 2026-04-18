import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface LoginProps {
  onLogin: (user: any) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [role, setRole] = useState<'student' | 'lecturer'>('student');
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  React.useEffect(() => {
    const saved = localStorage.getItem('lectorium_user');
    if (saved) {
        const user = JSON.parse(saved);
        onLogin(user);
        navigate(user.role === 'lecturer' ? '/lecturer' : '/student');
    }
  }, [navigate, onLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (role === 'lecturer' && password !== 'admin') {
         alert('Invalid password');
         setLoading(false);
         return;
      }

      // Check Firebase
      const { db, collection, getDocs, addDoc, query } = await import('@/lib/db');
      const { where } = await import('firebase/firestore');
      
      const q = query(
          collection(db, 'users'), 
          where('name', '==', name), 
          where('role', '==', role)
      );
      const querySnapshot = await getDocs(q);
      
      let user: any = null;
      if (!querySnapshot.empty) {
          const doc = querySnapshot.docs[0];
          user = { id: doc.id, ...doc.data() };
      } else {
          // Create new
          const newDoc = await addDoc(collection(db, 'users'), {
              name,
              group_id: groupId || '',
              role,
              createdAt: Date.now()
          });
          user = { id: newDoc.id, name, group_id: groupId || '', role };
      }

      onLogin(user);
      navigate(role === 'lecturer' ? '/lecturer' : '/student');
      
    } catch (err) {
      console.error(err);
      alert('Ошибка сети или базы данных');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-100 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-stone-200">
        <h1 className="text-3xl font-bold text-stone-800 mb-6 text-center font-serif">Лекториум</h1>
        
        <div className="flex bg-stone-100 p-1 rounded-lg mb-6">
          <button
            className={cn(
              "flex-1 py-2 rounded-md text-sm font-medium transition-all",
              role === 'student' ? "bg-white shadow-sm text-stone-900" : "text-stone-500 hover:text-stone-700"
            )}
            onClick={() => setRole('student')}
          >
            Студент
          </button>
          <button
            className={cn(
              "flex-1 py-2 rounded-md text-sm font-medium transition-all",
              role === 'lecturer' ? "bg-white shadow-sm text-stone-900" : "text-stone-500 hover:text-stone-700"
            )}
            onClick={() => setRole('lecturer')}
          >
            Преподаватель
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">ФИО</label>
            <input
              required
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-stone-300 focus:ring-2 focus:ring-stone-500 focus:border-transparent outline-none"
              placeholder="Иванов Иван Иванович"
            />
          </div>

          {role === 'student' && (
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Номер группы</label>
              <input
                required
                type="text"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-stone-300 focus:ring-2 focus:ring-stone-500 focus:border-transparent outline-none"
                placeholder="101-А"
              />
            </div>
          )}

          {role === 'lecturer' && (
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Пароль</label>
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-stone-300 focus:ring-2 focus:ring-stone-500 focus:border-transparent outline-none"
                placeholder="admin"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-stone-900 text-white py-3 rounded-lg font-medium hover:bg-stone-800 transition-colors disabled:opacity-50"
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
