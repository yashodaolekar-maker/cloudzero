FROM docker.io/library/node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build

FROM docker.io/library/node:24-bookworm-slim AS production-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM docker.io/library/node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --gid 10001 cloudzero \
    && useradd --uid 10001 --gid cloudzero --shell /usr/sbin/nologin --no-create-home cloudzero \
    && mkdir -p /app/.data \
    && chown -R cloudzero:cloudzero /app

COPY --from=production-dependencies --chown=cloudzero:cloudzero /app/node_modules ./node_modules
COPY --from=build --chown=cloudzero:cloudzero /app/dist ./dist
COPY --from=build --chown=cloudzero:cloudzero /app/package.json ./package.json
COPY --from=build --chown=cloudzero:cloudzero /app/proto ./proto

USER 10001:10001
EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/server.cjs"]
