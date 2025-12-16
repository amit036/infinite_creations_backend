# Use official Node.js image
FROM node:20-alpine

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
