import { handle } from 'hono/cloudflare-pages';
import app from '../../server/app';

// Cloudflare Pages routes every /api/* request to this function.
export const onRequest = handle(app);
