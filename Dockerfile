# Use official Node.js image (Debian slim is more compatible with Prisma than Alpine)
FROM node:20-slim

# Install OpenSSL (required for Prisma)
RUN apt-get update -y && apt-get install -y openssl

# Set working directory
WORKDIR /app

# Copy package files first to leverage cache
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies used in production
RUN npm install

# Generate Prisma Client
RUN npx prisma generate

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 5001

# Start the application
CMD ["npm", "start"]
