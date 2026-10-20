import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import Home from './pages/Home';
import Login from './pages/Login';
import Signup from './pages/Signup';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-4">
          <div className="w-full max-w-sm space-y-6">
            <h1 className="text-3xl font-bold text-center">Mirai Hub</h1>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/login" element={<Login />} />
            </Routes>
          </div>
        </main>
      </AuthProvider>
    </BrowserRouter>
  );
}