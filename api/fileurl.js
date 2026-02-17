import { MongoClient } from 'mongodb';

const TELEGRAM_OFFICIAL = 'https://api.telegram.org';
const TELEGRAM_PROXY = 'https://tgapi.kairod.cfd';

function buildUrlFromFilePath(botToken, filePath, useProxy = false) {
  if (!filePath) return null;
  if (useProxy) return `${TELEGRAM_PROXY}/file/bot${botToken}/${filePath}`;
  return `${TELEGRAM_OFFICIAL}/file/bot${botToken}/${filePath}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const file_id = url.searchParams.get('file_id');
  if (!file_id) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'file_id required' }));
  }

  const MONGO_URI = process.env.MONGO_URI;
  let botToken = process.env.BOT_TOKEN || null;
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
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'No bot token available' }));
  }

  // Try official getFile
  try {
    const resp = await fetch(`${TELEGRAM_OFFICIAL}/bot${botToken}/getFile?file_id=${encodeURIComponent(file_id)}`);
    const data = await resp.json();
    if (data && data.ok && data.result && data.result.file_path) {
      const filePath = data.result.file_path;
      const urlDirect = buildUrlFromFilePath(botToken, filePath, false);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ url: urlDirect }));
    }
  } catch (e) {
    // fallthrough to proxy
  }

  // Try proxy
  try {
    const resp2 = await fetch(`${TELEGRAM_PROXY}/bot${botToken}/getFile?file_id=${encodeURIComponent(file_id)}`);
    const data2 = await resp2.json();
    if (data2 && data2.ok && data2.result && data2.result.file_path) {
      const filePath = data2.result.file_path;
      const urlDirect = buildUrlFromFilePath(botToken, filePath, true);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ url: urlDirect }));
    }
  } catch (e) {
    // final fallback
  }

  res.statusCode = 502;
  return res.end(JSON.stringify({ error: 'Failed to retrieve file URL' }));
}
