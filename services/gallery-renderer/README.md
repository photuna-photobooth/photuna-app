# Gallery renderer

Builds a session's motion clip from the burst clips the booth uploads, and fills
in `galleries.final_video_url`.

It exists so the booth does not have to encode. A booth that must encode cannot
be an iPad — iPadOS will not run a bundled encoder — and shipping FFmpeg to
customers is what obliges us to distribute GPL software. Running FFmpeg on our
own server is not distribution, so that obligation disappears.

The FFmpeg graph itself lives in `shared/motionComposite.js` and is the same one
the booth uses, so both produce the same clip.

## How a job flows

```
booth uploads clips + render.json  →  galleries row (video_status 'pending')
                                          │
                    database webhook ──►  POST /render  { record: { slug } }
                                          │
                          claim ──► download ──► ffmpeg ──► upload ──► mark ready
```

The webhook is only a nudge. The sweeper (every `SWEEP_INTERVAL_MS`) picks up
anything still outstanding, so a delivery that is missed, misconfigured or
rejected costs minutes rather than the clip. Both payment integrations broke
because they trusted a single delivery; this one does not.

## Two rules that must not be relaxed

**Nothing is trusted from the request but the slug.** Every storage path is
derived from the claimed database row. The service holds the service-role key,
so RLS does **not** protect it — this discipline is the only thing keeping one
operator's job away from another operator's files.

**A job is claimed before any work.** `claim_gallery_video_job` is one
conditional UPDATE: a duplicate webhook delivery cannot start a second encode,
and a job orphaned by a crash is reclaimed when its lease expires.

## What the booth must upload

Alongside the burst clips, per session:

```
<event>/<session>/render.json          layout, slotVideoMap, backgroundColor, watermark
<event>/<session>/overlay.png          the frame graphic (optional)
<event>/<session>/burst-video/slot-N.mp4
```

`render.json`:

```json
{
  "layout": { "layoutKey": "4x6", "width": 1200, "height": 1800,
              "frame": { "padding": 0 }, "slots": [ /* … */ ] },
  "slotVideoMap": [0, 1, 2],
  "backgroundColor": "#ffffff",
  "watermark": false
}
```

Without `render.json` the clips alone carry no layout, and the job fails with
`no render.json for this session` rather than producing a wrong-looking clip.

## Deploying

Docker is not required locally — Fly builds remotely.

```bash
# once
fly auth login
fly apps create photuna-gallery-renderer

fly secrets set \
  SUPABASE_URL=https://elthktbvojsmvhtxxqnz.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service role key> \
  RENDER_WEBHOOK_SECRET=<a long random string> \
  --app photuna-gallery-renderer

# from the repository root, so `shared/` is in the build context
fly deploy --remote-only \
  --config services/gallery-renderer/fly.toml \
  --dockerfile services/gallery-renderer/Dockerfile
```

Then add a Database Webhook in Supabase on `public.galleries`, INSERT, pointing
at `https://photuna-gallery-renderer.fly.dev/render` with header
`x-render-secret: <RENDER_WEBHOOK_SECRET>`.

The service-role key must only ever live in Fly secrets. It must never reach
the desktop app, the website, or this repository.

## Scaling

Volume is sessions, not customers, and a session costs about half a second of
CPU. When that stops being true:

```bash
fly scale vm shared-cpu-2x --memory 2048
fly scale count 3                  # workers coordinate through the claim alone
fly scale count 3 --region nrt,sin
```

Adding workers needs no code change: two workers racing the same session, the
loser claims nothing and moves on.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SUPABASE_URL` | — | required |
| `SUPABASE_SERVICE_ROLE_KEY` | — | required |
| `RENDER_WEBHOOK_SECRET` | — | required; compared against `x-render-secret` |
| `STORAGE_BUCKET` | `studiophotuna` | |
| `MAX_CONCURRENT` | `2` | encodes at once per machine |
| `SWEEP_INTERVAL_MS` | `120000` | how often outstanding work is picked up |

`GET /health` reports in-flight jobs and is what Fly's check uses.
