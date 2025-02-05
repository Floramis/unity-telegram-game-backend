# Use official Node.js image
FROM node:20.13.1-alpine

# Set working directory
WORKDIR /app

# Copy package.json and yarn.lock
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install

# Copy the rest of the app
COPY . .

# Expose port (ensure it matches your app's PORT)
EXPOSE 6100

# Start the app
CMD ["node", "index.js"]