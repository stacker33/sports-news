# Instant web search: Cloudflare setup (free, about 5 minutes)

The site is static, so the browser can't read Google News directly. `search-worker.js` is a small free "proxy" on Cloudflare. It searches Google News for the editor's words, translates the foreign headlines into Hebrew, and returns the results to the site. It needs no keys and keeps no data.

## Steps
1. Go to **dash.cloudflare.com/sign-up** and open a free account. Only an email and a password are needed; there's no credit card.
2. In the menu on the left choose **Compute (Workers)** → **Workers & Pages** → **Create** → **Create Worker** (the "Hello World" template is fine).
3. Name it, for example `sports-radar-search`, and press **Deploy**.
4. Press **Edit code**. Delete everything there, paste the full contents of `worker/search-worker.js`, and press **Deploy** again.
5. Copy the worker's address. It looks like `https://sports-radar-search.<your-name>.workers.dev`
6. Check it in the browser: `https://sports-radar-search.<your-name>.workers.dev/search?q=messi` should show results (JSON).
7. Send the address to Claude. It goes into `SEARCH_URL` in `public/app.js`, and the "🌐 from the web" section appears on the site.

## Limits
- The free plan allows 100,000 requests a day. A search is one request, and the same search within 2 minutes comes from the cache.
- The worker only answers the radar's pages (stacker33.github.io, plus localhost for testing).
