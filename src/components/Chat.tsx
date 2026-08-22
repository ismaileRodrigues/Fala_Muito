import React, { useEffect, useState, useRef, useCallback } from 'react';
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

  // Referências para controle de áudio e tempo
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const isHoldingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const recordingMimeTypeRef = useRef('audio/webm');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

  }, [fetchMyProfile, fetchUsers, fetchGroups, fetchLastMessages]);

  // O stream só deve ser encerrado quando o componente for desmontado.
  // Não o encerre quando dados de grupos/perfil forem atualizados.
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (activeChat?.type === 'group') {
      fetchActiveGroupMembers();
    }
  }, [activeChat, fetchActiveGroupMembers]);

  const triggerNotification = useCallback((senderName: string, text: string) => {
    try {
      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
      audio.volume = 0.5;
      audio.play().catch(() => {});
    } catch (e) {
      console.error('Erro som:', e);
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(senderName, { body: text, icon: '/favicon.ico' });
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!activeChat) {
      setMessages([]);
      return;
    }

    let query = supabase.from('messages').select('*, profiles(full_name, avatar_url)');

    if (activeChat.type === 'group') {
      query = query.eq('group_id', activeChat.id);
    } else {
      query = query.or(
        `and(sender_id.eq.${session.user.id},receiver_id.eq.${activeChat.id}),and(sender_id.eq.${activeChat.id},receiver_id.eq.${session.user.id})`
      );
    }

    const { data, error } = await query.order('created_at', { ascending: true });

    if (error) console.error('Erro ao buscar mensagens:', error);
    else if (data) setMessages(data as Message[]);
  }, [activeChat, session.user.id]);

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
              const profileData = currentUsers.find((u) => u.id === newMsg.sender_id);
              setMessages((prev) => [
                ...prev,
                { 
                  ...newMsg, 
                  profiles: profileData ? { full_name: profileData.full_name, avatar_url: profileData.avatar_url } : undefined 
                },
              ]);
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
    scrollToBottom();
  }, [messages]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const fileExt = file.name.split('.').pop();
      const filePath = `avatars/${session.user.id}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(filePath, file);

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
      const fileExt = file.name.split('.').pop();
      const filePath = `groups/${activeChat.id}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(filePath, file);

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
      const fileExt = file.name.split('.').pop();
      const filePath = `${session.user.id}/${Date.now()}.${fileExt}`;

      await supabase.storage.from('chat-images').upload(filePath, file);
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
      alert('Erro ao enviar imagem.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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

        // Pare o microfone somente depois de o MediaRecorder finalizar o Blob.
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
      // O onstop encerra os tracks depois que o Blob for montado.
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

  const sortedUsers = [...users].sort((a, b) => {
    const timeA = lastMessageTimes[`user_${a.id}`] || '';
    const timeB = lastMessageTimes[`user_${b.id}`] || '';
    return timeB.localeCompare(timeA);
  });

  const availableUsersToAdd = users.filter(
    (u) => !activeGroupMembers.some((member) => member.id === u.id)
  );

  return (
    <div className="flex h-screen bg-[#E5DDD5] font-sans overflow-hidden">
      
      {/* Sidebar */}
      <div className={`w-full md:w-1/3 lg:w-1/4 flex-col border-r border-gray-300 bg-white ${isMobileChatView ? 'hidden md:flex' : 'flex'}`}>
        
        {/* Header Usuário */}
        <div className="flex items-center justify-between bg-[#008069] p-4 text-white">
          <div className="flex items-center space-x-3 truncate">
            <div className="relative group flex-shrink-0">
              {currentUser?.avatar_url ? (
                <img 
                  src={currentUser.avatar_url} 
                  alt="Perfil" 
                  onClick={() => setPreviewAvatar({ url: currentUser.avatar_url!, name: currentUser.full_name || 'Meu Perfil' })}
                  className="h-10 w-10 rounded-full object-cover border border-teal-300 cursor-pointer hover:opacity-80 transition"
                  title="Clique para ver a foto maior"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-800 font-bold border border-teal-400">
                  {session.user.email?.[0].toUpperCase()}
                </div>
              )}
              <button
                onClick={() => avatarInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 bg-white text-gray-700 p-0.5 rounded-full shadow hover:bg-gray-200 transition text-[10px]"
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

            <span className="font-semibold text-sm truncate">
              {currentUser?.full_name || session.user.user_metadata?.full_name || session.user.email}
            </span>
          </div>

          <button
            onClick={() => supabase.auth.signOut()}
            className="text-xs bg-teal-800 hover:bg-teal-900 px-2.5 py-1.5 rounded transition ml-2"
          >
            Sair
          </button>
        </div>

        {/* Header Grupos */}
        <div className="p-3 border-b bg-gray-50 flex justify-between items-center">
          <span className="text-xs font-bold text-gray-500 uppercase">Grupos</span>
          <button
            onClick={() => setIsModalOpen(true)}
            className="text-xs bg-[#008069] hover:bg-[#006e5a] text-white font-semibold px-2.5 py-1 rounded shadow transition flex items-center gap-1"
          >
            <span>+</span> Criar Grupo
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sortedGroups.length === 0 ? (
            <p className="p-3 text-xs text-gray-400 text-center">Nenhum grupo criado ainda.</p>
          ) : (
            sortedGroups.map((group) => {
              const chatKey = `group_${group.id}`;
              const hasUnread = unreadChats.includes(chatKey);
              const isActive = activeChat?.type === 'group' && activeChat.id === group.id;

              return (
                <div
                  key={group.id}
                  onClick={() => handleSelectChat({ type: 'group', id: group.id, name: group.name, created_by: group.created_by, avatar_url: group.avatar_url ?? undefined })}
                  className={`flex items-center gap-3 p-3.5 cursor-pointer border-b hover:bg-gray-100 transition ${
                    isActive ? 'bg-gray-200' : ''
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
                      className="h-11 w-11 rounded-full object-cover border flex-shrink-0 hover:opacity-80 transition"
                      title="Clique para ver a foto maior"
                    />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-teal-600 text-white font-bold text-lg flex-shrink-0">
                      👨‍👩‍👧‍👦
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <h3 className={`text-sm truncate ${hasUnread ? 'font-black text-[#008069]' : 'font-bold text-gray-800'}`}>
                      {group.name}
                    </h3>
                    <p className={`text-xs truncate ${hasUnread ? 'font-bold text-gray-900' : 'text-gray-500'}`}>
                      {lastMessages[chatKey] || 'Nenhuma mensagem ainda'}
                    </p>
                  </div>
                  {hasUnread && <div className="h-2.5 w-2.5 bg-[#25D366] rounded-full mr-2"></div>}
                </div>
              );
            })
          )}

          <div className="p-3 bg-gray-50 text-xs font-bold text-gray-500 uppercase border-t">
            Conversas Privadas
          </div>

          {sortedUsers.map((user) => {
            const chatKey = `user_${user.id}`;
            const hasUnread = unreadChats.includes(chatKey);
            const isActive = activeChat?.type === 'direct' && activeChat.id === user.id;

            return (
              <div
                key={user.id}
                onClick={() => handleSelectChat({ type: 'direct', id: user.id, name: user.full_name, avatar_url: user.avatar_url })}
                className={`flex items-center gap-3 p-3.5 cursor-pointer border-b hover:bg-gray-100 transition ${
                  isActive ? 'bg-gray-200' : ''
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
                    className="h-11 w-11 rounded-full object-cover border flex-shrink-0 hover:opacity-80 transition"
                    title="Clique para ver a foto maior"
                  />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-400 text-white font-bold text-md flex-shrink-0">
                    {user.full_name ? user.full_name[0].toUpperCase() : '👤'}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <h3 className={`text-sm truncate ${hasUnread ? 'font-black text-[#008069]' : 'font-semibold text-gray-800'}`}>
                    {user.full_name || 'Familiar'}
                  </h3>
                  <p className={`text-xs truncate ${hasUnread ? 'font-bold text-gray-900' : 'text-gray-500'}`}>
                    {lastMessages[chatKey] || 'Nenhuma mensagem ainda'}
                  </p>
                </div>
                {hasUnread && <div className="h-2.5 w-2.5 bg-[#25D366] rounded-full mr-2"></div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Chat Ativo */}
      <div className={`flex-1 flex-col h-full w-full ${isMobileChatView ? 'flex' : 'hidden md:flex'}`}>
        {activeChat ? (
          <>
            <div className="flex items-center justify-between bg-[#008069] px-4 py-3 text-white shadow-md z-10">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => setIsMobileChatView(false)}
                  className="md:hidden p-1 hover:bg-teal-700 rounded-full transition"
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
                        className="h-9 w-9 rounded-full object-cover border border-teal-200 cursor-pointer hover:opacity-80 transition"
                        title="Clique para ver a foto maior"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-800 text-white font-bold text-sm">
                        👨‍👩‍👧‍👦
                      </div>
                    )}
                    <button
                      onClick={() => groupAvatarInputRef.current?.click()}
                      className="absolute -bottom-1 -right-1 bg-white text-gray-700 p-0.5 rounded-full shadow hover:bg-gray-200 transition text-[9px]"
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
                    className="h-9 w-9 rounded-full object-cover border border-teal-200 cursor-pointer hover:opacity-80 transition"
                    title="Clique para ver a foto maior"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-800 font-bold text-sm">
                    {activeChat.name?.[0]?.toUpperCase() || '👤'}
                  </div>
                )}

                <div className="truncate">
                  <h1 className="text-base font-bold truncate">{activeChat.name}</h1>
                  <p className="text-xs text-teal-100">
                    {activeChat.type === 'group' ? `${activeGroupMembers.length} participantes` : 'Conversa Privada'}
                  </p>
                </div>
              </div>

              {activeChat.type === 'group' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsManageMembersOpen(true)}
                    className="p-2 hover:bg-teal-700 rounded-lg transition text-teal-100 flex items-center gap-1 text-xs font-medium bg-teal-800/50"
                    title="Gerenciar Membros do Grupo"
                  >
                    <span>👥</span>
                    <span>Membros</span>
                  </button>

                  <button
                    onClick={() => handleDeleteGroup(activeChat.id, activeChat.name)}
                    className="p-2 hover:bg-teal-700 rounded-lg transition text-teal-100 hover:text-red-300 flex items-center gap-1 text-xs font-medium"
                    title="Excluir este grupo"
                  >
                    <span>🗑️</span>
                  </button>
                </div>
              )}
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#E5DDD5]">
              {messages.map((msg) => {
                const isMe = msg.sender_id === session.user.id;
                const date = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                return (
                  <div key={msg.id} className={`flex flex-col group ${isMe ? 'items-end' : 'items-start'}`}>
                    <div className="flex items-end gap-2 max-w-[85%] md:max-w-[75%]">
                      {!isMe && msg.profiles?.avatar_url && (
                        <img 
                          src={msg.profiles.avatar_url} 
                          alt="Avatar" 
                          onClick={() => setPreviewAvatar({ url: msg.profiles!.avatar_url!, name: msg.profiles!.full_name })}
                          className="h-7 w-7 rounded-full object-cover mb-1 cursor-pointer hover:opacity-80 transition" 
                          title="Clique para ver a foto maior"
                        />
                      )}

                      {isMe && (
                        <button
                          onClick={() => handleDeleteMessage(msg.id)}
                          className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition p-1 hidden md:block"
                          title="Apagar"
                        >
                          🗑️
                        </button>
                      )}

                      <div className={`rounded-lg px-3 py-1.5 shadow text-sm relative ${isMe ? 'bg-[#D9FDD3]' : 'bg-white'}`}>
                        {isMe && (
                          <button
                            onClick={() => handleDeleteMessage(msg.id)}
                            className="absolute -top-2 -left-2 bg-white border rounded-full w-5 h-5 flex items-center justify-center text-[10px] md:hidden"
                          >
                            🗑️
                          </button>
                        )}

                        {!isMe && activeChat.type === 'group' && (
                          <p className="text-[11px] font-bold text-teal-700 mb-0.5">
                            {msg.profiles?.full_name || 'Familiar'}
                          </p>
                        )}

                        {msg.image_url && (
                          <a href={msg.image_url} target="_blank" rel="noopener noreferrer">
                            <img src={msg.image_url} alt="imagem" className="max-h-60 rounded-md mb-1 cursor-pointer hover:opacity-90" />
                          </a>
                        )}

                        {msg.audio_url && (
                          <audio controls className="h-9 mt-1 mb-1 w-[200px]">
                            <source src={msg.audio_url} type="audio/webm" />
                          </audio>
                        )}

                        {msg.content && <p className="break-words">{msg.content}</p>}
                        <span className="block text-[10px] text-gray-500 text-right mt-0.5">{date}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input de Mensagem com Botão de Microfone Corrigido via Pointer Events */}
            <div className="flex items-center gap-2 bg-[#F0F2F5] p-3 border-t border-gray-200">
              <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleImageUpload} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || isRecording}
                className="p-2 text-gray-500 hover:bg-gray-200 rounded-full"
              >
                📷
              </button>

              <form onSubmit={handleSendMessage} className="flex flex-1 gap-2">
                <input
                  type="text"
                  value={isRecording ? 'Gravando áudio...' : newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  disabled={isRecording}
                  placeholder="Mensagem..."
                  className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm focus:outline-none"
                />

                {newMessage.trim() ? (
                  <button type="submit" className="bg-[#008069] text-white p-2 rounded-full">
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
                    className={`p-2 rounded-full text-white select-none touch-none transition-colors ${
                      isRecording ? 'bg-red-500 animate-pulse' : 'bg-[#008069]'
                    } ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    🎤
                  </button>
                )}
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Selecione uma conversa ou crie um grupo para começar.
          </div>
        )}
      </div>

      {/* Modal Foto de Perfil */}
      {previewAvatar && (
        <div 
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setPreviewAvatar(null)}
        >
          <div 
            className="relative max-w-lg w-full bg-gray-900 rounded-2xl overflow-hidden shadow-2xl flex flex-col items-center p-4 cursor-default border border-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full flex justify-between items-center mb-3 px-1">
              <span className="font-semibold text-white text-sm truncate">{previewAvatar.name}</span>
              <button
                onClick={() => setPreviewAvatar(null)}
                className="text-gray-400 hover:text-white text-2xl font-bold leading-none p-1 transition"
              >
                &times;
              </button>
            </div>

            <div className="w-full flex items-center justify-center overflow-hidden rounded-xl bg-black max-h-[75vh]">
              <img
                src={previewAvatar.url}
                alt={previewAvatar.name}
                className="max-h-[70vh] w-auto max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal Criar Grupo */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Criar Novo Grupo</h2>
            
            <form onSubmit={handleCreateGroup}>
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Nome do Grupo</label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Ex: Almoço de Domingo, Viagem..."
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-teal-600"
                  required
                />
              </div>

              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Foto do Grupo (Opcional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setGroupAvatarFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"
                />
              </div>

              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-600 mb-2">Selecione os Participantes</label>
                <div className="max-h-48 overflow-y-auto border rounded p-2 space-y-2 bg-gray-50">
                  {users.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 hover:bg-gray-100 p-1.5 rounded">
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(u.id)}
                        onChange={() => toggleUserSelection(u.id)}
                        className="rounded text-teal-600 focus:ring-teal-500"
                      />
                      {u.avatar_url && (
                        <img src={u.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
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
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-4 py-2 text-xs font-semibold bg-[#008069] text-white rounded hover:bg-[#006e5a] disabled:opacity-50"
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold text-gray-800">Participantes do Grupo</h2>
              <button
                onClick={() => setIsManageMembersOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 pr-1">
              {/* Integrantes Atuais */}
              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">
                  Integrantes Atuais ({activeGroupMembers.length})
                </h3>
                {activeGroupMembers.length === 0 ? (
                  <p className="text-xs text-gray-400 italic p-2 border rounded bg-gray-50 text-center">
                    Nenhum integrante encontrado.
                  </p>
                ) : (
                  <div className="space-y-2 border rounded p-2 bg-gray-50">
                    {activeGroupMembers.map((member) => (
                      <div key={member.id} className="flex items-center justify-between p-1.5 bg-white rounded shadow-sm">
                        <div className="flex items-center gap-2 truncate">
                          {member.avatar_url ? (
                            <img src={member.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                          ) : (
                            <div className="h-7 w-7 rounded-full bg-teal-600 text-white flex items-center justify-center font-bold text-xs">
                              {member.full_name?.[0]?.toUpperCase() || '👤'}
                            </div>
                          )}
                          <span className="text-sm font-medium text-gray-800 truncate">
                            {member.full_name} {member.id === session.user.id && '(Você)'}
                          </span>
                        </div>

                        <button
                          onClick={() => handleRemoveMemberFromGroup(member.id)}
                          className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded border border-red-200 transition font-medium"
                        >
                          {member.id === session.user.id ? 'Sair' : 'Remover'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Adicionar ao Grupo */}
              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Adicionar ao Grupo</h3>
                {availableUsersToAdd.length === 0 ? (
                  <p className="text-xs text-gray-400 italic p-2 border rounded bg-gray-50 text-center">
                    Todos os contatos já estão no grupo.
                  </p>
                ) : (
                  <div className="space-y-2 border rounded p-2 bg-gray-50 max-h-40 overflow-y-auto">
                    {availableUsersToAdd.map((user) => (
                      <div key={user.id} className="flex items-center justify-between p-1.5 bg-white rounded shadow-sm">
                        <div className="flex items-center gap-2 truncate">
                          {user.avatar_url ? (
                            <img src={user.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                          ) : (
                            <div className="h-7 w-7 rounded-full bg-gray-400 text-white flex items-center justify-center font-bold text-xs">
                              {user.full_name?.[0]?.toUpperCase() || '👤'}
                            </div>
                          )}
                          <span className="text-sm text-gray-800 truncate">{user.full_name}</span>
                        </div>

                        <button
                          onClick={() => handleAddMemberToGroup(user.id)}
                          className="text-xs bg-[#008069] text-white hover:bg-[#006e5a] px-2.5 py-1 rounded transition font-medium"
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
                className="px-4 py-1.5 text-xs font-semibold bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition"
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
