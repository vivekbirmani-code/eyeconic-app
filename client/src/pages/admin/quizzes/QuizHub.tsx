import { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { api } from '../../../services/api';
import { useNavigate } from 'react-router-dom';
import { 
  Database, 
  PlusCircle, 
  BarChart3, 
  Upload, 
  Clock, 
  ChevronRight
} from 'lucide-react';

interface QuizStats {
  total: number;
  daily: number;
  weekly: number;
  grand: number;
}

export default function QuizHub() {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState<QuizStats>({
    total: 0,
    daily: 0,
    weekly: 0,
    grand: 0
  });
  const [questionCount, setQuestionCount] = useState(0);
  const [retestCount, setRetestCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      
      const statsRes = await api.get('/quizzes/stats');
      setStats(statsRes.data);

      const qStatsRes = await api.get('/question-bank/stats');
      setQuestionCount(qStatsRes.data.total || 0);

      const retestRes = await api.get('/quizzes/retests/pending');
      setRetestCount(retestRes.data.length || 0);

    } catch (error) {
      console.error('Error fetching quiz hub data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const menuItems = [
    {
      id: 'question-bank',
      title: 'Question Bank',
      subtitle: `${questionCount} questions`,
      icon: <Database className="w-6 h-6 text-[#01b4ae]" />,
      route: '/quizzes/question-bank',
      color: 'bg-[#E0F7F6]'
    },
    {
      id: 'create-quiz',
      title: 'Create Quiz',
      subtitle: 'Daily, Weekly, Grand',
      icon: <PlusCircle className="w-6 h-6 text-emerald-500" />,
      route: '/quizzes/create',
      color: 'bg-emerald-50'
    },
    {
      id: 'analytics',
      title: 'Student Analytics',
      subtitle: 'View test history',
      icon: <BarChart3 className="w-6 h-6 text-purple-500" />,
      route: '/quizzes/analytics',
      color: 'bg-purple-50'
    },
    {
      id: 'import',
      title: 'Import from Excel',
      subtitle: 'Upload .xlsx files',
      icon: <Upload className="w-6 h-6 text-blue-500" />,
      route: '/quizzes/import',
      color: 'bg-blue-50'
    },
    {
      id: 'retests',
      title: 'Retest Requests',
      subtitle: retestCount > 0 ? `${retestCount} pending requests` : 'No pending requests',
      icon: <Clock className="w-6 h-6 text-amber-500" />,
      route: '/quizzes/retests',
      color: 'bg-amber-50',
      badge: retestCount > 0
    }
  ];

  if (currentUser?.role !== 'admin') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="bg-red-50 text-red-600 px-6 py-4 rounded-xl font-semibold">
          Access Denied - Admins Only
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white min-h-[calc(100vh-64px)] md:min-h-screen">
      
      {/* Header */}
      <div className="bg-[#01b4ae] px-4 md:px-8 py-6 md:py-8 shadow-sm">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl md:text-3xl font-bold text-white tracking-wide mb-1">Quiz Hub</h1>
          <p className="text-white/90 font-medium">Manage questions and tests</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 md:py-8">
        
        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-3 md:gap-4 mb-8">
          {[
            { label: 'Questions', value: questionCount, loading: isLoading },
            { label: 'Total Tests', value: stats.total, loading: isLoading },
            { label: 'Daily', value: stats.daily, loading: isLoading },
            { label: 'Weekly', value: stats.weekly, loading: isLoading }
          ].map((stat, i) => (
            <div key={i} className="bg-white rounded-2xl p-4 md:p-6 border border-gray-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] flex flex-col items-center justify-center animate-fade-in-up" style={{ animationDelay: `${i * 100}ms` }}>
              {stat.loading ? (
                <div className="w-10 h-8 bg-gray-200 rounded animate-pulse mb-2" />
              ) : (
                <span className={`text-2xl md:text-3xl font-bold mb-1 ${i === 0 ? 'text-[#01b4ae]' : 'text-gray-800'}`}>
                  {stat.value}
                </span>
              )}
              <span className="text-[12px] md:text-[14px] font-semibold text-gray-500 uppercase tracking-wider text-center">
                {stat.label}
              </span>
            </div>
          ))}
        </div>

        {/* Menu Cards */}
        <div className="space-y-4">
          {menuItems.map((item, i) => (
            <div
              key={item.id}
              onClick={() => navigate(item.route)}
              className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] hover:shadow-md cursor-pointer transition-all hover:border-[#01b4ae]/30 group flex items-center gap-4 md:gap-5 animate-fade-in-up"
              style={{ animationDelay: `${(i + 4) * 100}ms` }}
            >
              <div className={`w-14 h-14 md:w-16 md:h-16 rounded-2xl flex items-center justify-center shrink-0 border border-black/5 group-hover:scale-105 transition-transform ${item.color}`}>
                {item.icon}
              </div>
              
              <div className="flex-1 min-w-0 py-1">
                <h3 className="font-bold text-gray-900 text-[16px] md:text-[18px] mb-1 group-hover:text-[#01b4ae] transition-colors flex items-center gap-2">
                  {item.title}
                  {item.badge && (
                    <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                  )}
                </h3>
                {isLoading ? (
                  <div className="h-4 bg-gray-200 rounded w-1/3 animate-pulse" />
                ) : (
                  <p className="text-[14px] font-medium text-gray-500 truncate">{item.subtitle}</p>
                )}
              </div>

              <div className="shrink-0 text-gray-300 group-hover:text-[#01b4ae] group-hover:translate-x-1 transition-all">
                <ChevronRight className="w-6 h-6 md:w-7 md:h-7" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
