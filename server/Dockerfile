# 忆梦云团队开发
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg gnupg \
    && curl -fsSL https://pgp.mongodb.com/server-7.0.asc -o /tmp/mongodb-server-7.0.asc \
    && test "$(gpg --batch --show-keys --with-colons /tmp/mongodb-server-7.0.asc | awk -F: '$1 == "fpr" { print $10; exit }')" = "E58830201F7DD82CD808AA84160D26BB1785BA38" \
    && gpg --batch --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg /tmp/mongodb-server-7.0.asc \
    && echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" > /etc/apt/sources.list.d/mongodb-org-7.0.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends mongodb-database-tools=100.19.0 \
    && mongodump --version \
    && mongorestore --version \
    && rm -f /tmp/mongodb-server-7.0.asc \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /app/upload-generations/active && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "app.js"]
