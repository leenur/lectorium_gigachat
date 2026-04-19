FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# If a build step is necessary before running, uncomment the next line:
# RUN npm run build

EXPOSE 80
ENV HOST=0.0.0.0
ENV PORT=80

# This CMD assumes standard Vite dev execution. 
# Verify your specific start script in package.json. If you run server.ts, adjust accordingly (e.g., CMD ["npx", "tsx", "server.ts"]).
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "80"]
