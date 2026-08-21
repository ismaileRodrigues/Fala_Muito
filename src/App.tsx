import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { Auth } from './components/Auth';
import { Chat } from './components/Chat';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
//......
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-6 font-sans">
        <div className="w-full max-w-lg rounded-2xl bg-white p-8 text-center shadow-xl">
          <h1 className="text-3xl font-extrabold text-gray-950">FalaMuito</h1>
          <h2 className="mt-6 text-xl font-bold text-gray-900">Configuração pendente</h2>
          <p className="mt-3 text-gray-600">
            A aplicação está no ar, mas as variáveis do Supabase ainda não foram
            configuradas neste ambiente da Vercel.
          </p>
          <p className="mt-4 rounded-lg bg-gray-100 p-4 text-left text-sm text-gray-700">
            Cadastre <code>VITE_SUPABASE_URL</code> e{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> nas Environment Variables da Vercel
            e faça um novo deploy.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-600 font-semibold">Carregando FalaMuito...</p>
      </div>
    );
  }

  return session ? <Chat session={session} /> : <Auth />;
}