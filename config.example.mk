# Personal settings. Copy this file to config.mk (`make config` does it) and
# edit. config.mk is gitignored, so your values never reach the repository.

# Suffix of the extension UUID: psi-monitor@<HANDLE>. Use your GitHub username.
# Changing it later changes the extension's identity, so pick it before you
# release (anyone who installed the old UUID would have to reinstall).
HANDLE := your-github-username

# Optional: "Maintainer" field of the .deb. It is public inside the package, so
# it defaults to GitHub's noreply address for HANDLE. Uncomment to override.
# DEB_MAINTAINER := Your Name <12345678+your-github-username@users.noreply.github.com>
