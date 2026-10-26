import { ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import NotificationBell from './components/NotificationBell';
import RequireAuth from './components/RequireAuth';
import Home from './pages/Home';
import Login from './pages/Login';
import NewProject from './pages/NewProject';
import Profile from './pages/Profile';
import ProjectPage from './pages/ProjectPage';
import Signup from './pages/Signup';

// Forms and detail pages keep a narrow column; Home uses the full (wider) width
function Narrow({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-lg">{children}</div>;
}

// Your name in the header links to your own profile
function ProfileLink() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <Link
      to={`/u/${user.id}`}
      title="Your profile"
      className="block max-w-[7rem] truncate text-sm text-slate-300 hover:text-white sm:max-w-[12rem]"
    >
      {user.name}
    </Link>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <main className="flex min-h-screen justify-center bg-slate-950 px-4 py-8 text-slate-100">
          <div className="w-full max-w-3xl space-y-6">
            <div className="relative">
              <div className="absolute left-0 top-1/2 z-20 -translate-y-1/2">
                <ProfileLink />
              </div>
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
              <Route path="/u/:id" element={<Narrow><Profile /></Narrow>} />
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