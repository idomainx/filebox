FROM node:22-alpine
WORKDIR /app
COPY server.js index.html style.css app.js health.html ./
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]
