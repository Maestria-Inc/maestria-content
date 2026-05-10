// api/generate-batch.ts
// The Brain — generates a batch of TikTok carousel scripts
// Fed with past performance data to iterate week over week
//
// Called by N8N cron (weekly) or manually
// POST /api/generate-batch { batch_size?: number }

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

// ── System Prompt — The Maestria Content Engine ──────────────────────────────

const SYSTEM_PROMPT = `You are the content engine for Maestria, an AI-powered piano composition app. Your job is to generate TikTok carousel scripts that drive profile visits and link-in-bio clicks.

═══ THE PRODUCT ═══
Maestria creates unique piano pieces that have never been played before. The user chooses a mood (Nocturne, Étude, Prélude, Ballade, Méditation). A fictional character is born — with a story, a life, a reason for the music to exist. The piece is composed from that soul. The user receives: the audio file, the sheet music (PDF), and the complete story. Delivered within the hour. Price: $14.99.

═══ THE PERSONA (updated) ═══
Adult pianist, takes piano seriously. Not a beginner — they've been playing for years. They know Chopin, Debussy, Satie. They have reference pieces they love. They understand musical forms. They care about the story behind the music, not just the notes.

Their core problem is NOT that they lack skill or repertoire. It's that when they sit at the piano, they can't choose what to play — because no piece has a reason to be picked over another. It's the Netflix paradox: 10,000 series available, and you say "there's nothing to watch." Not because the catalog is empty, but because nothing pulls you. Nothing says "this one, tonight, for YOU."

That's what Maestria solves: it gives each piece a reason to exist for you specifically. A mood you chose, a soul that was born from it, a story you discover. The piece isn't just music — it's an answer to "why this one?"

═══ THE PAIN THAT CONVERTS ═══
Based on real TikTok performance data, these specific pains drive action (profile visits + link clicks):
- "I don't know what to play" — the paralysis of sitting down with no direction
- "I'm bored after 2 minutes" — nothing feels worth finishing  
- "The same 3 songs on repeat" — the repertoire loop
- "I want to create but nothing comes out" — creative block at the piano
- "Maybe tomorrow" — closing the lid and walking away

These CONCEPTUAL observations get engagement (likes) but NOT action:
- "Pianists watch more piano videos than they play" — too abstract
- "Playing only when nobody's home" — relatable but no urgency
Avoid these for conversion-focused content.

═══ FORMAT RULES ═══
- Exactly 6 slides per carousel

- Slide 1: Hook. MAX 12 WORDS. One gut-punch sentence. The person must feel called out in under 2 seconds.
  GOOD: "You start playing… And 2 minutes later, you're bored."
  GOOD: "Ever sat at your piano… And had nothing to play?"
  BAD: "You sat down tonight and played the intro to the same piece for the third time this week." (too long, too narrative)

- Slides 2-3: Escalate. MAX 12 WORDS EACH. Stay punchy. One thought per slide.
  GOOD: "So you go back to what's safe… The same 3 songs."
  GOOD: "So you switch songs. Again. And again."
  BAD: "Not because you love it that much. Because nothing else had a reason to be next." (too wordy, too clever)

- Slide 4: The pivot. MAX 10 WORDS. A question or a shift. This slide is short on purpose.
  GOOD: "What if tonight was different?"
  GOOD: "Let's give you a reason to care."
  BAD: "What if the piece already knew it was for tonight?" (too abstract, too poetic)

- Slide 5: The resolution. MAX 15 WORDS. What THEY get. Not a product description. Not a pitch. Not a feature list. NEVER mention "Maestria" by name — it looks like an ad and they stop reading.
  GOOD: "A piece composed for tonight. The audio. The sheet music. Yours."
  GOOD: "One mood. One piece. Yours within the hour."
  BAD: "Maestria composes one piece for the mood you choose — with a story, a soul, a reason to exist for you specifically. Sheet music included. Ready within the hour." (this is a paragraph, not a slide)

- Slide 6: "Link in bio." — ONLY these three words. Nothing else. Ever.

═══ STYLE RULES ═══
- HARD LIMIT: No slide exceeds 15 words. Most slides should be 8-12 words.
- Max 2 lines of text per slide. Never 3.
- Conversational, direct. Like talking to a friend at 11pm.
- No exclamation marks. No emojis. No hashtags in slide text.
- Use ellipsis (...) sparingly — max once per carousel.
- Second person only ("you", never "we" or "I")
- NEVER mention "Maestria" anywhere in the slides. The brand is invisible. The page does the selling.
- Never mention the price.
- Never list features. Never use dashes or bullet points in slide text.
- If a slide sounds like ad copy, rewrite it. If it sounds like a friend texting you at midnight, keep it.

═══ IMAGE DIRECTION PER SLIDE ═══
For each carousel, also provide image direction — a brief description of what the image should show/feel like. This will be used either to generate an AI image or to select a matching stock photo.
Categories available for stock: piano, hands, room, sheet_music, mood_dark, mood_light
Keep directions moody, dark, intimate. Think: dimly lit room, a piano waiting, hands hovering over keys, an empty bench. Never bright, never colorful, never cheerful.

═══ CAPTION ═══
Write a TikTok caption (max 150 chars) that reinforces the hook without repeating it. End with relevant hashtags (3-5).

═══ OUTPUT FORMAT ═══
Respond ONLY in valid JSON array. No markdown. No backticks. Each element:
{
  "slides": ["slide 1 text", "slide 2", "slide 3", "slide 4", "slide 5", "slide 6"],
  "image_directions": ["dark piano in empty room", "hands hovering over keys", ...],
  "caption": "caption text #hashtag1 #hashtag2"
}`;

// ── Fetch last batch performance ─────────────────────────────────────────────

async function getPerformanceContext(): Promise<string> {
  // Get the last 2 batches worth of pieces with performance data
  const { data: pieces } = await supabase
    .from('content_pieces')
    .select('slide_texts, tiktok_views, tiktok_likes, tiktok_profile_views, tiktok_site_clicks, engagement_score, conversion_score')
    .not('tiktok_views', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!pieces || pieces.length === 0) {
    return 'No performance data yet. This is the first batch. Use the pain points that are marked as high-converting in the system prompt.';
  }

  // Sort by conversion score (profile views / views = what actually drives business)
  const sorted = [...pieces].sort((a, b) => (b.conversion_score || 0) - (a.conversion_score || 0));
  
  const top = sorted.slice(0, 5);
  const bottom = sorted.slice(-5);

  let ctx = 'PERFORMANCE DATA FROM PREVIOUS BATCHES:\n\n';
  
  ctx += '── TOP PERFORMERS (highest profile visit rate) ──\n';
  top.forEach((p, i) => {
    const slides = Array.isArray(p.slide_texts) ? p.slide_texts : [];
    ctx += `${i + 1}. Hook: "${slides[0] || 'N/A'}" | Views: ${p.tiktok_views} | Likes: ${p.tiktok_likes} | Profile visits: ${p.tiktok_profile_views} | Site clicks: ${p.tiktok_site_clicks} | Conversion: ${((p.conversion_score || 0) * 100).toFixed(1)}%\n`;
  });
  
  ctx += '\n── LOWEST PERFORMERS ──\n';
  bottom.forEach((p, i) => {
    const slides = Array.isArray(p.slide_texts) ? p.slide_texts : [];
    ctx += `${i + 1}. Hook: "${slides[0] || 'N/A'}" | Views: ${p.tiktok_views} | Profile visits: ${p.tiktok_profile_views} | Conversion: ${((p.conversion_score || 0) * 100).toFixed(1)}%\n`;
  });

  ctx += '\nINSTRUCTION: Generate new scripts that follow the PATTERNS of top performers (pain specificity, physical actions at the piano, directness) and AVOID the patterns of low performers. Do NOT repeat hooks — create new angles on the same core pains.';

  return ctx;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const batchSize = req.body?.batch_size || 21;
    const performanceContext = await getPerformanceContext();

    // Get current week number
    const now = new Date();
    const weekNumber = Math.ceil(
      (now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 604800000
    );

    // Create batch record
    const { data: batch, error: batchErr } = await supabase
      .from('content_batches')
      .insert({
        week_number: weekNumber,
        batch_size: batchSize,
        system_prompt_version: 'v1',
        performance_context: { raw: performanceContext },
        system_prompt_used: SYSTEM_PROMPT,
      })
      .select('id')
      .single();

    if (batchErr || !batch) {
      return res.status(500).json({ error: 'Failed to create batch', detail: batchErr });
    }

    // Generate in chunks of 7 to stay within token limits
    const CHUNK_SIZE = 7;
    let allCarousels: any[] = [];

    for (let chunk = 0; chunk < Math.ceil(batchSize / CHUNK_SIZE); chunk++) {
      const remaining = batchSize - allCarousels.length;
      const thisChunk = Math.min(CHUNK_SIZE, remaining);
      
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Generate ${thisChunk} carousel scripts for this week (batch ${chunk + 1} of ${Math.ceil(batchSize / CHUNK_SIZE)}).\n\n${performanceContext}\n\n${allCarousels.length > 0 ? `ALREADY GENERATED HOOKS (do NOT repeat these):\n${allCarousels.map(c => `- "${c.slides?.[0]}"`).join('\n')}\n\n` : ''}Respond ONLY in valid JSON array. No markdown, no backticks.`,
        }],
      });

      const rawText = message.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      try {
        const parsed = JSON.parse(rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
        allCarousels = allCarousels.concat(parsed);
      } catch {
        console.error(`[generate-batch] Failed to parse chunk ${chunk + 1}:`, rawText.slice(0, 300));
        // Continue with what we have
      }
    }

    const carousels = allCarousels.slice(0, batchSize);

    // Store each piece with auto-scheduling
    // 3 posts per day, at 13:00, 18:00, 23:00 UTC
    // = 10h, 15h, 20h Guyane = 9AM, 2PM, 7PM US Eastern
    const POST_HOURS_UTC = [13, 18, 23];
    const pieces = [];

    // Start scheduling from tomorrow
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() + 1);
    startDate.setUTCHours(0, 0, 0, 0);

    for (let i = 0; i < carousels.length; i++) {
      const c = carousels[i];
      
      // Calculate scheduled time: piece i → day floor(i/3), slot i%3
      const dayOffset = Math.floor(i / POST_HOURS_UTC.length);
      const slotIndex = i % POST_HOURS_UTC.length;
      const scheduledFor = new Date(startDate);
      scheduledFor.setUTCDate(scheduledFor.getUTCDate() + dayOffset);
      scheduledFor.setUTCHours(POST_HOURS_UTC[slotIndex], 0, 0, 0);

      // Extract hashtags from caption
      const hashtagMatch = (c.caption || '').match(/#\w+/g);
      const captionClean = (c.caption || '').replace(/#\w+/g, '').trim();

      const { data: piece, error: pieceErr } = await supabase
        .from('content_pieces')
        .insert({
          batch_id: batch.id,
          piece_index: i,
          slide_texts: c.slides || [],
          caption: captionClean,
          hashtags: hashtagMatch || [],
          image_mode: 'alternate',
          image_prompts: (c.image_directions || []).map((dir: string, idx: number) => ({
            slide_index: idx,
            direction: dir,
            mode: idx % 2 === 0 ? 'stock' : 'ai',
          })),
          status: 'generated',
          scheduled_for: scheduledFor.toISOString(),
        })
        .select('id, piece_index, slide_texts, caption, scheduled_for')
        .single();

      if (piece) pieces.push(piece);
    }

    return res.status(200).json({
      ok: true,
      batch_id: batch.id,
      pieces_generated: pieces.length,
      pieces: pieces.map(p => ({
        id: p.id,
        index: p.piece_index,
        hook: Array.isArray(p.slide_texts) ? p.slide_texts[0] : 'N/A',
        caption: p.caption,
      })),
    });

  } catch (err: any) {
    console.error('[generate-batch] Error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}