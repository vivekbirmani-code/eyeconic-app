import { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { api } from '../../../services/api';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Check, X as XIcon, Clock, History } from 'lucide-react';

interface RetestRequest {
  _id: string;
  student: { _id: string; name: string; email: string };
  quiz: { _id: string; title: string; testType: string };
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestDate: string;
  reviewedAt?: string;
}

export default function RetestRequests() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [requests, setRequests] = useState<RetestRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRequests();
  }, [activeTab]);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const endpoint = activeTab === 'pending' ? '/quizzes/retests/pending' : '/quizzes/retests/history';
      const res = await api.get(endpoint);
      setRequests(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    if (!window.confirm(`Are you sure you want to ${action} this request?`)) return;
    
    try {
      await api.post(`/quizzes/retests/${id}/${action}`);
      alert(`Request ${action}d successfully`);
      fetchRequests();
    } catch (e: any) {
      alert(e.response?.data?.message || `Failed to ${action} request`);
    }
  };

  if (user?.role !== 'admin') return <div className="p-8">Access Denied</div>;

  return (
    <div className="flex-1 bg-gray-50 min-h-screen">
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-4 md:px-8 py-6 shadow-sm sticky top-0 z-30">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate('/quizzes')} className="p-2 bg-white/20 rounded-xl hover:bg-white/30 text-white transition-colors">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-wide">Retest Requests</h1>
            <p className="text-white/80 text-sm font-medium">Manage student reattempt requests</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 md:px-8 py-8">
        
        <div className="flex bg-gray-200 p-1 rounded-xl w-fit mb-8">
          <button onClick={() => setActiveTab('pending')} className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-colors ${activeTab === 'pending' ? 'bg-white text-amber-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            <Clock className="w-4 h-4" /> Pending
          </button>
          <button onClick={() => setActiveTab('history')} className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-colors ${activeTab === 'history' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            <History className="w-4 h-4" /> History
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500 animate-pulse font-medium">Loading requests...</div>
        ) : requests.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-100 shadow-sm">
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-amber-500" />
            </div>
            <p className="text-gray-500 font-medium text-lg">No {activeTab} requests</p>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map(req => (
              <div key={req._id} className="bg-white p-5 md:p-6 rounded-2xl border border-gray-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] hover:shadow-md transition-shadow animate-fade-in-up">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg">{req.student?.name}</h3>
                    <p className="text-sm font-medium text-gray-500">{req.student?.email}</p>
                  </div>
                  <div className="text-left md:text-right bg-amber-50 md:bg-transparent px-3 py-2 md:p-0 rounded-lg">
                    <p className="font-bold text-amber-600 text-[15px]">{req.quiz?.title}</p>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-0.5">{req.quiz?.testType} Test • {new Date(req.requestDate).toLocaleDateString()}</p>
                  </div>
                </div>
                
                <div className="bg-gray-50 rounded-xl p-4 mb-5 border border-gray-100">
                  <p className="text-sm font-bold text-gray-600 mb-1">Reason for request:</p>
                  <p className="text-[15px] text-gray-800 italic">"{req.reason}"</p>
                </div>

                {activeTab === 'pending' ? (
                  <div className="flex gap-3 pt-4 border-t border-gray-100">
                    <button onClick={() => handleAction(req._id, 'approve')} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors">
                      <Check className="w-5 h-5" /> Approve
                    </button>
                    <button onClick={() => handleAction(req._id, 'reject')} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors">
                      <XIcon className="w-5 h-5" /> Reject
                    </button>
                  </div>
                ) : (
                  <div className="pt-4 border-t border-gray-100 flex items-center gap-2">
                    <span className={`px-4 py-1.5 rounded-lg text-sm font-bold uppercase tracking-wider ${req.status === 'approved' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-rose-50 text-rose-600 border border-rose-100'}`}>
                      {req.status}
                    </span>
                    <span className="text-xs text-gray-400 font-medium">on {new Date(req.reviewedAt || req.requestDate).toLocaleString()}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
