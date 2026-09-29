.PHONY: setup dev fake web sidecar test build clean spikes

# First time: fetch deps, create the DB, build the sidecar.
setup:
	cd server && mix setup
	cd sidecar && npm install
	cd web && npm install
	$(MAKE) sidecar

sidecar:
	cd sidecar && npm run build

web:
	cd web && npm run build

# Phoenix on :4000 and Vite on :5173 (open http://127.0.0.1:5173). Ctrl-C stops both.
dev: sidecar
	@trap 'kill 0' INT TERM EXIT; \
	(cd server && mix phx.server) & \
	(cd web && npm run dev) & \
	wait

# Everything served by Phoenix from the built SPA (http://127.0.0.1:4000).
build: sidecar web
	@echo "run: cd server && mix phx.server"

test:
	cd server && mix test
	cd sidecar && npm test && npm run typecheck
	cd web && npx tsc -b

spikes:
	./spikes/02-orphans.sh
	./spikes/01-claude-sdk.sh

clean:
	rm -rf server/_build server/priv/static sidecar/dist web/dist
