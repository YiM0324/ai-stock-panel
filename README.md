# AI 股票分析器

一个基于 AI 的智能股票分析应用，支持实时行情获取和 AI 智能分析。

---

## 1. 在线访问 URL

**Render 部署地址**: `https://your-app-name.onrender.com`

> 注：请替换为实际部署后的 URL。部署步骤见下方 [部署指南](#部署指南)。

---

## 2. Prompt 设计：强制 LLM 只返回 JSON

### 核心 Prompt 代码

```javascript
const prompt = `请分析以下股票数据，提供投资分析和建议。

股票代码: ${symbol}
当前价格: $${stockData.price}
涨跌额: $${stockData.change}
涨跌幅: ${stockData.changePercent}
成交量: ${stockData.volume.toLocaleString()}

**重要：你必须只返回JSON格式，不要添加任何其他文字、标记或代码块。**

格式如下：
{"summary": "对该股票的简要分析和总结（50-100字）", "sentiment": "Bullish或Neutral或Bearish", "risk_level": "High或Medium或Low"}`;
```

### 关键设计点

| 设计 | 说明 |
|------|------|
| **强制指令** | `"你必须只返回JSON格式，不要添加任何其他文字、标记或代码块"` - 直接告诉 AI 不要添加 markdown 代码块 |
| **格式示例** | 提供具体的 JSON 结构示例，让 AI 明确知道字段名和值类型 |
| **严格枚举** | `sentiment` 限定为 `Bullish/Neutral/Bearish`，`risk_level` 限定为 `High/Medium/Low` |

### 双重解析保障

如果 AI 仍然返回了 markdown 代码块（如 ```json），代码会自动清理后重试：

```javascript
// 第一次：直接解析
try {
  analysis = JSON.parse(aiResponse.trim());
} catch (e1) {
  // 第二次：清理 markdown 后解析
  const cleaned = aiResponse
    .replace(/```json\s*/g, '')
    .replace(/```\s*$/g, '')
    .trim();
  analysis = JSON.parse(cleaned);
}
```

---

## 3. Debug 记录：Supabase 数据库连接失败

### 问题描述

系统成功连接到 Supabase，但保存历史记录时报错：

```
保存到Supabase失败: {
  code: 'PGRST204',
  message: "Could not find the 'change' column of 'stock_analyses' in the schema cache"
}
```

### 根因分析

通过 Claude Code 工具检查代码发现，`server.js` 中 `insert` 操作需要以下字段：
- `symbol`, `price`, `change`, `change_percent`, `volume`
- `analysis_summary`, `sentiment`, `risk_level`, `created_at`

但 Supabase 中的表结构缺少 `change`, `change_percent`, `volume` 等字段。

### 解决方案

在 Supabase SQL Editor 中执行：

```sql
-- 删除旧表并重建
DROP TABLE IF EXISTS stock_analyses;

CREATE TABLE stock_analyses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol text NOT NULL,
  price numeric,
  change numeric,              -- 新增：涨跌额
  change_percent text,         -- 新增：涨跌幅
  volume bigint,               -- 新增：成交量
  analysis_summary text,
  sentiment text,
  risk_level text,
  created_at timestamp with time zone DEFAULT now()
);

-- 开启权限（可选）
ALTER TABLE stock_analyses DISABLE ROW LEVEL SECURITY;
```

### 验证结果

执行 SQL 后重启服务器，终端显示：
```
Supabase 已连接
✓ 保存历史记录成功
```

页面历史记录功能恢复正常。

---

## 技术栈

- **前端**: HTML + Tailwind CSS + Vanilla JS
- **后端**: Node.js + Express
- **AI API**: Kimi (Moonshot) / Claude (Anthropic)
- **数据库**: Supabase (PostgreSQL)
- **部署**: Render

## 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 文件填入 API Key

# 3. 启动服务器
node server.js

# 4. 访问 http://localhost:3000
```

## 部署指南

### 部署到 Render

1. 将代码推送到 GitHub
2. 登录 https://render.com 并创建 New Web Service
3. 连接 GitHub 仓库
4. 配置环境变量（在 Render Dashboard → Environment）：
   - `ALPHA_VANTAGE_API_KEY`
   - `KIMI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `AI_PROVIDER=kimi`
5. 点击 Deploy

## API 限制说明

- **Alpha Vantage**: 免费版每天 25 次请求，美股/部分 A 股支持，港股可能返回空
- **Kimi API**: 需要自行申请 API Key

## License

MIT
