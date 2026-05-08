FROM node:24-alpine

WORKDIR /usr/src/app

COPY package.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget --spider -q http://127.0.0.1:3000/health/ready || exit 1

CMD ["node", "src/server.js"]
