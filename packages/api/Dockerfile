FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages/api/package.json packages/api/
RUN npm install --workspace=@claude-tasks/api
COPY packages/api/ packages/api/
RUN npm run build --workspace=@claude-tasks/api
CMD ["node", "packages/api/dist/index.js"]
