// api/tiktok-login.ts
// Redirects to TikTok OAuth — used to authorize our own account
// Visit: https://maestria-content.vercel.app/api/tiktok-login

import type { VercelRequest, VercelResponse } from '@vercel/node';

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY!;
const REDIRECT_URI = 'https://maestria-content.vercel.app/api/tiktok-callback';
const SCOPES = 'user.info.basic,user.info.stats,video.list,video.upload';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const state = 'maestria-' + Date.now();
  
  const authUrl = `https://www.tiktok.com/v2/auth/authorize/?` +
    `client_key=${CLIENT_KEY}` +
    `&scope=${SCOPES}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${state}`;

  res.redirect(302, authUrl);
}
