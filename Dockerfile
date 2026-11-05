FROM node:22-bookworm-slim

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web-core/package.json web-core/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund

# Unsichtbarer Browser für digi4school
RUN npx playwright install --with-deps chromium

COPY . .
# Edition-Plugin (Stella for Students) aus dem eigenen Repo; STUDENTS_REF = Branch, Tag oder Commit. Ohne Plugin: --build-arg STUDENTS_REF=off
ARG STUDENTS_REF=main
RUN if [ "$STUDENTS_REF" != off ]; then apt-get update -qq && apt-get install -y -qq --no-install-recommends git ca-certificates && STELLA_STUDENTS_REF=$STUDENTS_REF STELLA_FETCH_STRIP_GIT=1 scripts/fetch-edition.sh && apt-get purge -y -qq git && rm -rf /var/lib/apt/lists/*; fi
RUN npm run build

ENV STELLA_DATA_DIR=/data
VOLUME /data
EXPOSE 8787
CMD ["npm", "start"]
