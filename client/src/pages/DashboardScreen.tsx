import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { LogOut, BookOpen, MessageCircle, LayoutDashboard, Users } from 'lucide-react';

export default function DashboardScreen() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [isDataLoading, setIsDataLoading] = useState(true);

  // Entry animations simulation
  useEffect(() => {
    const loadData = setTimeout(() => {
      setIsDataLoading(false);
    }, 800);
    return () => clearTimeout(loadData);
  }, []);

  const handleLogout = () => {
    logout();
  };

  const getRoleDisplayName = (role: string) => {
    switch (role) {
      case 'admin': return 'Administrator';
      case 'mentor': return 'Mentor';
      case 'student': return 'Student';
      default: return 'User';
    }
  };

  return (
    <div className="flex-1 bg-white min-h-[calc(100vh-64px)] md:min-h-screen">
      {/* Enhanced Header with gradient */}
      <div className="bg-gradient-to-r from-[#01b4ae] via-[#009d99] to-[#01b4ae] px-4 md:px-8 py-6 md:py-8 shadow-md relative z-10 animate-fade-in-down overflow-hidden">
        <div className="flex justify-between items-center max-w-5xl mx-auto">
          <div className="flex-1">
            <h1 className="text-2xl md:text-3xl font-bold text-white tracking-wide mb-1">Eyeconic Dashboard</h1>
            <p className="text-sm md:text-base font-medium text-white/90 tracking-wide">Hi, {user?.name} 👋</p>
          </div>
          {/* We hide this on desktop if there's a sidebar logout icon, but since it's an exact port to the page: */}
          <button
            onClick={handleLogout}
            className="bg-white/20 rounded-xl p-2 md:p-3 shadow-sm hover:bg-white/30 transition-colors ml-4"
            title="Logout"
          >
            <LogOut className="text-white w-5 h-5" />
          </button>
        </div>
        
        {/* Decorative background circles */}
        <div className="absolute top-[-50px] right-[-50px] w-64 h-64 bg-white/10 rounded-full blur-3xl" />
      </div>

      <div className="px-4 md:px-8 pb-10 pt-6 max-w-5xl mx-auto space-y-6">
        
        {/* Enhanced Welcome Card with label/value formatting */}
        <div className="bg-white rounded-2xl p-6 md:p-8 border border-gray-100 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.1)] hover:shadow-[0_8px_30px_-10px_rgba(0,0,0,0.15)] transition-all animate-fade-in-up">
          <h2 className="text-xl md:text-2xl font-bold text-[#01b4ae] mb-6 tracking-wide">Welcome Back!</h2>

          {isDataLoading ? (
            <div className="space-y-4">
              <div className="h-5 bg-gray-100 rounded animate-pulse w-3/4"></div>
              <div className="h-5 bg-gray-100 rounded animate-pulse w-2/3"></div>
              <div className="h-6 bg-gray-100 rounded-lg animate-pulse w-1/4 mt-2"></div>
            </div>
          ) : (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center">
                <span className="text-[14px] md:text-[15px] font-semibold text-gray-400 w-24 tracking-wide uppercase">Name</span>
                <span className="flex-1 text-[16px] md:text-[18px] font-bold text-gray-900">{user?.name}</span>
              </div>
              <div className="flex items-center">
                <span className="text-[14px] md:text-[15px] font-semibold text-gray-400 w-24 tracking-wide uppercase">Email</span>
                <span className="flex-1 text-[15px] md:text-[16px] font-medium text-gray-600">{user?.email}</span>
              </div>
              <div className="flex items-center mt-2">
                <span className="text-[14px] md:text-[15px] font-semibold text-gray-400 w-24 tracking-wide uppercase">Role</span>
                <div>
                  <span className="inline-block bg-[#01b4ae]/10 rounded-lg py-1.5 px-4 border border-[#01b4ae]/20 text-[14px] font-bold text-[#01b4ae] tracking-wide">
                    {getRoleDisplayName(user?.role || '')}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Enhanced Quick Actions Card */}
        <div className="bg-white rounded-2xl p-6 md:p-8 border border-gray-100 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.1)] hover:shadow-[0_8px_30px_-10px_rgba(0,0,0,0.15)] transition-all animate-fade-in-up" style={{ animationDelay: '150ms' }}>
          <h2 className="text-xl md:text-2xl font-bold text-[#01b4ae] mb-3 tracking-wide">Quick Actions</h2>
          
          {isDataLoading ? (
            <div className="h-5 bg-gray-100 rounded animate-pulse w-5/6 mb-6"></div>
          ) : (
            <div className="animate-fade-in">
              <p className="text-[15px] md:text-[16px] text-gray-500 leading-relaxed font-medium mb-8">
                {user?.role === 'admin' && 'Manage users, groups, and quizzes'}
                {user?.role === 'mentor' && 'View your groups and interact with students'}
                {user?.role === 'student' && 'Join groups and attempt quizzes'}
              </p>

              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                {/* Groups button - all roles */}
                <button
                  onClick={() => navigate('/groups')}
                  className="group flex flex-col items-center justify-center bg-gray-50 hover:bg-white rounded-3xl py-8 px-4 border-2 border-transparent hover:border-blue-100 shadow-sm hover:shadow-xl transition-all duration-300"
                >
                  <div className="w-16 h-16 rounded-2xl bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center mb-4 transition-colors">
                    <MessageCircle className="text-blue-600 w-8 h-8" />
                  </div>
                  <span className="text-[15px] font-bold text-gray-800">Groups</span>
                </button>

                {/* Quizzes button - all roles */}
                <button
                  onClick={() => navigate('/quizzes')}
                  className="group flex flex-col items-center justify-center bg-gray-50 hover:bg-white rounded-3xl py-8 px-4 border-2 border-transparent hover:border-emerald-100 shadow-sm hover:shadow-xl transition-all duration-300"
                >
                  <div className="w-16 h-16 rounded-2xl bg-emerald-50 group-hover:bg-emerald-100 flex items-center justify-center mb-4 transition-colors">
                    <BookOpen className="text-emerald-500 w-8 h-8" />
                  </div>
                  <span className="text-[15px] font-bold text-gray-800">Quizzes</span>
                </button>

                {/* My Tasks - student only */}
                {user?.role === 'student' && (
                  <button
                    onClick={() => navigate('/student-assignments')}
                    className="group flex flex-col items-center justify-center bg-gray-50 hover:bg-white rounded-3xl py-8 px-4 border-2 border-transparent hover:border-amber-100 shadow-sm hover:shadow-xl transition-all duration-300"
                  >
                    <div className="w-16 h-16 rounded-2xl bg-amber-50 group-hover:bg-amber-100 flex items-center justify-center mb-4 transition-colors">
                      <LayoutDashboard className="text-amber-500 w-8 h-8" />
                    </div>
                    <span className="text-[15px] font-bold text-gray-800">My Tasks</span>
                  </button>
                )}

                {/* Users - admin only */}
                {user?.role === 'admin' && (
                  <button
                    onClick={() => navigate('/users')}
                    className="group flex flex-col items-center justify-center bg-gray-50 hover:bg-white rounded-3xl py-8 px-4 border-2 border-transparent hover:border-purple-100 shadow-sm hover:shadow-xl transition-all duration-300"
                  >
                    <div className="w-16 h-16 rounded-2xl bg-purple-50 group-hover:bg-purple-100 flex items-center justify-center mb-4 transition-colors">
                      <Users className="text-purple-600 w-8 h-8" />
                    </div>
                    <span className="text-[15px] font-bold text-gray-800">Users</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
