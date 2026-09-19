# 忆梦云团队开发
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "app.js"]
