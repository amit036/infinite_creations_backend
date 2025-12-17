# Use standard Node.js image which includes all necessary build tools and libraries (like OpenSSL)
FROM node:20

# Create app directory
WORKDIR /app

# Copy application dependency manifests to the container image.
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install

# Generate Prisma Client
RUN npx prisma generate

# Copy local code to the container image.
COPY . .

# Expose the service port
EXPOSE 5001

# Run the web service on container startup.
CMD ["npm", "start"]
