import { useState, useEffect, useRef, useCallback } from 'react';
import { withFeatureGate } from '@/components/withFeatureGate';
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
  RefreshControl,
  Animated,
  Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenContainer } from '@/components/layout';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Send, X, Check, CheckCheck, Edit2, Trash2, Info, Phone, PhoneOff, Ban, Users, ChevronDown, Clock, AlertCircle } from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';
import { getSocketURL } from '@/services/config';
import { colors } from '@/utils/theme';
import * as Haptics from '@/utils/haptics';
import { io, Socket } from 'socket.io-client';
import { KeyboardAvoidingDialog } from '@/components/KeyboardAvoidingDialog';
import ScreenHeader from '@/components/ScreenHeader';
import TouchableScale from '@/components/TouchableScale';

import { useNotifications } from '@/context/NotificationContext';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Paperclip, FileText, Image as ImageIcon } from 'lucide-react-native';
import { AttachmentViewer, AttachmentThumbnail } from '@/components/AttachmentViewer';
import UserAvatar from '@/components/UserAvatar';

interface Message {
  _id: string;
  content: string;
  sender: { _id: string; name: string; profilePicture?: string | null };
  createdAt: string;
  // 'sending'/'failed' are client-only optimistic-send states.
  status?: 'sent' | 'delivered' | 'read' | 'sending' | 'failed';
  isEdited?: boolean;
  editedAt?: string;

  deletedForEveryone?: boolean;
  isUploading?: boolean;
  attachments?: Array<{
    type: 'image' | 'video' | 'document';
    url: string;
    name: string;
    size: number;
    mimeType: string;
    publicId: string;
    localUri?: string;
  }>;
  messageType?: 'text' | 'image' | 'file' | 'call_start' | 'call_end' | 'call_missed' | 'call_declined';
  callDurationSeconds?: number;
  callId?: string;
}

interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
  profilePicture?: string | null;
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
  user: { _id: string; name: string; profilePicture?: string | null };
  readAt: string;
}

/**
 * Soft fade+rise entrance for messages that arrive AFTER the initial history
 * load (sent or received live). The registry dedupes so a recycled list item
 * never replays the animation, and history items skip it entirely.
 */
function MessageEntrance({
  messageId,
  shouldAnimate,
  onRegister,
  children,
}: {
  messageId: string;
  shouldAnimate: boolean;
  onRegister: (id: string) => void;
  children: React.ReactNode;
}) {
  const opacity = useRef(new Animated.Value(shouldAnimate ? 0 : 1)).current;
  const translateY = useRef(new Animated.Value(shouldAnimate ? 8 : 0)).current;

  useEffect(() => {
    if (!shouldAnimate) return;
    onRegister(messageId);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 170,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 170,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!shouldAnimate) return <>{children}</>;

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

/**
 * Message-shaped loading placeholders — alternating sides with a gentle
 * pulse, replacing the old "Loading messages..." text.
 */
function ChatLoadingSkeleton() {
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.85, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const rows: Array<{ own: boolean; width: `${number}%`; height: number }> = [
    { own: false, width: '58%', height: 42 },
    { own: false, width: '42%', height: 42 },
    { own: true, width: '50%', height: 42 },
    { own: false, width: '64%', height: 58 },
    { own: true, width: '38%', height: 42 },
    { own: false, width: '52%', height: 42 },
  ];

  return (
    <View style={styles.skeletonContainer}>
      {rows.map((row, i) => (
        <Animated.View
          key={i}
          style={[
            styles.skeletonBubble,
            row.own ? styles.ownMessage : styles.otherMessage,
            { width: row.width, height: row.height, opacity: pulse },
          ]}
        />
      ))}
    </View>
  );
}

function ChatScreen() {
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { markAsRead } = useNotifications();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [group, setGroup] = useState<Group | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Measured header height (safe-area inset excluded) so the keyboard
  // avoiding offset adapts to every device instead of a hardcoded value.
  const [headerHeight, setHeaderHeight] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const socketRef = useRef<Socket | null>(null);
  // ---- Keep-my-place scrolling ---------------------------------------
  // The user stays put while reading history; a pill counts unseen new
  // messages instead of yanking them to the bottom (old behavior).
  const isNearBottomRef = useRef(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Entrance animations apply only to messages that arrive after the initial
  // history load; ids already shown never replay.
  const initialLoadDoneRef = useRef(false);
  const animatedMessageIdsRef = useRef<Set<string>>(new Set());
  const registerAnimatedMessage = useCallback((id: string) => {
    animatedMessageIdsRef.current.add(id);
  }, []);
  const shouldAnimateMessage = useCallback(
    (id: string) =>
      initialLoadDoneRef.current && !animatedMessageIdsRef.current.has(id),
    []
  );
  // Whether this screen is the focused (topmost) route. The 'group_deleted'
  // handler must only navigate when it is — when Group Info is pushed on top,
  // that screen owns the post-delete navigation (dismissTo back to the Groups
  // tab) and a back() from here would fight it.
  const isFocusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      return () => {
        isFocusedRef.current = false;
      };
    }, [])
  );
  const pendingAttachmentActionRef = useRef<(() => void) | null>(null);
  const pendingAttachmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Message action states
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [isMessageMenuVisible, setIsMessageMenuVisible] = useState(false);
  // The long-press menu grows in from 92% instead of a bare fade.
  const menuScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isMessageMenuVisible) return;
    menuScale.setValue(0.92);
    Animated.spring(menuScale, {
      toValue: 1,
      friction: 6,
      tension: 220,
      useNativeDriver: true,
    }).start();
  }, [isMessageMenuVisible, menuScale]);
  const [isMessageInfoVisible, setIsMessageInfoVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [readByUsers, setReadByUsers] = useState<ReadByUser[]>([]);

  const [isLoadingReadBy, setIsLoadingReadBy] = useState(false);

  // Attachment states
  const [isAttachmentMenuVisible, setIsAttachmentMenuVisible] = useState(false);
  // Attachment menu gets the same grow-in as the message menu.
  const attachmentMenuScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isAttachmentMenuVisible) return;
    attachmentMenuScale.setValue(0.92);
    Animated.spring(attachmentMenuScale, {
      toValue: 1,
      friction: 6,
      tension: 220,
      useNativeDriver: true,
    }).start();
  }, [isAttachmentMenuVisible, attachmentMenuScale]);
  const [isUploading, setIsUploading] = useState(false);
  const [viewingAttachment, setViewingAttachment] = useState<any>(null);
  const [isViewerVisible, setIsViewerVisible] = useState(false);

  // Keyboard state for the input row's bottom safe-area padding. The keyboard
  // frame already covers the navigation bar / home-indicator region, so the
  // bottom inset must be dropped while it is open or the input floats above
  // the keyboard by the inset height (safe-area-context excludes ime() insets
  // on Android, so insets.bottom keeps reporting the nav bar).
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setIsKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setIsKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pendingAttachmentTimerRef.current) {
        clearTimeout(pendingAttachmentTimerRef.current);
      }
    };
  }, []);

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
      if (isNearBottomRef.current) {
        // Reading at the bottom: stay pinned and keep read-state accurate.
        scrollToBottom();
        if (groupId) {
          markAsRead(groupId);
          api.post(`/messages/${data._id}/read`).catch(() => { });
        }
      } else {
        // Reading history: don't move; surface the pill instead.
        setNewMessagesCount(count => count + 1);
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

    // The group was deleted while this chat was open (admin deleted it from
    // Group Info or elsewhere). Leave gracefully instead of leaving the user
    // typing into a dead chat — but only when this screen is the focused
    // route (see isFocusedRef).
    socketRef.current.on('group_deleted', (data: { groupId: string }) => {
      if (data.groupId !== groupId || !isFocusedRef.current) return;
      Alert.alert('Group deleted', 'This group has been deleted.');
      router.back();
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

  // showLoading=false keeps the message list on screen during pull-to-refresh.
  const fetchMessages = async (showLoading = true) => {
    try {
      if (showLoading) setIsLoading(true);
      const response = await api.get(`/messages/group/${groupId}`);
      setMessages(response.data);
      setIsLoading(false);
      // Flip the entrance gate only AFTER the first history batch has
      // rendered (rAF runs post-paint) — history items must not animate in,
      // only messages that arrive live from here on.
      requestAnimationFrame(() => {
        scrollToBottom(false);
        initialLoadDoneRef.current = true;
      });

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

  const refreshChat = async () => {
    setIsRefreshing(true);
    await Promise.all([fetchMessages(false), fetchGroup()]);
    setIsRefreshing(false);
  };

  // Animated defaults true; the content-size pin uses the non-animated form.
  const scrollToBottom = (animated = true) => {
    flatListRef.current?.scrollToEnd({ animated });
  };

  // Track whether the user is reading at the bottom; clearing the pill when
  // they arrive there themselves.
  const handleMessagesScroll = (event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    if (!contentSize || contentSize.height === 0) return;
    const nearBottom =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 140;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) {
      setNewMessagesCount(prev => (prev > 0 ? 0 : prev));
    }
  };

  const jumpToNewMessages = () => {
    setNewMessagesCount(0);
    isNearBottomRef.current = true;
    scrollToBottom(true);
    if (groupId) markAsRead(groupId);
  };

  // Optimistic send: the bubble appears instantly with a clock, swaps to the
  // server message on success, or turns red with tap-to-retry on failure.
  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    const messageContent = newMessage.trim();
    setNewMessage('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const tempId = `temp_${Date.now()}`;
    const tempMessage: Message = {
      _id: tempId,
      content: messageContent,
      sender: { _id: user?._id || '', name: user?.name || '' },
      createdAt: new Date().toISOString(),
      status: 'sending',
    };
    setMessages(prev => [...prev, tempMessage]);
    isNearBottomRef.current = true;
    scrollToBottom();

    try {
      const response = await api.post('/messages', {
        content: messageContent,
        groupId,
      });
      setMessages(prev => prev.map(msg =>
        msg._id === tempId ? response.data : msg
      ));
      socketRef.current?.emit('send_message', {
        ...response.data,
        groupId,
      });
    } catch (error) {
      setMessages(prev => prev.map(msg =>
        msg._id === tempId ? { ...msg, status: 'failed' } : msg
      ));
      Haptics.errorNotification();
    }
  };

  const retrySendMessage = async (failedMessage: Message) => {
    if (!failedMessage.content?.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    setMessages(prev => prev.map(msg =>
      msg._id === failedMessage._id ? { ...msg, status: 'sending' } : msg
    ));

    try {
      const response = await api.post('/messages', {
        content: failedMessage.content,
        groupId,
      });
      setMessages(prev => prev.map(msg =>
        msg._id === failedMessage._id ? response.data : msg
      ));
      socketRef.current?.emit('send_message', {
        ...response.data,
        groupId,
      });
    } catch (error) {
      setMessages(prev => prev.map(msg =>
        msg._id === failedMessage._id ? { ...msg, status: 'failed' } : msg
      ));
    }
  };

  const runPendingAttachmentAction = () => {
    if (pendingAttachmentTimerRef.current) {
      clearTimeout(pendingAttachmentTimerRef.current);
      pendingAttachmentTimerRef.current = null;
    }

    const action = pendingAttachmentActionRef.current;
    pendingAttachmentActionRef.current = null;
    action?.();
  };

  const openPickerAfterMenuDismiss = (action: () => void) => {
    pendingAttachmentActionRef.current = action;
    setIsAttachmentMenuVisible(false);

    // iOS, especially on iPad, can ignore a picker presentation while a RN Modal
    // is still dismissing. onDismiss is the preferred path, with this as backup.
    pendingAttachmentTimerRef.current = setTimeout(
      runPendingAttachmentAction,
      Platform.OS === 'ios' ? 450 : 80
    );
  };

  const handlePickImage = () => {
    openPickerAfterMenuDismiss(() => {
      void launchImagePicker();
    });
  };

  const launchImagePicker = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await uploadFile(result.assets[0], 'image');
      }
    } catch (error) {
      console.error('Image picker failed:', error);
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const handlePickDocument = () => {
    openPickerAfterMenuDismiss(() => {
      void launchDocumentPicker();
    });
  };

  const launchDocumentPicker = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        copyToCacheDirectory: true
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        await uploadFile(result.assets[0], 'document');
      }
    } catch (error) {
      console.error('Document picker failed:', error);
      Alert.alert('Error', 'Failed to pick document');
    }
  };

  const uploadFile = async (file: any, type: 'image' | 'document') => {
    setIsUploading(true);
    
    // 1. Create a temporary message for optimistic UI
    const tempId = `temp_${Date.now()}`;
    const uriToUse = file.uri;
    const fileName = file.name || file.fileName || (type === 'image' ? 'image.jpg' : 'document.pdf');
    
    let mimeType = file.mimeType;
    if (!mimeType) {
      const ext = fileName.split('.').pop()?.toLowerCase();
      if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
      else if (ext === 'png') mimeType = 'image/png';
      else if (ext === 'gif') mimeType = 'image/gif';
      else if (ext === 'webp') mimeType = 'image/webp';
      else if (ext === 'heic') mimeType = 'image/heic';
      else if (ext === 'heif') mimeType = 'image/heif';
      else if (ext === 'pdf') mimeType = 'application/pdf';
      else if (ext === 'doc') mimeType = 'application/msword';
      else if (ext === 'docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (ext === 'xls') mimeType = 'application/vnd.ms-excel';
      else if (ext === 'xlsx') mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      else mimeType = type === 'image' ? 'image/jpeg' : 'application/octet-stream';
    }

    const tempMessage: Message = {
      _id: tempId,
      content: '',
      sender: { _id: user?._id || '', name: user?.name || '' },
      createdAt: new Date().toISOString(),
      status: 'sent',
      isUploading: true,
      attachments: [{
        type: type,
        url: '', // No URL yet
        name: fileName,
        size: file.size || 0,
        mimeType: mimeType,
        publicId: '',
        localUri: uriToUse
      }]
    };

    // Append temporary message locally only. Other clients should receive the
    // persisted message after the upload succeeds.
    setMessages(prev => [...prev, tempMessage]);
    setTimeout(scrollToBottom, 100);

    try {
      console.log('Preparing upload:', type, file.uri, mimeType);

      const formData = new FormData();
      formData.append('file', {
        uri: uriToUse,
        name: fileName,
        type: mimeType
      } as any);

      const response = await api.post('/upload/chat', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 60000,
        transformRequest: (data) => data
      });

      if (response.data.success) {
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

        // 2. Replace temporary message with actual DB message
        setMessages(prev => prev.map(msg => 
          msg._id === tempId ? msgResponse.data : msg
        ));

        // 3. Emit the persisted message to other clients
        socketRef.current?.emit('send_message', {
          ...msgResponse.data,
          groupId,
        });
      }
    } catch (error: any) {
      console.error('Upload failed details:', error);
      Alert.alert('Upload Failed', error?.response?.data?.message || 'Failed to upload file');
      // On failure, remove the temp message
      setMessages(prev => prev.filter(msg => msg._id !== tempId));
    } finally {
      setIsUploading(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // ---- Day separators + sender grouping -------------------------------
  // A centered "Today / Yesterday / date" chip starts each new day, and a
  // sender's name shows only when the sender (or the day) changes — so a run
  // of messages from one person reads as one block.
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const formatDayLabel = (date: Date) => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfToday.getDate() - 1);
    if (date >= startOfToday) return 'Today';
    if (date >= startOfYesterday) return 'Yesterday';
    return date.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    });
  };

  const formatCallDuration = (seconds?: number) => {
    const duration = seconds ?? 0;
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    return `${mins} min ${secs} sec`;
  };

  // Message action handlers
  const handleMessageLongPress = (message: Message) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedMessage(message);
    setIsMessageMenuVisible(true);
  };

  const isCallEvent = (message: Message) => {
    return ['call_start', 'call_end', 'call_missed', 'call_declined'].includes(message.messageType || '');
  };

  const renderCallMessage = (message: Message, isOwnMessage: boolean) => {
    const callType = message.messageType;
    const durationLabel = callType === 'call_end'
      ? formatCallDuration(message.callDurationSeconds)
      : callType === 'call_missed'
        ? 'No answer'
        : callType === 'call_declined'
          ? 'Declined'
          : 'Calling...';
    const iconBackground = (callType === 'call_missed' || callType === 'call_declined') ? colors.dangerDark : colors.success;
    const title = callType === 'call_missed' ? 'Missed call' : callType === 'call_declined' ? 'Declined call' : 'Voice call';
    const containerStyle = [
      styles.callMessageContainer,
      isOwnMessage ? styles.callOwnMessage : styles.callOtherMessage
    ];
    const titleStyle = [
      styles.callTitle,
      isOwnMessage ? styles.callTitleLight : styles.callTitleDark
    ];
    const durationStyle = [
      styles.callDurationText,
      isOwnMessage ? styles.callDurationLight : styles.callDurationDark
    ];
    const timeStyle = [
      styles.callMetaTime,
      isOwnMessage ? styles.callTimeLight : styles.callTimeDark
    ];

    return (
      <Pressable
        onLongPress={() => handleMessageLongPress(message)}
        delayLongPress={300}
        style={containerStyle}
      >
        <View style={styles.callMessageRow}>
          <View style={[styles.callIconCircle, { backgroundColor: iconBackground }]}>
            {(callType === 'call_missed' || callType === 'call_declined') ? (
              <PhoneOff color="#FFFFFF" size={20} />
            ) : (
              <Phone color="#FFFFFF" size={20} />
            )}
          </View>
          <Text style={titleStyle}>{title}</Text>
        </View>
        <View style={styles.callMeta}>
          <Text style={durationStyle}>{durationLabel}</Text>
          <Text style={timeStyle}>{formatTime(message.createdAt)}</Text>
        </View>
      </Pressable>
    );
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

    if (status === 'sending') {
      return <Clock color="rgba(255,255,255,0.7)" size={13} />;
    }
    if (status === 'failed') {
      return <AlertCircle color="#FECACA" size={13} />;
    }
    if (status === 'read') {
      return <CheckCheck color="#34B7F1" size={14} />;
    } else if (status === 'delivered') {
      return <CheckCheck color="rgba(255,255,255,0.7)" size={14} />;
    } else {
      return <Check color="rgba(255,255,255,0.7)" size={14} />;
    }
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => (
    <MessageEntrance
      messageId={item._id}
      shouldAnimate={shouldAnimateMessage(item._id)}
      onRegister={registerAnimatedMessage}
    >
      {renderMessageContent({ item, index })}
    </MessageEntrance>
  );

  const renderMessageContent = ({ item, index }: { item: Message; index: number }) => {
    const isOwnMessage = item.sender._id === user?._id;
    const prev = index > 0 ? messages[index - 1] : null;

    const startsNewDay =
      !prev || !isSameDay(new Date(prev.createdAt), new Date(item.createdAt));
    // Names repeat only when the sender (or the day) changes.
    const showSenderName =
      !isOwnMessage && (startsNewDay || !prev || prev.sender._id !== item.sender._id);

    const dayChip = startsNewDay ? (
      <View style={styles.dayChip}>
        <Text style={styles.dayChipText}>{formatDayLabel(new Date(item.createdAt))}</Text>
      </View>
    ) : null;

    if (isCallEvent(item)) {
      return (
        <>
          {dayChip}
          {renderCallMessage(item, isOwnMessage)}
        </>
      );
    }

    // Deleted message placeholder
    if (item.deletedForEveryone) {
      const isAdmin = user?.role === 'admin';

      // Admin sees the original content in a red box
      if (isAdmin && item.content) {
        return (
          <>
            {dayChip}
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
              {showSenderName && (
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
          </>
        );
      }

      // Students/Mentors see a quiet "deleted" bubble with the same line-icon
      // language as the rest of the app (was a 🚫 emoji).
      return (
        <>
          {dayChip}
          <View style={[
            styles.messageContainer,
            isOwnMessage ? styles.ownMessage : styles.otherMessage,
            styles.deletedMessage
          ]}>
            <View style={styles.deletedMessageRow}>
              <Ban color={colors.textSecondary} size={13} />
              <Text style={styles.deletedMessageText}>
                This message was deleted
              </Text>
            </View>
          </View>
        </>
      );
    }

    return (
      <>
        {dayChip}
        <Pressable
          onLongPress={() => handleMessageLongPress(item)}
          // A failed optimistic send comes back to life on tap.
          onPress={item.status === 'failed' ? () => retrySendMessage(item) : undefined}
          delayLongPress={300}
          style={[
            styles.messageContainer,
            isOwnMessage ? styles.ownMessage : styles.otherMessage,
            item.status === 'failed' && styles.failedMessage
          ]}
        >
          {showSenderName && (
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
              {item.attachments.map((att, attIndex) => (
                <AttachmentThumbnail
                  key={attIndex}
                  attachment={att as any}
                  isUploading={item.isUploading}
                  onPress={() => {
                    if (!item.isUploading) {
                      setViewingAttachment(att);
                      setIsViewerVisible(true);
                    }
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
      </>
    );
  };

  return (
    <ScreenContainer style={styles.container}>
      <View
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
      >
        <ScreenHeader
          title={group?.name || 'Chat'}
          subtitle={group?.description}
          onBack={() => router.back()}
          leading={<View style={styles.headerGroupAvatar}><Users color={colors.primary} size={18} /></View>}
          onTitlePress={() => router.push(`/chat/${groupId}/info` as any)}
          titleAccessibilityLabel={`Open info for ${group?.name || 'this group'}`}
          right={
            user?.role !== 'student' ? (
              <TouchableOpacity
                style={styles.callButton}
                onPress={() => router.push(`/call/${groupId}` as any)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Start voice call"
              >
                <Phone color={colors.success} size={22} />
              </TouchableOpacity>
            ) : undefined
          }
        />
      </View>

      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + headerHeight : 0}
      >
        {isLoading ? (
          <ChatLoadingSkeleton />
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item._id}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onScroll={handleMessagesScroll}
            scrollEventThrottle={16}
            // Stay pinned only when the user is already at the bottom —
            // reading history stays put (the pill counts what's new).
            onContentSizeChange={() => {
              if (isNearBottomRef.current) scrollToBottom(false);
            }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={refreshChat}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No messages yet</Text>
                <Text style={styles.emptySubtext}>Start the conversation!</Text>
              </View>
            }
          />
        )}



        {/* New-messages pill — shown while reading history and messages land */}
        {newMessagesCount > 0 && (
          <TouchableOpacity
            style={styles.newMessagesPill}
            onPress={jumpToNewMessages}
            accessibilityRole="button"
            accessibilityLabel={`${newMessagesCount} new message${newMessagesCount === 1 ? '' : 's'}. Jump to latest.`}
          >
            <ChevronDown color="#FFFFFF" size={14} />
            <Text style={styles.newMessagesPillText}>
              {newMessagesCount === 1 ? '1 new message' : `${newMessagesCount} new messages`}
            </Text>
          </TouchableOpacity>
        )}

        <View
          style={[
            styles.inputContainer,
            // Lift the row above the Android navigation bar / iOS home
            // indicator. ScreenContainer only applies the top edge, and with
            // edge-to-edge enforced the window draws behind these bars.
            { paddingBottom: 10 + (isKeyboardVisible ? 0 : insets.bottom) },
          ]}
        >
          <TouchableOpacity
            style={styles.attachButton}
            onPress={() => setIsAttachmentMenuVisible(true)}
            disabled={isUploading}
          >
            {isUploading ? (
              <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.textSecondary, borderTopColor: 'transparent', opacity: 0.5 }} />
            ) : (
              <Paperclip color={colors.textSecondary} size={20} />
            )}
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor={colors.textMuted}
            value={newMessage}
            onChangeText={setNewMessage}
            multiline
            maxLength={500}
          />
          <TouchableScale
            style={[styles.sendButton, !newMessage.trim() && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!newMessage.trim()}
            scaleTo={0.9}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Send color="#FFFFFF" size={20} />
          </TouchableScale>
        </View>
      </KeyboardAvoidingView>

      {/* Message Action Menu */}
      <Modal visible={isMessageMenuVisible} transparent animationType="fade">
        <Pressable
          style={styles.menuOverlay}
          onPress={() => setIsMessageMenuVisible(false)}
        >
          <Animated.View style={[styles.menuContainer, { transform: [{ scale: menuScale }] }]}>
            {/* Info - Admin can see on any message, others only on own messages */}
            {(user?.role === 'admin' || selectedMessage?.sender._id === user?._id) && (
              <TouchableOpacity style={styles.menuItem} onPress={openMessageInfo}>
                <Info color={colors.textBody} size={20} />
                <Text style={styles.menuItemText}>Info</Text>
              </TouchableOpacity>
            )}

            {/* Edit - Only sender can edit their own non-deleted messages */}
            {selectedMessage?.sender._id === user?._id && !selectedMessage?.deletedForEveryone && (
              <TouchableOpacity style={styles.menuItem} onPress={openEditModal}>
                <Edit2 color={colors.textBody} size={20} />
                <Text style={styles.menuItemText}>Edit</Text>
              </TouchableOpacity>
            )}



            {/* Delete for me - Available to everyone */}
            <TouchableOpacity style={styles.menuItem} onPress={deleteForMe}>
              <Trash2 color={colors.textBody} size={20} />
              <Text style={styles.menuItemText}>Delete for me</Text>
            </TouchableOpacity>

            {/* Delete for everyone - Sender OR Admin can delete, not if already deleted */}
            {(selectedMessage?.sender._id === user?._id || user?.role === 'admin') && !selectedMessage?.deletedForEveryone && (
              <TouchableOpacity style={[styles.menuItem, styles.menuItemDanger]} onPress={deleteForEveryone}>
                <Trash2 color={colors.danger} size={20} />
                <Text style={styles.menuItemTextDanger}>Delete for everyone</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </Pressable>
      </Modal>

      {/* Message Info Modal */}
      <Modal visible={isMessageInfoVisible} animationType="slide" transparent>
        <View style={styles.infoOverlay}>
          <View style={styles.infoContainer}>
            <View style={styles.infoHeader}>
              <Text style={styles.infoTitle}>Message Info</Text>
              <TouchableOpacity onPress={() => setIsMessageInfoVisible(false)}>
                <X color={colors.textSecondary} size={24} />
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
                      <UserAvatar
                        name={rb.user.name}
                        imageUrl={rb.user.profilePicture}
                        size={36}
                      />
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

      {/* Edit Message dialog — in-tree overlay (not a RN Modal) so it renders
          in the main window: under Android edge-to-edge RN Modal windows get
          no keyboard resize/events, so the keyboard covered this input and
          the Save button. */}
      <KeyboardAvoidingDialog
        visible={isEditModalVisible}
        onClose={() => setIsEditModalVisible(false)}
        animationType="fade"
        cardStyle={styles.editContainer}
      >
        <View style={styles.editHeader}>
          <Text style={styles.editTitle}>Edit Message</Text>
          <TouchableOpacity onPress={() => setIsEditModalVisible(false)}>
            <X color={colors.textSecondary} size={24} />
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
      </KeyboardAvoidingDialog>

      {/* Attachment Menu Modal */}
      <Modal
        visible={isAttachmentMenuVisible}
        transparent
        animationType="fade"
        onDismiss={runPendingAttachmentAction}
        onRequestClose={() => setIsAttachmentMenuVisible(false)}
      >
        <View style={styles.menuOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setIsAttachmentMenuVisible(false)}
          />
          <Animated.View
            style={[
              styles.menuContainer,
              styles.attachmentMenuContainer,
              // Anchor above the input row, which now includes the bottom inset.
              { bottom: 100 + insets.bottom, transform: [{ scale: attachmentMenuScale }] },
            ]}
          >
            <TouchableOpacity style={styles.menuItem} onPress={handlePickDocument}>
              <FileText color={colors.textBody} size={20} />
              <Text style={styles.menuItemText}>Document</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={handlePickImage}>
              <ImageIcon color={colors.textBody} size={20} />
              <Text style={styles.menuItemText}>Gallery</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
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
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  // Small group avatar in the header — same tile language as the group icon
  // everywhere else in the module.
  headerGroupAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primaryTint,
    justifyContent: 'center',
    alignItems: 'center',
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
    color: colors.textSecondary,
    fontSize: 16,
  },
  messagesList: {
    padding: 15,
    flexGrow: 1,
  },
  // Centered day separator ("Today" / "Yesterday" / date).
  dayChip: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 12,
    marginTop: 6,
    marginBottom: 10,
  },
  dayChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  messageContainer: {
    maxWidth: '80%',
    marginBottom: 8,
    padding: 12,
    borderRadius: 16,
  },
  // Chat bubble blue is deliberate (chat convention) — kept per the
  // no-color-change constraint; it is not part of the teal token set.
  ownMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#2563EB',
    borderBottomRightRadius: 4,
  },
  otherMessage: {
    alignSelf: 'flex-start',
    backgroundColor: colors.bg,
    borderBottomLeftRadius: 4,
  },
  deletedMessage: {
    backgroundColor: colors.bg,
    opacity: 0.75,
  },
  deletedMessageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deletedMessageText: {
    color: colors.textSecondary,
    fontStyle: 'italic',
    fontSize: 13.5,
  },
  // Admin deleted message styles
  adminDeletedMessage: {
    backgroundColor: colors.dangerTint,
    borderWidth: 1.5,
    borderColor: colors.danger,
  },
  deletedBadge: {
    backgroundColor: colors.danger,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  deletedBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
  },
  adminDeletedMessageText: {
    color: colors.dangerDark,
  },
  adminDeletedTime: {
    fontSize: 10,
    color: colors.danger,
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
    color: colors.text,
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
    color: colors.textMuted,
  },
  messageTime: {
    fontSize: 10,
  },
  ownMessageTime: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  otherMessageTime: {
    color: colors.textMuted,
  },
  callMessageContainer: {
    maxWidth: '78%',
    marginBottom: 10,
    padding: 14,
    borderRadius: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  callOwnMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#0F766E',
  },
  callOtherMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#ECFDF5',
  },
  callMessageRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  callIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  callTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  callTitleLight: {
    color: '#FFFFFF',
  },
  callTitleDark: {
    color: '#0F172A',
  },
  callMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  callDurationText: {
    fontSize: 12,
    fontWeight: '600',
  },
  callDurationLight: {
    color: 'rgba(255, 255, 255, 0.85)',
  },
  callDurationDark: {
    color: '#065F46',
  },
  callMetaTime: {
    fontSize: 12,
  },
  callTimeLight: {
    color: 'rgba(255, 255, 255, 0.75)',
  },
  callTimeDark: {
    color: '#065F46',
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
    color: colors.textSecondary,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 5,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    maxHeight: 100,
    marginRight: 12,
  },
  sendButton: {
    backgroundColor: colors.primary,
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
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
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 8,
    minWidth: 200,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  attachmentMenuContainer: {
    position: 'absolute',
    left: 20,
    width: 200,
    // `bottom` is computed inline so the menu clears the safe-area-padded input row.
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  menuItemText: {
    fontSize: 16,
    color: colors.textBody,
  },
  menuItemDanger: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 4,
    paddingTop: 16,
  },
  menuItemTextDanger: {
    fontSize: 16,
    color: colors.danger,
  },
  // Message info modal styles
  infoOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  infoContainer: {
    backgroundColor: colors.surface,
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
    borderBottomColor: colors.border,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  infoSection: {
    padding: 16,
  },
  infoSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 12,
  },
  noReadsText: {
    fontSize: 14,
    color: colors.textMuted,
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
    borderBottomColor: colors.border,
  },
  readByAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  readByAvatarText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  readByInfo: {
    flex: 1,
  },
  readByName: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  readByTime: {
    fontSize: 12,
    color: colors.textMuted,
  },
  // Edit dialog card styles (the overlay/scrim comes from KeyboardAvoidingDialog)
  editContainer: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    width: '100%',
    maxWidth: 420,
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
    color: colors.text,
  },
  editInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: colors.text,
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
    color: colors.textSecondary,
  },
  editSaveButton: {
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
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
  // Floating pill above the input row while new messages land off-screen.
  newMessagesPill: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 84,
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 6,
  },
  newMessagesPillText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  // Failed optimistic send: a soft red edge + lighter bubble.
  failedMessage: {
    borderWidth: 1.5,
    borderColor: colors.danger,
    opacity: 0.85,
  },
  // Loading placeholders (ChatLoadingSkeleton).
  skeletonContainer: {
    flex: 1,
    padding: 15,
    gap: 10,
  },
  skeletonBubble: {
    borderRadius: 16,
    backgroundColor: colors.bg,
  },

});
// TEMPORARY FEATURE FREEZE — quiz-only availability (utils/featureAvailability.ts).
export default withFeatureGate('chat')(ChatScreen);
