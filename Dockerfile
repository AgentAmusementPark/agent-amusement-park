FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7860

WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /app/runs && \
    touch /app/events.ndjson && \
    chown -R node:node /app/runs /app/events.ndjson

USER node
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:7860/api/health || exit 1
CMD ["node", "server.js"]
