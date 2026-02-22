import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  Home, 
  Menu, 
  LogOut, 
  User as UserIcon,
  X,
  BarChart3,
  MessageCircle,
  BookOpen,
  Users
} from 'lucide-react';

export default function MainLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: Home },
    ...(user?.role === 'admin' ? [{ name: 'Admin Dashboard', path: '/admin', icon: BarChart3 }] : []),
    { name: 'Groups', path: '/groups', icon: MessageCircle },
    { name: 'Quizzes', path: '/quizzes', icon: BookOpen },
    ...(user?.role === 'admin' ? [{ name: 'Users', path: '/users', icon: Users }] : []),
  ];

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden font-sans">
      
      {/* --- DESKTOP SIDEBAR --- */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-gray-200 p-4 transition-all duration-300">
        <div className="flex items-center gap-3 mb-8 px-2">
          <div className="w-10 h-10 rounded-full bg-[#01b4ae] flex items-center justify-center text-white font-bold text-xl shadow-md">
            E
          </div>
          <div>
            <h1 className="text-[#01b4ae] font-bold text-xl tracking-tight leading-none">EYECONIC</h1>
            <span className="text-xs text-gray-500 font-medium">{user?.role === 'admin' ? 'Admin Portal' : 'Student Portal'}</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group font-medium ${
                    isActive 
                      ? 'bg-[#01b4ae]/10 text-[#01b4ae]' 
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={20} className={isActive ? 'text-[#01b4ae]' : 'text-gray-400 group-hover:text-gray-600'} />
                    {item.name}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* User Card */}
        <div className="mt-auto border-t border-gray-200 pt-4 pb-2 px-2">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 border border-gray-200">
              <UserIcon size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-sm font-medium"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* --- MOBILE CONTENT WRAPPER --- */}
      <div className="flex-1 flex flex-col w-full h-full relative">
        
        {/* MOBILE HEADER */}
        <header className="md:hidden flex items-center justify-between p-4 bg-white border-b border-gray-200 z-20">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#01b4ae] flex items-center justify-center text-white font-bold shadow-sm">
              E
            </div>
            <h1 className="text-[#01b4ae] font-bold text-lg">EYECONIC</h1>
          </div>
          <button 
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </header>

        {/* MOBILE MENU DROPDOWN */}
        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-[73px] left-0 w-full bg-white border-b border-gray-200 shadow-xl z-20 animate-fade-in-down">
            <nav className="p-4 space-y-2 relative">
               {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium ${
                          isActive 
                            ? 'bg-[#01b4ae]/10 text-[#01b4ae]' 
                            : 'text-gray-600 hover:bg-gray-50'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon size={20} className={isActive ? 'text-[#01b4ae]' : 'text-gray-400'} />
                          {item.name}
                        </>
                      )}
                    </NavLink>
                  );
                })}
                <div className="pt-4 border-t border-gray-100 mt-2">
                  <div className="px-4 py-2 mb-2">
                    <p className="text-sm font-semibold text-gray-900">{user?.name}</p>
                    <p className="text-xs text-gray-500">{user?.email}</p>
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-xl transition-colors font-medium"
                  >
                    <LogOut size={20} />
                    Sign Out
                  </button>
                </div>
            </nav>
          </div>
        )}
        
        {/* MOBILE OVERLAY */}
        {isMobileMenuOpen && (
          <div 
            className="md:hidden absolute inset-0 bg-black/20 z-10"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* MAIN BODY AREA */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-[#F3F4F6] relative">
            <Outlet />
        </main>
      </div>
    </div>
  );
}
