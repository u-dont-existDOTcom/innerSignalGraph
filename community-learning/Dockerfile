FROM node:24.18.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY apps/community ./apps/community
COPY community-learning ./community-learning
COPY src/core ./src/core
COPY src/community-learning ./src/community-learning
RUN mkdir -p /data/community-learning && chown -R node:node /data
USER node
ENV COMMUNITY_HOST=0.0.0.0
ENV COMMUNITY_DATA_ROOT=/data/community-learning
CMD ["node", "src/community-learning/serve.mjs"]
