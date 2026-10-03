# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

To publish a release, add a section for the new version below, bump
`version-name` in `metadata.json.in`, and push to `main`.

## [Unreleased]

## [0.1.0] - 2026-10-03

### Added

- Four top-bar badges for disk, CPU, memory and GPU. The number is usage; the
  color (green, yellow, red) comes from the kernel's Pressure Stall
  Information (PSI).
- Details menu with PSI `some`/`full` over 10 s, 60 s and 5 min, a finer
  2-second value derived from the cumulative counter, per-disk busy % and
  read/write speed with mount points, CPU core count and usage, RAM and swap
  in use, and GPU usage, VRAM and temperature.
- GPU stats from a single long-running `nvidia-smi` process, read
  asynchronously. The badge shows `GPU: n/a` when it is unavailable.
- `Makefile` with targets to install, enable, check, test and pack, plus a
  `psi-monitor` command that runs them from any directory.
- Unit tests for the parsers, running on plain Node (`make test`).
- Optional gitignored `config.mk` for the UUID suffix; `metadata.json` is
  generated from `metadata.json.in`.
- Released under GPL-3.0-or-later.

[Unreleased]: https://github.com/pablomelo-inf/psi-monitor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/pablomelo-inf/psi-monitor/releases/tag/v0.1.0
