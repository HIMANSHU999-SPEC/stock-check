# Multi-stage build for the Stock & Library Management app.
# Serves the built React frontend and the Express API from a single container.
FROM node:22-slim AS build
WORKDIR /app

# Install build tools needed by better-sqlite3 native bindings.
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN (npm ci --omit=dev || npm install --omit=dev) && npm cache clean --force

# Copy server code and the built frontend.
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server

ENV NODE_ENV=production
ENV PORT=3001
# Store the SQLite database on a mounted volume so data survives redeploys.
ENV DB_PATH=/data/stock-management.db
VOLUME ["/data"]

EXPOSE 3001
CMD ["node", "server/index.js"]
