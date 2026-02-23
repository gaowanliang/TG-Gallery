import jwt from 'jsonwebtoken';

async function verifyTurnstileToken(token, ip, secretKey) {
  if (!secretKey) {
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
        secret: secretKey,
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

export async function onRequest(context) {
  const { request, env } = context;
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    // ignore
  }

  const username = body.username;
  const password = body.password;
  const turnstileToken = body.turnstileToken;

  const USER = env.GALLERY_USER || 'admin';
  const PASS = env.GALLERY_PASS || 'password';
  const SECRET = env.JWT_SECRET || 'change-me';
  const TURNSTILE_SECRET_KEY = env.TURNSTILE_SECRET_KEY;

  if (turnstileToken) {
    const clientIp = request.headers.get('cf-connecting-ip') || 
                     request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip');
    
    const isValidTurnstile = await verifyTurnstileToken(turnstileToken, clientIp, TURNSTILE_SECRET_KEY);
    
    if (!isValidTurnstile) {
      return new Response(JSON.stringify({ error: '人机验证失败，请重试' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  if (!username || !password || username !== USER || password !== PASS) {
    return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const token = jwt.sign({ user: username }, SECRET, { expiresIn: '365d' });
  
  return new Response(JSON.stringify({ token }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
