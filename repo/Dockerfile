FROM node:20-alpine AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

COPY package.json package-lock.json ./
RUN pnpm install --no-frozen-lockfile

COPY . .
RUN pnpm build

FROM node:20-alpine AS runner

WORKDIR /app

RUN npm install -g serve@14.2.4

COPY --from=build /app/dist ./dist

EXPOSE 4173

CMD ["serve", "-s", "dist", "-l", "4173"]
