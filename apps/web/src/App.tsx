import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import RequireAuth from './components/RequireAuth';
import Home from './pages/Home';
import Login from './pages/Login';
import NewProject from './pages/NewProject';
import ProjectPage from './pages/ProjectPage';
import Signup from './pages/Signup';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-4">
          <div className="w-full max-w-lg space-y-6">
            <h1 className="text-3xl font-bold text-center">
              <Link to="/">Mirai Hub</Link>
            </h1>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/login" element={<Login />} />
              <Route
                path="/projects/new"
                element={
                  <RequireAuth role="DEV">
                    <NewProject />
                  </RequireAuth>
                }
              />
              <Route path="/p/:slug" element={<ProjectPage />} />
              <Route
                path="*"
                element={
                  <p className="text-center text-slate-400">
                    Page not found. <Link to="/" className="text-indigo-400 hover:underline">Home</Link>
                  </p>
                }
              />
            </Routes>
          </div>
        </main>
      </AuthProvider>
    </BrowserRouter>
  );
}