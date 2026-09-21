FROM node:24.21.0-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY app ./app
COPY instrumentation ./instrumentation

USER node
EXPOSE 8080

CMD ["node", "--require", "./instrumentation/sdk/register.js", "./app/server.js"]
