# Deployment

Tessera is a 100% static site. There is nothing to build and nothing to configure on the server side. Vercel (or any other static host) serves the files exactly as committed.

## One-time setup

### 1. Push to GitHub

```sh
cd tessera
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin git@github.com:USER/tessera.git
git push -u origin main
```

### 2. Connect to Vercel

1. Go to <https://vercel.com/new>.
2. Click **Import Git Repository** and select your `tessera` repo.
3. Vercel will auto-detect this as a static site.
   - Framework Preset: **Other**
   - Build Command: *(leave blank)*
   - Output Directory: *(leave blank — Vercel serves from the repo root)*
4. Click **Deploy**.

That's it. The first deploy takes about 30 seconds.

### 3. Connect a custom domain (optional)

1. In your Vercel project, go to **Settings → Domains**.
2. Add your domain (e.g. `qr.example.com`).
3. Follow Vercel's instructions to add the DNS record at your registrar (typically a CNAME pointing to `cname.vercel-dns.com`).
4. Vercel issues a free Let's Encrypt SSL certificate automatically.

## Subsequent deploys

Push to `main`. Vercel deploys automatically. CI runs the test suite first; if it fails, the deploy is blocked.

## Verifying a deployed instance

After deployment, visit `<your-domain>/tests.html`. The full browser test suite runs and reports green/red. This is your continuous proof that the live site's encoder is correct.

## Reverting

`vercel.json` has no fancy redirects or rewrites. Reverts are a normal `git revert` + push.

## What if Vercel ever goes away?

Tessera is a static site. The same files work on:

- GitHub Pages
- Cloudflare Pages
- Netlify
- Any Apache/nginx/Caddy server
- Even **just opening `index.html` from disk** — there are no `fetch()` calls or anything else that requires a server. This was an explicit design constraint.

Pick a new host, point your domain at it, done.

## Domain considerations for a tattoo

If the QR points to a URL on a domain you control, **renew the domain forever**. Set up:

- 10-year renewals with auto-renewal at every registrar that allows it.
- Multiple payment methods on file.
- A note in your will / instructions to next-of-kin.

If the URL ever 404s, the QR still scans correctly — it just leads nowhere. You can solve this by either renewing the domain forever, or by encoding a payload that doesn't depend on a server (e.g. a `mailto:`, plain text, or a data URI — though those have practical limits).
