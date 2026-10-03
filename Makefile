SHELL := /bin/bash
.DEFAULT_GOAL := help

# Personal settings live in config.mk (gitignored). See config.example.mk.
-include config.mk
HANDLE    ?= local

UUID      := psi-monitor@$(HANDLE)
EXT_DIR   := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
BIN_DIR   := $(HOME)/.local/bin
CLI       := psi-monitor
SRC_FILES := extension.js metadata.json stylesheet.css lib
JS_FILES  := extension.js $(wildcard lib/*.js) $(wildcard test/*.js)

.PHONY: help config version metadata.json install uninstall link unlink enable \
        disable status reload logs doctor check test pack clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_.-]+:.*## / {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

config: ## Create config.mk from config.example.mk (if missing)
	@if [ -e config.mk ]; then echo "config.mk already exists"; \
	else cp config.example.mk config.mk && echo "Created config.mk: edit it with your values"; fi

version: ## Print the extension version
	@sed -n 's/.*"version-name": *"\([^"]*\)".*/\1/p' metadata.json.in

# Generated from metadata.json.in so the personal UUID suffix never lives in git.
# Phony on purpose: always rebuilt, so `make HANDLE=x ...` is honoured too.
metadata.json:
	@sed 's|__UUID__|$(UUID)|' metadata.json.in > $@

install: link metadata.json ## Copy the extension to GNOME and link the CLI
	@rm -rf "$(EXT_DIR)"
	@mkdir -p "$(EXT_DIR)"
	@cp -r $(SRC_FILES) "$(EXT_DIR)/"
	@echo "Installed to $(EXT_DIR)"
	@echo "Next: 'make reload' (X11) to let GNOME discover it, then 'make enable'."

uninstall: disable unlink ## Disable the extension, remove it and the CLI link
	@rm -rf "$(EXT_DIR)"
	@echo "Removed $(EXT_DIR)"

link: ## Symlink the psi-monitor command into ~/.local/bin
	@mkdir -p "$(BIN_DIR)"
	@ln -sfn "$(CURDIR)/bin/$(CLI)" "$(BIN_DIR)/$(CLI)"
	@echo "Linked $(BIN_DIR)/$(CLI)"

unlink: ## Remove the CLI symlink
	@rm -f "$(BIN_DIR)/$(CLI)"

enable: ## Enable the extension
	@gnome-extensions enable "$(UUID)" || { echo "GNOME has not discovered it yet: run 'make reload'."; exit 1; }

disable: ## Disable the extension (no error if missing)
	@gnome-extensions disable "$(UUID)" 2>/dev/null || true

status: ## Show the extension state reported by GNOME
	@gnome-extensions info "$(UUID)"

reload: ## Explain how to restart GNOME Shell on X11 (does not do it for you)
	@echo "Press Alt+F2, type r, press Enter. Windows stay open on X11."

logs: ## Follow GNOME Shell logs (Ctrl+C to stop)
	@journalctl -f -o cat /usr/bin/gnome-shell

doctor: ## Check the environment
	@echo "Shell:   $$(gnome-shell --version)"
	@echo "Session: $$XDG_SESSION_TYPE"
	@echo "Node:    $$(command -v node >/dev/null && node --version || echo missing '(needed for make test/check)')"
	@[ -r /proc/pressure/io ] && echo "PSI:     available" || echo "PSI:     NOT available (kernel without CONFIG_PSI?)"
	@echo "Metadata shell-version: $$(grep -o '"shell-version".*' metadata.json.in)"
	@if [ -f config.mk ]; then echo "Config:  config.mk (HANDLE=$(HANDLE), UUID=$(UUID))"; \
	else echo "Config:  none, using HANDLE=$(HANDLE) (run 'make config')"; fi

check: metadata.json ## Validate metadata.json and JS syntax
	@python3 -m json.tool metadata.json >/dev/null && echo "metadata.json OK"
	@for f in $(JS_FILES); do node --check "$$f" || exit 1; done && echo "JS syntax OK"

test: ## Run unit tests (Node)
	@node --test test/*.test.js

ZIP := dist/$(UUID).shell-extension.zip

pack: check ## Build the release zip in dist/ (plain zip, no gjs needed)
	@command -v zip >/dev/null || { echo "zip not found: sudo apt install zip"; exit 1; }
	@mkdir -p dist
	@rm -f dist/*.shell-extension.zip   # no stale zips from another HANDLE
	@zip -qr "$(ZIP)" $(SRC_FILES)
	@echo "Built $(ZIP)"
	@unzip -l "$(ZIP)" | tail -n +4 | head -n -2

clean: ## Remove build output
	@rm -rf dist
