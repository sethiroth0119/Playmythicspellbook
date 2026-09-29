# syntax=docker/dockerfile:1
# Mythic Spellbook multiplayer server — Colyseus on Node 20.
# Multi-stage so the runtime image stays slim (no dev deps, no source).
FROM node:20-alpine AS builder
WORKDIR /app

# Install ALL deps (incl. dev) so we can compile TypeScript.
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# Copy source + tsconfig, then compile.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime image ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=2567

# Install only production deps.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Bring in the compiled JS from the builder stage.
COPY --from=builder /app/dist ./dist

# Health endpoint is on /health; Fly checks it.
EXPOSE 2567
CMD ["node", "dist/index.js"]
