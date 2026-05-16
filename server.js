const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// 初始化Supabase客户端
let supabase = null;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY &&
      !process.env.SUPABASE_URL.includes('your-project')) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
    console.log('Supabase 已连接');
  } else {
    console.log('Supabase 未配置，历史记录功能将不可用');
  }
} catch (e) {
  console.error('Supabase 连接失败:', e.message);
}

// 获取股票行情 (Alpha Vantage代理)
app.get('/api/stock/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

    const response = await axios.get('https://www.alphavantage.co/query', {
      params: {
        function: 'GLOBAL_QUOTE',
        symbol: symbol.toUpperCase(),
        apikey: apiKey
      }
    });

    // 检查 API 是否返回额度限制信息
    if (response.data['Information']) {
      console.error('Alpha Vantage API 限制:', response.data['Information']);
      return res.status(429).json({
        error: 'API 额度已用完',
        message: 'Alpha Vantage 免费版每日限额 25 次已用完，请明天再试或升级付费版',
        detail: response.data['Information']
      });
    }

    const data = response.data['Global Quote'];
    if (!data || Object.keys(data).length === 0) {
      return res.status(404).json({ error: '股票代码未找到' });
    }

    const stockData = {
      symbol: data['01. symbol'],
      price: parseFloat(data['05. price']),
      change: parseFloat(data['09. change']),
      changePercent: data['10. change percent'],
      volume: parseInt(data['06. volume']),
      latestTradingDay: data['07. latest trading day']
    };

    res.json(stockData);
  } catch (error) {
    console.error('获取股票数据失败:', error.message);
    res.status(500).json({ error: '获取股票数据失败' });
  }
});

// AI分析股票 (支持 Claude 或 Kimi)
app.post('/api/analyze', async (req, res) => {
  try {
    const { symbol, stockData } = req.body;

    if (!symbol || !stockData) {
      return res.status(400).json({ error: '缺少股票代码或数据' });
    }

    const prompt = `请分析以下股票数据，提供投资分析和建议。

股票代码: ${symbol}
当前价格: $${stockData.price}
涨跌额: $${stockData.change}
涨跌幅: ${stockData.changePercent}
成交量: ${stockData.volume.toLocaleString()}
最新交易日: ${stockData.latestTradingDay}

重要：你必须只返回JSON格式，不要添加任何其他文字、标记或代码块。格式如下：
{"summary": "对该股票的简要分析和总结（50-100字）", "sentiment": "Bullish或Neutral或Bearish", "risk_level": "High或Medium或Low"}`;

    const aiProvider = process.env.AI_PROVIDER || 'kimi';
    let analysis = null;
    let aiResponse = null;

    try {
      if (aiProvider === 'claude') {
        // Claude API 调用
        const response = await axios.post('https://api.anthropic.com/v1/messages', {
          model: 'claude-sonnet-4-6',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }]
        }, {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          }
        });
        aiResponse = response.data.content[0].text;
      } else {
        // Kimi API 调用 (OpenAI 兼容格式)
        const response = await axios.post('https://api.moonshot.cn/v1/chat/completions', {
          model: 'moonshot-v1-8k',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }]
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.KIMI_API_KEY}`
          }
        });
        aiResponse = response.data.choices[0].message.content;
      }

      console.log('AI 返回内容:', aiResponse);

      // 解析 JSON
      try {
        // 先尝试直接解析
        analysis = JSON.parse(aiResponse.trim());
        console.log('✓ 直接解析 JSON 成功');
      } catch (e1) {
        // 尝试清理后解析
        try {
          let clean = aiResponse.trim()
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();
          analysis = JSON.parse(clean);
          console.log('✓ 清理后解析 JSON 成功');
        } catch (e2) {
          // 尝试提取 JSON 部分
          const match = aiResponse.match(/\{[\s\S]*\}/);
          if (match) {
            try {
              analysis = JSON.parse(match[0]);
              console.log('✓ 提取后解析 JSON 成功');
            } catch (e3) {
              throw new Error('JSON解析失败: ' + e3.message);
            }
          } else {
            throw new Error('未找到JSON');
          }
        }
      }

      console.log('解析结果:', JSON.stringify(analysis));
    } catch (parseError) {
      console.error('解析 AI 响应失败:', parseError.message);
      console.error('原始响应:', aiResponse);
      analysis = {
        summary: aiResponse ? aiResponse.substring(0, 100) + '...' : 'AI 响应解析失败',
        sentiment: 'Neutral',
        risk_level: 'Medium'
      };
    }

    // 验证分析结果格式
    if (!analysis.summary) analysis.summary = '暂无分析';
    if (!analysis.sentiment || !['Bullish', 'Neutral', 'Bearish'].includes(analysis.sentiment)) {
      analysis.sentiment = 'Neutral';
    }
    if (!analysis.risk_level || !['High', 'Medium', 'Low'].includes(analysis.risk_level)) {
      analysis.risk_level = 'Medium';
    }

    // 保存到Supabase（如果已配置）
    let dbError = null;
    if (supabase) {
      const { error } = await supabase
        .from('stock_analyses')
        .insert([
          {
            symbol: symbol.toUpperCase(),
            price: stockData.price,
            change: stockData.change,
            change_percent: stockData.changePercent,
            volume: stockData.volume,
            analysis_summary: analysis.summary,
            sentiment: analysis.sentiment,
            risk_level: analysis.risk_level,
            created_at: new Date().toISOString()
          }
        ]);
      dbError = error;
      if (dbError) {
        console.error('保存到Supabase失败:', dbError);
      }
    }

    // 判断解析是否成功
    const isFallback = !analysis.summary || analysis.summary === 'AI 响应解析失败';

    res.json({
      success: true,
      analysis: {
        summary: analysis.summary || '暂无分析',
        sentiment: analysis.sentiment || 'Neutral',
        risk_level: analysis.risk_level || 'Medium'
      },
      stockData,
      savedToDb: !dbError && !isFallback,
      debug: {
        aiProvider,
        rawResponse: aiResponse ? aiResponse.substring(0, 500) : null,
        parseStatus: isFallback ? '使用默认数据' : '解析成功',
        isFallback: isFallback
      }
    });
  } catch (error) {
    console.error('AI分析失败:', error.response?.data || error.message);
    console.error('错误详情:', error.stack);
    res.status(500).json({
      error: 'AI分析失败',
      details: error.response?.data?.error?.message || error.message,
      stack: error.stack
    });
  }
});

// 获取历史分析记录
app.get('/api/history', async (req, res) => {
  try {
    if (!supabase) {
      return res.json([]); // Supabase 未配置时返回空数组
    }

    const { data, error } = await supabase
      .from('stock_analyses')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('获取历史记录失败:', error);
      return res.json([]); // 出错时返回空数组而不是500错误
    }

    res.json(data || []);
  } catch (error) {
    console.error('获取历史记录失败:', error.message);
    res.json([]);
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`访问 http://localhost:${PORT} 查看应用`);
});
