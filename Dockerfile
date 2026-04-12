FROM node:22-alpine AS base
WORKDIR /app

FROM base AS install
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts || npm install

FROM base AS build
COPY --from=install /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
