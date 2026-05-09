// api/sync-tiktok-stats.ts
// Feedback Loop — pulls performance data from TikTok API
// and updates content_pieces in Supabase
//
// Called by N8N cron (daily or every 12h)
// POST /api/sync-tiktok-stats
//
// TikTok Business API requires:
// - TIKTOK_ACCESS_TOKEN (from TikTok Developer Portal)
// - TIKTOK_BUSINESS_ID

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TIKTOK_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN!;

// ── TikTok API helpers ──────────────────────────────────────────────────────

async function fetchTikTokVideos(): Promise<any[]> {
  // TikTok Content Posting API — list videos
  // Docs: https://developers.tiktok.com/doc/content-posting-api-reference-get-video-list
  const res = await fetch('https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,like_count,comment_count,share_count,view_count,duration', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TIKTOK_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      max_count: 20,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`TikTok API error: ${res.status} — ${err}`);
  }

  const data = await res.json();
  return data.data?.videos || [];
}

async function fetchVideoDetails(videoId: string): Promise<any> {
  // Query specific video stats
  const res = await fetch('https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TIKTOK_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filters: {
        video_ids: [videoId],
      },
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.videos?.[0] || null;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    // 1. Get all pieces that have been posted but not yet analyzed (or need refresh)
    const { data: pieces } = await supabase
      .from('content_pieces')
      .select('id, tiktok_video_id, posted_at')
      .in('status', ['posted', 'analyzed'])
      .not('tiktok_video_id', 'is', null)
      .order('posted_at', { ascending: false })
      .limit(30);

    if (!pieces || pieces.length === 0) {
      return res.status(200).json({ ok: true, message: 'No posted pieces to sync', updated: 0 });
    }

    let updated = 0;

    // 2. For each piece with a TikTok video ID, fetch latest stats
    for (const piece of pieces) {
      try {
        const stats = await fetchVideoDetails(piece.tiktok_video_id);
        if (!stats) continue;

        const views = stats.view_count || 0;
        const likes = stats.like_count || 0;
        const comments = stats.comment_count || 0;
        const shares = stats.share_count || 0;

        // Calculate scores
        const engagementScore = views > 0 
          ? (likes + comments + shares) / views 
          : 0;

        // Profile views and site clicks need manual input or Plausible correlation
        // For now, we store what TikTok gives us and leave profile/site fields 
        // to be updated manually or via a separate Plausible sync

        await supabase
          .from('content_pieces')
          .update({
            tiktok_views: views,
            tiktok_likes: likes,
            tiktok_comments: comments,
            tiktok_shares: shares,
            engagement_score: engagementScore,
            status: 'analyzed',
            analyzed_at: new Date().toISOString(),
          })
          .eq('id', piece.id);

        updated++;
      } catch (e) {
        console.warn(`[sync] Failed for piece ${piece.id}:`, e);
      }
    }

    // 3. Also try to fetch recent videos and match them to pieces
    //    (for pieces where tiktok_video_id wasn't set yet)
    try {
      const videos = await fetchTikTokVideos();
      const { data: unmatchedPieces } = await supabase
        .from('content_pieces')
        .select('id, slide_texts, posted_at')
        .eq('status', 'posted')
        .is('tiktok_video_id', null)
        .limit(20);

      if (unmatchedPieces && videos.length > 0) {
        // Try to match by posting time proximity
        for (const piece of unmatchedPieces) {
          if (!piece.posted_at) continue;
          const pieceTime = new Date(piece.posted_at).getTime();
          
          const match = videos.find((v: any) => {
            const videoTime = new Date(v.create_time * 1000).getTime();
            return Math.abs(videoTime - pieceTime) < 3600000; // within 1 hour
          });

          if (match) {
            await supabase
              .from('content_pieces')
              .update({ tiktok_video_id: match.id })
              .eq('id', piece.id);
          }
        }
      }
    } catch (e) {
      console.warn('[sync] Video matching failed:', e);
    }

    return res.status(200).json({ ok: true, updated });

  } catch (err: any) {
    console.error('[sync-tiktok-stats] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
