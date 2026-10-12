FROM node:22-alpine
WORKDIR /app

# Prisma's engines need openssl on Alpine
RUN apk add --no-cache libc6-compat openssl

# Whole repo (.dockerignore keeps out node_modules, .env files, .git and build output)
COPY . .

# Install only the api workspace plus the root, not Electron or the web app
RUN npm ci --workspace=api --include-workspace-root

# Uses the Prisma 5.22 pinned in apps/api (no global install, a newer CLI could mismatch)
RUN npx prisma generate --schema=packages/database/schema.prisma

# Compile the API and the worker to apps/api/dist
RUN npm run build --workspace=api

EXPOSE 5000
CMD ["node", "apps/api/dist/server.js"]