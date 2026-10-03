SHELL := /bin/bash
.DEFAULT_GOAL := help

# Personal settings live in config.mk (gitignored). See config.example.mk.
-include config.mk
HANDLE    ?= local

# HANDLE ends up in shell commands and in the folder `make uninstall` removes
# with rm -rf, so accept only plain characters (no slash, quote, space...).
_ALLOWED := a b c d e f g h i j k l m n o p q r s t u v w x y z A B C D E F G H I J K L M N O P Q R S T U V W X Y Z 0 1 2 3 4 5 6 7 8 9 . _ -
_strip = $(if $(2),$(call _strip,$(subst $(firstword $(2)),,$(1)),$(wordlist 2,$(words $(2)),$(2))),$(1))
ifneq ($(words $(HANDLE)),1)
$(error HANDLE must be exactly one word of letters, digits, dot, underscore or dash)
endif
ifneq ($(strip $(call _strip,$(HANDLE),$(_ALLOWED))),)
$(error HANDLE may only contain letters, digits, dot, underscore and dash)
endif

UUID      := psi-monitor@$(HANDLE)
VERSION   := $(shell sed -n 's/.*"version-name": *"\([^"]*\)".*/\1/p' metadata.json.in)

# .deb settings. The Maintainer field is public inside the package, so it
# defaults to GitHub's noreply address for HANDLE. Override in config.mk.
DEB_PKG        := gnome-shell-extension-psi-monitor
DEB_MAINTAINER ?= $(HANDLE) <$(HANDLE)@users.noreply.github.com>
HOMEPAGE       ?= https://github.com/$(HANDLE)/psi-monitor
DEB_FILE       := dist/$(DEB_PKG)_$(VERSION)_all.deb
DEB_ROOT       := dist/deb-root
EXT_DIR   := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
BIN_DIR   := $(HOME)/.local/bin
CLI       := psi-monitor
SRC_FILES := extension.js metadata.json stylesheet.css lib schemas
JS_FILES  := extension.js $(wildcard lib/*.js) $(wildcard test/*.js)

.PHONY: help config setup hooks lint format version metadata.json schemas install uninstall link \
        unlink enable disable status reload logs doctor check test pack deb clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_.-]+:.*## / {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

config: ## Create config.mk from config.example.mk (if missing)
	@if [ -e config.mk ]; then echo "config.mk already exists"; \
	else cp config.example.mk config.mk && echo "Created config.mk: edit it with your values"; fi

setup: ## Install the dev tools (npm packages) and the git pre-commit hook
	@command -v npm >/dev/null || { echo "npm not found: install Node.js 22 (see .nvmrc)"; exit 1; }
	@command -v pre-commit >/dev/null || { echo "pre-commit not found: pipx install pre-commit"; exit 1; }
	npm ci
	pre-commit install

hooks: ## Install the git pre-commit hook
	@pre-commit install

lint: ## Run every linter and format check on all files (same as CI)
	@pre-commit run --all-files --show-diff-on-failure

format: ## Format JS, JSON, CSS, YAML and Markdown with Prettier
	@npx --no-install prettier --write --ignore-unknown .

version: ## Print the extension version
	@echo "$(VERSION)"

# Generated from metadata.json.in so the personal UUID suffix never lives in git.
# Phony on purpose: always rebuilt, so `make HANDLE=x ...` is honoured too.
# The shell loads the settings schema from its compiled form, so it ships with
# the extension. --strict also validates the XML.
schemas:
	@command -v glib-compile-schemas >/dev/null || { echo "glib-compile-schemas not found: sudo apt install libglib2.0-bin"; exit 1; }
	@glib-compile-schemas --strict schemas

metadata.json:
	@sed 's|__UUID__|$(UUID)|' metadata.json.in > $@

install: link metadata.json schemas ## Copy the extension to GNOME and link the CLI
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
	@major="$$(gnome-shell --version 2>/dev/null | grep -oE '[0-9]+' | head -1)"; \
	  supported="$$(grep -o '"shell-version".*' metadata.json.in | grep -oE '[0-9]+' | tr '\n' ' ')"; \
	  case " $$supported " in \
	    *" $$major "*) echo "Compat:  GNOME Shell $$major is supported" ;; \
	    *) echo "Compat:  WARNING GNOME Shell $${major:-?} is not supported (supported: $$supported)" ;; \
	  esac
	@if [ -f config.mk ]; then echo "Config:  config.mk (HANDLE=$(HANDLE), UUID=$(UUID))"; \
	else echo "Config:  none, using HANDLE=$(HANDLE) (run 'make config')"; fi

check: metadata.json schemas ## Validate metadata.json and JS syntax
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

deb: check ## Build a .deb package in dist/ (Debian/Ubuntu)
	@command -v dpkg-deb >/dev/null || { echo "dpkg-deb not found (Debian/Ubuntu only)"; exit 1; }
	@rm -rf "$(DEB_ROOT)"
	@rm -f dist/*.deb
	@install -d "$(DEB_ROOT)/DEBIAN" "$(DEB_ROOT)/usr/share/doc/$(DEB_PKG)" \
	    "$(DEB_ROOT)/usr/share/gnome-shell/extensions/$(UUID)"
	@cp -r $(SRC_FILES) "$(DEB_ROOT)/usr/share/gnome-shell/extensions/$(UUID)/"
	@sed -e 's|@VERSION@|$(VERSION)|g' -e 's|@MAINTAINER@|$(DEB_MAINTAINER)|g' \
	     -e 's|@HOMEPAGE@|$(HOMEPAGE)|g' packaging/deb/control.in > "$(DEB_ROOT)/DEBIAN/control"
	@sed -e 's|@HOMEPAGE@|$(HOMEPAGE)|g' packaging/deb/copyright.in \
	     > "$(DEB_ROOT)/usr/share/doc/$(DEB_PKG)/copyright"
	@{ printf 'psi-monitor (%s) unstable; urgency=medium\n\n' "$(VERSION)"; \
	    bash scripts/release-notes.sh "$(VERSION)" \
	      | sed -e '/^###/d' -e '/./,$$!d' -e 's/^- /  * /' -e 's/^  \([^ *]\)/    \1/'; \
	    printf '\n -- %s  %s\n' "$(DEB_MAINTAINER)" \
	      "$$(date -R -u -d "@$${SOURCE_DATE_EPOCH:-$$(date +%s)}")"; \
	  } | gzip -9n > "$(DEB_ROOT)/usr/share/doc/$(DEB_PKG)/changelog.gz"
	@cd "$(DEB_ROOT)" && find usr -type f -exec md5sum {} + > DEBIAN/md5sums
	@find "$(DEB_ROOT)" -type d -exec chmod 755 {} +
	@find "$(DEB_ROOT)" -type f -exec chmod 644 {} +
	@dpkg-deb --root-owner-group -Zxz --build "$(DEB_ROOT)" "$(DEB_FILE)" >/dev/null
	@rm -rf "$(DEB_ROOT)"
	@echo "Built $(DEB_FILE)"

clean: ## Remove build output
	@rm -rf dist schemas/gschemas.compiled
