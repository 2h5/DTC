FROM node:24.11.1-alpine3.22

ENV NODE_ENV=production \
    PAYPAL_ENV=disabled \
    PORT=8787

WORKDIR /app

COPY package.json package-lock.json* ./
# Intentionally fails if a reviewed lockfile has not been generated.
RUN test -f package-lock.json && npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --chown=node:node . .
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
