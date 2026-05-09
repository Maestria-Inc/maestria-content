// api/cron-deliver.ts
// Picks stock images for each slide and delivers via Telegram
// Text overlay is done manually in TikTok when posting
//
// Flow:
// 1. Finds pieces in "generated" status approaching their schedule
// 2. For each slide: picks a tone-cohesive stock image
// 3. Sends images + slide texts via Telegram
// 4. Updates status

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;

// ── Telegram helpers ────────────────────────────────────────────────────────

async function sendTelegramMessage(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
  });
}

async function sendTelegramMediaGroup(mediaUrls: string[], caption?: string) {
  const media = mediaUrls.map((url, i) => ({
    type: 'photo' as const,
    media: url,
    ...(i === 0 && caption ? { caption } : {}),
  }));

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMediaGroup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, media }),
  });
}

// ── Stock image picker (tone-cohesive) ──────────────────────────────────────

async function pickStockImage(direction: string, preferredTone?: string, excludeIds?: string[]): Promise<{ id: string; url: string; tone: string } | null> {
  const categoryMap: Record<string, string[]> = {
    piano: ['piano', 'grand piano', 'upright', 'keys', 'keyboard', 'bench'],
    hands: ['hands', 'fingers', 'touching', 'hovering', 'playing'],
    room: ['room', 'empty', 'dark room', 'window', 'light', 'door'],
    sheet_music: ['sheet', 'score', 'partition', 'music stand', 'pages'],
    mood_dark: ['shadow', 'dark', 'night', 'dim', 'silhouette', 'fog'],
    mood_light: ['morning', 'dawn', 'soft light', 'gentle', 'quiet'],
  };

  let bestCategory = 'piano';
  const dirLower = (direction || '').toLowerCase();
  for (const [cat, keywords] of Object.entries(categoryMap)) {
    if (keywords.some(kw => dirLower.includes(kw))) {
      bestCategory = cat;
      break;
    }
  }

  // Try: same tone + same category
  const attempts = [
    { tone: preferredTone, category: bestCategory },
    { tone: preferredTone, category: undefined },
    { tone: undefined, category: bestCategory },
    { tone: undefined, category: undefined },
  ];

  for (const attempt of attempts) {
    let query = supabase
      .from('stock_images')
      .select('id, storage_path, tone, used_count')
      .order('used_count', { ascending: true });

    if (attempt.tone) query = query.eq('tone', attempt.tone);
    if (attempt.category) query = query.eq('category', attempt.category);
    if (excludeIds && excludeIds.length > 0) {
      query = query.not('id', 'in', `(${excludeIds.join(',')})`);
    }

    const { data: img } = await query.limit(1).single();

    if (img) {
      await supabase.from('stock_images').update({ used_count: (img.used_count || 0) + 1 }).eq('id', img.id);
      
      // Get public URL
      const { data: urlData } = supabase.storage
        .from('stock-images')
        .getPublicUrl(img.storage_path);

      return {
        id: img.id,
        url: urlData?.publicUrl || '',
        tone: img.tone || 'neutral',
      };
    }
  }

  return null;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const now = new Date().toISOString();

    // ── STEP 1: Produce image selections for upcoming pieces ──
    const { data: needsImages } = await supabase
      .from('content_pieces')
      .select('id, slide_texts, image_prompts')
      .eq('status', 'generated')
      .lte('scheduled_for', new Date(Date.now() + 6 * 3600000).toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(1);

    if (needsImages && needsImages.length > 0) {
      const piece = needsImages[0];
      const slides: string[] = Array.isArray(piece.slide_texts) ? piece.slide_texts : [];
      const prompts: any[] = Array.isArray(piece.image_prompts) ? piece.image_prompts : [];
      const imageUrls: string[] = [];
      const stockKeys: string[] = [];
      let carouselTone: string | undefined;
      const usedImageIds: string[] = [];

      for (let i = 0; i < slides.length; i++) {
        const direction = prompts[i]?.direction || 'dark moody piano';
        const stock = await pickStockImage(direction, carouselTone, usedImageIds);

        if (!stock) {
          imageUrls.push('');
          continue;
        }

        if (i === 0) carouselTone = stock.tone;
        usedImageIds.push(stock.id);
        stockKeys.push(stock.id);
        imageUrls.push(stock.url);
      }

      await supabase
        .from('content_pieces')
        .update({
          final_image_urls: imageUrls,
          stock_image_keys: stockKeys,
          image_mode: 'stock',
          status: 'ready',
        })
        .eq('id', piece.id);
    }

    // ── STEP 2: Deliver ready pieces whose time has come ──
    const { data: toDeliver } = await supabase
      .from('content_pieces')
      .select('id, slide_texts, caption, hashtags, final_image_urls, scheduled_for')
      .eq('status', 'ready')
      .lte('scheduled_for', now)
      .order('scheduled_for', { ascending: true })
      .limit(1);

    if (!toDeliver || toDeliver.length === 0) {
      return res.status(200).json({ ok: true, message: 'Nothing to deliver right now' });
    }

    const piece = toDeliver[0];
    const slides: string[] = Array.isArray(piece.slide_texts) ? piece.slide_texts : [];
    const imageUrls: string[] = Array.isArray(piece.final_image_urls) ? piece.final_image_urls : [];
    const hashtags = Array.isArray(piece.hashtags) ? piece.hashtags.join(' ') : '';
    const caption = `${piece.caption || ''} ${hashtags}`.trim();

    // Send slide texts with numbering
    let message = `🎹 <b>POST READY</b>\n\n`;
    message += `<b>Caption:</b>\n${caption}\n\n`;
    slides.forEach((s: string, i: number) => {
      message += `<b>Slide ${i + 1}:</b> ${s}\n\n`;
    });
    message += `📷 Images below — add text in TikTok`;

    await sendTelegramMessage(message);

    // Send images
    const validUrls = imageUrls.filter(u => u && u.startsWith('http'));
    if (validUrls.length > 1) {
      await sendTelegramMediaGroup(validUrls);
    } else if (validUrls.length === 1) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, photo: validUrls[0] }),
      });
    }

    // Update status
    await supabase
      .from('content_pieces')
      .update({ status: 'delivered' })
      .eq('id', piece.id);

    return res.status(200).json({ ok: true, delivered: piece.id, images: validUrls.length });

  } catch (err: any) {
    console.error('[cron-deliver] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}