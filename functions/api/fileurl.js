import { MongoClient } from 'mongodb';

const TELEGRAM_OFFICIAL = 'https://api.telegram.org';
const TELEGRAM_PROXY = 'https://tgapi.kairod.cfd';

function buildUrlFromFilePath(botToken, filePath, useProxy = false) {
  if (!filePath) return null;
  if (useProxy) return `${TELEGRAM_PROXY}/file/bot${botToken}/${filePath}`;
  return `${TELEGRAM_OFFICIAL}/file/bot${botToken}/${filePath}`;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const file_id = url.searchParams.get('file_id');
  if (!file_id) {
    return new Response(JSON.stringify({ error: 'file_id required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const MONGO_URI = env.MONGO_URI;
  let botToken = env.BOT_TOKEN || null;
  
  if (MONGO_URI) {
    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const db = client.db('magic_plugin_db');
      const collection = db.collection('gallery');
      const doc = await collection.findOne({ 'telegram.file_id': file_id });
      if (doc && doc.telegram && doc.telegram.bot_token) botToken = doc.telegram.bot_token;
    } catch (e) {
      // ignore and fallback to env
    } finally {
      await client.close();
    }
  }

  if (!botToken) {
    return new Response(JSON.stringify({ error: 'No bot token available' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const resp = await fetch(`${TELEGRAM_OFFICIAL}/bot${botToken}/getFile?file_id=${encodeURIComponent(file_id)}`);
    const data = await resp.json();
    if (data && data.ok && data.result && data.result.file_path) {
      const filePath = data.result.file_path;
      const urlDirect = buildUrlFromFilePath(botToken, filePath, false);
      
      // 直接获取图片内容并返回
      const imageResp = await fetch(urlDirect);
      if (imageResp.ok) {
        const contentType = imageResp.headers.get('content-type') || 'image/jpeg';
        return new Response(imageResp.body, {
          headers: {
            ...corsHeaders,
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        });
      }
    }
  } catch (e) {
    // fallthrough to proxy
  }

  try {
    const resp2 = await fetch(`${TELEGRAM_PROXY}/bot${botToken}/getFile?file_id=${encodeURIComponent(file_id)}`);
    const data2 = await resp2.json();
    if (data2 && data2.ok && data2.result && data2.result.file_path) {
      const filePath = data2.result.file_path;
      const urlDirect = buildUrlFromFilePath(botToken, filePath, true);
      
      // 直接获取图片内容并返回
      const imageResp = await fetch(urlDirect);
      if (imageResp.ok) {
        const contentType = imageResp.headers.get('content-type') || 'image/jpeg';
        return new Response(imageResp.body, {
          headers: {
            ...corsHeaders,
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        });
      }
    }
  } catch (e) {
    // final fallback
  }

  return new Response(JSON.stringify({ error: 'Failed to retrieve file URL' }), {
    status: 502,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
