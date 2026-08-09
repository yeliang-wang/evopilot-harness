FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run hub:snapshot >/dev/null

EXPOSE 4176
CMD ["node", "src/index.mjs", "hub", "serve", "--host", "0.0.0.0", "--port", "4176", "--catalog", "published", "--source", "harnesses"]
