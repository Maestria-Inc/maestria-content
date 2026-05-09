// api/sync-stock-images.ts
// Scans the stock-images bucket in Supabase Storage
// and creates entries in the stock_images table for any new files
//
// POST /api/sync-stock-images
// Optional body: { "default_category": "piano" }
//
// Category is auto-detected from filename if it contains a keyword:
//   piano, hands, room, sheet, dark, light
// Otherwise uses default_category (defaults to "piano")

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function detectCategory(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes('hand')) return 'hands';
  if (lower.includes('room') || lower.includes('empty') || lower.includes('interior')) return 'room';
  if (lower.includes('sheet') || lower.includes('partition') || lower.includes('score')) return 'sheet_music';
  if (lower.includes('dark') || lower.includes('shadow') || lower.includes('night')) return 'mood_dark';
  if (lower.includes('light') || lower.includes('morning') || lower.includes('bright')) return 'mood_light';
  return 'piano';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const defaultCategory = req.body?.default_category || 'piano';

    // List all files in the stock-images bucket
    const { data: files, error: listError } = await supabase.storage
      .from('stock-images')
      .list('', { limit: 500 });

    if (listError) {
      return res.status(500).json({ error: 'Failed to list bucket', detail: listError.message });
    }

    if (!files || files.length === 0) {
      return res.status(200).json({ ok: true, message: 'No files in bucket', added: 0 });
    }

    // Get existing entries to avoid duplicates
    const { data: existing } = await supabase
      .from('stock_images')
      .select('storage_path');

    const existingPaths = new Set((existing || []).map(e => e.storage_path));

    // Insert new entries
    let added = 0;
    const results: any[] = [];

    for (const file of files) {
      // Skip folders and hidden files
      if (!file.name || file.name.startsWith('.') || !file.id) continue;

      const path = file.name;

      // Skip if already registered
      if (existingPaths.has(path)) continue;

      const category = detectCategory(path) || defaultCategory;

      const { data, error } = await supabase
        .from('stock_images')
        .insert({
          storage_path: path,
          category,
          tags: [],
          used_count: 0,
        })
        .select('id, storage_path, category')
        .single();

      if (data) {
        added++;
        results.push(data);
      } else if (error) {
        console.warn(`[sync-stock] Failed to insert ${path}:`, error.message);
      }
    }

    return res.status(200).json({
      ok: true,
      total_files: files.filter(f => f.id).length,
      already_registered: existingPaths.size,
      added,
      entries: results,
    });

  } catch (err: any) {
    console.error('[sync-stock-images] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
