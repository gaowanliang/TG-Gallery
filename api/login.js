import jwt from 'jsonwebtoken';

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body) return resolve(req.body);
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (e) {
        resolve({});
      }
    });
  });
}

// 验证 Cloudflare Turnstile Token
async function verifyTurnstileToken(token, ip) {
  const SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;
  
  // 如果没有配置密钥，跳过验证（开发环境）
  if (!SECRET_KEY) {
    console.warn('警告: 未配置 TURNSTILE_SECRET_KEY，跳过人机验证');
    return true;
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret: SECRET_KEY,
        response: token,
        remoteip: ip,
      }),
    });

    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error('Turnstile 验证错误:', error);
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
  }

  const body = await parseBody(req);
  const username = body.username;
  const password = body.password;
  const turnstileToken = body.turnstileToken;

  const USER = process.env.GALLERY_USER || 'admin';
  const PASS = process.env.GALLERY_PASS || 'password';
  const SECRET = process.env.JWT_SECRET || 'change-me';

  // 验证 Turnstile Token
  if (turnstileToken) {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || 
                     req.headers['x-real-ip'] || 
                     req.socket.remoteAddress;
    
    const isValidTurnstile = await verifyTurnstileToken(turnstileToken, clientIp);
    
    if (!isValidTurnstile) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ error: '人机验证失败，请重试' }));
    }
  }

  // 验证用户名和密码
  if (!username || !password || username !== USER || password !== PASS) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: '用户名或密码错误' }));
  }

  // 生成超长有效期的 JWT (1 年)
  const token = jwt.sign({ user: username }, SECRET, { expiresIn: '365d' });
  
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify({ token }));
}
