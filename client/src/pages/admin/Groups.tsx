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
  mentors?: { _id: string, name: string }[];
  createdBy: { name: string };
}

export default function Groups() {
  const { user: currentUser } = useAuth();
  
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMentorId, setSelectedMentorId] = useState<string | null>(null);
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

  // Extract unique mentors from all groups
  const mentors = Array.from(
    new Map(
      groups
        .flatMap(group => group.mentors || [])
        .filter(mentor => mentor && mentor._id)
        .map(mentor => [mentor._id, mentor])
    ).values()
  );

  // Filter groups based on selected mentor
  const filteredGroups = selectedMentorId 
    ? groups.filter(group => group.mentors?.some(m => m._id === selectedMentorId))
    : groups;

  if (currentUser?.role !== 'admin' && currentUser?.role !== 'mentor') {
    // Both admin and mentor can see groups.
    // Wait, let's keep it open for students as well if they are mapped in the real app, but the logic in mobile is open to everyone.
  }

  return (
    <div className="flex-1 bg-gray-50 min-h-[calc(100vh-64px)] md:min-h-screen pb-12">
      
      {/* Header */}
      <div className="bg-[#01b4ae] px-4 md:px-8 py-6 md:py-8 shadow-sm relative overflow-hidden">
        {/* Background Decorative Pattern */}
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
          <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-white blur-3xl"></div>
          <div className="absolute top-12 -left-12 w-48 h-48 rounded-full bg-white blur-3xl"></div>
        </div>
        
        <div className="flex justify-between items-center max-w-5xl mx-auto relative z-10">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white tracking-wide">Groups</h1>
            <p className="text-[#e6fffe] mt-1.5 text-sm font-medium">Manage and communicate with your student groups</p>
          </div>
          {(currentUser?.role === 'admin' || currentUser?.role === 'mentor') && (
            <button 
              className="w-10 h-10 md:w-12 md:h-12 bg-white/20 hover:bg-white/30 rounded-2xl flex items-center justify-center transition-all shadow-sm group hover:-translate-y-0.5 relative overflow-hidden"
              onClick={() => {/* Implement Create Group Modal */}}
              title="Create new group"
            >
              <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-20 transition-opacity"></div>
              <Plus className="text-white w-6 h-6 z-10" />
            </button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto">
        
        {/* Mentor Folders List (Admin view) */}
        {!isLoading && currentUser?.role === 'admin' && mentors.length > 0 && (
          <div className="px-4 md:px-8 pt-6 pb-2">
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 px-1">Filter by Mentor</h2>
            
            <div className="flex overflow-x-auto pb-4 pt-1 px-1 -mx-1 gap-4 scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {/* "All Groups" Folder */}
              <div 
                onClick={() => setSelectedMentorId(null)}
                className={`relative shrink-0 w-[140px] md:w-[160px] h-[110px] md:h-[120px] rounded-2xl p-4 flex flex-col justify-between cursor-pointer transition-all duration-300 transform shadow-sm border ${
                  selectedMentorId === null 
                    ? 'bg-[#01b4ae] border-[#01b4ae] text-white scale-105 shadow-md z-10 ring-4 ring-[#01b4ae]/10' 
                    : 'bg-white border-gray-200 text-gray-700 hover:border-[#01b4ae]/40 hover:shadow-md hover:-translate-y-1'
                }`}
              >
                {/* Folder Tab Decorative Element */}
                <div className={`absolute top-0 left-4 w-12 h-2 rounded-b-md ${selectedMentorId === null ? 'bg-white/20' : 'bg-gray-100'}`}></div>
                
                <div className="flex justify-between items-start mt-1">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${selectedMentorId === null ? 'bg-white/20' : 'bg-[#01b4ae]/10 text-[#01b4ae]'}`}>
                    <MessageCircle size={20} className={selectedMentorId === null ? 'text-white' : 'text-[#01b4ae]'} />
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${selectedMentorId === null ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {groups.length}
                  </span>
                </div>
                <div>
                  <h3 className={`font-bold text-sm md:text-base leading-tight ${selectedMentorId === null ? 'text-white' : 'text-gray-900'}`}>All Groups</h3>
                  <p className={`text-xs mt-1 font-medium ${selectedMentorId === null ? 'text-white/80' : 'text-gray-500'}`}>View everything</p>
                </div>
              </div>

              {/* Mentor Specific Folders */}
              {mentors.map((mentor) => {
                const isSelected = selectedMentorId === mentor._id;
                const mentorGroupCount = groups.filter(g => g.mentors?.some(m => m._id === mentor._id)).length;
                
                return (
                  <div 
                    key={mentor._id}
                    onClick={() => setSelectedMentorId(mentor._id)}
                    className={`relative shrink-0 w-[140px] md:w-[160px] h-[110px] md:h-[120px] rounded-2xl p-4 flex flex-col justify-between cursor-pointer transition-all duration-300 transform shadow-sm border ${
                      isSelected 
                        ? 'bg-gradient-to-br from-[#10b981] to-[#059669] border-[#10b981] text-white scale-105 shadow-md z-10 ring-4 ring-[#10b981]/10' 
                        : 'bg-white border-gray-200 text-gray-700 hover:border-[#10b981]/40 hover:shadow-md hover:-translate-y-1'
                    }`}
                  >
                    {/* Folder Tab Decorative Element */}
                    <div className={`absolute top-0 left-4 w-12 h-2 rounded-b-md ${isSelected ? 'bg-white/20' : 'bg-gray-100'}`}></div>

                    <div className="flex justify-between items-start mt-1">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg ${isSelected ? 'bg-white/20 text-white' : 'bg-[#10b981]/10 text-[#10b981]'}`}>
                        {mentor.name.charAt(0).toUpperCase()}
                      </div>
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
                        {mentorGroupCount}
                      </span>
                    </div>
                    <div>
                      <h3 className={`font-bold text-sm md:text-base leading-tight truncate ${isSelected ? 'text-white' : 'text-gray-900'}`} title={mentor.name}>
                        {mentor.name}
                      </h3>
                      <p className={`text-xs mt-1 font-medium ${isSelected ? 'text-white/80' : 'text-gray-500'}`}>Mentor Groups</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Groups List */}
        <div className="px-4 md:px-8 py-4">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-800">
              {selectedMentorId 
                ? `${mentors.find(m => m._id === selectedMentorId)?.name}'s Groups` 
                : 'Active Groups'}
            </h2>
            <span className="text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
              {filteredGroups.length} total
            </span>
          </div>

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
            ) : filteredGroups.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-200">
                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <MessageCircle className="w-10 h-10 text-gray-300" />
                </div>
                <p className="text-gray-500 font-medium text-lg">No groups found</p>
                <p className="text-gray-400 text-sm mt-1">
                  {selectedMentorId ? "This mentor hasn't been assigned to any groups yet." : "Create a group to start communicating."}
                </p>
              </div>
            ) : (
              filteredGroups.map((group) => (
                <div 
                  key={group._id}
                  onClick={() => navigate(`/groups/${group._id}`)}
                  className="bg-white rounded-2xl p-5 border border-gray-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] hover:shadow-lg cursor-pointer transition-all duration-300 hover:border-[#01b4ae]/30 group flex flex-col md:flex-row items-start md:items-center gap-4 relative overflow-hidden"
                >
                  {/* Left accent border decoration on hover */}
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#01b4ae] opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  
                  <div className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-blue-50/80 flex items-center justify-center shrink-0 border border-blue-100/50 group-hover:bg-[#01b4ae]/10 group-hover:border-[#01b4ae]/20 transition-all duration-300 mt-1 md:mt-0">
                    <MessageCircle className="w-6 h-6 text-blue-600 group-hover:text-[#01b4ae] transition-colors" />
                  </div>
                  
                  <div className="flex-1 min-w-0 w-full">
                    <div className="flex flex-col md:flex-row md:items-center justify-between mb-1 gap-2">
                      <h3 className="font-bold text-gray-900 text-[16px] md:text-[18px] group-hover:text-[#01b4ae] transition-colors leading-tight">
                        {group.name}
                      </h3>
                      
                      {group.mentors && group.mentors.length > 0 && (
                        <div className="flex items-center gap-1.5 self-start md:self-auto bg-green-50 border border-green-100 px-2 py-1 rounded-md">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                          <span className="text-[11px] font-bold text-green-700 uppercase tracking-wider">{group.mentors[0].name}</span>
                        </div>
                      )}
                    </div>
                    
                    <p className="text-[14px] text-gray-500 mb-3 line-clamp-2 md:truncate leading-relaxed">{group.description || 'No description available'}</p>
                    
                    <div className="flex items-center justify-between mt-auto">
                      <div className="flex items-center gap-1.5 text-gray-500 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-100">
                        <UsersIcon className="w-3.5 h-3.5" />
                        <span className="text-[12px] font-bold tracking-wide">{group.members?.length || 0} MEMBERS</span>
                      </div>
                      
                      <div className="md:hidden shrink-0 text-gray-300 group-hover:text-[#01b4ae] group-hover:translate-x-1 transition-transform">
                        <ArrowRight className="w-5 h-5" />
                      </div>
                    </div>
                  </div>

                  <div className="hidden md:block shrink-0 text-gray-300 group-hover:text-[#01b4ae] group-hover:translate-x-1 transition-transform p-2 bg-gray-50 rounded-full group-hover:bg-[#01b4ae]/10">
                    <ArrowRight className="w-5 h-5" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
