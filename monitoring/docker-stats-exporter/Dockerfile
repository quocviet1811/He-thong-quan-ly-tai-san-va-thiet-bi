FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node server.js ./

USER node
EXPOSE 9100

CMD ["node", "server.js"]
