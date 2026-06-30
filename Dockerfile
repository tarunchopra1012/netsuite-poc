# Small base image for the Node app.
FROM node:18-alpine

WORKDIR /app

# Install deps first for better layer caching. Use npm ci when a lockfile exists,
# otherwise fall back to npm install (no lockfile committed in this POC).
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# App source.
COPY . .

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
