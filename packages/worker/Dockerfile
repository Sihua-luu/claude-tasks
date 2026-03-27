FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages/worker/package.json packages/worker/
RUN npm install --workspace=@claude-tasks/worker
COPY packages/worker/ packages/worker/
RUN npm run build --workspace=@claude-tasks/worker
CMD ["node", "packages/worker/dist/index.js"]
