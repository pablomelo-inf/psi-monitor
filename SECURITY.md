# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
reporting instead: open the **Security** tab of this repository and choose
**Report a vulnerability**. Say which version you use, what you did and what you
expected. Reports are handled on a best-effort basis.

## What the extension does and does not do

It runs inside GNOME Shell, with your user's permissions.

- **Reads** kernel counters from `/proc` and `/sys` (pressure, CPU, memory,
  disks, network interfaces, Wi-Fi signal). Nothing is written back.
- **Runs** `nvidia-smi` for the GPU badge, with fixed arguments and without a
  shell. It uses `/usr/bin/nvidia-smi` when that exists.
- **Stores** one GSettings key, the list of hidden badges.
- **Does not** open network connections, send or capture traffic, write files,
  read the clipboard or need root.
- The `.deb` package has no maintainer scripts, so nothing runs as root when you
  install it.

## Supply chain

- There are no runtime dependencies. The npm packages (ESLint and Prettier) are
  only used to develop.
- CI actions are pinned to full commit SHAs, and Dependabot proposes updates
  after a 7-day cooldown.
- Every push and pull request runs the tests, the linters and a Trivy scan; the
  scan also runs weekly, because new vulnerabilities appear without new commits.
