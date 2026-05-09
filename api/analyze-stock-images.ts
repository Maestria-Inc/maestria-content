// api/analyze-stock-images.ts
// Sends each unanalyzed stock image to Claude Vision
// Gets back: description, tone, dominant color, subject, category
// Stores everything in stock_images table
//
// POST /api/analyze-stock-images
// Optional body: { "limit": 10 } — how many to process per call (default 10)
//
// Call multiple times until all images are analyzed
// (avoids Vercel timeout on large batches)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const limit = req.body?.limit || 10;

    // Get unanalyzed images
    const { data: images, error: fetchErr } = await supabase
      .from('stock_images')
      .select('id, storage_path')
      .eq('analyzed', false)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (fetchErr) {
      return res.status(500).json({ error: 'Failed to fetch images', detail: fetchErr.message });
    }

    if (!images || images.length === 0) {
      return res.status(200).json({ ok: true, message: 'All images already analyzed', analyzed: 0 });
    }

    const results: any[] = [];

    for (const img of images) {
      try {
        // Download image from Supabase Storage
        const { data: fileData, error: dlErr } = await supabase.storage
          .from('stock-images')
          .download(img.storage_path);

        if (dlErr || !fileData) {
          console.warn(`[analyze] Failed to download ${img.storage_path}:`, dlErr?.message);
          continue;
        }

        // Convert to base64
        const arrayBuffer = await fileData.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');

        // Detect media type from extension
        const ext = img.storage_path.toLowerCase().split('.').pop() || 'jpg';
        const mediaType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

        // Send to Claude Vision
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64,
                },
              },
              {
                type: 'text',
                text: `Analyze this image for use in a moody piano-themed TikTok carousel.

Respond ONLY in valid JSON, no markdown, no backticks:
{
  "description": "One sentence describing what's in the image",
  "tone": "dark" | "light" | "warm" | "neutral" | "bw",
  "dominant_color": "black" | "white" | "cream" | "brown" | "gray" | "sepia",
  "subject": "grand_piano" | "upright_piano" | "piano_keys" | "hands" | "room" | "sheet_music" | "silhouette" | "bench" | "window" | "other",
  "category": "piano" | "hands" | "room" | "sheet_music" | "mood_dark" | "mood_light",
  "mood": "intimate" | "dramatic" | "peaceful" | "lonely" | "elegant" | "melancholic"
}

Be precise about the tone — "dark" means predominantly dark/shadowy, "light" means bright/airy, "warm" means golden/cream tones, "bw" means true black and white, "neutral" means mixed/balanced.`,
              },
            ],
          }],
        });

        // Parse response
        const rawText = message.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('');

        let analysis: any;
        try {
          analysis = JSON.parse(rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
        } catch {
          console.warn(`[analyze] Failed to parse response for ${img.storage_path}:`, rawText.slice(0, 200));
          continue;
        }

        // Update database
        const { error: updateErr } = await supabase
          .from('stock_images')
          .update({
            description: analysis.description || '',
            tone: analysis.tone || 'neutral',
            dominant_color: analysis.dominant_color || '',
            subject: analysis.subject || '',
            category: analysis.category || 'piano',
            tags: [analysis.mood || '', analysis.subject || '', analysis.dominant_color || ''].filter(Boolean),
            analyzed: true,
          })
          .eq('id', img.id);

        if (!updateErr) {
          results.push({
            path: img.storage_path,
            tone: analysis.tone,
            category: analysis.category,
            description: analysis.description,
          });
        }

      } catch (imgErr: any) {
        console.warn(`[analyze] Error processing ${img.storage_path}:`, imgErr.message);
      }
    }

    // Check how many remain
    const { count } = await supabase
      .from('stock_images')
      .select('id', { count: 'exact', head: true })
      .eq('analyzed', false);

    return res.status(200).json({
      ok: true,
      analyzed: results.length,
      remaining: count || 0,
      results,
    });

  } catch (err: any) {
    console.error('[analyze-stock-images] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
