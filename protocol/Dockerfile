# Build stage
FROM node:24.1.0-alpine AS builder
WORKDIR /app

# Copy package files
COPY package*.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN yarn build

# Production stage
FROM node:24.1.0-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy package files
COPY package*.json yarn.lock ./

# Install only production dependencies
RUN yarn install --production --frozen-lockfile && yarn cache clean

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Create uploads directory with proper permissions
RUN mkdir -p /app/uploads

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership of uploads directory to nodejs user
RUN chown -R nodejs:nodejs /app/uploads

USER nodejs

EXPOSE 3000

CMD ["node", "dist/index.js"] 