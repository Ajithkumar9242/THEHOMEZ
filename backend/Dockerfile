# ==============================================================================
# TheHomez — Multi-Stage Backend Dockerfile
# ==============================================================================

FROM node:22-alpine AS builder

WORKDIR /app

# Copy root package and workspace configurations
COPY package*.json tsconfig.base.json ./
COPY packages/ packages/
COPY backend/ backend/

# Install dependencies and build shared packages + backend
RUN npm ci
RUN npm run build:packages
RUN npm --workspace=@thehomez/backend run build

# Runtime Stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY packages/shared-types/package*.json ./packages/shared-types/
COPY packages/shared-types/dist/ ./packages/shared-types/dist/
COPY backend/package*.json ./backend/
COPY backend/dist/ ./backend/dist/

# Install production dependencies only
RUN npm ci --omit=dev

WORKDIR /app/backend
EXPOSE 5000

CMD ["node", "dist/index.js"]
