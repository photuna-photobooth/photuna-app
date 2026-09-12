# Built from the repository root so the shared composite module can be copied in:
#   fly deploy --config services/gallery-renderer/fly.toml --dockerfile services/gallery-renderer/Dockerfile
FROM node:22-bookworm-slim

# ffmpeg does the encoding; the fonts are for the trial watermark, which uses
# drawtext and silently renders nothing on an image with no fonts installed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/gallery-renderer/package.json ./services/gallery-renderer/
WORKDIR /app/services/gallery-renderer
RUN npm install --omit=dev --no-audit --no-fund

WORKDIR /app
COPY shared ./shared
COPY services/gallery-renderer/index.js ./services/gallery-renderer/

ENV NODE_ENV=production PORT=8080
EXPOSE 8080
WORKDIR /app/services/gallery-renderer
CMD ["node", "index.js"]
