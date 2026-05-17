// api/generate-batch.ts
// The Brain v2.0 — generates BROAD carousels + NICHE video scripts
// Two content lines: identity reach (BROAD) + conversion (NICHE)
//
// Called by Vercel daily cron or manually
// POST /api/generate-batch { batch_size?: number }
// GET  /api/generate-batch (for cron trigger)

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

// ── System Prompt v2.0 — Two-Line Content Engine ────────────────────────────

const SYSTEM_PROMPT = `You are the content engine for Maestria, a piano app. You generate two types of TikTok content.

═══════════════════════════════════════
MODE 1: BROAD IDENTITY CAROUSELS
═══════════════════════════════════════

PURPOSE: Maximum reach. Grow followers. Build identity resonance with ALL piano players — not just classical, not just advanced, not just those with the "what to play" problem. The product NEVER appears in these posts.

AUDIENCE: English-speaking piano players of ALL levels. From the teenager learning pop songs by ear to the conservatory graduate who hasn't touched their piano in months. The common thread is: they have a relationship with a piano.

FORMAT: 6 slides (sometimes 7, never fewer than 6).

SLIDE 1 (HOOK):
- Line 1: Bold statement. Listicle format preferred ("5 things...", "7 signs...", "6 moments...") OR single declarative truth.
- Line 2: Emotional subline in parentheses. This is the gut-punch. It reframes the list title as personal.
- Max 15 words for line 1. Max 20 words for line 2.

SLIDES 2-6/7:
- Line 1: The point. Bold. Numbered. Concrete. Specific to piano life.
- Line 2: The subline. Lighter weight. Emotional payoff or reframe.
- Each slide is a complete thought. It works alone. It works in sequence.
- Max 20 words per line. Aim for 12-16.

CRITICAL RULES:
1. NEVER mention Maestria, the app, AI, generation, or any product.
2. NEVER use "what to play" as a topic. That's NICHE territory.
3. NEVER reference specific classical composers (Chopin, Debussy, Satie) — most piano TikTok users don't play classical.
4. Every hook must pass this test: would a 17-year-old who plays pop piano by ear AND a 45-year-old who learned classical as a child BOTH feel seen?
5. The territory is IDENTITY, not ADVICE. You're not teaching. You're mirroring.
6. Sublines should feel like inner monologue, not a lesson.

TERRITORY MAP (rotate across these, never repeat the same angle in 14 days):
- Recognition: "things only pianists understand" — shared experiences
- Identity: "signs piano changed who you are" — what piano did to your brain
- Types: "which pianist are you" — archetypes, self-identification
- Moments: "things that hit different when you play" — sensory, specific
- Unspoken: "rules nobody taught you" — tribal knowledge
- Habits: "quiet things serious pianists do" — discipline, routine
- Emotional: "why piano is different from every other instrument" — depth of relationship

ANTI-REPETITION:
- Never reuse a hook opening word pattern from the last 14 days.
- Never reuse more than 2 specific points from any previous carousel.
- Track which territory angles have been used. Rotate strictly.
- If you catch yourself writing "the piano doesn't judge" or "the keys don't care" — stop. Find a fresher way.

CAPTION TEMPLATE:
[Restate hook in lowercase, conversational] + [one line that invites engagement: tag, comment, save] + 5-7 hashtags from this bank: #piano #pianist #pianistsoftiktok #pianolife #musicianlife #pianopractice #pianojourney #musicisfeeling #pianolove

IMAGE DIRECTIONS:
For each slide, provide a brief stock photo search direction.
Categories: piano_hands, piano_keys, dark_room, sheet_music, mood_dark, piano_pov
Keep it moody, dark, intimate. Never bright or cheerful. Always 9:16 portrait.

═══════════════════════════════════════
MODE 2: NICHE CONVERSION VIDEOS
═══════════════════════════════════════

PURPOSE: Conversion. Make viewers ask "what is this piece?" — then answer in comments with the app. The MUSIC is the content. The text is just framing.

AUDIENCE: Same as Mode 1 but the hook filters for people who feel something specific right now.

FORMAT: Single video. Stock footage of piano hands. 8-11 seconds. ONE text overlay line. Maestria piece as audio.

TEXT OVERLAY RULES:
- One sentence. No period at the end.
- Lowercase. No caps except "I".
- First person. Present tense or recent past.
- It describes a FEELING or a MOMENT, never the product.
- It implies the piece was created in response to an emotional state.
- NEVER use: "AI", "generated", "app", "Maestria", "tool", "create".
- NEVER use a CTA. No "link in bio". No "try it".
- The viewer should feel like they're watching someone's private piano moment.
- Max 15 words. Aim for 8-12.

MOOD MAPPING (assign one per video):
- nocturne: late night, solitude, quiet ache, insomnia, melancholy
- etude: restless energy, need to move, intensity, focus
- prelude: calm, morning, stillness, nothing to prove
- ballade: weight, big feelings, stories, drama, aftermath
- meditation: emptiness, letting go, space, breath

STOCK FOOTAGE SEARCH TERMS:
- "piano hands dark" / "piano keys close up" / "piano playing night"
- "piano dramatic lighting" / "piano gentle hands"
- Always dark/moody. Never bright studio. Never full body. Hands or keys only.

CAPTION: Minimal. One emoji (🎹) + 3 hashtags max: #piano #pianomusic + one mood-specific tag.

ANTI-REPETITION:
- Never reuse the same sentence structure in 14 days.
- Vary the emotional trigger: time of day, weather, event, absence, memory.
- Alternate between "I" statements and impersonal framings ("some pieces exist because...").

═══════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════

Respond ONLY in valid JSON array. No markdown. No backticks. Each element:

For BROAD carousels:
{
  "type": "BROAD",
  "territory": "recognition" | "identity" | "types" | "moments" | "unspoken" | "habits" | "emotional",
  "slides": ["slide 1 line 1", "slide 1 line 2 (subline)", "slide 2 line 1", "slide 2 line 2", ...],
  "image_directions": ["direction for slide 1", "direction for slide 2", ...],
  "caption": "caption text #hashtag1 #hashtag2"
}

For NICHE videos:
{
  "type": "NICHE",
  "mood": "nocturne" | "etude" | "prelude" | "ballade" | "meditation",
  "text_overlay": "the single overlay line",
  "stock_search": "search terms for Pexels/Pixabay",
  "duration_seconds": 8-11,
  "caption": "🎹 #piano #pianomusic #tag"
}

═══════════════════════════════════════
QUALITY GATE
═══════════════════════════════════════

Before outputting any script, check:
□ Would this make a pianist stop scrolling and think "that's me"?
□ Is every slide readable in under 3 seconds?
□ Does the BROAD hook pass the 17-year-old AND 45-year-old test?
□ Is there ZERO product mention in BROAD content?
□ Is the NICHE overlay under 15 words?
□ Has this exact angle/hook been used in the last 14 days? If yes, kill it.`;

// ── Fetch last batch performance ─────────────────────────────────────────────

async function getPerformanceContext(): Promise<string> {
  const { data: pieces } = await supabase
    .from('content_pieces')
    .select('slide_texts, content_type, tiktok_views, tiktok_likes, tiktok_comments, tiktok_shares, tiktok_profile_views, tiktok_site_clicks, engagement_score, conversion_score')
    .not('tiktok_views', 'is', null)
    .order('created_at', { ascending: false })
    .limit(30);

  if (!pieces || pieces.length === 0) {
    return 'No performance data yet. This is the first batch with the new two-line strategy. Generate a balanced mix of BROAD identity carousels and NICHE conversion video scripts.';
  }

  // Separate BROAD and NICHE performance
  const broad = pieces.filter(p => p.content_type === 'BROAD' || !p.content_type);
  const niche = pieces.filter(p => p.content_type === 'NICHE');

  const sortByConversion = (arr: typeof pieces) =>
    [...arr].sort((a, b) => (b.conversion_score || 0) - (a.conversion_score || 0));

  let ctx = 'PERFORMANCE DATA FROM PREVIOUS BATCHES:\n\n';

  if (broad.length > 0) {
    const sortedBroad = sortByConversion(broad);
    ctx += '── BROAD CAROUSEL PERFORMANCE ──\n';
    ctx += 'Top:\n';
    sortedBroad.slice(0, 3).forEach((p, i) => {
      const slides = Array.isArray(p.slide_texts) ? p.slide_texts : [];
      ctx += `${i + 1}. Hook: "${slides[0] || 'N/A'}" | Views: ${p.tiktok_views} | Likes: ${p.tiktok_likes} | Comments: ${p.tiktok_comments || 0} | Shares: ${p.tiktok_shares || 0} | Profile visits: ${p.tiktok_profile_views}\n`;
    });
    ctx += 'Bottom:\n';
    sortedBroad.slice(-3).forEach((p, i) => {
      const slides = Array.isArray(p.slide_texts) ? p.slide_texts : [];
      ctx += `${i + 1}. Hook: "${slides[0] || 'N/A'}" | Views: ${p.tiktok_views}\n`;
    });
  }

  if (niche.length > 0) {
    ctx += '\n── NICHE VIDEO PERFORMANCE ──\n';
    niche.forEach((p, i) => {
      ctx += `${i + 1}. Overlay: "${Array.isArray(p.slide_texts) ? p.slide_texts[0] : 'N/A'}" | Views: ${p.tiktok_views} | Comments: ${p.tiktok_comments || 0}\n`;
    });
  }

  ctx += '\nINSTRUCTION: For BROAD, follow patterns of top performers (identity specificity, emotional sublines). For NICHE, prioritize moods that generated comments (people asking about the piece). Do NOT repeat any hooks or overlays.';

  return ctx;
}

// ── Get recently used hooks to prevent repetition ────────────────────────────

async function getRecentHooks(): Promise<string[]> {
  const { data } = await supabase
    .from('content_pieces')
    .select('slide_texts')
    .order('created_at', { ascending: false })
    .limit(42); // last 2 weeks worth

  if (!data) return [];
  return data
    .map(p => (Array.isArray(p.slide_texts) ? p.slide_texts[0] : ''))
    .filter(Boolean);
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Allow GET for cron triggers (Vercel crons send GET)
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple auth for cron/external triggers
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.method === 'GET') {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    // Default: 14 BROAD + 7 NICHE = 21 per week
    const broadCount = (req.body?.broad_count) || 14;
    const nicheCount = (req.body?.niche_count) || 7;
    const totalCount = broadCount + nicheCount;

    const performanceContext = await getPerformanceContext();
    const recentHooks = await getRecentHooks();

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
        batch_size: totalCount,
        system_prompt_version: 'v2.0',
        performance_context: { raw: performanceContext },
        system_prompt_used: SYSTEM_PROMPT,
      })
      .select('id')
      .single();

    if (batchErr || !batch) {
      return res.status(500).json({ error: 'Failed to create batch', detail: batchErr });
    }

    // ── Generate BROAD carousels ──
    let allContent: any[] = [];

    // Generate BROAD in chunks of 7
    const CHUNK_SIZE = 7;
    for (let chunk = 0; chunk < Math.ceil(broadCount / CHUNK_SIZE); chunk++) {
      const remaining = broadCount - allContent.filter(c => c.type === 'BROAD').length;
      const thisChunk = Math.min(CHUNK_SIZE, remaining);

      const existingHooks = [
        ...recentHooks,
        ...allContent.map(c => c.slides?.[0] || c.text_overlay || ''),
      ].filter(Boolean);

      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Generate ${thisChunk} BROAD identity carousel scripts.\n\n${performanceContext}\n\nRECENT HOOKS (do NOT repeat or closely mirror these):\n${existingHooks.map(h => `- "${h}"`).join('\n')}\n\nRespond ONLY in valid JSON array. No markdown, no backticks. Each element must have "type": "BROAD".`,
        }],
      });

      const rawText = message.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      try {
        const parsed = JSON.parse(rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
        allContent = allContent.concat(parsed);
      } catch {
        console.error(`[generate-batch] Failed to parse BROAD chunk ${chunk + 1}:`, rawText.slice(0, 300));
      }
    }

    // ── Generate NICHE video scripts ──
    const nicheMessage = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Generate ${nicheCount} NICHE video scripts.\n\n${performanceContext}\n\nRECENT OVERLAYS (do NOT repeat):\n${recentHooks.slice(0, 14).map(h => `- "${h}"`).join('\n')}\n\nRespond ONLY in valid JSON array. No markdown, no backticks. Each element must have "type": "NICHE".`,
      }],
    });

    const nicheRaw = nicheMessage.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    try {
      const nicheParsed = JSON.parse(nicheRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
      allContent = allContent.concat(nicheParsed);
    } catch {
      console.error('[generate-batch] Failed to parse NICHE:', nicheRaw.slice(0, 300));
    }

    // ── Schedule pieces ──
    // Daily pattern: 10h Cayenne (13 UTC) = BROAD, 15h (18 UTC) = NICHE, 20h (23 UTC) = BROAD
    const POST_SLOTS = [
      { hour: 13, type: 'BROAD' },
      { hour: 18, type: 'NICHE' },
      { hour: 23, type: 'BROAD' },
    ];

    const broadPieces = allContent.filter(c => c.type === 'BROAD').slice(0, broadCount);
    const nichePieces = allContent.filter(c => c.type === 'NICHE').slice(0, nicheCount);

    // Interleave: for each day, pick 2 BROAD + 1 NICHE
    const scheduled: any[] = [];
    let broadIdx = 0;
    let nicheIdx = 0;

    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() + 1);
    startDate.setUTCHours(0, 0, 0, 0);

    const totalDays = Math.ceil(Math.max(broadCount / 2, nicheCount));

    for (let day = 0; day < totalDays; day++) {
      for (const slot of POST_SLOTS) {
        let piece;
        if (slot.type === 'BROAD' && broadIdx < broadPieces.length) {
          piece = broadPieces[broadIdx++];
        } else if (slot.type === 'NICHE' && nicheIdx < nichePieces.length) {
          piece = nichePieces[nicheIdx++];
        } else {
          continue;
        }

        const scheduledFor = new Date(startDate);
        scheduledFor.setUTCDate(scheduledFor.getUTCDate() + day);
        scheduledFor.setUTCHours(slot.hour, 0, 0, 0);

        // Extract hashtags from caption
        const hashtagMatch = (piece.caption || '').match(/#\w+/g);
        const captionClean = (piece.caption || '').replace(/#\w+/g, '').trim();

        const insertData: any = {
          batch_id: batch.id,
          piece_index: scheduled.length,
          content_type: piece.type,
          slide_texts: piece.type === 'BROAD'
            ? (piece.slides || [])
            : [piece.text_overlay || ''],
          caption: captionClean,
          hashtags: hashtagMatch || [],
          status: 'generated',
          scheduled_for: scheduledFor.toISOString(),
        };

        // BROAD-specific fields
        if (piece.type === 'BROAD') {
          insertData.territory = piece.territory || null;
          insertData.image_directions = piece.image_directions || [];
        }

        // NICHE-specific fields
        if (piece.type === 'NICHE') {
          insertData.mood = piece.mood || null;
          insertData.stock_search = piece.stock_search || null;
          insertData.duration_seconds = piece.duration_seconds || 9;
        }

        const { data: saved, error: pieceErr } = await supabase
          .from('content_pieces')
          .insert(insertData)
          .select('id, piece_index, content_type, slide_texts, caption, scheduled_for')
          .single();

        if (saved) scheduled.push(saved);
      }
    }

    return res.status(200).json({
      ok: true,
      batch_id: batch.id,
      broad_generated: broadPieces.length,
      niche_generated: nichePieces.length,
      total_scheduled: scheduled.length,
      pieces: scheduled.map(p => ({
        id: p.id,
        index: p.piece_index,
        type: p.content_type,
        hook: Array.isArray(p.slide_texts) ? p.slide_texts[0] : 'N/A',
        scheduled: p.scheduled_for,
      })),
    });

  } catch (err: any) {
    console.error('[generate-batch] Error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
