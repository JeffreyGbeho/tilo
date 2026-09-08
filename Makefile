UUID    = tilo@jeffreygbeho
SRC     = src/$(UUID)
USERDIR = $(HOME)/.local/share/cinnamon/extensions/$(UUID)
SYSDIR  = $(DESTDIR)/usr/share/cinnamon/extensions/$(UUID)

.PHONY: help install install-user dev-link uninstall uninstall-user check test live-test deb apt-repo pot spices publish restart

help:
	@echo "tilo - available targets"
	@echo "  make dev-link       symlink into the user extension directory (development)"
	@echo "  make install-user   copy into ~/.local/share/cinnamon/extensions/"
	@echo "  make install        system-wide copy, used by the .deb (honours DESTDIR)"
	@echo "  make uninstall-user remove the user-level install"
	@echo "  make check          validate JS and JSON syntax"
	@echo "  make test           run the test harness (Cinnamon module resolution)"
	@echo "  make live-test      drive every open window through every action, on the real desktop"
	@echo "  make pot            regenerate the translation template"
	@echo "  make spices         build the Cinnamon Spices submission tree"
	@echo "  make deb            build the .deb into dist/"
	@echo "  make apt-repo       build a signed apt repository into public/"
	@echo "  make publish        push the signed repository to the gh-pages branch"
	@echo "  make restart        restart Cinnamon (session is preserved)"
	@echo ""
	@echo "NO target ever enables the extension: that is the user's gesture,"
	@echo "in Settings > Extensions."

# System-wide install, used by the .deb package.
# Places files and NOTHING else: never writes to dconf.
install:
	install -d $(SYSDIR)/lib
	install -m 644 $(SRC)/metadata.json        $(SYSDIR)/
	install -m 644 $(SRC)/extension.js         $(SYSDIR)/
	install -m 644 $(SRC)/settings-schema.json $(SYSDIR)/
	install -m 644 $(SRC)/stylesheet.css       $(SYSDIR)/
	install -m 644 $(SRC)/lib/*.js             $(SYSDIR)/lib/

install-user:
	mkdir -p $(USERDIR)
	cp -r $(SRC)/. $(USERDIR)/
	@echo ""
	@echo "Files installed into $(USERDIR)"
	@echo "To enable: Settings > Extensions > Tilo"
	@echo "(tilo never enables itself.)"

# Development: the user directory takes priority over the system one, so this
# symlink cleanly shadows any installed release.
dev-link:
	@rm -rf $(USERDIR)
	@mkdir -p $(dir $(USERDIR))
	ln -s $(CURDIR)/$(SRC) $(USERDIR)
	@echo "Symlink created: $(USERDIR) -> $(CURDIR)/$(SRC)"
	@echo "To enable: Settings > Extensions > Tilo"

uninstall:
	rm -rf $(SYSDIR)

uninstall-user:
	rm -rf $(USERDIR)

check:
	@for f in $(SRC)/extension.js $(SRC)/lib/*.js; do \
		node --check $$f && echo "  OK  $$f" || exit 1; \
	done
	@for f in $(SRC)/metadata.json $(SRC)/settings-schema.json; do \
		python3 -c "import json,sys; json.load(open('$$f'))" && echo "  OK  $$f" || exit 1; \
	done

test:
	@node tests/verify.js $(SRC)

pot:
	@sh packaging/make-pot.sh

spices: pot check test
	@sh packaging/build-spices.sh

deb: check test
	@sh packaging/build-deb.sh

apt-repo:
	@sh packaging/build-apt-repo.sh

publish: apt-repo
	@sh packaging/publish-pages.sh

# Places every open window in every zone from every starting state and checks
# the result against the expected rectangle. Moves the user's windows around.
live-test:
	@dbus-send --session --dest=org.Cinnamon --print-reply=literal /org/Cinnamon \
		org.Cinnamon.Eval string:"$$(cat tests/live-runner.js)" > /dev/null
	@while [ "$$(dbus-send --session --dest=org.Cinnamon --print-reply=literal /org/Cinnamon \
		org.Cinnamon.Eval string:'global.__tiloTest.done' | tail -1 | tr -d ' \"')" != "true" ]; do sleep 2; done
	@python3 tests/live-report.py

restart:
	@cinnamon --replace > /dev/null 2>&1 &
	@echo "Cinnamon restarted."
