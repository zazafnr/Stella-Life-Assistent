FROM node:22-bookworm-slim

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund

# Unsichtbarer Browser für digi4school
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

ENV STELLA_DATA_DIR=/data
VOLUME /data
EXPOSE 8787
CMD ["npm", "start"]
