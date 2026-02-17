import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
  }

  const auth = (req.headers.authorization || '').split(' ')[1];
  const SECRET = process.env.JWT_SECRET || 'change-me';
  try {
    if (!auth) throw new Error('No token');
    jwt.verify(auth, SECRET);
  } catch (e) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'MONGO_URI not configured' }));
  }

  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db('magic_plugin_db');
    const collection = db.collection('gallery');
    const docs = await collection
      .find({}, { projection: { prompt: 1, metadata: 1, telegram: 1, timestamp: 1 } })
      .sort({ timestamp: -1 })
      .limit(200)
      .toArray();

    const out = docs.map((d) => ({
      id: d._id.toString(),
      prompt: d.prompt,
      metadata: d.metadata || {},
      telegram: {
        chat_id: d.telegram?.chat_id || null,
        file_id: d.telegram?.file_id || null,
      },
      timestamp: d.timestamp,
    }));
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: String(e) }));
  } finally {
    await client.close();
  }
}
