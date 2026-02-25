FROM node:20-alpine

WORKDIR /app

# Copy workspace manifests (root + server only — skip client/scraper)
COPY package*.json ./
COPY server/package.json ./server/

# Install only server workspace dependencies
RUN npm ci --workspace=server --ignore-scripts

# Copy server source
COPY server/src ./server/src

EXPOSE 3002

CMD ["node", "server/src/index.js"]
