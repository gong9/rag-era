'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LayoutDashboard } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn('credentials', {
        username,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('用户名或密码错误');
      } else {
        router.push('/dashboard');
        router.refresh();
      }
    } catch (err) {
      setError('登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center relative overflow-hidden bg-zinc-50/30">
       {/* 动态背景 */}
       <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.4]" />
        
        {/* 流光效果 */}
        <div className="absolute inset-0 pointer-events-none">
           <div className="absolute inset-y-0 w-[400px] bg-gradient-to-r from-transparent via-indigo-500/5 to-transparent animate-beam blur-xl" />
        </div>

        {/* 呼吸光晕 - 登录页用稍冷的色调 */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-tr from-indigo-100/40 to-blue-100/40 blur-[120px] rounded-full animate-pulse duration-[6000ms]" />
      </div>

      <Card className="w-full max-w-md bg-white/80 backdrop-blur-sm border-zinc-200/60 shadow-xl shadow-zinc-200/40">
        <CardHeader className="space-y-3 text-center pt-8 pb-6">
          <CardTitle className="text-2xl font-semibold tracking-tight text-zinc-900">欢迎回来</CardTitle>
          <CardDescription className="text-zinc-500 text-sm">
            登录以管理您的 RAG 知识库
          </CardDescription>
        </CardHeader>
        <CardContent className="px-8 pb-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg border border-red-100 flex items-center justify-center animate-in fade-in slide-in-from-top-2">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor="username" className="text-xs font-medium text-zinc-500 uppercase tracking-wider ml-1">
                用户名
              </label>
              <Input
                id="username"
                type="text"
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="h-11 bg-zinc-50/50 border-zinc-200 focus:bg-white transition-all duration-200"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-xs font-medium text-zinc-500 uppercase tracking-wider ml-1">
                  密码
                </label>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11 bg-zinc-50/50 border-zinc-200 focus:bg-white transition-all duration-200"
              />
            </div>
            <Button 
              type="submit" 
              className="w-full h-11 bg-zinc-900 hover:bg-zinc-800 text-white font-medium shadow-lg shadow-zinc-900/10 transition-all hover:scale-[1.01] active:scale-[0.99]" 
              disabled={loading}
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>登录中...</span>
                </div>
              ) : '登 录'}
            </Button>
            <div className="text-center pt-2">
              <span className="text-zinc-400 text-sm">还没有账号？</span>
              <Link href="/register" className="ml-2 text-sm font-medium text-zinc-900 hover:text-zinc-700 hover:underline transition-colors">
                创建新账号
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* 底部版权信息 */}
      <div className="absolute bottom-6 text-center w-full">
         <p className="text-xs text-zinc-400 font-medium tracking-wide">RAG KNOWLEDGE BASE © 2025</p>
      </div>
    </div>
  );
}
