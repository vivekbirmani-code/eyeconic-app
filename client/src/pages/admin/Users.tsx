import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';
import { Search, Plus, User as UserIcon, AlertTriangle } from 'lucide-react';
import UserAvatar from '../../components/UserAvatar';

interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
  phone?: string;
  profilePicture?: string | null;
  isActive?: boolean;
  isProfileComplete?: boolean;
  createdAt?: string;
  studentProfile?: {
    mbbsBatch?: string;
    collegeName?: string;
    attemptNo?: number;
    batchType?: string;
    targetBranch?: string;
    averageScore?: number;
  };
}

export default function Users() {
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'student' | 'mentor' | 'admin'>('all');

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isDetailModalVisible, setDetailModalVisible] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const response = await api.get('/users');
      setUsers(response.data);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter(usr => {
      const matchesSearch = 
        usr.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        usr.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (usr.phone && usr.phone.includes(searchQuery));
      
      const matchesFilter = filter === 'all' || usr.role === filter;
      
      return matchesSearch && matchesFilter;
    });
  }, [users, searchQuery, filter]);

  const counts = useMemo(() => ({
    all: users.length,
    student: users.filter(u => u.role === 'student').length,
    mentor: users.filter(u => u.role === 'mentor').length,
    admin: users.filter(u => u.role === 'admin').length,
  }), [users]);

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'text-rose-500';
      case 'mentor': return 'text-emerald-500';
      case 'student': return 'text-blue-500';
      default: return 'text-gray-500';
    }
  };

  const getRoleBgColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-rose-50 border-rose-100';
      case 'mentor': return 'bg-emerald-50 border-emerald-100';
      case 'student': return 'bg-blue-50 border-blue-100';
      default: return 'bg-gray-50 border-gray-100';
    }
  };

  const handleOpenUser = (u: User) => {
    setSelectedUser(u);
    setDetailModalVisible(true);
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="bg-red-50 text-red-600 px-6 py-4 rounded-xl font-semibold flex items-center gap-3">
          <AlertTriangle /> Access Denied - Admins Only
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white min-h-[calc(100vh-64px)] md:min-h-screen">
      
      {/* Header */}
      <div className="bg-[#01b4ae] px-4 md:px-8 py-6 md:py-8 shadow-sm">
        <div className="flex justify-between items-center max-w-5xl mx-auto">
          <h1 className="text-2xl md:text-3xl font-bold text-white tracking-wide">User Management</h1>
          <button 
            className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
            onClick={() => {/* To be implemented: Create User Modal */}}
          >
            <Plus className="text-white w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6">
        
        {/* Search */}
        <div className="relative mb-6">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <Search className="w-5 h-5 text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="Search by name, email or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-[15px] focus:outline-none focus:ring-2 focus:ring-[#01b4ae]/50 focus:border-[#01b4ae] transition-all shadow-sm"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-none">
          {(['all', 'student', 'mentor', 'admin'] as const).map((currFilter) => {
            const isActive = filter === currFilter;
            return (
              <button
                key={currFilter}
                onClick={() => setFilter(currFilter)}
                className={`px-5 py-2 rounded-full border text-sm font-semibold whitespace-nowrap transition-all ${
                  isActive 
                    ? 'bg-[#01b4ae] border-[#01b4ae] text-white shadow-md' 
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {currFilter.charAt(0).toUpperCase() + currFilter.slice(1)} ({counts[currFilter]})
              </button>
            );
          })}
        </div>

        <p className="text-sm text-gray-500 mb-4">{filteredUsers.length} users found</p>

        {/* User List */}
        <div className="space-y-4">
          {isLoading ? (
            Array(4).fill(0).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100 shadow-sm flex items-center gap-4 animate-pulse">
                <div className="w-12 h-12 bg-gray-200 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 bg-gray-200 rounded w-1/3" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            ))
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500 font-medium">No users match your criteria.</p>
            </div>
          ) : (
            filteredUsers.map((usr) => (
              <div 
                key={usr._id}
                onClick={() => handleOpenUser(usr)}
                className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] hover:shadow-md cursor-pointer transition-all hover:border-[#01b4ae]/30 group flex items-center gap-4 animate-fade-in-up"
              >
                <UserAvatar
                  name={usr.name}
                  role={usr.role}
                  imageUrl={usr.profilePicture}
                  size={56}
                />
                
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-900 text-[16px] md:text-[18px] truncate group-hover:text-[#01b4ae] transition-colors">
                    {usr.name} {usr._id === currentUser?._id && '(You)'}
                  </h3>
                  <p className="text-sm text-gray-500 truncate mb-2">{usr.email}</p>
                  
                  <div className="flex flex-wrap gap-2">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider border ${getRoleBgColor(usr.role)} ${getRoleColor(usr.role)}`}>
                      {usr.role}
                    </span>
                    
                    {usr.role === 'student' && !usr.isProfileComplete && (
                      <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[11px] font-bold tracking-wider">
                        Profile Incomplete
                      </span>
                    )}
                    
                    {!usr.isActive && (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 border border-gray-200 rounded text-[11px] font-bold tracking-wider uppercase">
                        Inactive
                      </span>
                    )}
                  </div>
                </div>

                <div className="shrink-0 text-gray-300 group-hover:text-[#01b4ae] group-hover:translate-x-1 transition-all">
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* User Detail Modal */}
      {isDetailModalVisible && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className={`p-6 bg-gradient-to-r ${selectedUser.role === 'admin' ? 'from-rose-500 to-rose-600' : selectedUser.role === 'mentor' ? 'from-emerald-500 to-emerald-600' : 'from-[#01b4ae] to-[#01b4ae]'} text-white`}>
              <div className="flex justify-between items-start">
                <div className="flex gap-4 items-center">
                  <UserAvatar
                    name={selectedUser.name}
                    role={selectedUser.role}
                    imageUrl={selectedUser.profilePicture}
                    size={64}
                    className="border-2 border-white/30"
                  />
                  <div>
                    <h2 className="text-2xl font-bold">{selectedUser.name}</h2>
                    <p className="text-white/80 font-medium">{selectedUser.email}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setDetailModalVisible(false)}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <Plus className="w-6 h-6 rotate-45" />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Basic Info Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Phone Number</p>
                  <p className="text-[15px] font-semibold text-gray-800">{selectedUser.phone || 'Not provided'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Role</p>
                  <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider border ${getRoleBgColor(selectedUser.role)} ${getRoleColor(selectedUser.role)}`}>
                    {selectedUser.role}
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Joined On</p>
                  <p className="text-[15px] font-semibold text-gray-800">{selectedUser.createdAt ? new Date(selectedUser.createdAt).toLocaleDateString() : 'Unknown'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Status</p>
                  <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold tracking-wider uppercase ${selectedUser.isActive ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-gray-100 text-gray-400 border-gray-200'}`}>
                    {selectedUser.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              {/* Student Specific Profile */}
              {selectedUser.role === 'student' && (
                <div className="pt-6 border-t border-gray-100">
                  <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <UserIcon className="w-4 h-4 text-[#01b4ae]" />
                    Student Profile
                  </h3>
                  {selectedUser.isProfileComplete ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-8 bg-gray-50 rounded-2xl p-5 border border-gray-100">
                      <div className="space-y-1">
                        <p className="text-[11px] font-bold text-gray-400 uppercase">College</p>
                        <p className="text-[14px] font-semibold text-gray-800">{selectedUser.studentProfile?.collegeName || 'N/A'}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[11px] font-bold text-gray-400 uppercase">Batch</p>
                        <p className="text-[14px] font-semibold text-gray-800">{selectedUser.studentProfile?.mbbsBatch || 'N/A'}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[11px] font-bold text-gray-400 uppercase">Batch Type</p>
                        <p className="text-[14px] font-semibold text-gray-800">{selectedUser.studentProfile?.batchType || 'N/A'}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[11px] font-bold text-gray-400 uppercase">Attempt No.</p>
                        <p className="text-[14px] font-semibold text-gray-800">{selectedUser.studentProfile?.attemptNo || 'N/A'}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[11px] font-bold text-gray-400 uppercase">Target Branch</p>
                        <p className="text-[14px] font-semibold text-gray-800">{selectedUser.studentProfile?.targetBranch || 'N/A'}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[11px] font-bold text-gray-400 uppercase">Avg Score</p>
                        <p className="text-[14px] font-bold text-[#01b4ae]">{selectedUser.studentProfile?.averageScore?.toFixed(1) || '0.0'}%</p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex items-center gap-3 text-amber-700">
                      <AlertTriangle className="w-5 h-5 shrink-0" />
                      <p className="text-sm font-medium">Profile information has not been completed by the student yet.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-6 border-t border-gray-100 flex flex-wrap gap-3">
                <button className="flex-1 min-w-[140px] py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-black transition-colors shadow-sm">
                  Edit User
                </button>
                <button className={`flex-1 min-w-[140px] py-3 font-bold rounded-xl border transition-colors shadow-sm ${selectedUser.isActive ? 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100'}`}>
                  {selectedUser.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-center">
              <button 
                className="text-sm font-bold text-gray-500 hover:text-gray-700 transition-colors"
                onClick={() => setDetailModalVisible(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
