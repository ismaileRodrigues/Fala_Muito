import React, { useEffect, useState, useRef } from 'react';
import { type Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface Message {
  id: string;
  sender_id: string;
  receiver_id: string | null;
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

export function Chat({ session }: { session: Session }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [users, setUsers] = useState<Profile[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [activeChatUser, setActiveChatUser] = useState<Profile | null>(null);
  const [unreadChats, setUnreadChats] = useState<(string | null)[]>([]);
  const [lastMessages, setLastMessages] = useState<Record<string, string>>({});

  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  // NOVO: Controle de tela para a versão Mobile
  const [isMobileChatView, setIsMobileChatView] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    fetchUsers();
    fetchLastMessages();
  }, []);

  useEffect(() => {
    fetchMessages();

    const channel = supabase
      .channel('public:messages')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        async (payload) => {

          if (payload.eventType === 'DELETE') {
            const deletedId = payload.old.id;
            setMessages((prev) => prev.filter((msg) => msg.id !== deletedId));
            return;
          }

          if (payload.eventType === 'INSERT') {
            const newMsg = payload.new as Message;

            let incomingChatId: string | null = null;
            let isMyMessage = newMsg.sender_id === session.user.id;

            if (newMsg.receiver_id === null) {
              incomingChatId = null;
            } else {
              incomingChatId = isMyMessage ? newMsg.receiver_id : newMsg.sender_id;
            }

            const chatKey = incomingChatId === null ? 'group' : incomingChatId;

            let previewText = newMsg.content;
            if (newMsg.image_url) previewText = '📷 [Imagem]';
            if (newMsg.audio_url) previewText = '🎤 [Áudio]';

            setLastMessages((prev) => ({ ...prev, [chatKey]: previewText }));

            if (incomingChatId === null || newMsg.receiver_id === session.user.id || isMyMessage) {
              if (incomingChatId === activeChat) {
                const { data: profile } = await supabase
                  .from('profiles')
                  .select('full_name, avatar_url')
                  .eq('id', newMsg.sender_id)
                  .single();

                setMessages((prev) => [
                  ...prev,
                  { ...newMsg, profiles: profile || { full_name: 'Familiar' } },
                ]);
              } else if (!isMyMessage) {
                setUnreadChats((prev) => {
                  if (!prev.includes(incomingChatId)) {
                    return [...prev, incomingChatId];
                  }
                  return prev;
                });
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeChat]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .neq('id', session.user.id);

    if (error) console.error('Erro ao buscar usuários:', error);
    else if (data) setUsers(data as Profile[]);
  };

  const fetchLastMessages = async () => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`receiver_id.is.null,sender_id.eq.${session.user.id},receiver_id.eq.${session.user.id}`)
      .order('created_at', { ascending: false });

    if (data) {
      const latest: Record<string, string> = {};
      data.forEach((msg) => {
        const isGroup = msg.receiver_id === null;
        const chatId = isGroup ? 'group' : (msg.sender_id === session.user.id ? msg.receiver_id : msg.sender_id);

        if (chatId && !latest[chatId]) {
          if (msg.image_url) latest[chatId] = '📷 [Imagem]';
          else if (msg.audio_url) latest[chatId] = '🎤 [Áudio]';
          else latest[chatId] = msg.content;
        }
      });
      setLastMessages(latest);
    }
  };

  const fetchMessages = async () => {
    let query = supabase.from('messages').select('*, profiles(full_name, avatar_url)');

    if (activeChat === null) {
      query = query.is('receiver_id', null);
    } else {
      query = query.or(
        `and(sender_id.eq.${session.user.id},receiver_id.eq.${activeChat}),and(sender_id.eq.${activeChat},receiver_id.eq.${session.user.id})`
      );
    }

    const { data, error } = await query.order('created_at', { ascending: true });

    if (error) console.error('Erro ao buscar mensagens:', error);
    else if (data) setMessages(data as Message[]);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const textToSend = newMessage;
    setNewMessage('');

    const { error } = await supabase.from('messages').insert({
      sender_id: session.user.id,
      receiver_id: activeChat,
      content: textToSend,
    });

    if (error) console.error('Erro ao enviar mensagem:', error);
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!window.confirm('Tem certeza que deseja apagar esta mensagem para todos?')) return;

    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId);

    if (error) {
      console.error('Erro ao apagar mensagem:', error);
      alert('Erro ao apagar mensagem.');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${session.user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('chat-images')
        .getPublicUrl(filePath);

      const { error: dbError } = await supabase.from('messages').insert({
        sender_id: session.user.id,
        receiver_id: activeChat,
        content: '',
        image_url: publicUrlData.publicUrl,
      });

      if (dbError) throw dbError;
    } catch (error) {
      console.error('Erro ao enviar imagem:', error);
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

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await handleAudioUpload(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Erro ao acessar o microfone:', err);
      alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleAudioUpload = async (audioBlob: Blob) => {
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

      const { error: dbError } = await supabase.from('messages').insert({
        sender_id: session.user.id,
        receiver_id: activeChat,
        content: '',
        audio_url: publicUrlData.publicUrl,
      });

      if (dbError) throw dbError;
    } catch (error) {
      console.error('Erro ao enviar áudio:', error);
      alert('Erro ao enviar áudio.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSelectUser = (user: Profile | null) => {
    const chatId = user ? user.id : null;
    setActiveChat(chatId);
    setActiveChatUser(user);
    setUnreadChats((prev) => prev.filter((id) => id !== chatId));

    // NOVO: Ao clicar num contato, abre a tela de chat no mobile
    setIsMobileChatView(true);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const hasUnreadGroup = unreadChats.includes(null);

  return (
    <div className="flex h-screen bg-[#E5DDD5] font-sans overflow-hidden">

      {/* Sidebar - Oculta no Mobile quando um chat está aberto */}
      <div className={`w-full md:w-1/3 lg:w-1/4 flex-col border-r border-gray-300 bg-white ${isMobileChatView ? 'hidden md:flex' : 'flex'}`}>

        <div className="flex items-center justify-between bg-[#008069] p-4 text-white">
          <div className="flex items-center space-x-3 overflow-hidden">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-teal-800 text-lg font-bold">
              {session.user.email?.[0].toUpperCase()}
            </div>
            <span className="font-semibold truncate">
              {session.user.user_metadata?.full_name || session.user.email}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs bg-teal-800 hover:bg-teal-900 px-3 py-1.5 rounded transition flex-shrink-0"
          >
            Sair
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div
            onClick={() => handleSelectUser(null)}
            className={`flex items-center gap-3 p-4 cursor-pointer border-b hover:bg-gray-100 transition ${
              activeChat === null ? 'bg-gray-200' : ''
            }`}
          >
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-teal-600 text-white font-bold text-xl">
              👨‍👩‍👧‍👦
            </div>
            <div className="flex-1 min-w-0">
              <h3 className={`text-base truncate ${hasUnreadGroup ? 'font-black text-[#008069]' : 'font-bold text-gray-800'}`}>
                Grupo da Família
              </h3>
              <p className={`text-sm truncate ${hasUnreadGroup ? 'font-bold text-gray-900' : 'text-gray-500'}`}>
                {lastMessages['group'] || 'Nenhuma mensagem ainda'}
              </p>
            </div>
            {hasUnreadGroup && (
              <div className="h-3 w-3 flex-shrink-0 bg-[#25D366] rounded-full mr-2"></div>
            )}
          </div>

          <div className="p-3 bg-gray-50 text-xs font-bold text-gray-500 uppercase tracking-wider">
            Conversas Individuais
          </div>

          {users.length === 0 ? (
            <p className="p-4 text-sm text-gray-400 text-center">Nenhum outro familiar cadastrado ainda.</p>
          ) : (
            users.map((user) => {
              const hasUnread = unreadChats.includes(user.id);
              return (
                <div
                  key={user.id}
                  onClick={() => handleSelectUser(user)}
                  className={`flex items-center gap-3 p-4 cursor-pointer border-b hover:bg-gray-100 transition ${
                    activeChat === user.id ? 'bg-gray-200' : ''
                  }`}
                >
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gray-400 text-white font-bold text-lg">
                    {user.full_name ? user.full_name[0].toUpperCase() : '👤'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className={`text-base truncate ${hasUnread ? 'font-black text-[#008069]' : 'font-semibold text-gray-800'}`}>
                      {user.full_name || 'Familiar'}
                    </h3>
                    <p className={`text-sm truncate ${hasUnread ? 'font-bold text-gray-900' : 'text-gray-500'}`}>
                      {lastMessages[user.id] || 'Nenhuma mensagem ainda'}
                    </p>
                  </div>
                  {hasUnread && (
                    <div className="h-3 w-3 flex-shrink-0 bg-[#25D366] rounded-full mr-2"></div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Área Principal das Mensagens - Oculta no mobile se a lista estiver aberta */}
      <div className={`flex-1 flex-col h-full w-full ${isMobileChatView ? 'flex' : 'hidden md:flex'}`}>

        {/* Cabeçalho do Chat */}
        <div className="flex items-center justify-between bg-[#008069] px-4 py-3 text-white shadow-md z-10">
          <div className="flex items-center gap-2">

            {/* NOVO: Botão Voltar (Visível apenas no Mobile) */}
            <button
              onClick={() => setIsMobileChatView(false)}
              className="md:hidden mr-1 p-1 hover:bg-teal-700 rounded-full transition flex-shrink-0"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>

            <div className="text-2xl flex-shrink-0">
              {activeChat === null ? '👨‍👩‍👧‍👦' : '👤'}
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold truncate">
                {activeChat === null ? 'Grupo da Família 💬' : activeChatUser?.full_name}
              </h1>
              <p className="text-xs text-teal-100 truncate">
                {activeChat === null ? 'Todos os membros da família' : 'Conversa Privada'}
              </p>
            </div>
          </div>
        </div>

        {/* Histórico de Mensagens */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#E5DDD5]">
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 mt-10 text-sm">
              Nenhuma mensagem por aqui ainda. Mande um "Oi!" 👋
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.sender_id === session.user.id;
              const date = new Date(msg.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col group ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-2 max-w-[85%] md:max-w-[75%]">

                    {isMe && (
                      <button
                        onClick={() => handleDeleteMessage(msg.id)}
                        className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 p-1 flex-shrink-0 md:block hidden"
                        title="Apagar mensagem"
                      >
                        🗑️
                      </button>
                    )}

                    <div
                      className={`rounded-lg px-3 py-1.5 shadow text-sm relative ${
                        isMe
                          ? 'bg-[#D9FDD3] text-gray-900 rounded-tr-none'
                          : 'bg-white text-gray-900 rounded-tl-none'
                      }`}
                    >
                      {/* Lixeira Mobile: No celular, passamos o botão para dentro da mensagem para facilitar o toque */}
                      {isMe && (
                         <button
                         onClick={() => handleDeleteMessage(msg.id)}
                         className="absolute -top-2 -left-2 bg-white border border-gray-200 rounded-full w-6 h-6 flex items-center justify-center text-xs shadow-sm md:hidden text-gray-500 hover:text-red-500 z-10"
                       >
                         🗑️
                       </button>
                      )}

                      {!isMe && activeChat === null && (
                        <p className="text-[11px] font-bold text-teal-700 mb-0.5">
                          {msg.profiles?.full_name || 'Familiar'}
                        </p>
                      )}

                      {msg.image_url && (
                        <a href={msg.image_url} target="_blank" rel="noopener noreferrer">
                          <img
                            src={msg.image_url}
                            alt="Imagem enviada"
                            className="max-h-64 rounded-md object-cover mb-1 cursor-pointer hover:opacity-90 transition"
                          />
                        </a>
                      )}

                      {msg.audio_url && (
                        <audio controls className="h-10 mt-1 mb-1 w-[200px] md:max-w-[250px]">
                          <source src={msg.audio_url} type="audio/webm" />
                          Seu navegador não suporta áudio.
                        </audio>
                      )}

                      {msg.content && <p className="break-words text-base md:text-sm">{msg.content}</p>}

                      <span className="block text-[10px] text-gray-500 text-right mt-1">
                        {date}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Campo de Envio */}
        <div className="flex items-center gap-1 md:gap-2 bg-[#F0F2F5] p-2 md:p-3 border-t border-gray-200 safe-area-bottom pb-4 md:pb-3">

          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            className="hidden"
            onChange={handleImageUpload}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || isRecording}
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 transition ${(isUploading || isRecording) ? 'opacity-50 cursor-not-allowed' : ''}`}
            title="Anexar imagem"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          <form
            onSubmit={handleSendMessage}
            className="flex flex-1 items-center gap-1 md:gap-2"
          >
            <input
              type="text"
              value={isRecording ? 'Gravando áudio...' : newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              disabled={isRecording}
              placeholder="Mensagem..."
              className="flex-1 rounded-full border border-gray-300 bg-white px-4 py-2 text-base text-gray-900 focus:border-teal-600 focus:outline-none disabled:bg-gray-100 disabled:text-gray-500"
            />

            {/* Botão Dinâmico: Se tiver texto, vira o botão de enviar. Se estiver vazio, vira o microfone! */}
            {newMessage.trim() ? (
              <button
                type="submit"
                disabled={isUploading}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#008069] text-white transition hover:bg-[#006e5a] shadow-sm disabled:opacity-50"
              >
                <svg className="w-5 h-5 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                disabled={isUploading}
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition shadow-sm ${
                  isRecording
                    ? 'bg-red-500 text-white animate-pulse'
                    : 'bg-[#008069] text-white hover:bg-[#006e5a]'
                } ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isRecording ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <rect x="5" y="5" width="10" height="10" rx="1" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}