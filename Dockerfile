FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY server ./server
COPY scripts/serve-geo.ts ./scripts/serve-geo.ts
RUN npx esbuild scripts/serve-geo.ts --bundle --platform=node --format=esm --target=node24 --external:node:* --outfile=/out/geo-server.mjs

FROM node:24-slim
RUN useradd --system --no-create-home geo
COPY --from=build /out/geo-server.mjs /app/geo-server.mjs
ENV GEO_PACKS_DIR=/data HOST=0.0.0.0 PORT=8096 NODE_ENV=production
USER geo
EXPOSE 8096
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "/app/geo-server.mjs"]
