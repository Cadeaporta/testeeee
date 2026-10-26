# Termos de TI · imagem do servidor
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
COPY lib ./lib
COPY db ./db
COPY public ./public
COPY scripts/criar-admin.mjs ./scripts/
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/saude || exit 1
CMD ["node", "server.mjs"]
