import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  ScrollView,
  Pressable,
  Keyboard,
  StatusBar,
  Dimensions,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Send, Users, UserPlus, X, Search, Check, CheckCheck, Edit2, Trash2, Info, Phone } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from '@/utils/haptics';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';
import { getSocketURL } from '@/services/config';
import { io, Socket } from 'socket.io-client';

import { useNotifications } from '@/context/NotificationContext';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Paperclip, FileText, Image as ImageIcon } from 'lucide-react-native';
import { AttachmentViewer, AttachmentThumbnail } from '@/components/AttachmentViewer';

interface Message {
  _id: string;
  content: string;
  sender: { _id: string; name: string };
  createdAt: string;
  status?: 'sent' | 'delivered' | 'read';
  isEdited?: boolean;
  editedAt?: string;

  deletedForEveryone?: boolean;
  attachments?: Array<{
    type: 'image' | 'video' | 'document';
    url: string;
    name: string;
    size: number;
    mimeType: string;
    publicId: string;
  }>;
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

interface ReadByUser {
  user: { _id: string; name: string };
  readAt: string;
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

  // Message action states
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [isMessageMenuVisible, setIsMessageMenuVisible] = useState(false);
  const [isMessageInfoVisible, setIsMessageInfoVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [readByUsers, setReadByUsers] = useState<ReadByUser[]>([]);

  const [isLoadingReadBy, setIsLoadingReadBy] = useState(false);

  // Attachment states
  const [isAttachmentMenuVisible, setIsAttachmentMenuVisible] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [viewingAttachment, setViewingAttachment] = useState<any>(null);
  const [isViewerVisible, setIsViewerVisible] = useState(false);

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
    socketRef.current = io(getSocketURL());

    socketRef.current.on('connect', () => {
      console.log('Socket connected');
      socketRef.current?.emit('join_room', groupId);
    });

    socketRef.current.on('receive_message', (data: Message) => {
      setMessages(prev => [...prev, data]);
      scrollToBottom();
      // Mark messages as read when chat is open
      if (groupId) {
        markAsRead(groupId);
        // Mark the received message as read
        api.post(`/messages/${data._id}/read`).catch(() => { });
      }
    });

    // Listen for message updates (edit, delete)
    socketRef.current.on('message_updated', (data: Message) => {
      setMessages(prev => prev.map(msg =>
        msg._id === data._id ? { ...msg, ...data } : msg
      ));
    });

    // Listen for message deletion
    socketRef.current.on('message_deleted', (data: { messageId: string, deletedForEveryone: boolean }) => {
      if (data.deletedForEveryone) {
        setMessages(prev => prev.map(msg =>
          msg._id === data.messageId ? { ...msg, deletedForEveryone: true } : msg
        ));
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
      fetchGroup();
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
              fetchGroup();
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

      // Mark all messages as read
      const messageIds = response.data
        .filter((m: Message) => m.sender._id !== user?._id)
        .map((m: Message) => m._id);
      if (messageIds.length > 0) {
        api.post('/messages/read-batch', { messageIds }).catch(() => { });
      }
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

      setMessages(prev => [...prev, response.data]);

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

  const handlePickImage = async () => {
    try {
      setIsAttachmentMenuVisible(false);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        uploadFile(result.assets[0], 'image');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const handlePickDocument = async () => {
    try {
      setIsAttachmentMenuVisible(false);
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        copyToCacheDirectory: true
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        // Read file as base64 (needed for our upload implementation)
        // Note: Expo DocumentPicker doesn't return base64 by default.
        // We might need to use FileSystem if uri is file://
        // But for web/expo-go, let's try to fetch the blob or rely on our backend accepting multipart if we switch logic.
        // Wait, my backend implementation expects 'req.file' which usually comes from Multipart form data.
        // But in `question-bank` I used `import { api } from '@/services/api'`. 
        // If `api` is axios instance, passing FormData works.
        // I should switch upload logic to FormData for Documents to avoid base64 complexity with large files.
        // My upload endpoint `upload.js` uses `multer`. It handles multipart perfectly.

        uploadFile(result.assets[0], 'document');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick document');
    }
  };

  const uploadFile = async (file: any, type: 'image' | 'document') => {
    setIsUploading(true);
    try {
      console.log('Preparing upload:', type, file.uri, file.mimeType);

      const formData = new FormData();

      const fileName = file.name || file.fileName || (type === 'image' ? 'image.jpg' : 'document.pdf');

      // Infer valid mimetype if missing
      let mimeType = file.mimeType;
      if (!mimeType) {
        const ext = fileName.split('.').pop()?.toLowerCase();
        if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
        else if (ext === 'png') mimeType = 'image/png';
        else if (ext === 'pdf') mimeType = 'application/pdf';
        else if (ext === 'doc') mimeType = 'application/msword';
        else if (ext === 'docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        else if (ext === 'xls') mimeType = 'application/vnd.ms-excel';
        else if (ext === 'xlsx') mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        else mimeType = type === 'image' ? 'image/jpeg' : 'application/octet-stream';
      }

      // Append file
      formData.append('file', {
        uri: Platform.OS === 'android' ? file.uri : file.uri.replace('file://', ''),
        name: fileName,
        type: mimeType
      } as any);

      console.log('FormData created with type:', mimeType);

      // Use specific content-type header for multipart
      // timeout is overridden to 60s here only — global api.ts timeout (10s) is unchanged
      const response = await api.post('/upload/chat', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 60000, // 60s for upload only: backend must receive + upload to Cloudinary
        transformRequest: (data, headers) => {
          // Axios on React Native needs this to not stringify FormData
          return data;
        }
      });

      if (response.data.success) {
        // Send message with attachment
        const attachmentData = {
          type: type,
          url: response.data.url,
          name: response.data.name,
          size: response.data.size,
          mimeType: response.data.mimeType,
          publicId: response.data.public_id
        };

        const msgResponse = await api.post('/messages', {
          content: '',
          groupId,
          attachments: [attachmentData]
        });

        // Emit socket event so other group members see the file in real-time
        // (mirrors how text messages are broadcast in sendMessage())
        socketRef.current?.emit('send_message', {
          ...msgResponse.data,
          groupId,
        });
      }
    } catch (error: any) {
      console.error('Upload failed details:', error);
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
      }
      Alert.alert('Upload Failed', error?.response?.data?.message || 'Failed to upload file');
    } finally {
      setIsUploading(false);
      // Refresh messages
      fetchMessages();
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Message action handlers
  const handleMessageLongPress = (message: Message) => {
    setSelectedMessage(message);
    setIsMessageMenuVisible(true);
  };

  const fetchReadByUsers = async (messageId: string) => {
    setIsLoadingReadBy(true);
    try {
      const response = await api.get(`/messages/${messageId}/read-status`);
      setReadByUsers(response.data.readBy);
    } catch (error) {
      console.log('Error fetching read status', error);
    } finally {
      setIsLoadingReadBy(false);
    }
  };

  const openMessageInfo = () => {
    if (!selectedMessage) return;
    setIsMessageMenuVisible(false);
    fetchReadByUsers(selectedMessage._id);
    setIsMessageInfoVisible(true);
  };

  const openEditModal = () => {
    if (!selectedMessage) return;
    setEditContent(selectedMessage.content);
    setIsMessageMenuVisible(false);
    setIsEditModalVisible(true);
  };

  const saveEditedMessage = async () => {
    if (!selectedMessage || !editContent.trim()) return;

    try {
      const response = await api.put(`/messages/${selectedMessage._id}`, {
        content: editContent.trim()
      });

      setMessages(prev => prev.map(msg =>
        msg._id === selectedMessage._id ? response.data : msg
      ));

      // Emit socket event for real-time update
      socketRef.current?.emit('message_updated', {
        ...response.data,
        groupId,
      });

      setIsEditModalVisible(false);
      setSelectedMessage(null);
    } catch (error: any) {
      Alert.alert('Error', error?.response?.data?.message || 'Failed to edit message');
    }
  };

  const deleteForMe = async () => {
    if (!selectedMessage) return;

    try {
      await api.delete(`/messages/${selectedMessage._id}/me`);
      setMessages(prev => prev.filter(msg => msg._id !== selectedMessage._id));
      setIsMessageMenuVisible(false);
      setSelectedMessage(null);
    } catch (error: any) {
      Alert.alert('Error', error?.response?.data?.message || 'Failed to delete message');
    }
  };

  const deleteForEveryone = async () => {
    if (!selectedMessage) return;

    Alert.alert(
      'Delete for Everyone',
      'This message will be deleted for all members. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await api.delete(`/messages/${selectedMessage._id}/everyone`);

              setMessages(prev => prev.map(msg =>
                msg._id === selectedMessage._id
                  ? { ...msg, deletedForEveryone: true }
                  : msg
              ));

              // Emit socket event
              socketRef.current?.emit('message_deleted', {
                messageId: selectedMessage._id,
                deletedForEveryone: true,
                groupId,
              });

              setIsMessageMenuVisible(false);
              setSelectedMessage(null);
            } catch (error: any) {
              Alert.alert('Error', error?.response?.data?.message || 'Failed to delete message');
            }
          }
        }
      ]
    );
  };

  const renderTickIcon = (message: Message) => {
    if (message.sender._id !== user?._id) return null;

    const status = message.status || 'sent';

    if (status === 'read') {
      return <CheckCheck color="#34B7F1" size={14} />;
    } else if (status === 'delivered') {
      return <CheckCheck color="rgba(255,255,255,0.7)" size={14} />;
    } else {
      return <Check color="rgba(255,255,255,0.7)" size={14} />;
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isOwnMessage = item.sender._id === user?._id;

    // Deleted message placeholder
    if (item.deletedForEveryone) {
      const isAdmin = user?.role === 'admin';

      // Admin sees the original content in a red box
      if (isAdmin && item.content) {
        return (
          <Pressable
            onLongPress={() => handleMessageLongPress(item)}
            delayLongPress={300}
            style={[
              styles.messageContainer,
              isOwnMessage ? styles.ownMessage : styles.otherMessage,
              styles.adminDeletedMessage
            ]}
          >
            <View style={styles.deletedBadge}>
              <Text style={styles.deletedBadgeText}>Deleted Message</Text>
            </View>
            {!isOwnMessage && (
              <Text style={styles.senderName}>{item.sender.name}</Text>
            )}
            <Text style={[
              styles.messageText,
              styles.adminDeletedMessageText
            ]}>
              {item.content}
            </Text>
            <Text style={styles.adminDeletedTime}>
              {formatTime(item.createdAt)}
            </Text>
          </Pressable>
        );
      }

      // Students/Mentors see "This message was deleted"
      return (
        <View style={[
          styles.messageContainer,
          isOwnMessage ? styles.ownMessage : styles.otherMessage,
          styles.deletedMessage
        ]}>
          <Text style={styles.deletedMessageText}>
            🚫 This message was deleted
          </Text>
        </View>
      );
    }

    return (
      <Pressable
        onLongPress={() => handleMessageLongPress(item)}
        delayLongPress={300}
        style={[
          styles.messageContainer,
          isOwnMessage ? styles.ownMessage : styles.otherMessage
        ]}
      >
        {!isOwnMessage && (
          <Text style={styles.senderName}>{item.sender.name}</Text>
        )}
        <Text style={[
          styles.messageText,
          isOwnMessage ? styles.ownMessageText : styles.otherMessageText
        ]}>
          {item.content}
        </Text>

        {item.attachments && item.attachments.length > 0 && (
          <View style={styles.attachmentsContainer}>
            {item.attachments.map((att, index) => (
              <AttachmentThumbnail
                key={index}
                attachment={att as any}
                onPress={() => {
                  setViewingAttachment(att);
                  setIsViewerVisible(true);
                }}
              />
            ))}
          </View>
        )}

        <View style={styles.messageFooter}>
          {item.isEdited && (
            <Text style={[
              styles.editedLabel,
              isOwnMessage ? styles.ownEditedLabel : styles.otherEditedLabel
            ]}>
              edited
            </Text>
          )}
          <Text style={[
            styles.messageTime,
            isOwnMessage ? styles.ownMessageTime : styles.otherMessageTime
          ]}>
            {formatTime(item.createdAt)}
          </Text>
          {renderTickIcon(item)}
        </View>
      </Pressable>
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
        {user?.role !== 'student' && (
          <TouchableOpacity
            style={styles.callButton}
            onPress={() => router.push(`/call/${groupId}` as any)}
          >
            <Phone color="#10B981" size={22} />
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No messages yet</Text>
                <Text style={styles.emptySubtext}>Start the conversation!</Text>
              </View>
            }
          />
        )}



        <View style={styles.inputContainer}>
          <TouchableOpacity
            style={styles.attachButton}
            onPress={() => setIsAttachmentMenuVisible(true)}
            disabled={isUploading}
          >
            {isUploading ? (
              <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#6B7280', borderTopColor: 'transparent', opacity: 0.5 }} />
            ) : (
              <Paperclip color="#6B7280" size={20} />
            )}
          </TouchableOpacity>
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

      {/* Message Action Menu */}
      <Modal visible={isMessageMenuVisible} transparent animationType="fade">
        <Pressable
          style={styles.menuOverlay}
          onPress={() => setIsMessageMenuVisible(false)}
        >
          <View style={styles.menuContainer}>
            {/* Info - Admin can see on any message, others only on own messages */}
            {(user?.role === 'admin' || selectedMessage?.sender._id === user?._id) && (
              <TouchableOpacity style={styles.menuItem} onPress={openMessageInfo}>
                <Info color="#374151" size={20} />
                <Text style={styles.menuItemText}>Info</Text>
              </TouchableOpacity>
            )}

            {/* Edit - Only sender can edit their own non-deleted messages */}
            {selectedMessage?.sender._id === user?._id && !selectedMessage?.deletedForEveryone && (
              <TouchableOpacity style={styles.menuItem} onPress={openEditModal}>
                <Edit2 color="#374151" size={20} />
                <Text style={styles.menuItemText}>Edit</Text>
              </TouchableOpacity>
            )}



            {/* Delete for me - Available to everyone */}
            <TouchableOpacity style={styles.menuItem} onPress={deleteForMe}>
              <Trash2 color="#374151" size={20} />
              <Text style={styles.menuItemText}>Delete for me</Text>
            </TouchableOpacity>

            {/* Delete for everyone - Sender OR Admin can delete, not if already deleted */}
            {(selectedMessage?.sender._id === user?._id || user?.role === 'admin') && !selectedMessage?.deletedForEveryone && (
              <TouchableOpacity style={[styles.menuItem, styles.menuItemDanger]} onPress={deleteForEveryone}>
                <Trash2 color="#EF4444" size={20} />
                <Text style={styles.menuItemTextDanger}>Delete for everyone</Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* Message Info Modal */}
      <Modal visible={isMessageInfoVisible} animationType="slide" transparent>
        <View style={styles.infoOverlay}>
          <View style={styles.infoContainer}>
            <View style={styles.infoHeader}>
              <Text style={styles.infoTitle}>Message Info</Text>
              <TouchableOpacity onPress={() => setIsMessageInfoVisible(false)}>
                <X color="#6B7280" size={24} />
              </TouchableOpacity>
            </View>

            <View style={styles.infoSection}>
              <Text style={styles.infoSectionTitle}>Read by</Text>
              {isLoadingReadBy ? (
                <Text style={styles.loadingText}>Loading...</Text>
              ) : readByUsers.length === 0 ? (
                <Text style={styles.noReadsText}>Not read yet</Text>
              ) : (
                <ScrollView style={styles.readByList}>
                  {readByUsers.map((rb, index) => (
                    <View key={index} style={styles.readByItem}>
                      <View style={styles.readByAvatar}>
                        <Text style={styles.readByAvatarText}>
                          {rb.user.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.readByInfo}>
                        <Text style={styles.readByName}>{rb.user.name}</Text>
                        <Text style={styles.readByTime}>
                          {new Date(rb.readAt).toLocaleString()}
                        </Text>
                      </View>
                      <CheckCheck color="#34B7F1" size={18} />
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Message Modal */}
      <Modal visible={isEditModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.editOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.editContainer}>
            <View style={styles.editHeader}>
              <Text style={styles.editTitle}>Edit Message</Text>
              <TouchableOpacity onPress={() => setIsEditModalVisible(false)}>
                <X color="#6B7280" size={24} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.editInput}
              value={editContent}
              onChangeText={setEditContent}
              multiline
              autoFocus
            />

            <View style={styles.editActions}>
              <TouchableOpacity
                style={styles.editCancelButton}
                onPress={() => setIsEditModalVisible(false)}
              >
                <Text style={styles.editCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editSaveButton, !editContent.trim() && styles.editSaveButtonDisabled]}
                onPress={saveEditedMessage}
                disabled={!editContent.trim()}
              >
                <Text style={styles.editSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>

      </Modal>

      {/* Attachment Menu Modal */}
      <Modal visible={isAttachmentMenuVisible} transparent animationType="fade">
        <Pressable
          style={styles.menuOverlay}
          onPress={() => setIsAttachmentMenuVisible(false)}
        >
          <View style={[styles.menuContainer, { bottom: 100, left: 20, width: 200 }]}>
            <TouchableOpacity style={styles.menuItem} onPress={handlePickDocument}>
              <FileText color="#374151" size={20} />
              <Text style={styles.menuItemText}>Document</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={handlePickImage}>
              <ImageIcon color="#374151" size={20} />
              <Text style={styles.menuItemText}>Gallery</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Attachment Viewer */}
      {viewingAttachment && (
        <AttachmentViewer
          attachment={viewingAttachment}
          isVisible={isViewerVisible}
          onClose={() => {
            setIsViewerVisible(false);
            setViewingAttachment(null);
          }}
        />
      )}

      <>
        {/* Group Info Modal */}
        <Modal visible={isGroupInfoVisible} animationType="slide">
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setIsGroupInfoVisible(false)} style={styles.backButton}>
                <ArrowLeft color="#000000" size={24} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Group Info</Text>
              <View style={{ width: 24 }} />
            </View>

            <View style={{ flex: 1 }}>
              <FlatList
                key={isGroupInfoVisible ? 'visible' : 'hidden'}
                data={group?.members || []}
                keyExtractor={(item) => item._id}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 40 }}
                showsVerticalScrollIndicator={true}
                removeClippedSubviews={false}
                nestedScrollEnabled={true}
                scrollEnabled={true}
                ListHeaderComponent={() => (
                  <>
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
                  </>
                )}
                renderItem={({ item: member }) => (
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
                )}
              />
            </View>
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
  callButton: {
    padding: 8,
    marginLeft: 5,
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
  deletedMessage: {
    backgroundColor: '#F3F4F6',
    opacity: 0.7,
  },
  deletedMessageText: {
    color: '#6B7280',
    fontStyle: 'italic',
    fontSize: 14,
  },
  // Admin deleted message styles
  adminDeletedMessage: {
    backgroundColor: '#FEF2F2',
    borderWidth: 2,
    borderColor: '#EF4444',
  },
  deletedBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  deletedBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
  },
  adminDeletedMessageText: {
    color: '#991B1B',
  },
  adminDeletedTime: {
    fontSize: 10,
    color: '#EF4444',
    marginTop: 4,
    textAlign: 'right',
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
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
    gap: 4,
  },
  editedLabel: {
    fontSize: 10,
    fontStyle: 'italic',
    marginRight: 4,
  },
  ownEditedLabel: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  otherEditedLabel: {
    color: '#9CA3AF',
  },
  messageTime: {
    fontSize: 10,
  },
  ownMessageTime: {
    color: 'rgba(255, 255, 255, 0.7)',
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
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
    color: '#1F2937',
    maxHeight: 100,
    marginRight: 12,
  },
  sendButton: {
    backgroundColor: '#01b4ae',
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  sendButtonDisabled: {
    backgroundColor: '#A0D8D6',
    opacity: 0.6,
  },
  // Message action menu styles
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 8,
    minWidth: 200,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  menuItemText: {
    fontSize: 16,
    color: '#374151',
  },
  menuItemDanger: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    marginTop: 4,
    paddingTop: 16,
  },
  menuItemTextDanger: {
    fontSize: 16,
    color: '#EF4444',
  },
  // Message info modal styles
  infoOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  infoContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
  },
  infoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
  },
  infoSection: {
    padding: 16,
  },
  infoSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 12,
  },
  noReadsText: {
    fontSize: 14,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  readByList: {
    maxHeight: 250,
  },
  readByItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  readByAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  readByAvatarText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  readByInfo: {
    flex: 1,
  },
  readByName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#000000',
  },
  readByTime: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  // Edit modal styles
  editOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  editContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
  },
  editHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  editTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#000000',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
    gap: 12,
  },
  editCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  editCancelText: {
    fontSize: 16,
    color: '#6B7280',
  },
  editSaveButton: {
    backgroundColor: '#01b4ae',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  editSaveButtonDisabled: {
    backgroundColor: '#A0D8D6',
    opacity: 0.6,
  },
  editSaveText: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  // Existing modal styles
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
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#01b4ae',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#01b4ae',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
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
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E0F7F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  addMemberText: {
    fontSize: 16,
    color: '#01b4ae',
    fontWeight: '600',
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
    color: '#01b4ae',
    backgroundColor: '#E0F7F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 2,
    fontWeight: '700',
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
    color: '#01b4ae',
    fontSize: 16,
    fontWeight: '700',
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
    backgroundColor: '#01b4ae',
    borderColor: '#01b4ae',
  },
  attachButton: {
    padding: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },

});
