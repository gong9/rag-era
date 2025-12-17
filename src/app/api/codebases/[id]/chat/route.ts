import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { configureLLM, getOpenAI } from '@/lib/llm/config';
import { meilisearchService } from '@/lib/meilisearch';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const codeBaseId = params.id;
    const { question, sessionId } = await request.json();

    if (!question) {
      return NextResponse.json({ error: '问题不能为空' }, { status: 400 });
    }

    // 验证 sessionId（如果提供）
    if (sessionId) {
      const chatSession = await prisma.chatSession.findUnique({
        where: { id: sessionId },
      });
      if (!chatSession || chatSession.userId !== userId) {
        return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 403 });
      }
    }

    // 验证代码库所有权
    const codeBase = await prisma.codeBase.findUnique({
      where: { id: codeBaseId },
    });

    if (!codeBase) {
      return NextResponse.json({ error: '代码库不存在' }, { status: 404 });
    }

    if (codeBase.userId !== userId) {
      return NextResponse.json({ error: '无权访问此代码库' }, { status: 403 });
    }

    if (codeBase.status !== 'completed') {
      return NextResponse.json({ error: '代码库尚未完成索引' }, { status: 400 });
    }

    // 配置 LLM
    configureLLM();
    const llm = getOpenAI();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[CodeChat] 查询开始`);
    console.log(`[CodeChat] 代码库: ${codeBase.name} (${codeBaseId})`);
    console.log(`[CodeChat] 用户问题: "${question}"`);
    console.log(`${'='.repeat(60)}`);

    // ========== Step 1: LLM 提取搜索关键词 ==========
    console.log(`\n[Step 1] 提取搜索关键词...`);
    
    const keywordResponse = await llm.chat({
      messages: [
        {
          role: 'system',
          content: `你是一个代码搜索助手。从用户问题中提取用于搜索代码的关键词。
只返回英文代码标识符（函数名、类名、变量名等），用逗号分隔。
不要返回中文、解释或其他内容。

示例1:
问题: "Vue的响应式系统是怎么实现的？"
输出: reactive,ref,effect,track,trigger,computed

示例2:
问题: "React如何实现虚拟DOM的diff算法？"
输出: diff,reconcile,fiber,updateQueue,commitWork

示例3:
问题: "Express中间件的执行流程是什么？"
输出: middleware,next,use,app,router`
        },
        { role: 'user', content: `问题: "${question}"` }
      ],
    });

    const keywordsText = typeof keywordResponse.message.content === 'string' 
      ? keywordResponse.message.content 
      : '';
    // 提取英文标识符
    const keywords = keywordsText
      .split(/[,，\s]+/)
      .map((k: string) => k.trim())
      .filter((k: string) => k && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k))
      .slice(0, 10);

    console.log(`  提取的关键词: [${keywords.join(', ')}]`);

    // ========== Step 2: 获取相关模块摘要 ==========
    console.log(`\n[Step 2] 获取模块摘要...`);
    let moduleContext = '';
    
    // 获取模块，优先选择有摘要的
    const modules = await prisma.repoModule.findMany({
      where: {
        codeBaseId,
        summary: { not: null },
      },
      select: {
        name: true,
        path: true,
        summary: true,
        responsibilities: true,
        publicAPI: true,
      },
      take: 5,
    });

    if (modules.length > 0) {
      moduleContext = modules.map(m => {
        let line = `📦 ${m.name} (${m.path})`;
        if (m.summary) {
          line += `\n   ${m.summary}`;
        }
        return line;
      }).join('\n\n');
      
      console.log(`  找到 ${modules.length} 个模块`);
    } else {
      console.log(`  无模块摘要`);
    }

    // ========== Step 3: Meilisearch 关键词搜索 ==========
    console.log(`\n[Step 3] 关键词搜索...`);
    let searchResults: any[] = [];

    if (keywords.length > 0) {
      try {
        const searchQuery = keywords.join(' ');
        // meilisearchService.search 直接返回 SearchResult[] 数组
        const meiliResults = await meilisearchService.search(
          `codebase_${codeBaseId}`,
          searchQuery,
          15
        );
        
        // 过滤非源码文件
        searchResults = (meiliResults || []).filter((hit: any) => {
          const docId = hit.documentId || hit.id || '';
          const excludePatterns = [
            /node_modules/i,
            /\.test\./i,
            /\.spec\./i,
            /\.d\.ts$/i,
            /package\.json/i,
            /\.lock$/i,
            /\.md$/i,
          ];
          return !excludePatterns.some(pattern => pattern.test(docId));
        });

        console.log(`  Meilisearch 结果: ${searchResults.length} 条`);
      } catch (e: any) {
        console.log(`  Meilisearch 搜索失败: ${e.message}`);
      }
    }

    // ========== Step 4: 符号数据库搜索 ==========
    console.log(`\n[Step 4] 符号数据库搜索...`);
    let symbolResults: any[] = [];

    if (keywords.length > 0) {
      symbolResults = await prisma.codeSymbol.findMany({
        where: {
          codeBaseId,
          OR: keywords.map(keyword => ({
            OR: [
              { name: { contains: keyword } },
              { signature: { contains: keyword } },
              { docComment: { contains: keyword } },
            ],
          })),
        },
        select: {
          id: true,
          name: true,
          type: true,
          filePath: true,
          startLine: true,
          endLine: true,
          signature: true,
          docComment: true,
        },
        take: 15,
      });

      console.log(`  符号搜索结果: ${symbolResults.length} 个`);
      symbolResults.slice(0, 5).forEach((s, i) => {
        console.log(`    ${i + 1}. ${s.type} ${s.name} @ ${s.filePath}:${s.startLine}`);
      });
    }

    // ========== Step 5: 构建上下文并生成回答 ==========
    console.log(`\n[Step 5] 构建上下文...`);

    // 系统提示词
    const systemPrompt = `你是一个代码助手，专门帮助用户理解和分析代码库 "${codeBase.name}"。
这是一个 GitHub 仓库: ${codeBase.githubUrl}
主要语言: ${codeBase.mainLanguage || '未知'}

请根据以下检索到的信息来回答用户的问题。
在回答时：
1. 如果涉及具体代码，请引用文件路径和行号
2. 解释代码的功能和逻辑
3. 如果有模块摘要信息，先从宏观架构角度解释
4. 如果检索的内容不足以回答问题，请明确告知用户
5. 如果你认为流程图能帮助说明，可以用 Mermaid 语法（\`\`\`mermaid）画图，但要配合文字解释，不要只给图`;

    // 构建上下文
    let contextContent = '';
    
    // 添加模块摘要
    if (moduleContext) {
      contextContent += `[📦 相关模块]\n${moduleContext}\n\n`;
    }
    
    // 添加搜索到的符号
    if (symbolResults.length > 0) {
      contextContent += `[🔤 相关符号]\n`;
      contextContent += symbolResults.slice(0, 8).map((s, i) => {
        let line = `${i + 1}. ${s.type} ${s.name} @ ${s.filePath}:${s.startLine}`;
        if (s.signature) {
          line += `\n   签名: ${s.signature.substring(0, 100)}`;
        }
        if (s.docComment) {
          line += `\n   注释: ${s.docComment.substring(0, 100)}`;
        }
        return line;
      }).join('\n');
      contextContent += '\n\n';
    }

    // 添加代码块搜索结果
    if (searchResults.length > 0) {
      contextContent += `[📄 相关代码片段]\n`;
      contextContent += searchResults.slice(0, 5).map((hit, i) => {
        const content = hit.content || '';
        const preview = content.substring(0, 300) + (content.length > 300 ? '...' : '');
        return `${i + 1}. ${hit.documentId || hit.documentName}\n${preview}`;
      }).join('\n\n');
    }

    // 如果没有找到任何结果
    if (!contextContent.trim()) {
      contextContent = '（未找到相关代码，将基于问题直接回答）';
    }

    console.log(`  上下文长度: ${contextContent.length} 字符`);

    // 生成回答
    console.log(`\n[Step 6] 生成回答...`);
    const finalResponse = await llm.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `以下是检索到的相关信息：\n\n${contextContent}\n\n用户问题：${question}` },
      ],
    });

    const answer = typeof finalResponse.message.content === 'string' 
      ? finalResponse.message.content 
      : '';

    // 构建返回的 sourceNodes（合并符号搜索和代码块搜索结果）
    const sourceNodes: any[] = [];
    
    // 添加符号搜索结果
    symbolResults.slice(0, 6).forEach((result, i) => {
      sourceNodes.push({
        type: 'symbol',
        name: result.name,
        symbolType: result.type,
        score: 0.8 - (i * 0.05),
        filePath: result.filePath,
        startLine: result.startLine,
        endLine: result.endLine,
        signature: result.signature,
      });
    });
    
    // 添加 Meilisearch 代码块搜索结果
    searchResults.slice(0, 4).forEach((hit, i) => {
      // documentId 格式: packages/runtime-core/src/renderer.ts:1578-1784
      const docId = hit.documentId || hit.documentName || '';
      let filePath = docId;
      let startLine: number | undefined;
      let endLine: number | undefined;
      
      // 解析格式: filePath:startLine-endLine，提取纯文件路径
      const match = docId.match(/^(.+):(\d+)-(\d+)$/);
      if (match) {
        filePath = match[1];  // 纯文件路径，不含行号
        startLine = parseInt(match[2], 10);
        endLine = parseInt(match[3], 10);
      }
      
      // 跳过非源码文件（如 CHANGELOG.md）
      const isSourceCode = /\.(ts|tsx|js|jsx|vue|py|java|go|rs|c|cpp|h)$/i.test(filePath);
      if (!isSourceCode) {
        return;
      }
      
      sourceNodes.push({
        type: 'code_chunk',
        name: filePath.split('/').pop() || docId,
        score: 0.6 - (i * 0.05),
        filePath: filePath,  // 纯文件路径
        startLine,
        endLine,
        content: (hit.content || '').substring(0, 200),
      });
    });

    // ========== 保存聊天历史 ==========
    if (sessionId) {
      try {
        await prisma.chatHistory.create({
          data: {
            sessionId,
            userId,
            knowledgeBaseId: `codebase_${codeBaseId}`,
            question,
            answer,
            sourceNodes: JSON.stringify(sourceNodes),
          },
        });

        // 更新会话标题（如果是第一条消息）
        const historyCount = await prisma.chatHistory.count({
          where: { sessionId },
        });
        if (historyCount === 1) {
          await prisma.chatSession.update({
            where: { id: sessionId },
            data: { title: question.substring(0, 50) + (question.length > 50 ? '...' : '') },
          });
        }
      } catch (historyError) {
        console.error('[CodeChat] Failed to save chat history:', historyError);
      }
    }

    // 汇总日志
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[CodeChat] 查询完成`);
    console.log(`  关键词: [${keywords.join(', ')}]`);
    console.log(`  模块: ${modules.length} 个`);
    console.log(`  符号: ${symbolResults.length} 个`);
    console.log(`  代码块: ${searchResults.length} 个`);
    console.log(`  回答长度: ${answer.length} 字符`);
    console.log(`${'='.repeat(60)}\n`);

    return NextResponse.json({
      answer,
      sourceNodes,
    });
  } catch (error: any) {
    console.error('Codebase chat error:', error);
    return NextResponse.json({ error: error.message || '查询失败' }, { status: 500 });
  }
}
