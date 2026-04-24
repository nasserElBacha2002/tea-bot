# Build (Vite inlines VITE_* at build time)
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

ARG VITE_API_BASE_URL=http://170.239.85.196:3000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

# Serve static assets
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
