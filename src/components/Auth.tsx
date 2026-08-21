import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

export function Auth() {
  const [isLoading, setIsLoading] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false); // Estado para controlar a visibilidade da senha

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            }
          }
        });
        if (error) throw error;
        alert('Cadastro realizado! Verifique seu email ou faça login.');
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const tealPrimary = "#3D8F7F";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 font-sans">
      <div className="w-full max-w-md space-y-8">

        {/* Cabeçalho */}
        <div className="text-center">
          <h1 className="text-4xl font-extrabold text-gray-950 tracking-tight">
            FalaMuito
          </h1>
          <p className="mt-3 text-lg text-gray-700">
            {isLogin ? 'Entre para falar com a família' : 'Crie sua conta no chat da família'}
          </p>
        </div>

        {/* Cartão do Formulário */}
        <div className="bg-white p-8 rounded-2xl shadow-xl">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-5 rounded-md shadow-sm">

              {!isLogin && (
                <div>
                  <label htmlFor="fullName" className="block text-sm font-semibold text-gray-800 mb-1.5">
                    Nome Completo
                  </label>
                  <input
                    id="fullName"
                    name="fullName"
                    type="text"
                    required={!isLogin}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition outline-none"
                    placeholder="Nome (como você quer ser chamado)"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>
              )}

              <div>
                <label htmlFor="email-address" className="block text-sm font-semibold text-gray-800 mb-1.5">
                  Email
                </label>
                <input
                  id="email-address"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition outline-none"
                  placeholder="Digite seu email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-gray-800 mb-1.5">
                  Senha
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"} // Tipo dinâmico
                    autoComplete={isLogin ? "current-password" : "new-password"}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition outline-none pr-12"
                    placeholder="Digite sua senha (mínimo 6 caracteres)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />

                  {/* Botão com evento onClick e alteração de ícone */}
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-700 focus:outline-none"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? (
                      /* Ícone Olho Aberto */
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      /* Ícone Olho Fechado / Riscado */
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Botão de Ação */}
            <div>
              <button
                type="submit"
                disabled={isLoading}
                style={{ backgroundColor: tealPrimary }}
                className="w-full text-white font-bold py-3 rounded-xl transition duration-150 ease-in-out disabled:opacity-60 hover:bg-[#347B6D]"
              >
                {isLoading ? 'Carregando...' : (isLogin ? 'Entrar' : 'Cadastrar')}
              </button>
            </div>
          </form>

          {/* Link para Alternar Modo */}
          <div className="mt-8 text-center">
            <p className="text-sm text-gray-600">
              {isLogin ? 'Ainda não tem conta?' : 'Já tem uma conta?'}{' '}
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
                style={{ color: tealPrimary }}
                className="font-semibold hover:underline"
              >
                {isLogin ? 'Cadastre-se' : 'Entre aqui'}
              </button>
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}