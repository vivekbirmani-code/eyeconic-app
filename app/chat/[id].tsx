import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  ScrollView,
  Image,
  StatusBar,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Send, Users, UserPlus, Trash2, X, MoreVertical, Search, Check } from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';
import { io, Socket } from 'socket.io-client';
import Constants from 'expo-constants';
import { useNotifications } from '@/context/NotificationContext';

interface Message {
  _id: string;
  content: string;
  sender: { _id: string; name: string };
  createdAt: string;
}

interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
}

interface Group {
  _id: string;
  name: string;
  description: string;
  members: User[];
  createdBy: User;
  createdAt: string;
}

export default function ChatScreen() {
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { markAsRead } = useNotifications();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [group, setGroup] = useState<Group | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGroupInfoVisible, setIsGroupInfoVisible] = useState(false);
  const [isAddMemberVisible, setIsAddMemberVisible] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [selectedNewMembers, setSelectedNewMembers] = useState<string[]>([]);
  const flatListRef = useRef<FlatList>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (groupId) {
      fetchGroup();
      fetchMessages();
      setupSocket();
      markAsRead(groupId);
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.emit('leave_room', groupId);
        socketRef.current.disconnect();
      }
    };
  }, [groupId]);

  const setupSocket = () => {
    const getSocketURL = () => {
      if (Platform.OS === 'web') return 'http://localhost:3000';
      const hostUri = Constants.expoConfig?.hostUri;
      if (hostUri) {
        const ip = hostUri.split(':')[0];
        return `http://${ip}:3000`;
      }
      return 'http://10.78.16.198:3000';
    };
    
    socketRef.current = io(getSocketURL());
    
    socketRef.current.on('connect', () => {
      console.log('Socket connected');
      socketRef.current?.emit('join_room', groupId);
    });

    socketRef.current.on('receive_message', (data: Message) => {
      setMessages(prev => [...prev, data]);
      scrollToBottom();
      // Mark as read when receiving a message while in chat
      if (groupId) {
        markAsRead(groupId);
      }
    });
  };

  const fetchGroup = async () => {
    try {
      const response = await api.get(`/groups/${groupId}`);
      setGroup(response.data);
    } catch (error) {
      Alert.alert('Error', 'Failed to load group');
      router.back();
    }
  };

  const fetchAllUsers = async () => {
    try {
      const response = await api.get('/users');
      setAllUsers(response.data);
    } catch (error) {
       console.log('Error fetching users', error);
    }
  };

  const openAddMemberModal = () => {
    fetchAllUsers();
    setSelectedNewMembers([]);
    setMemberSearchQuery('');
    setIsAddMemberVisible(true);
  };

  const addMembers = async () => {
     if (selectedNewMembers.length === 0) return;
     
     try {
       await api.post(`/groups/${groupId}/members`, { userIds: selectedNewMembers });
       Alert.alert('Success', 'Members added successfully');
       setIsAddMemberVisible(false);
       fetchGroup(); // Refresh group data
     } catch (error: any) {
       Alert.alert('Error', error?.response?.data?.message || 'Failed to add members');
     }
  };

  const removeMember = async (userId: string) => {
    Alert.alert(
      'Remove Member',
      'Are you sure you want to remove this member from the group?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Remove', 
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/groups/${groupId}/members/${userId}`);
              fetchGroup(); // Refresh group data
            } catch (error: any) {
              Alert.alert('Error', error?.response?.data?.message || 'Failed to remove member');
            }
          }
        }
      ]
    );
  };

  const filteredUsersToAdd = useMemo(() => {
    if (!group) return [];
    
    const currentMemberIds = group.members.map(m => m._id);
    
    return allUsers.filter(u => 
      !currentMemberIds.includes(u._id) && 
      (u.name.toLowerCase().includes(memberSearchQuery.toLowerCase()) || 
       u.email.toLowerCase().includes(memberSearchQuery.toLowerCase()))
    );
  }, [allUsers, group, memberSearchQuery]);

  const toggleUserSelection = (userId: string) => {
    setSelectedNewMembers(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId) 
        : [...prev, userId]
    );
  };

  const fetchMessages = async () => {
    try {
      const response = await api.get(`/messages/group/${groupId}`);
      setMessages(response.data);
      setIsLoading(false);
      setTimeout(scrollToBottom, 100);
    } catch (error) {
      Alert.alert('Error', 'Failed to load messages');
      setIsLoading(false);
    }
  };

  const scrollToBottom = () => {
    if (flatListRef.current && messages.length > 0) {
      flatListRef.current.scrollToEnd({ animated: true });
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    const messageContent = newMessage.trim();
    setNewMessage('');

    try {
      const response = await api.post('/messages', {
        content: messageContent,
        groupId,
      });

      // Add message locally
      setMessages(prev => [...prev, response.data]);
      
      // Emit to socket for real-time
      socketRef.current?.emit('send_message', {
        ...response.data,
        groupId,
      });
      
      scrollToBottom();
    } catch (error) {
      Alert.alert('Error', 'Failed to send message');
      setNewMessage(messageContent);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isOwnMessage = item.sender._id === user?._id;
    
    return (
      <View style={[
        styles.messageContainer,
        isOwnMessage ? styles.ownMessage : styles.otherMessage
      ]}>
        {!isOwnMessage && (
          <Text style={styles.senderName}>{item.sender.name}</Text>
        )}
        <Text style={[
          styles.messageText,
          isOwnMessage ? styles.ownMessageText : styles.otherMessageText
        ]}>
          {item.content}
        </Text>
        <Text style={[
          styles.messageTime,
          isOwnMessage ? styles.ownMessageTime : styles.otherMessageTime
        ]}>
          {formatTime(item.createdAt)}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft color="#000000" size={24} />
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.headerInfo} 
          onPress={() => setIsGroupInfoVisible(true)}
        >
          <Text style={styles.headerTitle}>{group?.name || 'Chat'}</Text>
          {group?.description && (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {group.description}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading messages...</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item._id}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={scrollToBottom}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No messages yet</Text>
                <Text style={styles.emptySubtext}>Start the conversation!</Text>
              </View>
            }
          />
        )}

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor="#9CA3AF"
            value={newMessage}
            onChangeText={setNewMessage}
            multiline
            maxLength={500}
          />
          <TouchableOpacity 
            style={[styles.sendButton, !newMessage.trim() && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!newMessage.trim()}
          >
            <Send color="#FFFFFF" size={20} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <>
      {/* Group Info Modal */}
      <Modal visible={isGroupInfoVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setIsGroupInfoVisible(false)} style={styles.backButton}>
              <ArrowLeft color="#000000" size={24} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Group Info</Text>
            <View style={{ width: 24 }} />
          </View>
          
          <ScrollView style={styles.modalScroll}>
            <View style={styles.groupProfileSection}>
              <View style={styles.largeGroupIcon}>
                <Users color="#FFFFFF" size={40} />
              </View>
              <Text style={styles.largeGroupName}>{group?.name}</Text>
              {group?.description ? (
                <Text style={styles.groupDescription}>{group.description}</Text>
              ) : null}
              <Text style={styles.groupMeta}>
                Created by {group?.createdBy?.name} • {new Date(group?.createdAt || '').toLocaleDateString()}
              </Text>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{group?.members?.length || 0} participants</Text>
            </View>

            {user?.role === 'admin' && (
              <TouchableOpacity style={styles.addMemberRow} onPress={openAddMemberModal}>
                <View style={styles.addMemberIcon}>
                  <UserPlus color="#2563EB" size={20} />
                </View>
                <Text style={styles.addMemberText}>Add Participants</Text>
              </TouchableOpacity>
            )}

            {group?.members?.map((member) => (
              <View key={member._id} style={styles.memberRow}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>{member.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>
                    {member._id === user?._id ? 'You' : member.name}
                  </Text>
                  <Text style={styles.memberEmail}>{member.role}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                    {group?.createdBy?._id === member._id && (
                        <Text style={styles.adminBadge}>Group Admin</Text>
                    )}
                    {user?.role === 'admin' && member._id !== group?.createdBy?._id && (
                        <TouchableOpacity 
                            style={styles.removeButton}
                            onPress={() => removeMember(member._id)}
                        >
                            <Text style={styles.removeText}>Remove</Text>
                        </TouchableOpacity>
                    )}
                </View>
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Add Members Modal */}
      <Modal visible={isAddMemberVisible} animationType="slide">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setIsAddMemberVisible(false)} style={styles.backButton}>
              <X color="#000000" size={24} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Add Participants</Text>
            {selectedNewMembers.length > 0 ? (
                <TouchableOpacity onPress={addMembers}>
                    <Text style={styles.doneButtonText}>Add ({selectedNewMembers.length})</Text>
                </TouchableOpacity>
            ) : (
                <View style={{ width: 24 }} />
            )}
          </View>

          <View style={styles.searchContainer}>
            <Search color="#6B7280" size={20} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search users..."
              placeholderTextColor="#9CA3AF"
              value={memberSearchQuery}
              onChangeText={setMemberSearchQuery}
            />
          </View>

          <FlatList
            data={filteredUsersToAdd}
            keyExtractor={(item) => item._id}
            contentContainerStyle={styles.userList}
            renderItem={({ item }) => (
              <TouchableOpacity 
                style={styles.userSelectRow} 
                onPress={() => toggleUserSelection(item._id)}
              >
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>{item.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{item.name}</Text>
                  <Text style={styles.memberEmail}>{item.email} • {item.role}</Text>
                </View>
                <View style={[
                  styles.checkbox,
                  selectedNewMembers.includes(item._id) && styles.checkboxSelected
                ]}>
                  {selectedNewMembers.includes(item._id) && (
                    <Check color="#FFFFFF" size={16} />
                  )}
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No users found</Text>
            }
          />
        </SafeAreaView>
      </Modal>
      </>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    padding: 5,
    marginRight: 10,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  chatContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#6B7280',
    fontSize: 16,
  },
  messagesList: {
    padding: 15,
    flexGrow: 1,
  },
  messageContainer: {
    maxWidth: '80%',
    marginBottom: 10,
    padding: 12,
    borderRadius: 16,
  },
  ownMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#2563EB',
    borderBottomRightRadius: 4,
  },
  otherMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#F3F4F6',
    borderBottomLeftRadius: 4,
  },
  senderName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB',
    marginBottom: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  ownMessageText: {
    color: '#FFFFFF',
  },
  otherMessageText: {
    color: '#000000',
  },
  messageTime: {
    fontSize: 10,
    marginTop: 4,
  },
  ownMessageTime: {
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'right',
  },
  otherMessageTime: {
    color: '#9CA3AF',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6B7280',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 5,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
    color: '#000000',
    maxHeight: 100,
    marginRight: 10,
  },
  sendButton: {
    backgroundColor: '#2563EB',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#93C5FD',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
  },
  modalScroll: {
    flex: 1,
  },
  groupProfileSection: {
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  largeGroupIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
  },
  largeGroupName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 5,
    textAlign: 'center',
  },
  groupDescription: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 5,
  },
  groupMeta: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  sectionHeader: {
    padding: 15,
    backgroundColor: '#F9FAFB',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  addMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  addMemberIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#DBEAFE',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  addMemberText: {
    fontSize: 16,
    color: '#2563EB',
    fontWeight: '500',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  memberAvatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6B7280',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000000',
  },
  memberEmail: {
    fontSize: 13,
    color: '#6B7280',
  },
  adminBadge: {
    fontSize: 11,
    color: '#2563EB',
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 2,
  },
  removeButton: {
    marginTop: 4,
  },
  removeText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '500',
  },
  doneButtonText: {
    color: '#2563EB',
    fontSize: 16,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#F3F4F6',
    margin: 10,
    borderRadius: 8,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
    color: '#000000',
  },
  userList: {
    paddingBottom: 20,
  },
  userSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
});
