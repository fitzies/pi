# Pi config

Sanitized Pi agent configuration for syncing between machines.

This repo intentionally excludes auth files, session history, logs, caches, browser state, dependencies, and generated binaries. Reinstall dependencies and authenticate separately on each machine.

## Restore on a server

```bash
git clone git@github.com:fitzies/pi.git ~/.pi
cd ~/.pi/agent/npm
npm install
```

Then run Pi login/auth setup on the server as needed.
