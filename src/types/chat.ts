export interface Profile {
  id: string;
  full_name: string;
  avatar_url?: string;
  updated_at: string;
}

export interface Message {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  profiles?: Profile; // Para fazermos o JOIN do autor da mensagem
}