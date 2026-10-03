FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
COPY public ./public
ENV PORT=3000 DATA_DIR=/app/data
RUN mkdir -p /app/data && chown node:node /app/data
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
