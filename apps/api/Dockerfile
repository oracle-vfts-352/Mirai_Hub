# Use a premium Node image packaged with light OS utilities
FROM node:20-alpine
WORKDIR /app

# Install native compilation dependencies required by database binaries
RUN apk add --no-cache libc6-compat openssl

# 1. Copy over the global monorepo footprint files
COPY package*.json ./

# 🌟 FIXED: Copy the tsconfig file straight from its actual subfolder location!
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json

# 2. Copy over every internal project module folder to map imports perfectly
COPY apps/api ./apps/api
COPY packages/database ./packages/database

# 3. Clean install all dependencies directly inside the Linux container boundary
RUN npm ci

# 4. Explicitly pre-install the Prisma CLI engine so npx never hits a 127 "not found" loop 🗄️
RUN npm install -g prisma

# 5. Automatically generate your local type-safe Prisma client binaries
RUN npx prisma generate --schema=packages/database/schema.prisma

# 6. Compile your TypeScript monorepo API files into production-grade JavaScript
RUN npm run build --workspace=api

EXPOSE 5000

# Execute your built JS entrypoint file natively
CMD ["node", "apps/api/dist/server.js"]
