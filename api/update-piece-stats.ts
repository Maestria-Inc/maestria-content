// api/update-piece-stats.ts
// Manual stats update — for metrics TikTok API doesn't provide per-video
// (profile views, site clicks from Plausible)
//
// POST /api/update-piece-stats
// { piece_id, tiktok_profile_views?, tiktok_site_clicks?, tiktok_saves? }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { piece_id, tiktok_profile_views, tiktok_site_clicks, tiktok_saves, tiktok_video_id } = req.body;

  if (!piece_id) return res.status(400).json({ error: 'piece_id required' });

  const updates: Record<string, any> = {};
  if (tiktok_profile_views !== undefined) updates.tiktok_profile_views = tiktok_profile_views;
  if (tiktok_site_clicks !== undefined) updates.tiktok_site_clicks = tiktok_site_clicks;
  if (tiktok_saves !== undefined) updates.tiktok_saves = tiktok_saves;
  if (tiktok_video_id !== undefined) updates.tiktok_video_id = tiktok_video_id;

  // Recalculate conversion score if we have the data
  if (tiktok_profile_views !== undefined) {
    const { data: piece } = await supabase
      .from('content_pieces')
      .select('tiktok_views')
      .eq('id', piece_id)
      .single();
    
    if (piece?.tiktok_views && piece.tiktok_views > 0) {
      updates.conversion_score = tiktok_profile_views / piece.tiktok_views;
    }
  }

  updates.analyzed_at = new Date().toISOString();

  const { error } = await supabase
    .from('content_pieces')
    .update(updates)
    .eq('id', piece_id);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
