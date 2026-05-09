// api/cron-deliver.ts
// Checks for pieces whose scheduled_for has passed and delivers via Telegram
// Called by Vercel cron every hour
//
// Also handles the "last mile" image production:
// - For AI images: calls OpenAI API to generate images with text baked in
// - For stock images: picks from stock bank and overlays text via Sharp

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
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
    }),
  });
}

async function sendTelegramPhoto(photoUrl: string, caption?: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      photo: photoUrl,
      caption: caption || '',
    }),
  });
}

async function sendTelegramMediaGroup(mediaUrls: string[], caption?: string) {
  const media = mediaUrls.map((url, i) => ({
    type: 'photo',
    media: url,
    ...(i === 0 && caption ? { caption } : {}),
  }));

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMediaGroup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      media,
    }),
  });
}

// ── Generate AI image via OpenAI ────────────────────────────────────────────

async function generateAIImage(prompt: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1024x1536', // portrait for TikTok carousel
        quality: 'low',    // $0.01 per image
      }),
    });

    if (!res.ok) {
      console.error('[cron-deliver] OpenAI error:', await res.text());
      return null;
    }

    const data = await res.json();
    // gpt-image-1 returns b64_json by default
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return data.data?.[0]?.url || null;

    // Upload base64 image to Supabase Storage
    const buffer = Buffer.from(b64, 'base64');
    const filename = `slide-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`;
    
    const { data: upload, error } = await supabase.storage
      .from('content-images')
      .upload(filename, buffer, { contentType: 'image/png' });

    if (error) {
      console.error('[cron-deliver] Storage upload error:', error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('content-images')
      .getPublicUrl(filename);

    return urlData?.publicUrl || null;
  } catch (e) {
    console.error('[cron-deliver] OpenAI fetch error:', e);
    return null;
  }
}

// ── Pick stock image from Supabase ──────────────────────────────────────────

async function pickStockImage(direction: string): Promise<string | null> {
  // Try to match category from direction keywords
  const categoryMap: Record<string, string[]> = {
    piano: ['piano', 'grand piano', 'upright', 'keys', 'keyboard'],
    hands: ['hands', 'fingers', 'touching', 'hovering'],
    room: ['room', 'empty', 'dark room', 'window', 'light'],
    sheet_music: ['sheet', 'score', 'partition', 'music stand'],
    mood_dark: ['shadow', 'dark', 'night', 'dim', 'silhouette'],
    mood_light: ['morning', 'dawn', 'soft light', 'gentle'],
  };

  let bestCategory = 'piano'; // default
  const dirLower = direction.toLowerCase();
  for (const [cat, keywords] of Object.entries(categoryMap)) {
    if (keywords.some(kw => dirLower.includes(kw))) {
      bestCategory = cat;
      break;
    }
  }

  // Pick least-used image in that category
  const { data: img } = await supabase
    .from('stock_images')
    .select('id, storage_path')
    .eq('category', bestCategory)
    .order('used_count', { ascending: true })
    .limit(1)
    .single();

  if (!img) {
    // Fallback: any category, least used
    const { data: fallback } = await supabase
      .from('stock_images')
      .select('id, storage_path')
      .order('used_count', { ascending: true })
      .limit(1)
      .single();
    
    if (!fallback) return null;
    
    await supabase.from('stock_images').update({ used_count: 1 }).eq('id', fallback.id);
    return fallback.storage_path;
  }

  // Increment used_count
  await supabase.rpc('increment_used_count', { image_id: img.id }).catch(() => {
    // Fallback if RPC doesn't exist
    supabase.from('stock_images').update({ used_count: 1 }).eq('id', img.id);
  });

  return img.storage_path;
}

// ── Build image prompt with text for OpenAI ─────────────────────────────────

function buildImagePrompt(direction: string, slideText: string): string {
  return `${direction}

CRITICAL TEXT REQUIREMENTS:
- Include this exact text in the image: "${slideText}"
- Typography: elegant serif font similar to Cormorant Garamond
- Text placement: upper third of the image, in negative space with high contrast
- Text must be immediately readable — never at the bottom, never vertical, never obscured
- The text should feel printed into the atmosphere, not overlaid

STYLE: monochrome watercolor, black ink wash, grayscale only, cinematic shadows, soft grain, melancholic elegance. No color, no glow, no modern UI.
ASPECT: portrait 9:16`;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow both GET (Vercel cron) and POST (manual trigger)
  
  try {
    const now = new Date().toISOString();

    // 1. Find pieces that need image production (generated → ready)
    const { data: needsImages } = await supabase
      .from('content_pieces')
      .select('id, slide_texts, image_prompts, image_mode')
      .eq('status', 'generated')
      .lte('scheduled_for', new Date(Date.now() + 6 * 3600000).toISOString()) // within next 6 hours
      .order('scheduled_for', { ascending: true })
      .limit(1);

    if (needsImages && needsImages.length > 0) {
      const piece = needsImages[0];
      const slides = Array.isArray(piece.slide_texts) ? piece.slide_texts : [];
      const prompts = Array.isArray(piece.image_prompts) ? piece.image_prompts : [];
      const imageUrls: string[] = [];

      for (let i = 0; i < slides.length; i++) {
        const slideText = slides[i] || '';
        const promptInfo = prompts[i] || {};
        const mode = promptInfo.mode || (i % 2 === 0 ? 'stock' : 'ai');
        const direction = promptInfo.direction || 'dark moody piano scene';

        if (mode === 'ai') {
          const fullPrompt = buildImagePrompt(direction, slideText);
          const url = await generateAIImage(fullPrompt);
          imageUrls.push(url || '');
        } else {
          // Stock image — for now just store the path, overlay happens at delivery
          const stockPath = await pickStockImage(direction);
          imageUrls.push(stockPath || '');
        }
      }

      // Update piece with image URLs and mark as ready
      await supabase
        .from('content_pieces')
        .update({
          final_image_urls: imageUrls,
          status: 'ready',
        })
        .eq('id', piece.id);

      console.log(`[cron-deliver] Produced images for piece ${piece.id}`);
    }

    // 2. Find pieces ready to deliver (scheduled_for has passed)
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
    const slides = Array.isArray(piece.slide_texts) ? piece.slide_texts : [];
    const imageUrls = Array.isArray(piece.final_image_urls) ? piece.final_image_urls : [];
    const hashtags = Array.isArray(piece.hashtags) ? piece.hashtags.join(' ') : '';
    const caption = `${piece.caption || ''} ${hashtags}`.trim();

    // Build Telegram message
    let message = `🎹 <b>CAROUSEL READY TO POST</b>\n\n`;
    message += `<b>Caption:</b> ${caption}\n\n`;
    message += `<b>Slides:</b>\n`;
    slides.forEach((s: string, i: number) => {
      message += `${i + 1}. ${s}\n`;
    });

    // Send notification
    await sendTelegramMessage(message);

    // Send images that have valid URLs (AI-generated ones)
    const validUrls = imageUrls.filter(u => u && u.startsWith('http'));
    if (validUrls.length > 0) {
      if (validUrls.length === 1) {
        await sendTelegramPhoto(validUrls[0]);
      } else {
        // Send in batches of max 10 (Telegram limit)
        for (let i = 0; i < validUrls.length; i += 10) {
          const batch = validUrls.slice(i, i + 10);
          await sendTelegramMediaGroup(batch);
        }
      }
    }

    // For stock images (paths, not URLs), note them in the message
    const stockSlides = imageUrls
      .map((u, i) => (!u || !u.startsWith('http')) ? i + 1 : null)
      .filter(Boolean);
    
    if (stockSlides.length > 0) {
      await sendTelegramMessage(
        `📷 Slides ${stockSlides.join(', ')} use stock images. Add text overlay manually when posting on TikTok, or use the stock images from your bank.`
      );
    }

    // Update status
    await supabase
      .from('content_pieces')
      .update({ status: 'delivered' })
      .eq('id', piece.id);

    return res.status(200).json({ ok: true, delivered: piece.id });

  } catch (err: any) {
    console.error('[cron-deliver] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
