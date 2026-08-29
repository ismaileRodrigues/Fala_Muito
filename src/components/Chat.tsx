// @ts-nocheck
import React, { useEffect, useState, useRef, useCallback } from 'react';
import imageCompression from 'browser-image-compression';
import { type Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface Message {
  id: string;
  sender_id: string;
  receiver_id?: string | null;
  group_id?: string | null;
  content: string;
  image_url?: string | null;
  audio_url?: string | null;
  created_at: string;
  profiles?: {
    full_name: string;
    avatar_url?: string;
  };
}

interface Profile {
  id: string;
  full_name: string;
  avatar_url?: string;
}

interface Group {
  id: string;
  name: string;
  created_by: string;
  avatar_url?: string | null;
}

type ActiveChat = 
  | { type: 'direct'; id: string; name: string; avatar_url?: string }
  | { type: 'group'; id: string; name: string; created_by?: string; avatar_url?: string }
  | null;

export function Chat({ session }: { session: Session }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [users, setUsers] = useState<Profile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  
  const [activeChat, setActiveChat] = useState<ActiveChat>(null);
  const [sidebarTab, setSidebarTab] = useState<'conversas' | 'contatos'>('conversas');
  const [unreadChats, setUnreadChats] = useState<string[]>([]);
  const [lastMessages, setLastMessages] = useState<Record<string, string>>({});
  const [lastMessageTimes, setLastMessageTimes] = useState<Record<string, string>>({});

  const [previewAvatar, setPreviewAvatar] = useState<{ url: string; name: string } | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [groupAvatarFile, setGroupAvatarFile] = useState<File | null>(null);

  const [isManageMembersOpen, setIsManageMembersOpen] = useState(false);
  const [activeGroupMembers, setActiveGroupMembers] = useState<Profile[]>([]);

  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isMobileChatView, setIsMobileChatView] = useState(false);
  const [showImageMenu, setShowImageMenu] = useState(false);
  // Paginação infinita das mensagens
  const MESSAGES_PER_PAGE = 30;
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);

  // Notificações do chat
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'denied'
  );
  const [chatNotification, setChatNotification] = useState<{
    senderName: string;
    text: string;
  } | null>(null);

  // Referências para controle de áudio e tempo
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const isHoldingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const recordingMimeTypeRef = useRef('audio/webm');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const oldestMessageDateRef = useRef<string | null>(null);
  const shouldScrollToBottomRef = useRef(false);
  const isLoadingOlderRef = useRef(false);
  const notificationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 //const fileInputRef = useRef<HTMLInputElement>(null);
 const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);

  const activeChatRef = useRef<ActiveChat>(activeChat);
  const usersRef = useRef<Profile[]>(users);

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchMyProfile = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (data) setCurrentUser(data as Profile);
  }, [session.user.id]);

  const fetchUsers = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').neq('id', session.user.id);
    if (data) setUsers(data as Profile[]);
  }, [session.user.id]);

  const fetchGroups = useCallback(async (): Promise<Group[]> => {
    const { data } = await supabase
      .from('group_members')
      .select('groups(id, name, created_by, avatar_url)')
      .eq('user_id', session.user.id);

    if (data) {
      const groupList = data.map((item: any) => item.groups).filter(Boolean);
      setGroups(groupList);
      return groupList;
    }
    return [];
  }, [session.user.id]);

  const fetchActiveGroupMembers = useCallback(async () => {
    if (!activeChat || activeChat.type !== 'group') {
      setActiveGroupMembers([]);
      return;
    }

    const { data: memberRows, error: memberErr } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', activeChat.id);

    if (memberErr || !memberRows || memberRows.length === 0) {
      setActiveGroupMembers([]);
      return;
    }

    const userIds = memberRows.map((m) => m.user_id);

    const { data: profilesData, error: profileErr } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', userIds);

    if (profileErr) {
      console.error('Erro ao buscar perfis dos membros:', profileErr);
      return;
    }

    setActiveGroupMembers((profilesData as Profile[]) || []);
  }, [activeChat]);

  const fetchLastMessages = useCallback(async (userGroups?: Group[]) => {
    const { data: directMsgs } = await supabase
      .from('messages')
      .select('*')
      .or(`sender_id.eq.${session.user.id},receiver_id.eq.${session.user.id}`)
      .is('group_id', null)
      .order('created_at', { ascending: false });

    const groupList = userGroups || groups;
    const groupIds = groupList.map((g) => g.id);
    let groupMsgs: any[] = [];

    if (groupIds.length > 0) {
      const { data: gData } = await supabase
        .from('messages')
        .select('*')
        .in('group_id', groupIds)
        .order('created_at', { ascending: false });
      if (gData) groupMsgs = gData;
    }

    const allMsgs = [...(directMsgs || []), ...groupMsgs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const latestText: Record<string, string> = {};
    const latestTime: Record<string, string> = {};

    allMsgs.forEach((msg) => {
      const key = msg.group_id
        ? `group_${msg.group_id}`
        : `user_${msg.sender_id === session.user.id ? msg.receiver_id : msg.sender_id}`;

      if (!latestText[key]) {
        latestText[key] = msg.image_url ? '📷 [Imagem]' : msg.audio_url ? '🎤 [Áudio]' : msg.content;
        latestTime[key] = msg.created_at;
      }
    });

    setLastMessages(latestText);
    setLastMessageTimes(latestTime);
  }, [groups, session.user.id]);

  useEffect(() => {
    fetchMyProfile();
    fetchUsers();
    fetchGroups().then((groupList) => {
      fetchLastMessages(groupList);
    });

    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, [fetchMyProfile, fetchUsers, fetchGroups, fetchLastMessages]);

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stream.getTracks().forEach((track) => track.stop());
      }

      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activeChat?.type === 'group') {
      fetchActiveGroupMembers();
    }
  }, [activeChat, fetchActiveGroupMembers]);

  useEffect(() => {
    const channel = supabase
      .channel('public:profiles')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, () => fetchUsers())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchUsers]);

  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      alert('Este navegador não oferece suporte a notificações.');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);

      if (permission === 'granted') {
        const testNotification = new Notification('Notificações ativadas', {
          body: 'Você será avisado quando receber novas mensagens.',
          icon: '/favicon.ico',
          tag: 'chat-notifications-enabled',
        });

        setTimeout(() => testNotification.close(), 4000);
      }
    } catch (error) {
      console.error('Erro ao solicitar permissão de notificação:', error);
    }
  }, []);

  const triggerNotification = useCallback((senderName: string, text: string) => {
    const notificationText = text || 'Nova mensagem';

    // Notificação visual dentro do próprio chat
    setChatNotification({ senderName, text: notificationText });

    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }

    notificationTimeoutRef.current = setTimeout(() => {
      setChatNotification(null);
    }, 5000);

    // Som de nova mensagem
    try {
      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
      audio.volume = 0.5;
      audio.play().catch(() => {});
    } catch (error) {
      console.error('Erro ao reproduzir som da notificação:', error);
    }

    // Notificação nativa do navegador
    if ('Notification' in window && Notification.permission === 'granted') {
      const browserNotification = new Notification(senderName, {
        body: notificationText,
        icon: '/favicon.ico',
        tag: `chat-${senderName}`,
      });

      browserNotification.onclick = () => {
        window.focus();
        browserNotification.close();
      };

      setTimeout(() => browserNotification.close(), 7000);
    }
  }, []);

  const createMessagesQuery = useCallback(() => {
    if (!activeChat) return null;

    let query = supabase
      .from('messages')
      .select('*, profiles(full_name, avatar_url)');

    if (activeChat.type === 'group') {
      return query.eq('group_id', activeChat.id);
    }

    return query.or(
      `and(sender_id.eq.${session.user.id},receiver_id.eq.${activeChat.id}),and(sender_id.eq.${activeChat.id},receiver_id.eq.${session.user.id})`
    );
  }, [activeChat, session.user.id]);

  const fetchMessages = useCallback(async () => {
    if (!activeChat) {
      setMessages([]);
      setHasMoreMessages(false);
      oldestMessageDateRef.current = null;
      return;
    }

    setIsLoadingMessages(true);
    setMessages([]);
    setHasMoreMessages(true);
    oldestMessageDateRef.current = null;
    shouldScrollToBottomRef.current = true;

    try {
      const query = createMessagesQuery();
      if (!query) return;

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(MESSAGES_PER_PAGE);

      if (error) throw error;

      const orderedMessages = [...((data as Message[]) || [])].reverse();
      setMessages(orderedMessages);
      setHasMoreMessages(orderedMessages.length === MESSAGES_PER_PAGE);
      oldestMessageDateRef.current = orderedMessages[0]?.created_at || null;
    } catch (error) {
      console.error('Erro ao buscar mensagens:', error);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [activeChat, createMessagesQuery]);

  const loadOlderMessages = useCallback(async () => {
    if (
      !activeChat ||
      isLoadingMessages ||
      isLoadingOlderRef.current ||
      !hasMoreMessages ||
      !oldestMessageDateRef.current
    ) {
      return;
    }

    const container = messagesContainerRef.current;
    if (!container) return;

    isLoadingOlderRef.current = true;
    setIsLoadingOlder(true);

    const previousScrollHeight = container.scrollHeight;
    const previousScrollTop = container.scrollTop;

    try {
      const query = createMessagesQuery();
      if (!query) return;

      const { data, error } = await query
        .lt('created_at', oldestMessageDateRef.current)
        .order('created_at', { ascending: false })
        .limit(MESSAGES_PER_PAGE);

      if (error) throw error;

      const olderMessages = [...((data as Message[]) || [])].reverse();

      if (olderMessages.length === 0) {
        setHasMoreMessages(false);
        return;
      }

      oldestMessageDateRef.current = olderMessages[0].created_at;
      setHasMoreMessages(olderMessages.length === MESSAGES_PER_PAGE);

      setMessages((currentMessages) => {
        const existingIds = new Set(currentMessages.map((message) => message.id));
        const uniqueOlderMessages = olderMessages.filter(
          (message) => !existingIds.has(message.id)
        );
        return [...uniqueOlderMessages, ...currentMessages];
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const currentContainer = messagesContainerRef.current;
          if (!currentContainer) return;

          currentContainer.scrollTop =
            previousScrollTop +
            (currentContainer.scrollHeight - previousScrollHeight);
        });
      });
    } catch (error) {
      console.error('Erro ao carregar mensagens antigas:', error);
    } finally {
      isLoadingOlderRef.current = false;
      setIsLoadingOlder(false);
    }
  }, [
    activeChat,
    createMessagesQuery,
    hasMoreMessages,
    isLoadingMessages,
  ]);

  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (container.scrollTop <= 100) {
      loadOlderMessages();
    }
  }, [loadOlderMessages]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    const channel = supabase
      .channel('public:messages')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            setMessages((prev) => prev.filter((msg) => msg.id !== payload.old.id));
            return;
          }

          if (payload.eventType === 'INSERT') {
            const newMsg = payload.new as Message;
            const currentActive = activeChatRef.current;
            const currentUsers = usersRef.current;
            const isMyMessage = newMsg.sender_id === session.user.id;
            const isForMe = newMsg.receiver_id === session.user.id;

            if (!newMsg.group_id && !isMyMessage && !isForMe) return;

            const chatKey = newMsg.group_id 
              ? `group_${newMsg.group_id}` 
              : (isMyMessage ? `user_${newMsg.receiver_id}` : `user_${newMsg.sender_id}`);

            let previewText = newMsg.content;
            if (newMsg.image_url) previewText = '📷 [Imagem]';
            if (newMsg.audio_url) previewText = '🎤 [Áudio]';

            setLastMessages((prev) => ({ ...prev, [chatKey]: previewText }));
            setLastMessageTimes((prev) => ({ ...prev, [chatKey]: newMsg.created_at || new Date().toISOString() }));

            const isCurrentChat = currentActive && (
              (currentActive.type === 'group' && currentActive.id === newMsg.group_id) ||
              (currentActive.type === 'direct' && (currentActive.id === newMsg.sender_id || currentActive.id === newMsg.receiver_id))
            );

            if (!isMyMessage && (!isCurrentChat || document.hidden)) {
              const sender = currentUsers.find((u) => u.id === newMsg.sender_id);
              triggerNotification(sender?.full_name || 'Nova mensagem', previewText);
            }

            if (isCurrentChat) {
              const container = messagesContainerRef.current;
              const isNearBottom =
                !container ||
                container.scrollHeight - container.scrollTop - container.clientHeight < 150;

              shouldScrollToBottomRef.current = isMyMessage || isNearBottom;

              const profileData = currentUsers.find((u) => u.id === newMsg.sender_id);
              setMessages((prev) => {
                if (prev.some((message) => message.id === newMsg.id)) return prev;

                return [
                  ...prev,
                  {
                    ...newMsg,
                    profiles: profileData
                      ? {
                          full_name: profileData.full_name,
                          avatar_url: profileData.avatar_url,
                        }
                      : undefined,
                  },
                ];
              });
            } else if (!isMyMessage) {
              setUnreadChats((prev) => (prev.includes(chatKey) ? prev : [...prev, chatKey]));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session.user.id, triggerNotification]);

  useEffect(() => {
    if (!shouldScrollToBottomRef.current) return;

    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      shouldScrollToBottomRef.current = false;
    });
  }, [messages]);

 const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);

      // Configurações focadas em Avatars (imagens menores)
      const options = {
        maxSizeMB: 0.5, // Meio megabyte é mais que suficiente para foto de perfil
        maxWidthOrHeight: 512, // Tamanho ideal para exibir no chat e sidebar
        useWebWorker: true,
        fileType: 'image/webp'
      };

      // Comprime o arquivo
      const compressedFile = await imageCompression(file, options);
      
      const fileExt = 'webp';
      const filePath = `avatars/${session.user.id}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(filePath, compressedFile);

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('chat-images')
        .getPublicUrl(filePath);

      const avatarUrl = publicUrlData.publicUrl;

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('id', session.user.id);

      if (updateError) throw updateError;

      setCurrentUser((prev) => (prev ? { ...prev, avatar_url: avatarUrl } : null));
      fetchUsers();
    } catch (err) {
      console.error('Erro ao atualizar foto de perfil:', err);
      alert('Não foi possível atualizar a foto de perfil.');
    } finally {
      setIsUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleUpdateGroupAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeChat || activeChat.type !== 'group') return;

    try {
      setIsUploading(true);

      // Mesma configuração econômica de compressão
      const options = {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 512,
        useWebWorker: true,
        fileType: 'image/webp'
      };

      const compressedFile = await imageCompression(file, options);
      
      const fileExt = 'webp';
      const filePath = `groups/${activeChat.id}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(filePath, compressedFile);

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('chat-images')
        .getPublicUrl(filePath);

      const avatarUrl = publicUrlData.publicUrl;

      const { error: updateError } = await supabase
        .from('groups')
        .update({ avatar_url: avatarUrl })
        .eq('id', activeChat.id);

      if (updateError) throw updateError;

      setActiveChat((prev) => (prev && prev.type === 'group' ? { ...prev, avatar_url: avatarUrl } : prev));
      fetchGroups();
    } catch (err) {
      console.error('Erro ao atualizar foto do grupo:', err);
      alert('Não foi possível atualizar a foto do grupo.');
    } finally {
      setIsUploading(false);
      if (groupAvatarInputRef.current) groupAvatarInputRef.current.value = '';
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim() || selectedUserIds.length === 0) {
      alert('Por favor, informe o nome do grupo e selecione ao menos 1 participante.');
      return;
    }

    try {
      setIsUploading(true);
      let groupAvatarUrl: string | null = null;

      if (groupAvatarFile) {
        const fileExt = groupAvatarFile.name.split('.').pop();
        const filePath = `groups/new_${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('chat-images')
          .upload(filePath, groupAvatarFile);

        if (!uploadError) {
          const { data: publicUrlData } = supabase.storage
            .from('chat-images')
            .getPublicUrl(filePath);
          groupAvatarUrl = publicUrlData.publicUrl;
        }
      }

      const { data: newGroup, error: groupErr } = await supabase
        .from('groups')
        .insert({ 
          name: groupName, 
          created_by: session.user.id,
          avatar_url: groupAvatarUrl 
        })
        .select()
        .single();

      if (groupErr) throw groupErr;

      const membersToInsert = [...selectedUserIds, session.user.id].map((userId) => ({
        group_id: newGroup.id,
        user_id: userId,
      }));

      const { error: membersErr } = await supabase.from('group_members').insert(membersToInsert);
      if (membersErr) throw membersErr;

      setIsModalOpen(false);
      setGroupName('');
      setSelectedUserIds([]);
      setGroupAvatarFile(null);

      const updatedGroups = await fetchGroups();
      await fetchLastMessages(updatedGroups);
      
      setActiveChat({ 
        type: 'group', 
        id: newGroup.id, 
        name: newGroup.name, 
        created_by: newGroup.created_by,
        avatar_url: newGroup.avatar_url 
      });
      setIsMobileChatView(true);
    } catch (err) {
      console.error('Erro ao criar grupo:', err);
      alert('Erro ao criar o grupo.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddMemberToGroup = async (userId: string) => {
    if (!activeChat || activeChat.type !== 'group') return;

    try {
      const { error } = await supabase
        .from('group_members')
        .insert({ group_id: activeChat.id, user_id: userId });

      if (error) throw error;

      await fetchActiveGroupMembers();
    } catch (err: any) {
      console.error('Erro ao adicionar membro:', err);
      alert('Não foi possível adicionar este participante.');
    }
  };

  const handleRemoveMemberFromGroup = async (userId: string) => {
    if (!activeChat || activeChat.type !== 'group') return;

    const confirmRemove = window.confirm('Tem certeza que deseja remover este participante do grupo?');
    if (!confirmRemove) return;

    try {
      const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', activeChat.id)
        .eq('user_id', userId);

      if (error) throw error;

      if (userId === session.user.id) {
        setIsManageMembersOpen(false);
        setActiveChat(null);
        setIsMobileChatView(false);
        fetchGroups();
      } else {
        await fetchActiveGroupMembers();
      }
    } catch (err) {
      console.error('Erro ao remover membro:', err);
      alert('Não foi possível remover este participante.');
    }
  };

  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    const confirmDelete = window.confirm(
      `Tem certeza que deseja excluir o grupo "${groupName}"? Esta ação apagará o grupo e todo o histórico de mensagens para todos os membros.`
    );

    if (!confirmDelete) return;

    try {
      const { error } = await supabase.from('groups').delete().eq('id', groupId);
      if (error) throw error;

      setGroups((prev) => prev.filter((g) => g.id !== groupId));

      if (activeChat?.type === 'group' && activeChat.id === groupId) {
        setActiveChat(null);
        setIsMobileChatView(false);
      }

      alert('Grupo excluído com sucesso!');
    } catch (err) {
      console.error('Erro ao excluir grupo:', err);
      alert('Não foi possível excluir o grupo.');
    }
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeChat) return;

    const textToSend = newMessage;
    setNewMessage('');

    const payload: Partial<Message> = {
      sender_id: session.user.id,
      content: textToSend,
    };

    if (activeChat.type === 'group') {
      payload.group_id = activeChat.id;
    } else {
      payload.receiver_id = activeChat.id;
    }

    const { error } = await supabase.from('messages').insert(payload);
    if (error) console.error('Erro ao enviar mensagem:', error);
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!window.confirm('Tem certeza que deseja apagar esta mensagem?')) return;
    await supabase.from('messages').delete().eq('id', messageId);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeChat) return;

    setIsUploading(true);
    try {
      // 1. Configurações de compressão
      const options = {
        maxSizeMB: 1, // Tamanho máximo desejado (1MB é ótimo para chat)
        maxWidthOrHeight: 1280, // Redimensiona se passar de 1280px
        useWebWorker: true, // Evita travar a interface do usuário
        fileType: 'image/webp' // Converte para webp para economizar ainda mais espaço
      };

      // 2. Comprime o arquivo original
      const compressedFile = await imageCompression(file, options);

      // 3. Prepara o envio com o arquivo comprimido
      const fileExt = 'webp'; // Como forçamos webp, usamos esta extensão
      const filePath = `${session.user.id}/${Date.now()}.${fileExt}`;

      // Faz o upload do arquivo COMPRIMIDO
      await supabase.storage.from('chat-images').upload(filePath, compressedFile);
      const { data: publicUrlData } = supabase.storage.from('chat-images').getPublicUrl(filePath);

      const payload: Partial<Message> = {
        sender_id: session.user.id,
        content: '',
        image_url: publicUrlData.publicUrl,
      };

      if (activeChat.type === 'group') payload.group_id = activeChat.id;
      else payload.receiver_id = activeChat.id;

      await supabase.from('messages').insert(payload);
    } catch (error) {
      console.error('Erro ao comprimir ou enviar imagem:', error);
      alert('Erro ao enviar imagem.');
   } finally {
      setIsUploading(false);
      if (galleryInputRef.current) galleryInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];
        mediaRecorderRef.current = null;

        if (audioBlob.size > 0) {
          await handleAudioUpload(audioBlob);
        } else {
          console.warn('A gravação terminou sem dados de áudio.');
        }

        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Erro ao acessar o microfone:', error);
      alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleAudioUpload = async (audioBlob: Blob) => {
    if (!activeChat || audioBlob.size === 0) return;

    setIsUploading(true);
    try {
      const fileName = `${Math.random()}.webm`;
      const filePath = `${session.user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('chat-audios')
        .upload(filePath, audioBlob);

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('chat-audios')
        .getPublicUrl(filePath);

      if (!publicUrlData?.publicUrl) {
        throw new Error('Não foi possível obter a URL do áudio.');
      }

      const payload: Partial<Message> = {
        sender_id: session.user.id,
        content: '',
        audio_url: publicUrlData.publicUrl,
      };

      if (activeChat.type === 'group') {
        payload.group_id = activeChat.id;
      } else {
        payload.receiver_id = activeChat.id;
      }

      const { error: dbError } = await supabase
        .from('messages')
        .insert(payload);

      if (dbError) throw dbError;
    } catch (error) {
      console.error('Erro ao enviar áudio:', error);
      alert('Erro ao enviar áudio.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSelectChat = (chat: ActiveChat) => {
    setActiveChat(chat);
    if (chat) {
      const chatKey = `${chat.type}_${chat.id}`;
      setUnreadChats((prev) => prev.filter((key) => key !== chatKey));
    }
    setIsMobileChatView(true);
  };

  const sortedGroups = [...groups].sort((a, b) => {
    const timeA = lastMessageTimes[`group_${a.id}`] || '';
    const timeB = lastMessageTimes[`group_${b.id}`] || '';
    return timeB.localeCompare(timeA);
  });

  const usersWithConversation = users
    .filter((user) => lastMessages[`user_${user.id}`] !== undefined)
    .sort((a, b) => {
      const timeA = lastMessageTimes[`user_${a.id}`] || '';
      const timeB = lastMessageTimes[`user_${b.id}`] || '';
      return timeB.localeCompare(timeA);
    });

  const usersWithoutConversation = users
    .filter((user) => lastMessages[`user_${user.id}`] === undefined)
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'pt-BR'));

  const getMessageDateKey = (dateValue: string) => {
    const date = new Date(dateValue);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };

  const formatMessageDate = (dateValue: string) => {
    const messageDate = new Date(dateValue);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (getMessageDateKey(dateValue) === getMessageDateKey(today.toISOString())) {
      return 'Hoje';
    }

    if (getMessageDateKey(dateValue) === getMessageDateKey(yesterday.toISOString())) {
      return 'Ontem';
    }

    const sameYear = messageDate.getFullYear() === today.getFullYear();

    return messageDate.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      ...(sameYear ? {} : { year: 'numeric' }),
    });
  };

  const availableUsersToAdd = users.filter(
    (u) => !activeGroupMembers.some((member) => member.id === u.id)
  );
  const handleDownloadImage = async (url: string, filename: string) => {
    try {
      // Busca o arquivo da URL
      const response = await fetch(url);
      const blob = await response.blob();
      
      // Cria um link temporário para forçar o download
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      
      // Define o nome do arquivo (limpa caracteres especiais)
      const safeName = filename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      link.download = `${safeName}_${Date.now()}.webp`; 
      
      document.body.appendChild(link);
      link.click();
      
      // Limpa os dados temporários
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Erro ao baixar imagem:', error);
      alert('Não foi possível baixar a imagem. Verifique sua conexão.');
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 font-sans overflow-hidden text-slate-100">
      
      {/* Sidebar Neon */}
      <div className={`w-full md:w-1/3 lg:w-1/4 flex-col border-r border-cyan-500/30 bg-slate-900 shadow-[0_0_20px_rgba(6,182,212,0.15)] ${isMobileChatView ? 'hidden md:flex' : 'flex'}`}>
        
        {/* Header Usuário Neon */}
        <div className="flex items-center justify-between bg-slate-900 border-b border-cyan-500/30 p-4 text-cyan-400 shadow-[0_4px_20px_rgba(6,182,212,0.2)]">
          <div className="flex items-center space-x-3 truncate">
            <div className="relative group flex-shrink-0">
              {currentUser?.avatar_url ? (
                <img 
                  src={currentUser.avatar_url} 
                  alt="Perfil" 
                  onClick={() => setPreviewAvatar({ url: currentUser.avatar_url!, name: currentUser.full_name || 'Meu Perfil' })}
                  className="h-10 w-10 rounded-full object-cover border-2 border-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)] cursor-pointer hover:opacity-80 transition"
                  title="Clique para ver a foto maior"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 font-bold border-2 border-emerald-400 text-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]">
                  {session.user.email?.[0].toUpperCase()}
                </div>
              )}
              <button
                onClick={() => avatarInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 bg-slate-800 text-cyan-300 border border-cyan-500/50 p-0.5 rounded-full shadow hover:bg-slate-700 transition text-[10px]"
                title="Alterar Foto de Perfil"
              >
                📷
              </button>
            </div>

            <input 
              type="file" 
              ref={avatarInputRef} 
              accept="image/*" 
              className="hidden" 
              onChange={handleAvatarUpload} 
            />

            <span className="font-semibold text-sm truncate text-slate-200">
              {currentUser?.full_name || session.user.user_metadata?.full_name || session.user.email}
            </span>
          </div>

          <div className="flex items-center gap-2 ml-2">
            <button
              type="button"
              onClick={requestNotificationPermission}
              className={`p-2 rounded-lg border transition text-sm ${
                notificationPermission === 'granted'
                  ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.25)]'
                  : 'bg-slate-800 border-yellow-500/40 text-yellow-400 hover:bg-slate-700'
              }`}
              title={
                notificationPermission === 'granted'
                  ? 'Notificações ativadas'
                  : notificationPermission === 'denied'
                    ? 'Notificações bloqueadas no navegador'
                    : 'Ativar notificações'
              }
            >
              {notificationPermission === 'granted' ? '🔔' : '🔕'}
            </button>

            <button
              onClick={() => supabase.auth.signOut()}
              className="text-xs bg-slate-800 border border-red-500/40 text-red-400 hover:bg-red-950/40 hover:shadow-[0_0_10px_rgba(239,68,68,0.5)] px-2.5 py-1.5 rounded transition font-medium"
            >
              Sair
            </button>
          </div>
        </div>

        {/* Header Grupos */}
        <div className="p-3 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
          <span className="text-xs font-bold text-yellow-400 tracking-wider shadow-[0_0_8px_rgba(250,204,21,0.4)]">GRUPOS</span>
          <button
            onClick={() => setIsModalOpen(true)}
            className="text-xs bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold px-3 py-1 rounded shadow-[0_0_12px_rgba(52,211,153,0.5)] transition flex items-center gap-1"
          >
            <span>+</span> Criar Grupo
          </button>
        </div>

        <div className="grid grid-cols-2 border-b border-cyan-500/30 bg-slate-900/90">
          <button type="button" onClick={() => setSidebarTab('conversas')} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider transition ${sidebarTab === 'conversas' ? 'text-cyan-300 border-b-2 border-cyan-400 bg-cyan-950/30' : 'text-slate-500'}`}>
            Conversas
          </button>
          <button type="button" onClick={() => setSidebarTab('contatos')} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider transition ${sidebarTab === 'contatos' ? 'text-emerald-300 border-b-2 border-emerald-400 bg-emerald-950/20' : 'text-slate-500'}`}>
            Contatos {usersWithoutConversation.length > 0 && <span className="ml-2 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">{usersWithoutConversation.length}</span>}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
          {sidebarTab === 'conversas' ? (
            <>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
          {sortedGroups.length === 0 ? (
            <p className="p-3 text-xs text-slate-500 text-center">Nenhum grupo criado ainda.</p>
          ) : (
            sortedGroups.map((group) => {
              const chatKey = `group_${group.id}`;
              const hasUnread = unreadChats.includes(chatKey);
              const isActive = activeChat?.type === 'group' && activeChat.id === group.id;

              return (
                <div
                  key={group.id}
                  onClick={() => handleSelectChat({ type: 'group', id: group.id, name: group.name, created_by: group.created_by, avatar_url: group.avatar_url ?? undefined })}
                  className={`flex items-center gap-3 p-3.5 cursor-pointer transition hover:bg-slate-800/60 ${
                    isActive ? 'bg-cyan-950/40 border-l-4 border-cyan-400 shadow-[inset_0_0_15px_rgba(6,182,212,0.15)]' : ''
                  }`}
                >
                  {group.avatar_url ? (
                    <img 
                      src={group.avatar_url} 
                      alt={group.name} 
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewAvatar({ url: group.avatar_url!, name: group.name });
                      }}
                      className="h-11 w-11 rounded-full object-cover border border-cyan-500/50 shadow-[0_0_8px_rgba(6,182,212,0.4)] flex-shrink-0 hover:opacity-80 transition"
                      title="Clique para ver a foto maior"
                    />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-cyan-950 text-cyan-400 border border-cyan-500/40 font-bold text-lg flex-shrink-0 shadow-[0_0_8px_rgba(6,182,212,0.3)]">
                      👨‍👩‍👧‍👦
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <h3 className={`text-sm truncate ${hasUnread ? 'font-black text-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.4)]' : 'font-bold text-slate-200'}`}>
                      {group.name}
                    </h3>
                    <p className={`text-xs truncate ${hasUnread ? 'font-bold text-cyan-300' : 'text-slate-400'}`}>
                      {lastMessages[chatKey] || 'Nenhuma mensagem ainda'}
                    </p>
                  </div>
                  {hasUnread && <div className="h-2.5 w-2.5 bg-emerald-400 rounded-full mr-2 shadow-[0_0_10px_rgba(52,211,153,0.9)] animate-pulse"></div>}
                </div>
              );
            })
          )}

          <div className="p-3 bg-slate-900/50 text-xs font-bold text-yellow-400 tracking-wider border-t border-slate-800 shadow-[0_0_8px_rgba(250,204,21,0.4)]">
            CONVERSAS PRIVADAS
          </div>

          {usersWithConversation.map((user) => {
            const chatKey = `user_${user.id}`;
            const hasUnread = unreadChats.includes(chatKey);
            const isActive = activeChat?.type === 'direct' && activeChat.id === user.id;

            return (
              <div
                key={user.id}
                onClick={() => handleSelectChat({ type: 'direct', id: user.id, name: user.full_name, avatar_url: user.avatar_url })}
                className={`flex items-center gap-3 p-3.5 cursor-pointer transition hover:bg-slate-800/60 ${
                  isActive ? 'bg-cyan-950/40 border-l-4 border-cyan-400 shadow-[inset_0_0_15px_rgba(6,182,212,0.15)]' : ''
                }`}
              >
                {user.avatar_url ? (
                  <img 
                    src={user.avatar_url} 
                    alt={user.full_name} 
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewAvatar({ url: user.avatar_url!, name: user.full_name });
                    }}
                    className="h-11 w-11 rounded-full object-cover border border-cyan-500/50 shadow-[0_0_8px_rgba(6,182,212,0.4)] flex-shrink-0 hover:opacity-80 transition"
                    title="Clique para ver a foto maior"
                  />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800 text-cyan-400 border border-cyan-500/30 font-bold text-md flex-shrink-0 shadow-[0_0_8px_rgba(6,182,212,0.3)]">
                    {user.full_name ? user.full_name[0].toUpperCase() : '👤'}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <h3 className={`text-sm truncate ${hasUnread ? 'font-black text-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.4)]' : 'font-semibold text-slate-200'}`}>
                    {user.full_name || 'Familiar'}
                  </h3>
                  <p className={`text-xs truncate ${hasUnread ? 'font-bold text-cyan-300' : 'text-slate-400'}`}>
                    {lastMessages[chatKey] || 'Nenhuma mensagem ainda'}
                  </p>
                </div>
                {hasUnread && <div className="h-2.5 w-2.5 bg-emerald-400 rounded-full mr-2 shadow-[0_0_10px_rgba(52,211,153,0.9)] animate-pulse"></div>}
              </div>
            );
          })}
        </div>
      </div>


            </>
          ) : (
            <>
              <div className="p-4 border-b border-slate-800 bg-slate-900/50">
                <p className="text-xs font-bold text-emerald-300 tracking-wider">CONTATOS</p>
                <p className="mt-1 text-[11px] text-slate-500">Pessoas cadastradas que ainda não possuem conversa.</p>
              </div>
              {usersWithoutConversation.length === 0 ? (
                <p className="p-8 text-center text-xs text-slate-500">Nenhum contato novo.</p>
              ) : (
                {usersWithoutConversation.map((user) => {
            const chatKey = `user_${user.id}`;
            const hasUnread = unreadChats.includes(chatKey);
            const isActive = activeChat?.type === 'direct' && activeChat.id === user.id;

            return (
              <div
                key={user.id}
                onClick={() => handleSelectChat({ type: 'direct', id: user.id, name: user.full_name, avatar_url: user.avatar_url })}
                className={`flex items-center gap-3 p-3.5 cursor-pointer transition hover:bg-slate-800/60 ${
                  isActive ? 'bg-cyan-950/40 border-l-4 border-cyan-400 shadow-[inset_0_0_15px_rgba(6,182,212,0.15)]' : ''
                }`}
              >
                {user.avatar_url ? (
                  <img 
                    src={user.avatar_url} 
                    alt={user.full_name} 
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewAvatar({ url: user.avatar_url!, name: user.full_name });
                    }}
                    className="h-11 w-11 rounded-full object-cover border border-cyan-500/50 shadow-[0_0_8px_rgba(6,182,212,0.4)] flex-shrink-0 hover:opacity-80 transition"
                    title="Clique para ver a foto maior"
                  />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800 text-cyan-400 border border-cyan-500/30 font-bold text-md flex-shrink-0 shadow-[0_0_8px_rgba(6,182,212,0.3)]">
                    {user.full_name ? user.full_name[0].toUpperCase() : '👤'}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <h3 className={`text-sm truncate ${'font-semibold text-slate-200'}`}>
                    {user.full_name || 'Familiar'}
                  </h3>
                  <p className={`text-xs truncate ${'text-slate-500'}`}>
                    {'Novo contato · clique para iniciar conversa'}
                  </p>
                </div>
                {hasUnread && <div className="h-2.5 w-2.5 bg-emerald-400 rounded-full mr-2 shadow-[0_0_10px_rgba(52,211,153,0.9)] animate-pulse"></div>}
              </div>
            );
          })}
        </div>
      </div>


              )}
            </>
          )}
        </div>
      </div>

      {/* Chat Ativo */}
      <div className={`flex-1 flex-col h-full w-full ${isMobileChatView ? 'flex' : 'hidden md:flex'}`}>
        {activeChat ? (
          <>
            <div className="flex items-center justify-between bg-slate-900 border-b border-cyan-500/30 px-4 py-3 text-cyan-400 shadow-[0_4px_20px_rgba(6,182,212,0.2)] z-10">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => setIsMobileChatView(false)}
                  className="md:hidden p-1 hover:bg-slate-800 rounded-full transition text-cyan-400"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </button>

                {activeChat.type === 'group' ? (
                  <div className="relative group flex-shrink-0">
                    {activeChat.avatar_url ? (
                      <img 
                        src={activeChat.avatar_url} 
                        alt={activeChat.name} 
                        onClick={() => setPreviewAvatar({ url: activeChat.avatar_url!, name: activeChat.name })}
                        className="h-9 w-9 rounded-full object-cover border border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.5)] cursor-pointer hover:opacity-80 transition"
                        title="Clique para ver a foto maior"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-cyan-400 border border-cyan-400 font-bold text-sm shadow-[0_0_8px_rgba(6,182,212,0.4)]">
                        👨‍👩‍👧‍👦
                      </div>
                    )}
                    <button
                      onClick={() => groupAvatarInputRef.current?.click()}
                      className="absolute -bottom-1 -right-1 bg-slate-800 text-cyan-300 border border-cyan-500/50 p-0.5 rounded-full shadow hover:bg-slate-700 transition text-[9px]"
                      title="Alterar Foto do Grupo"
                    >
                      📷
                    </button>
                    <input 
                      type="file" 
                      ref={groupAvatarInputRef} 
                      accept="image/*" 
                      className="hidden" 
                      onChange={handleUpdateGroupAvatar} 
                    />
                  </div>
                ) : activeChat.avatar_url ? (
                  <img 
                    src={activeChat.avatar_url} 
                    alt={activeChat.name} 
                    onClick={() => setPreviewAvatar({ url: activeChat.avatar_url!, name: activeChat.name })}
                    className="h-9 w-9 rounded-full object-cover border border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.5)] cursor-pointer hover:opacity-80 transition"
                    title="Clique para ver a foto maior"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-cyan-400 border border-cyan-400 font-bold text-sm shadow-[0_0_8px_rgba(6,182,212,0.4)]">
                    {activeChat.name?.[0]?.toUpperCase() || '👤'}
                  </div>
                )}

                <div className="truncate">
                  <h1 className="text-base font-bold truncate text-slate-100">{activeChat.name}</h1>
                  <p className="text-xs text-cyan-300">
                    {activeChat.type === 'group' ? `${activeGroupMembers.length} participantes` : 'Conversa Privada'}
                  </p>
                </div>
              </div>

              {activeChat.type === 'group' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsManageMembersOpen(true)}
                    className="p-2 hover:bg-slate-800 rounded-lg transition text-cyan-300 flex items-center gap-1 text-xs font-medium bg-slate-800/80 border border-cyan-500/30 shadow-[0_0_8px_rgba(6,182,212,0.2)]"
                    title="Gerenciar Membros do Grupo"
                  >
                    <span>👥</span>
                    <span>Membros</span>
                  </button>

                  <button
                    onClick={() => handleDeleteGroup(activeChat.id, activeChat.name)}
                    className="p-2 hover:bg-slate-800 rounded-lg transition text-red-400 hover:text-red-300 flex items-center gap-1 text-xs font-medium border border-red-500/30"
                    title="Excluir este grupo"
                  >
                    <span>🗑️</span>
                  </button>
                </div>
              )}
            </div>

            {/* Mensagens com Marca d'água Neon da Bandeira Brasileira */}
            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950 relative"
            >
              {/* Marca d'água incorporada */}
              <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-0">
  <img 
    src="/logo.png"
    alt="Marca d'água" 
    className="w-[380px] md:w-[500px] h-auto object-contain opacity-[0.6] filter drop-shadow-[0_0_20px_rgba(34,197,94,0.4)]"
  />
</div>
              {/* Listagem de Mensagens */}
              <div className="relative z-10 space-y-3">
                {isLoadingOlder && (
                  <div className="flex justify-center py-3">
                    <span className="text-xs text-cyan-400 animate-pulse">
                      Carregando mensagens antigas...
                    </span>
                  </div>
                )}

                {!hasMoreMessages && !isLoadingMessages && messages.length > 0 && (
                  <div className="text-center py-2 text-xs text-slate-600">
                    Início da conversa
                  </div>
                )}

                {isLoadingMessages && messages.length === 0 && (
                  <div className="text-center py-8 text-sm text-cyan-400 animate-pulse">
                    Carregando mensagens...
                  </div>
                )}

                {messages.map((msg, index) => {
                  const isMe = msg.sender_id === session.user.id;
                  const date = new Date(msg.created_at).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  const previousMessage = messages[index - 1];
                  const showDateSeparator =
                    !previousMessage ||
                    getMessageDateKey(previousMessage.created_at) !==
                      getMessageDateKey(msg.created_at);

                  return (
                    <React.Fragment key={msg.id}>
                      {showDateSeparator && (
                        <div className="sticky top-2 z-20 flex justify-center py-2 pointer-events-none">
                          <span className="rounded-full border border-cyan-500/30 bg-slate-900/95 px-3 py-1 text-[11px] font-semibold text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.18)] backdrop-blur-md">
                            {formatMessageDate(msg.created_at)}
                          </span>
                        </div>
                      )}

                      <div className={`flex flex-col group ${isMe ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-end gap-2 max-w-[85%] md:max-w-[75%]">
                        {!isMe && msg.profiles?.avatar_url && (
                          <img 
                            src={msg.profiles.avatar_url} 
                            alt="Avatar" 
                            onClick={() => setPreviewAvatar({ url: msg.profiles!.avatar_url!, name: msg.profiles!.full_name })}
                            className="h-7 w-7 rounded-full object-cover mb-1 border border-cyan-500/40 cursor-pointer hover:opacity-80 transition" 
                            title="Clique para ver a foto maior"
                          />
                        )}

                        {isMe && (
                          <button
                            onClick={() => handleDeleteMessage(msg.id)}
                            className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition p-1 hidden md:block"
                            title="Apagar"
                          >
                            🗑️
                          </button>
                        )}

                        <div className={`rounded-xl px-3.5 py-2 shadow-lg text-sm relative border ${
                          isMe 
                            ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.15)]' 
                            : 'bg-slate-900/90 border-cyan-500/30 text-slate-200 shadow-[0_0_12px_rgba(6,182,212,0.1)]'
                        }`}>
                          {isMe && (
                            <button
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="absolute -top-2 -left-2 bg-slate-900 border border-red-500/40 text-red-400 rounded-full w-5 h-5 flex items-center justify-center text-[10px] md:hidden shadow"
                            >
                              🗑️
                            </button>
                          )}

                          {!isMe && activeChat.type === 'group' && (
                            <p className="text-[11px] font-bold text-yellow-400 mb-0.5 shadow-[0_0_4px_rgba(250,204,21,0.3)]">
                              {msg.profiles?.full_name || 'Familiar'}
                            </p>
                          )}

                         {msg.image_url && (
    <img 
      src={msg.image_url} 
      alt="imagem" 
      onClick={() => setPreviewAvatar({ 
        url: msg.image_url!, 
        name: `Foto enviada por ${isMe ? 'Você' : (msg.profiles?.full_name || 'Familiar')}` 
      })}
      className="max-h-60 rounded-md mb-1 cursor-pointer hover:opacity-90 border border-slate-700" 
    />
  )}

                          {msg.audio_url && (
                            <audio controls className="h-9 mt-1 mb-1 w-[200px] accent-emerald-400">
                              <source src={msg.audio_url} type="audio/webm" />
                            </audio>
                          )}

                          {msg.content && <p className="break-words">{msg.content}</p>}
                          <span className="block text-[10px] text-slate-400 text-right mt-1">{date}</span>
                        </div>
                      </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </div>

      {/* Input de Mensagem Neon */}
            <div className="flex items-center gap-2 bg-slate-900 p-3 border-t border-cyan-500/30 shadow-[0_-4px_20px_rgba(6,182,212,0.1)] relative z-10">
              
              {/* Menu e Botões de Imagem */}
              <div className="relative flex items-center">
                {showImageMenu && (
                  <div className="absolute bottom-full left-0 mb-3 bg-slate-900 border border-cyan-500/50 rounded-xl shadow-[0_0_20px_rgba(6,182,212,0.4)] p-2 flex flex-col gap-1.5 z-50 min-w-[130px]">
                    <button
                      type="button"
                      onClick={() => {
                        cameraInputRef.current?.click();
                        setShowImageMenu(false);
                      }}
                      className="flex items-center gap-2 text-sm text-cyan-300 hover:bg-slate-800 p-2 rounded-lg transition text-left font-medium"
                    >
                      <span>📸</span> Câmera
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        galleryInputRef.current?.click();
                        setShowImageMenu(false);
                      }}
                      className="flex items-center gap-2 text-sm text-cyan-300 hover:bg-slate-800 p-2 rounded-lg transition text-left font-medium"
                    >
                      <span>🖼️</span> Galeria
                    </button>
                  </div>
                )}

                {/* Input para Galeria */}
                <input type="file" accept="image/*" ref={galleryInputRef} className="hidden" onChange={handleImageUpload} />
                
                {/* Input para Câmera Direta (capture="environment" abre a câmera no celular) */}
                <input type="file" accept="image/*" capture="environment" ref={cameraInputRef} className="hidden" onChange={handleImageUpload} />

                <button
                  type="button"
                  onClick={() => setShowImageMenu(!showImageMenu)}
                  disabled={isUploading || isRecording}
                  className={`p-2.5 rounded-full transition border border-cyan-500/30 shadow-[0_0_8px_rgba(6,182,212,0.2)] ${showImageMenu ? 'bg-cyan-900 text-cyan-200' : 'text-cyan-400 hover:bg-slate-800'}`}
                  title="Anexar"
                >
                  ➕
                </button>
              </div>
              <form onSubmit={handleSendMessage} className="flex flex-1 gap-2">
                <input
                  type="text"
                  value={isRecording ? 'Gravando áudio...' : newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  disabled={isRecording}
                  placeholder="Digite sua mensagem futurista..."
                  className="flex-1 rounded-full border border-cyan-500/40 bg-slate-950 px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_12px_rgba(6,182,212,0.4)] transition"
                />

                {newMessage.trim() ? (
                  <button type="submit" className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold p-2.5 rounded-full shadow-[0_0_12px_rgba(52,211,153,0.6)] transition">
                    ➤
                  </button>
                ) : (
                  <button
                    type="button"
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onTouchStart={startRecording}
                    onTouchEnd={stopRecording}
                    disabled={isUploading}
                    aria-label={isRecording ? 'Solte para enviar o áudio' : 'Segure para gravar áudio'}
                    className={`p-2.5 rounded-full text-slate-950 select-none touch-none transition-all ${
                      isRecording 
                        ? 'bg-red-500 text-white animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.9)]' 
                        : 'bg-emerald-400 hover:bg-emerald-300 font-bold shadow-[0_0_12px_rgba(52,211,153,0.6)]'
                    } ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title="Segure para gravar áudio"
                  >
                    🎤
                  </button>
                )}
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500 bg-slate-950">
            Selecione uma conversa ou crie um grupo para começar.
          </div>
        )}
      </div>

      {/* Notificação visual interna */}
      {chatNotification && (
        <button
          type="button"
          onClick={() => setChatNotification(null)}
          className="fixed top-4 right-4 z-[70] w-[calc(100%-2rem)] max-w-sm rounded-xl border border-cyan-400/50 bg-slate-900/95 p-4 text-left shadow-[0_0_25px_rgba(6,182,212,0.35)] backdrop-blur-md animate-pulse"
          title="Fechar notificação"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-emerald-400/50 bg-emerald-950 text-lg shadow-[0_0_10px_rgba(52,211,153,0.35)]">
              🔔
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-cyan-300">
                {chatNotification.senderName}
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-slate-300">
                {chatNotification.text}
              </p>
            </div>
            <span className="text-xs text-slate-500">✕</span>
          </div>
        </button>
      )}

      {/* Modal Foto de Perfil */}
 {/* Modal Visualizador de Imagem (Galeria) */}
      {previewAvatar && (
        <div 
          className="fixed inset-0 bg-black/95 z-[100] flex flex-col items-center justify-center p-4 cursor-pointer backdrop-blur-md"
          onClick={() => setPreviewAvatar(null)}
        >
          {/* Barra superior de ações */}
          <div className="absolute top-4 right-4 flex items-center gap-3 z-50">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadImage(previewAvatar.url, previewAvatar.name);
              }}
              className="flex items-center justify-center h-10 w-10 bg-slate-800/60 hover:bg-slate-700 text-white rounded-full transition shadow-lg border border-slate-600/50"
              title="Baixar imagem"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
              </svg>
            </button>
            
            <button
              onClick={() => setPreviewAvatar(null)}
              className="flex items-center justify-center h-10 w-10 bg-slate-800/60 hover:bg-red-500/80 text-white rounded-full transition shadow-lg border border-slate-600/50"
              title="Fechar"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          {/* Container da Imagem */}
          <div 
            className="relative w-full max-w-5xl flex flex-col items-center justify-center cursor-default h-full"
            onClick={(e) => e.stopPropagation()} // Evita fechar ao clicar na imagem
          >
            <img
              src={previewAvatar.url}
              alt={previewAvatar.name}
              className="max-h-[85vh] w-auto max-w-full object-contain rounded-md shadow-2xl"
            />
            
            {/* Título/Info da Imagem */}
            <div className="mt-6 px-4 py-2 bg-slate-900/80 border border-slate-700/50 rounded-full text-slate-200 text-sm font-medium shadow-lg text-center truncate max-w-xs md:max-w-md">
              {previewAvatar.name}
            </div>
          </div>
        </div>
      )}

      {/* Modal Criar Grupo */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-xl shadow-[0_0_25px_rgba(6,182,212,0.25)] w-full max-w-md p-5 text-slate-100">
            <h2 className="text-lg font-bold text-yellow-400 mb-4 shadow-[0_0_6px_rgba(250,204,21,0.3)]">Criar Novo Grupo</h2>
            
            <form onSubmit={handleCreateGroup}>
              <div className="mb-4">
                <label className="block text-xs font-semibold text-cyan-300 mb-1">Nome do Grupo</label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Ex: Almoço de Domingo, Viagem..."
                  className="w-full border border-cyan-500/40 bg-slate-950 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(6,182,212,0.3)]"
                  required
                />
              </div>

              <div className="mb-4">
                <label className="block text-xs font-semibold text-cyan-300 mb-1">Foto do Grupo (Opcional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setGroupAvatarFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-cyan-950 file:text-cyan-300 hover:file:bg-cyan-900 border border-slate-800 rounded bg-slate-950"
                />
              </div>

              <div className="mb-4">
                <label className="block text-xs font-semibold text-cyan-300 mb-2">Selecione os Participantes</label>
                <div className="max-h-48 overflow-y-auto border border-slate-800 rounded p-2 space-y-2 bg-slate-950">
                  {users.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:bg-slate-900 p-1.5 rounded transition">
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(u.id)}
                        onChange={() => toggleUserSelection(u.id)}
                        className="rounded bg-slate-900 border-cyan-500 text-emerald-500 focus:ring-emerald-400"
                      />
                      {u.avatar_url && (
                        <img src={u.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover border border-cyan-500/30" />
                      )}
                      <span>{u.full_name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setGroupAvatarFile(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-800 rounded transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-4 py-2 text-xs font-bold bg-emerald-500 text-slate-950 rounded hover:bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)] disabled:opacity-50 transition"
                >
                  {isUploading ? 'Criando...' : 'Criar Grupo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Gerenciar Membros */}
      {isManageMembersOpen && activeChat?.type === 'group' && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-xl shadow-[0_0_25px_rgba(6,182,212,0.25)] w-full max-w-md p-5 flex flex-col max-h-[85vh] text-slate-100">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold text-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.3)]">Participantes do Grupo</h2>
              <button
                onClick={() => setIsManageMembersOpen(false)}
                className="text-slate-400 hover:text-white text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 pr-1">
              <div>
                <h3 className="text-xs font-bold text-cyan-400 tracking-wider uppercase mb-2">
                  Integrantes Atuais ({activeGroupMembers.length})
                </h3>
                {activeGroupMembers.length === 0 ? (
                  <p className="text-xs text-slate-500 italic p-2 border border-slate-800 rounded bg-slate-950 text-center">
                    Nenhum integrante encontrado.
                  </p>
                ) : (
                  <div className="space-y-2 border border-slate-800 rounded p-2 bg-slate-950">
                    {activeGroupMembers.map((member) => (
                      <div key={member.id} className="flex items-center justify-between p-1.5 bg-slate-900 border border-slate-800 rounded shadow-sm">
                        <div className="flex items-center gap-2 truncate">
                          {member.avatar_url ? (
                            <img src={member.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover border border-cyan-500/40" />
                          ) : (
                            <div className="h-7 w-7 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-500/40 flex items-center justify-center font-bold text-xs">
                              {member.full_name?.[0]?.toUpperCase() || '👤'}
                            </div>
                          )}
                          <span className="text-sm font-medium text-slate-200 truncate">
                            {member.full_name} {member.id === session.user.id && '(Você)'}
                          </span>
                        </div>

                        <button
                          onClick={() => handleRemoveMemberFromGroup(member.id)}
                          className="text-xs text-red-400 hover:bg-red-950/40 px-2 py-1 rounded border border-red-500/30 transition font-medium"
                        >
                          {member.id === session.user.id ? 'Sair' : 'Remover'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-bold text-cyan-400 tracking-wider uppercase mb-2">Adicionar ao Grupo</h3>
                {availableUsersToAdd.length === 0 ? (
                  <p className="text-xs text-slate-500 italic p-2 border border-slate-800 rounded bg-slate-950 text-center">
                    Todos os contatos já estão no grupo.
                  </p>
                ) : (
                  <div className="space-y-2 border border-slate-800 rounded p-2 bg-slate-950 max-h-40 overflow-y-auto">
                    {availableUsersToAdd.map((user) => (
                      <div key={user.id} className="flex items-center justify-between p-1.5 bg-slate-900 border border-slate-800 rounded shadow-sm">
                        <div className="flex items-center gap-2 truncate">
                          {user.avatar_url ? (
                            <img src={user.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover border border-cyan-500/40" />
                          ) : (
                            <div className="h-7 w-7 rounded-full bg-slate-800 text-cyan-400 border border-cyan-500/30 flex items-center justify-center font-bold text-xs">
                              {user.full_name?.[0]?.toUpperCase() || '👤'}
                            </div>
                          )}
                          <span className="text-sm text-slate-200 truncate">{user.full_name}</span>
                        </div>

                        <button
                           onClick={() => handleAddMemberToGroup(user.id)}
                          className="text-xs bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 px-2.5 py-1 rounded transition shadow-[0_0_8px_rgba(52,211,153,0.4)]"
                        >
                          + Adicionar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setIsManageMembersOpen(false)}
                className="px-4 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 rounded transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
