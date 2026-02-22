import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { useNotifications } from '../contexts/NotificationContext';
import { ArrowLeft, Send, MessageCircle, Info, Users, UserPlus, X, Search, Check, Trash2, Shield } from 'lucide-react';

interface UserData {
  _id: string;
  name: string;
  email: string;
  role: string;
}

interface Message {
  _id: string;
  content: string;
  sender: { _id: string; name: string };
  createdAt: string;
}

interface Group {
  _id: string;
  name: string;
  description: string;
  members: UserData[];
  createdBy: UserData;
  createdAt: string;
}

export default function Chat() {
  const { id: groupId } = useParams();
  const { user } = useAuth();
  const { socket } = useNotifications();
  const navigate = useNavigate();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [group, setGroup] = useState<Group | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [allUsers, setAllUsers] = useState<UserData[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [selectedNewMembers, setSelectedNewMembers] = useState<string[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (groupId) {
      fetchGroup();
      fetchMessages();
      
      if (socket) {
        socket.emit('join_room', groupId);
        
        socket.on('receive_message', (data: Message) => {
          setMessages(prev => [...prev, data]);
          scrollToBottom();
        });
      }
    }
    
    return () => {
      if (socket && groupId) {
        socket.emit('leave_room', groupId);
        socket.off('receive_message');
      }
    };
  }, [groupId, socket]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchGroup = async () => {
    try {
      const response = await api.get(`/groups/${groupId}`);
      setGroup(response.data);
    } catch (error) {
      console.error('Error fetching group:', error);
    }
  };

  const fetchMessages = async () => {
    try {
      setIsLoading(true);
      const response = await api.get(`/messages/group/${groupId}`);
      setMessages(response.data);
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchAllUsers = async () => {
    try {
      const response = await api.get('/users');
      setAllUsers(response.data);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const handleOpenAddMember = () => {
    fetchAllUsers();
    setSelectedNewMembers([]);
    setMemberSearchQuery('');
    setIsAddMemberModalOpen(true);
  };

  const handleAddMembers = async () => {
    if (selectedNewMembers.length === 0) return;
    try {
      await api.post(`/groups/${groupId}/members`, { userIds: selectedNewMembers });
      setIsAddMemberModalOpen(false);
      fetchGroup();
    } catch (error) {
      console.error('Error adding members:', error);
      alert('Failed to add members');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!window.confirm('Are you sure you want to remove this member?')) return;
    try {
      await api.delete(`/groups/${groupId}/members/${userId}`);
      fetchGroup();
    } catch (error) {
      console.error('Error removing member:', error);
      alert('Failed to remove member');
    }
  };

  const filteredUsersToAdd = allUsers.filter(u => 
    !group?.members.some(m => m._id === u._id) &&
    (u.name.toLowerCase().includes(memberSearchQuery.toLowerCase()) || 
     u.email.toLowerCase().includes(memberSearchQuery.toLowerCase()))
  );

  const toggleUserSelection = (userId: string) => {
    setSelectedNewMembers(prev => 
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newMessage.trim() || isSending) return;

    try {
      setIsSending(true);
      const content = newMessage.trim();
      setNewMessage('');
      
      const response = await api.post('/messages', {
        content,
        groupId,
      });

      // Add to local state immediately if socket doesn't echo back
      setMessages(prev => [...prev, response.data]);
      
      if (socket) {
        socket.emit('send_message', {
          ...response.data,
          groupId,
        });
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] md:h-screen bg-gray-50 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <h2 className="font-bold text-gray-900 leading-tight">
              {group?.name || 'Loading...'}
            </h2>
            <p className="text-xs text-gray-500 font-medium truncate max-w-[200px]">
              {group?.members?.length || 0} members
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsInfoModalOpen(true)}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
          >
            <Info size={20} />
          </button>
        </div>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#01b4ae]"></div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 opacity-60">
            <MessageCircle size={48} className="mb-2" />
            <p className="font-medium">No messages yet</p>
            <p className="text-sm">Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.sender._id === user?._id;
            return (
              <div 
                key={msg._id}
                className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} animate-fade-in-up`}
              >
                {!isOwn && (
                  <span className="text-[11px] font-semibold text-gray-500 mb-1 ml-1 uppercase tracking-wider">
                    {msg.sender.name}
                  </span>
                )}
                <div 
                  className={`max-w-[85%] md:max-w-[70%] px-4 py-2.5 rounded-2xl shadow-sm text-[15px] ${
                    isOwn 
                      ? 'bg-[#01b4ae] text-white rounded-tr-none' 
                      : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'
                  }`}
                >
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  <div className={`text-[10px] mt-1 flex justify-end ${isOwn ? 'text-white/70' : 'text-gray-400'}`}>
                    {formatTime(msg.createdAt)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="bg-white border-t border-gray-200 p-4 shrink-0">
        <form 
          onSubmit={handleSendMessage}
          className="max-w-4xl mx-auto flex items-end gap-2"
        >
          <div className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden focus-within:border-[#01b4ae] transition-colors">
            <textarea
              rows={1}
              value={newMessage}
              onChange={(e) => {
                setNewMessage(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Message..."
              className="w-full bg-transparent px-4 py-3 outline-none resize-none text-[15px] font-medium placeholder:text-gray-400"
              style={{ maxHeight: '120px' }}
            />
          </div>
          <button
            type="submit"
            disabled={!newMessage.trim() || isSending}
            className={`flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-all ${
              newMessage.trim() && !isSending
                ? 'bg-[#01b4ae] text-white shadow-md transform active:scale-95'
                : 'bg-gray-100 text-gray-400'
            }`}
          >
            <Send size={18} className={newMessage.trim() && !isSending ? 'ml-0.5' : ''} />
          </button>
        </form>
      </div>
      {/* Group Info Modal */}
      {isInfoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-lg text-gray-900">Group Info</h3>
              <button onClick={() => setIsInfoModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                <X size={20} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex flex-col items-center mb-6">
                <div className="w-20 h-20 rounded-3xl bg-[#01b4ae]/10 flex items-center justify-center text-[#01b4ae] mb-4">
                  <Users size={40} />
                </div>
                <h4 className="text-xl font-bold text-gray-900">{group?.name}</h4>
                <p className="text-sm text-gray-500 mt-1">{group?.members.length} participants</p>
              </div>
              
              <div className="space-y-6">
                {group?.description && (
                  <div>
                    <h5 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Description</h5>
                    <p className="text-gray-700 text-sm leading-relaxed">{group.description}</p>
                  </div>
                )}
                
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Participants</h5>
                    {user?.role === 'admin' && (
                      <button 
                        onClick={handleOpenAddMember}
                        className="text-[#01b4ae] text-xs font-bold flex items-center gap-1 hover:underline"
                      >
                        <UserPlus size={14} />
                        Add Member
                      </button>
                    )}
                  </div>
                  
                  <div className="space-y-3">
                    {group?.members.map(member => (
                      <div key={member._id} className="flex items-center justify-between group/member">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500 font-bold border border-gray-200">
                            {member.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                              {member.name}
                              {member._id === group.createdBy?._id && (
                                <span className="bg-[#01b4ae]/10 text-[#01b4ae] text-[10px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider">Creator</span>
                              )}
                              {member.role === 'admin' && <Shield size={12} className="text-amber-500" />}
                            </p>
                            <p className="text-[11px] text-gray-500 font-medium">{member.role}</p>
                          </div>
                        </div>
                        
                        {user?.role === 'admin' && member._id !== user._id && member._id !== group.createdBy?._id && (
                          <button 
                            onClick={() => handleRemoveMember(member._id)}
                            className="p-2 text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover/member:opacity-100 transition-opacity"
                            title="Remove from group"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <p className="text-[10px] text-gray-400 text-center">
                    Created on {new Date(group?.createdAt || '').toLocaleDateString()} by {group?.createdBy?.name}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {isAddMemberModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">Add Participants</h3>
                <p className="text-xs text-gray-500">{selectedNewMembers.length} selected</p>
              </div>
              <button 
                onClick={() => setIsAddMemberModalOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-full text-gray-400"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-3">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input 
                  type="text" 
                  placeholder="Search users..."
                  className="w-full bg-gray-50 border border-gray-100 rounded-xl pl-10 pr-4 py-2 text-sm outline-none focus:border-[#01b4ae] transition-colors"
                  value={memberSearchQuery}
                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-4">
              <div className="space-y-1">
                {filteredUsersToAdd.map(u => (
                  <button 
                    key={u._id}
                    onClick={() => toggleUserSelection(u._id)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors ${
                      selectedNewMembers.includes(u._id) ? 'bg-[#01b4ae]/5' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500 font-bold border border-gray-200">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-bold text-gray-900">{u.name}</p>
                        <p className="text-xs text-gray-500">{u.email} • {u.role}</p>
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                      selectedNewMembers.includes(u._id) ? 'bg-[#01b4ae] border-[#01b4ae]' : 'border-gray-200'
                    }`}>
                      {selectedNewMembers.includes(u._id) && <Check size={12} className="text-white" />}
                    </div>
                  </button>
                ))}
                {filteredUsersToAdd.length === 0 && (
                  <div className="py-10 text-center text-gray-400 text-sm">
                    No users found to add.
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100">
              <button 
                onClick={handleAddMembers}
                disabled={selectedNewMembers.length === 0}
                className="w-full bg-[#01b4ae] text-white py-3 rounded-xl font-bold shadow-md hover:bg-[#01b4ae]/90 transition-all disabled:opacity-50 disabled:shadow-none active:scale-[0.98]"
              >
                Add {selectedNewMembers.length} Participants
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
