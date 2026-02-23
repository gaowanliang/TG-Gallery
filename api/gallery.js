import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 支持 GET (list) 和 DELETE (delete by id)
  if (req.method !== 'GET' && req.method !== 'DELETE') {
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

    if (req.method === 'DELETE') {
      // 删除指定 id 的文档
      let body = req.body;
      // 如果 body 是字符串，尝试解析
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
      }
      const id = body?.id || req.query?.id;
      if (!id) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Missing id' }));
      }
      try {
        const result = await collection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ ok: true, deletedId: id }));
        } else {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'Not found' }));
        }
      } catch (e) {
        res.statusCode = 500;
        return res.end(JSON.stringify({ error: String(e) }));
      }
    }

    const toGalleryItem = (d) => ({
      id: d._id.toString(),
      prompt: d.prompt,
      metadata: d.metadata || {},
      telegram: {
        chat_id: d.telegram?.chat_id || null,
        file_id: d.telegram?.file_id || null,
      },
      timestamp: d.timestamp,
    });

    // GET: 返回画廊列表（兼容旧版 + 新版游标分页）
    const limitRaw = req.query?.limit;
    const cursorRaw = req.query?.cursor;
    const cursor = typeof cursorRaw === 'string' ? cursorRaw.trim() : '';
    const wantsPagination = typeof limitRaw !== 'undefined' || Boolean(cursor);

    if (wantsPagination) {
      const parsedLimit = Number.parseInt(String(limitRaw ?? ''), 10);
      const limit = Number.isFinite(parsedLimit)
        ? Math.max(1, Math.min(parsedLimit, 200))
        : 60;

      let query = {};
      if (cursor) {
        if (!ObjectId.isValid(cursor)) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'Invalid cursor' }));
        }
        query = { _id: { $lt: new ObjectId(cursor) } };
      }

      const docs = await collection
        .find(query, { projection: { prompt: 1, metadata: 1, telegram: 1, timestamp: 1 } })
        .sort({ _id: -1 })
        .limit(limit + 1)
        .toArray();

      const hasMore = docs.length > limit;
      const pageDocs = hasMore ? docs.slice(0, limit) : docs;
      const items = pageDocs.map(toGalleryItem);
      const nextCursor = hasMore && pageDocs.length > 0
        ? pageDocs[pageDocs.length - 1]._id.toString()
        : null;

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=60'); // 缓存 60 秒
      return res.end(JSON.stringify({
        items,
        hasMore,
        nextCursor,
        limit,
      }));
    }

    // 旧版行为：仍然一次返回最多 200 条
    const docs = await collection
      .find({}, { projection: { prompt: 1, metadata: 1, telegram: 1, timestamp: 1 } })
      .sort({ timestamp: -1 })
      .limit(200)
      .toArray();

    const out = docs.map(toGalleryItem);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=60'); // 缓存 60 秒
    return res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: String(e) }));
  } finally {
    await client.close();
  }
}
