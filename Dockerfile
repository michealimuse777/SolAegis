# ── SolAegis Backend ──
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies
RUN npm ci --omit=dev && npm install tsx

# Copy backend source and data
COPY backend/ ./backend/
COPY data/ ./data/
COPY tsconfig.json ./

# Expose ports (HTTP + WebSocket)
EXPOSE 4000
EXPOSE 4001

# Start with tsx (TypeScript execution)
CMD ["npx", "tsx", "backend/index.ts"]
