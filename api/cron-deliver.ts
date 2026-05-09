// api/cron-deliver.ts
// 100% stock images + automatic text overlay via Sharp
// No AI image generation — zero cost
//
// Flow:
// 1. Finds pieces in "generated" status approaching their schedule
// 2. For each slide: picks a stock image, overlays the slide text using Sharp
// 3. Uploads final images to Supabase Storage
// 4. Delivers via Telegram when scheduled_for has passed

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

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

// ── Stock image picker ──────────────────────────────────────────────────────

async function pickStockImage(direction: string, preferredTone?: string, excludeIds?: string[]): Promise<{ id: string; path: string; tone: string } | null> {
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

  // Build query — prefer same tone for visual cohesion
  let query = supabase
    .from('stock_images')
    .select('id, storage_path, tone, used_count')
    .order('used_count', { ascending: true });

  // Filter by tone if specified (ensures all slides in a carousel look cohesive)
  if (preferredTone) {
    query = query.eq('tone', preferredTone);
  }

  // Exclude already-used images in this carousel
  if (excludeIds && excludeIds.length > 0) {
    query = query.not('id', 'in', `(${excludeIds.join(',')})`);
  }

  // Try with category first
  const { data: catMatch } = await query
    .eq('category', bestCategory)
    .limit(1)
    .single();

  if (catMatch) {
    await supabase.from('stock_images').update({ used_count: (catMatch.used_count || 0) + 1 }).eq('id', catMatch.id);
    return { id: catMatch.id, path: catMatch.storage_path, tone: catMatch.tone || 'neutral' };
  }

  // Fallback: same tone, any category
  let fallbackQuery = supabase
    .from('stock_images')
    .select('id, storage_path, tone, used_count')
    .order('used_count', { ascending: true });

  if (preferredTone) {
    fallbackQuery = fallbackQuery.eq('tone', preferredTone);
  }
  if (excludeIds && excludeIds.length > 0) {
    fallbackQuery = fallbackQuery.not('id', 'in', `(${excludeIds.join(',')})`);
  }

  const { data: toneFallback } = await fallbackQuery.limit(1).single();

  if (toneFallback) {
    await supabase.from('stock_images').update({ used_count: (toneFallback.used_count || 0) + 1 }).eq('id', toneFallback.id);
    return { id: toneFallback.id, path: toneFallback.storage_path, tone: toneFallback.tone || 'neutral' };
  }

  // Last resort: anything
  const { data: anyImg } = await supabase
    .from('stock_images')
    .select('id, storage_path, tone, used_count')
    .order('used_count', { ascending: true })
    .limit(1)
    .single();

  if (anyImg) {
    await supabase.from('stock_images').update({ used_count: (anyImg.used_count || 0) + 1 }).eq('id', anyImg.id);
    return { id: anyImg.id, path: anyImg.storage_path, tone: anyImg.tone || 'neutral' };
  }

  return null;
}

// ── Text overlay via Sharp ──────────────────────────────────────────────────

async function overlayTextOnImage(imageBuffer: Buffer, text: string): Promise<Buffer> {
  // Get image dimensions
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 1080;
  const height = metadata.height || 1350;

  // Split text into lines (max ~30 chars per line for readability)
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const test = currentLine ? `${currentLine} ${word}` : word;
    if (test.length > 28 && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = test;
    }
  }
  if (currentLine) lines.push(currentLine);

  // Calculate font size based on image width
  const fontSize = Math.round(width * 0.055); // ~60px on 1080w
  const lineHeight = Math.round(fontSize * 1.5);
  const textBlockHeight = lines.length * lineHeight;

  // Position: upper third, left-aligned with padding
  const xPad = Math.round(width * 0.08);
  const yStart = Math.round(height * 0.15);

  // Build SVG text overlay
  const svgLines = lines.map((line, i) => {
    const y = yStart + (i * lineHeight) + fontSize;
    // Escape special XML characters
    const escaped = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
    return `<text x="${xPad}" y="${y}" font-family="Georgia, 'Times New Roman', serif" font-weight="300" font-size="${fontSize}" fill="rgba(255,255,255,0.92)" letter-spacing="-0.5">${escaped}</text>`;
  }).join('\n');

  // Semi-transparent background behind text for legibility
  const bgY = yStart - Math.round(fontSize * 0.3);
  const bgHeight = textBlockHeight + Math.round(fontSize * 0.8);

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${bgY}" width="${width}" height="${bgHeight}" fill="rgba(0,0,0,0.35)" />
    ${svgLines}
  </svg>`;

  // Composite SVG over image
  const result = await sharp(imageBuffer)
    .composite([{
      input: Buffer.from(svg),
      top: 0,
      left: 0,
    }])
    .png()
    .toBuffer();

  return result;
}

// ── Download image from Supabase Storage ────────────────────────────────────

async function downloadStockImage(path: string): Promise<Buffer | null> {
  const { data, error } = await supabase.storage
    .from('stock-images')
    .download(path);

  if (error || !data) {
    console.error('[cron-deliver] Download error:', error);
    return null;
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── Upload final image to Supabase Storage ──────────────────────────────────

async function uploadFinalImage(buffer: Buffer, pieceId: string, slideIndex: number): Promise<string | null> {
  const filename = `final/${pieceId}/slide-${slideIndex}.png`;

  const { error } = await supabase.storage
    .from('content-images')
    .upload(filename, buffer, {
      contentType: 'image/png',
      upsert: true,
    });

  if (error) {
    console.error('[cron-deliver] Upload error:', error);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from('content-images')
    .getPublicUrl(filename);

  return urlData?.publicUrl || null;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const now = new Date().toISOString();

    // ── STEP 1: Produce images for upcoming pieces ──
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

      console.log(`[cron-deliver] Producing images for piece ${piece.id} (${slides.length} slides)`);

      // First pass: pick the tone from the first slide's image, then use same tone for all
      let carouselTone: string | undefined;
      const usedImageIds: string[] = [];

      for (let i = 0; i < slides.length; i++) {
        const slideText = slides[i] || '';
        const direction = prompts[i]?.direction || 'dark moody piano';

        // Pick stock image — same tone as first slide, exclude already used
        const stock = await pickStockImage(direction, carouselTone, usedImageIds);
        if (!stock) {
          console.error(`[cron-deliver] No stock image found for slide ${i}`);
          imageUrls.push('');
          continue;
        }

        // Lock the tone from the first image for the rest of the carousel
        if (i === 0) {
          carouselTone = stock.tone;
        }

        usedImageIds.push(stock.id);
        stockKeys.push(stock.path);

        // Download stock image
        const imageBuffer = await downloadStockImage(stock.path);
        if (!imageBuffer) {
          imageUrls.push('');
          continue;
        }

        // Overlay text
        const finalBuffer = await overlayTextOnImage(imageBuffer, slideText);

        // Upload final image
        const url = await uploadFinalImage(finalBuffer, piece.id, i);
        imageUrls.push(url || '');
      }

      // Update piece
      await supabase
        .from('content_pieces')
        .update({
          final_image_urls: imageUrls,
          stock_image_keys: stockKeys,
          image_mode: 'stock',
          status: 'ready',
        })
        .eq('id', piece.id);

      console.log(`[cron-deliver] Piece ${piece.id} ready with ${imageUrls.filter(u => u).length} images`);
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

    // Send text summary
    let message = `🎹 <b>POST READY</b>\n\n`;
    message += `<b>Caption:</b>\n${caption}\n\n`;
    slides.forEach((s: string, i: number) => {
      message += `<b>${i + 1}.</b> ${s}\n`;
    });

    await sendTelegramMessage(message);

    // Send images as media group
    const validUrls = imageUrls.filter(u => u && u.startsWith('http'));
    if (validUrls.length > 1) {
      await sendTelegramMediaGroup(validUrls, caption);
    } else if (validUrls.length === 1) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, photo: validUrls[0], caption }),
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
