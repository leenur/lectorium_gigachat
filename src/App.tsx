/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Login from './pages/Login';
import StudentView from './pages/StudentView';
import LecturerView from './pages/LecturerView';

export default function App() {
  const [user, setUser] = useState<any>(() => {
    const saved = localStorage.getItem('lectorium_user');
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    if (user) {
      localStorage.setItem('lectorium_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('lectorium_user');
    }
  }, [user]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login onLogin={setUser} />} />
        <Route 
          path="/student" 
          element={user && user.role === 'student' ? <StudentView user={user} onLogout={() => setUser(null)} /> : <Navigate to="/" />} 
        />
        <Route 
          path="/lecturer" 
          element={user && user.role === 'lecturer' ? <LecturerView onLogout={() => setUser(null)} /> : <Navigate to="/" />} 
        />
      </Routes>
    </BrowserRouter>
  );
}
