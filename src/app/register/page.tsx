'use client';

// @ts-ignore
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    if (password.length < 6) {
      setError('密码长度至少为 6 位');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || '注册失败');
        return;
      }

      // 注册成功，跳转到登录页
      router.push('/login?registered=true');
    } catch (err) {
      setError('注册失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center relative overflow-hidden bg-zinc-50/30 px-4 sm:px-6 py-8">
       {/* 动态背景 */}
       <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.4]" />
        
        {/* 流光效果 */}
        <div className="absolute inset-0 pointer-events-none">
           <div className="absolute inset-y-0 w-[400px] bg-gradient-to-r from-transparent via-purple-500/5 to-transparent animate-beam blur-xl" style={{ animationDelay: '1s' }} />
        </div>

        {/* 呼吸光晕 - 注册页用偏紫的暖色调 */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] sm:w-[800px] h-[600px] sm:h-[800px] bg-gradient-to-bl from-purple-100/40 to-pink-100/40 blur-[120px] rounded-full animate-pulse duration-[7000ms]" />
      </div>

      <Card className="w-full max-w-md bg-white/80 backdrop-blur-sm border-zinc-200/60 shadow-xl shadow-zinc-200/40">
        <CardHeader className="space-y-2 sm:space-y-3 text-center pt-6 sm:pt-8 pb-4 sm:pb-6">
          <CardTitle className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900">创建新账号</CardTitle>
          <CardDescription className="text-zinc-500 text-sm">
            开启您的智能知识库之旅
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5 sm:px-8 pb-6 sm:pb-8">
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
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
                placeholder="3-20个字符"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="h-11 bg-zinc-50/50 border-zinc-200 focus:bg-white transition-all duration-200"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-xs font-medium text-zinc-500 uppercase tracking-wider ml-1">
                密码
              </label>
              <Input
                id="password"
                type="password"
                placeholder="至少6位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11 bg-zinc-50/50 border-zinc-200 focus:bg-white transition-all duration-200"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-xs font-medium text-zinc-500 uppercase tracking-wider ml-1">
                确认密码
              </label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="再次输入密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
                  <span>注册中...</span>
                </div>
              ) : '立即注册'}
            </Button>
            <div className="text-center pt-2">
              <span className="text-zinc-400 text-sm">已有账号？</span>
              <Link href="/login" className="ml-2 text-sm font-medium text-zinc-900 hover:text-zinc-700 hover:underline transition-colors">
                直接登录
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* 底部版权信息 */}
      <div className="absolute bottom-4 sm:bottom-6 text-center w-full px-4">
         <p className="text-[10px] sm:text-xs text-zinc-400 font-medium tracking-wide">RAG KNOWLEDGE BASE © 2025</p>
      </div>
    </div>
  );
}
