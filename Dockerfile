FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV EVOPILOT_HARNESS_HOME=/data

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run hub:v3-snapshot >/dev/null

EXPOSE 4176
VOLUME ["/data"]
CMD ["node", "scripts/container-entrypoint.mjs"]
