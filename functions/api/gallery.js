import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'GET' && request.method !== 'DELETE') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const authHeader = request.headers.get('authorization') || '';
  const auth = authHeader.split(' ')[1];
  const SECRET = env.JWT_SECRET || 'change-me';
  
  try {
    if (!auth) throw new Error('No token');
    jwt.verify(auth, SECRET);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const MONGO_URI = env.MONGO_URI;
  if (!MONGO_URI) {
    return new Response(JSON.stringify({ error: 'MONGO_URI not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db('magic_plugin_db');
    const collection = db.collection('gallery');

    if (request.method === 'DELETE') {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
        // ignore
      }
      const id = body?.id || url.searchParams.get('id');
      if (!id) {
        return new Response(JSON.stringify({ error: 'Missing id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      const result = await collection.deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 1) {
        return new Response(JSON.stringify({ ok: true, deletedId: id }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
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

    const limitRaw = url.searchParams.get('limit');
    const cursorRaw = url.searchParams.get('cursor');
    const cursor = typeof cursorRaw === 'string' ? cursorRaw.trim() : '';
    const wantsPagination = limitRaw !== null || Boolean(cursor);

    if (wantsPagination) {
      const parsedLimit = Number.parseInt(limitRaw || '', 10);
      const limit = Number.isFinite(parsedLimit)
        ? Math.max(1, Math.min(parsedLimit, 200))
        : 60;

      let query = {};
      if (cursor) {
        if (!ObjectId.isValid(cursor)) {
          return new Response(JSON.stringify({ error: 'Invalid cursor' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
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

      return new Response(JSON.stringify({
        items,
        hasMore,
        nextCursor,
        limit,
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60' // 缓存 60 秒
        }
      });
    }

    const docs = await collection
      .find({}, { projection: { prompt: 1, metadata: 1, telegram: 1, timestamp: 1 } })
      .sort({ timestamp: -1 })
      .limit(200)
      .toArray();

    const out = docs.map(toGalleryItem);
    return new Response(JSON.stringify(out), {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60' // 缓存 60 秒
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } finally {
    await client.close();
  }
}
