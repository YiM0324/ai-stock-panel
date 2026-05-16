# AI 股票分析面板（精简版）

## 在线访问 URL

https://ai-stock-panel-1.onrender.com

## 核心功能

1. 输入股票代码，调用 Alpha Vantage API 获取实时行情
2. 点击 AI 分析，调用 Claude 3 Haiku 生成严格 JSON 格式分析
3. 所有分析数据自动存入 Supabase 数据库

## 强制 JSON Prompt 原文

你只能返回严格合法JSON，禁止任何多余文字、禁止markdown、禁止```符号。
必须严格返回这个结构：
{
"summary": "2-3句话分析",
"sentiment": "Bullish/Neutral/Bearish",
"risk_level": "High/Medium/Low"
}
股票数据：
${JSON.stringify(stockData)}

## Debug 记录

问题1：保存到 Supabase 报错 new row violates row-level security policy
解决：执行 SQL 关闭 RLS 权限
ALTER TABLE stock_analyses DISABLE ROW LEVEL SECURITY;

问题2：Supabase 找不到 change 字段
解决：删除旧表并重新创建完整表结构，确保字段完全匹配。

## 技术栈

- 前端：HTML + Tailwind CSS
- 后端：Node.js + Express
- 股票数据：Alpha Vantage API
- AI 分析：Claude 3 Haiku
- 数据库：Supabase
- 部署：Render.com
