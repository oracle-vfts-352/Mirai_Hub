import { ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import NotificationBell from './components/NotificationBell';
import RequireAuth from './components/RequireAuth';
import Home from './pages/Home';
import Login from './pages/Login';
import NewProject from './pages/NewProject';
import ProjectPage from './pages/ProjectPage';
import Signup from './pages/Signup';

// Forms and the project page keep a narrow column; Home uses the full (wider) width
function Narrow({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-lg">{children}</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <main className="flex min-h-screen justify-center bg-slate-950 px-4 py-8 text-slate-100">
          <div className="w-full max-w-3xl space-y-6">
            <div className="relative">
              <h1 className="text-center text-3xl font-bold">
                <Link to="/">Mirai Hub</Link>
              </h1>
              <div className="absolute right-0 top-1/2 z-20 -translate-y-1/2">
                <NotificationBell />
              </div>
            </div>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/signup" element={<Narrow><Signup /></Narrow>} />
              <Route path="/login" element={<Narrow><Login /></Narrow>} />
              <Route
                path="/projects/new"
                element={
                  <Narrow>
                    <RequireAuth role="DEV">
                      <NewProject />
                    </RequireAuth>
                  </Narrow>
                }
              />
              <Route path="/p/:slug" element={<Narrow><ProjectPage /></Narrow>} />
              <Route
                path="*"
                element={
                  <Narrow>
                    <p className="text-center text-slate-400">
                      Page not found. <Link to="/" className="text-indigo-400 hover:underline">Home</Link>
                    </p>
                  </Narrow>
                }
              />
            </Routes>
          </div>
        </main>
      </AuthProvider>
    </BrowserRouter>
  );
}