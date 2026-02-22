import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';
import { MessageCircle, Plus, Users as UsersIcon, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Group {
  _id: string;
  name: string;
  description: string;
  members: any[];
  createdBy: { name: string };
}

export default function Groups() {
  const { user: currentUser } = useAuth();
  
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      setIsLoading(true);
      const response = await api.get('/groups');
      setGroups(response.data);
    } catch (error) {
      console.error('Error fetching groups:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (currentUser?.role !== 'admin' && currentUser?.role !== 'mentor') {
    // Both admin and mentor can see groups.
    // Wait, let's keep it open for students as well if they are mapped in the real app, but the logic in mobile is open to everyone.
  }

  return (
    <div className="flex-1 bg-white min-h-[calc(100vh-64px)] md:min-h-screen">
      
      {/* Header */}
      <div className="bg-[#01b4ae] px-4 md:px-8 py-6 md:py-8 shadow-sm overflow-hidden relative">
        <div className="flex justify-between items-center max-w-5xl mx-auto relative z-10">
          <h1 className="text-2xl md:text-3xl font-bold text-white tracking-wide">Groups</h1>
          {(currentUser?.role === 'admin' || currentUser?.role === 'mentor') && (
            <button 
              className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30 transition-colors shadow-sm"
              onClick={() => {/* Implement Create Group Modal */}}
            >
              <Plus className="text-white w-6 h-6" />
            </button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 md:py-8">
        
        {/* Groups List */}
        <div className="space-y-4">
          {isLoading ? (
            Array(4).fill(0).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center gap-4 animate-pulse">
                <div className="w-12 h-12 bg-gray-200 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 bg-gray-200 rounded w-1/3" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                  <div className="h-3 bg-gray-200 rounded w-1/4 mt-2" />
                </div>
              </div>
            ))
          ) : groups.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <MessageCircle className="w-10 h-10 text-gray-300" />
              </div>
              <p className="text-gray-500 font-medium text-lg">No groups found</p>
              <p className="text-gray-400 text-sm mt-1">Create a group to start communicating</p>
            </div>
          ) : (
            groups.map((group) => (
              <div 
                key={group._id}
                onClick={() => navigate(`/groups/${group._id}`)}
                className="bg-white rounded-2xl p-5 border border-gray-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] hover:shadow-md cursor-pointer transition-all hover:border-[#01b4ae]/30 group flex items-start md:items-center gap-4 animate-fade-in-up"
              >
                <div className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-blue-50 flex items-center justify-center shrink-0 border border-blue-100 group-hover:bg-[#01b4ae]/10 transition-colors mt-1 md:mt-0">
                  <MessageCircle className="w-6 h-6 text-blue-600 group-hover:text-[#01b4ae] transition-colors" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-900 text-[16px] md:text-[18px] mb-1 group-hover:text-[#01b4ae] transition-colors">
                    {group.name}
                  </h3>
                  <p className="text-[14px] text-gray-500 mb-2.5 truncate">{group.description || 'No description available'}</p>
                  
                  <div className="flex items-center gap-1.5 text-gray-400">
                    <UsersIcon className="w-4 h-4" />
                    <span className="text-[13px] font-semibold">{group.members?.length || 0} members</span>
                  </div>
                </div>

                <div className="shrink-0 text-gray-300 group-hover:text-[#01b4ae] group-hover:translate-x-1 transition-all self-center">
                  <ArrowRight className="w-5 h-5 md:w-6 md:h-6" />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
