FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server/src ./server/src
COPY scripts/set-role.ts ./scripts/set-role.ts
COPY deploy/tsconfig.server.json ./deploy/tsconfig.server.json
RUN npx tsc -p deploy/tsconfig.server.json
COPY web ./web
COPY public ./public
COPY index.html vite.config.ts ./
RUN npx vite build

FROM node:24-bookworm-slim AS api
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# 保持模块相对路径，兼容应用定位 public。
COPY --from=build /app/build/server ./server
COPY --from=build /app/build/scripts ./scripts
COPY --from=build /app/public ./public
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 DATA_DIR=/var/lib/qian-estate
RUN mkdir -p /var/lib/qian-estate && chown node:node /var/lib/qian-estate
USER node
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:4310/api/health',{signal:AbortSignal.timeout(3000)}).then(async r=>{if(!r.ok||(await r.json()).status!=='ok')process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/src/server.js"]

FROM nginx:stable-alpine AS nginx
COPY --from=build /app/dist/web /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
