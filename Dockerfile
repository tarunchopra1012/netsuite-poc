# Small base image for the Node app. Node 22 matches .nvmrc / engines (Nx migration).
FROM node:22-alpine

WORKDIR /app

# Install deps first for better layer caching. Use npm ci when a lockfile exists,
# otherwise fall back to npm install (no lockfile committed in this POC).
# --ignore-scripts: the root "prepare" script (husky) needs .husky/, which isn't
# copied into this layer — and the legacy app needs no install scripts anyway.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; else npm install --omit=dev --ignore-scripts; fi

# App source.
COPY . .

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
