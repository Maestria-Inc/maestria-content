// api/tiktok-callback.ts
// Handles TikTok OAuth callback — exchanges code for access token
// Used for the feedback loop: reading video stats from our own account

import type { VercelRequest, VercelResponse } from '@vercel/node';

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY!;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`
      <html><body style="background:#000;color:#fff;font-family:system-ui;padding:40px;">
        <h2>Authorization failed</h2>
        <p>${error_description || error}</p>
        <a href="/" style="color:#888;">← Back</a>
      </body></html>
    `);
  }

  if (!code) {
    return res.status(400).send(`
      <html><body style="background:#000;color:#fff;font-family:system-ui;padding:40px;">
        <h2>No authorization code received</h2>
        <a href="/" style="color:#888;">← Back</a>
      </body></html>
    `);
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: CLIENT_KEY,
        client_secret: CLIENT_SECRET,
        code: code as string,
        grant_type: 'authorization_code',
        redirect_uri: `https://maestria-content.vercel.app/api/tiktok-callback`,
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error || !tokenData.access_token) {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:system-ui;padding:40px;">
          <h2>Token exchange failed</h2>
          <pre style="color:#888;">${JSON.stringify(tokenData, null, 2)}</pre>
          <a href="/" style="color:#888;">← Back</a>
        </body></html>
      `);
    }

    // Show the tokens — in production you'd store these in Supabase
    // For now, display them so you can copy to Vercel env vars
    return res.status(200).send(`
      <html><body style="background:#000;color:#fff;font-family:system-ui;padding:40px;">
        <h2 style="color:#4f4;">✓ Connected to TikTok</h2>
        <p style="color:#888;">Copy these values to your Vercel environment variables:</p>
        <div style="background:#111;padding:20px;border-radius:8px;margin:20px 0;">
          <p><strong>TIKTOK_ACCESS_TOKEN:</strong></p>
          <code style="color:#aaf;word-break:break-all;">${tokenData.access_token}</code>
          <br/><br/>
          <p><strong>TIKTOK_REFRESH_TOKEN:</strong></p>
          <code style="color:#aaf;word-break:break-all;">${tokenData.refresh_token || 'N/A'}</code>
          <br/><br/>
          <p><strong>TIKTOK_OPEN_ID:</strong></p>
          <code style="color:#aaf;word-break:break-all;">${tokenData.open_id || 'N/A'}</code>
          <br/><br/>
          <p style="color:#666;">Token expires in: ${tokenData.expires_in || '?'} seconds</p>
        </div>
        <p style="color:#888;">After copying, add these to Vercel → Settings → Environment Variables, then redeploy.</p>
      </body></html>
    `);

  } catch (err: any) {
    return res.status(500).send(`
      <html><body style="background:#000;color:#fff;font-family:system-ui;padding:40px;">
        <h2>Error</h2>
        <pre style="color:#888;">${err.message}</pre>
      </body></html>
    `);
  }
}
