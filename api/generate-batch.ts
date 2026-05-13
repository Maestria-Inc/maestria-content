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

═══ THE PERSONA ═══
Adult pianist, takes piano seriously. Not a beginner — they've been playing for years. They know Chopin, Debussy, Satie. They have reference pieces they love. They understand musical forms. They care about the story behind the music, not just the notes.

Their core problem is NOT that they lack skill or repertoire. It's that when they sit at the piano, they can't choose what to play — because no piece has a reason to be picked over another. It's the Netflix paradox: 10,000 series available, and you say "there's nothing to watch." Not because the catalog is empty, but because nothing pulls you.

═══ MANDATORY ANGLE CATEGORIES ═══
Each batch MUST include carousels from EACH of these categories. You MUST label each carousel with its category in the output. NEVER generate two carousels from the same category in a row.

CATEGORY A — "The Session" (max 7 per batch)
You narrate a specific piano session going wrong tonight. Physical, visceral, present tense.
Example hook: "You start playing… And 2 minutes later, you're bored."

CATEGORY B — "The Pattern" (max 5 per batch)
You zoom out on a recurring behavior they recognize across weeks/months/years.
Example hook: "You've known the same 4 songs for three years."

CATEGORY C — "The Comparison" (max 3 per batch)
You compare their experience to something outside piano that makes the problem click.
Example hook: "10,000 songs on Spotify. Nothing to listen to. Same thing happens at the piano."

CATEGORY D — "The Identity" (max 3 per batch)
You question who they are as a pianist — not attacking, but holding up a mirror.
Example hook: "People ask if you play piano. You say yes. But when?"

CATEGORY E — "The Moment" (max 3 per batch)
You describe a very specific, cinematic micro-moment at the piano that feels too real.
Example hook: "You played the first chord. Then sat there. Hands still on the keys. Going nowhere."

═══ THE NARRATIVE CHAIN — THIS IS CRITICAL ═══
Each carousel is a STORY told across 6 slides. Every slide must create an UNRESOLVED TENSION that FORCES the reader to swipe to the next slide.

The reader swipes because the current slide is INCOMPLETE — emotionally or narratively. NOT because the content is interesting. Because they NEED to know what comes next.

TECHNIQUES FOR CREATING SWIPE TENSION:
- End a slide mid-sentence: "So you go back to what's safe…" (safe WHAT? must swipe)
- End on a consequence that hasn't landed: "So you stop." (and then what?)
- End on a contradiction: "Not because you're bad." (then why? must swipe)
- Ask a question that won't be answered until slide 5: "What if tonight was different?"
- Use "So" or "And" to start the next slide — it connects them like chapters

BAD EXAMPLE (no chain — each slide is independent):
1. "You sit down. Nothing to play."
2. "The same three songs again."
3. "You close the lid."
4. "What if there was something new?"
5. "A piece for tonight."
6. "Link in bio."
WHY IT'S BAD: You can stop at any slide and feel "done." There's no pull forward.

GOOD EXAMPLE (chain — each slide is incomplete without the next):
1. "Ever sat at your piano… And had nothing to play?"
2. "So you go back to what's safe… The same 3 songs."
3. "You want to create something new… But nothing comes out."
4. "So you stop. Close the lid. 'Maybe tomorrow.'"
5. "It's not that you're bad. You just need the right piece."
6. "Link in bio."
WHY IT'S GOOD: Slide 1 asks a question answered in slide 2. Slide 2 creates frustration resolved in slide 3. Slide 3's failure leads to slide 4's giving up. Slide 4's defeat is reframed by slide 5. Each slide NEEDS the next.

═══ FORMAT RULES ═══
- Exactly 6 slides per carousel
- Slide 1: Hook. MAX 12 WORDS. Gut-punch.
- Slides 2-4: The story. MAX 12 WORDS EACH. Each one pulls to the next.
- Slide 5: The resolution. MAX 15 WORDS. What THEY get. Never mention "Maestria". Never list features.
- Slide 6: "Link in bio." — ONLY these three words.

═══ STYLE RULES ═══
- HARD LIMIT: No slide exceeds 15 words.
- Max 2 lines of text per slide.
- Conversational, direct. Like a friend texting at midnight.
- No exclamation marks. No emojis. No hashtags in slide text.
- Ellipsis (...) max once per carousel.
- Second person only ("you").
- NEVER mention "Maestria" in slides.
- Never mention the price.
- If it sounds like ad copy, delete it.

═══ HOOK UNIQUENESS ═══
CRITICAL: Every hook (slide 1) in a batch must be RADICALLY different from every other hook. Not just different words — different STRUCTURE, different SCENE, different ENTRY POINT.

If one hook starts with "You sit down…", NO other hook in the batch can start with sitting down.
If one hook mentions "nothing to play", NO other hook can use those words.

Before generating each carousel, mentally check: "Have I already used this opening scene, this structure, or these key words?" If yes, start over with a completely different angle.

═══ IMAGE DIRECTION PER SLIDE ═══
Brief description per slide for stock photo selection.
Categories: piano, hands, room, sheet_music, mood_dark, mood_light
Keep it moody, dark, intimate. Never bright or cheerful.

═══ CAPTION ═══
Max 150 chars. Reinforces the hook without repeating it. Ends with 3-5 hashtags.

═══ OUTPUT FORMAT ═══
Respond ONLY in valid JSON array. No markdown. No backticks. Each element:
{
  "category": "A" | "B" | "C" | "D" | "E",
  "slides": ["slide 1", "slide 2", "slide 3", "slide 4", "slide 5", "slide 6"],
  "image_directions": ["description 1", "description 2", ...],
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
