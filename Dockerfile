# Node 22 + Python 3.11 in one image: the server itself is plain Node/Express
# (run via tsx), but it shells out to server/quantum/*.py for Qiskit-backed
# analysis, so both runtimes have to be present at runtime, not just at build.
#
# Only server/ and client/ are ever installed here -- never the repo root
# package.json, which is the Electron desktop app's manifest and pulls in
# better-sqlite3 (a native addon) and electron itself. Installing that at the
# image root broke Northflank's buildpack auto-detection (which installs
# from whatever package.json it finds at the repo root, and tried to compile
# better-sqlite3's native addon there).
FROM node:22-bookworm-slim

# python3 on bookworm is 3.11 -- picked because it's the last release with
# prebuilt wheels for qiskit's symengine dependency (3.12+ falls back to a
# from-source build that fails, since the SymEngine C++ library isn't
# installed).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package.json server/package-lock.json server/
RUN npm install --prefix server

COPY client/package.json client/package-lock.json client/
RUN npm install --prefix client

COPY server/quantum/requirements.txt server/quantum/requirements.txt
# --ignore-installed: the base image ships a system PyJWT (via apt/
# dist-packages) that pip can't uninstall (no RECORD metadata, "installed by
# debian"), which would otherwise abort the whole install before qiskit gets
# to install -- silently leaving quantum mode broken (falls back to AI-only
# estimates with no visible error).
RUN pip3 install --break-system-packages --ignore-installed -r server/quantum/requirements.txt

COPY server/ server/
COPY client/ client/
RUN npm run build --prefix client \
    && rm -rf client/node_modules/.vite

# Runs as an unprivileged user rather than root -- the quantum subprocess
# (server/quantum/*.py) and any file-upload handling have no need for root,
# and running as root widens the blast radius of any RCE in either runtime.
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 10000

CMD ["npm", "run", "start", "--prefix", "server"]
