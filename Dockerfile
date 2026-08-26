FROM node:22-bookworm-slim AS build

WORKDIR /app

# pnpm 버전은 package.json의 packageManager가 정한다. 그 필드가 없던 동안에는 CI가
# pnpm 11로 도는 사이 이미지는 corepack이 고르는 버전으로 돌았고, --frozen-lockfile이
# 있어 버전이 어긋나면 조용히 넘어가는 대신 빌드가 깨진다 — 깨지는 시점이 하필
# 재배포 클릭 직후다.
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# 이 서버는 읽기만 한다(데이터는 전부 이미지 안의 JSON). root로 돌 이유가 없고,
# 베이스 이미지에 `node` 사용자가 이미 있다.
USER node

EXPOSE 3000

CMD ["node", "dist/server.js"]

