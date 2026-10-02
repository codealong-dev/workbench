.PHONY: setup dev fake web sidecar test build clean spikes install uninstall app dist restart stop logs link

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

# Phoenix on :4242 and Vite on :5173 (open http://127.0.0.1:5173). Ctrl-C stops both.
dev: sidecar
	@trap 'kill 0' INT TERM EXIT; \
	(cd server && mix phx.server) & \
	(cd web && npm run dev) & \
	wait

# Everything served by Phoenix from the built SPA (http://127.0.0.1:4242).
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
	rm -rf server/_build server/priv/static sidecar/dist web/dist desktop/build dist

# macOS: build a release and run it at login via launchd (scripts/macos).
install:
	./scripts/macos/install.sh

uninstall:
	./scripts/macos/uninstall.sh

# macOS: Workbench.app in ~/Applications, a native window on the server from `make install`.
app:
	./scripts/macos/build-app.sh

# macOS: dist/Workbench-<version>-<arch>.dmg with the server inside, for the website (see scripts/macos/package.sh).
dist:
	./scripts/macos/package.sh

restart:
	launchctl kickstart -k gui/$$(id -u)/dev.workbench.server

stop:
	launchctl bootout gui/$$(id -u)/dev.workbench.server

logs:
	tail -f $${WB_HOME:-$$HOME/.workbench}/logs/workbench.log

# M7: one-time login link for a browser on another machine (Tailscale).
#   make link HOST=macmini
link:
	@echo "http://$${HOST:-$$(hostname -s)}:$${PORT:-4242}/?token=$$(cat $${WB_HOME:-$$HOME/.workbench}/token)"
