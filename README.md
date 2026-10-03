# PSI Monitor

A GNOME Shell extension that puts **disk, CPU, memory and GPU** in the top bar
as four colored badges. The number says *how much* is in use. The color says
whether the system is actually *struggling* because of it, using the Linux
kernel's Pressure Stall Information (PSI).

![The four badges in the GNOME top bar](docs/screenshot.png)

## Quick start

```bash
git clone https://github.com/pablomelo-inf/psi-monitor.git
cd psi-monitor
make install
```

Restart GNOME Shell so it discovers the extension (**X11:** `Alt+F2`, type `r`,
`Enter`. **Wayland:** log out and back in), then:

```bash
make enable
```

The badges appear on the right side of the top bar. Details in
[Installation](#installation).

## Contents

- [Why PSI?](#why-psi)
- [Features](#features)
- [Reading the badges](#reading-the-badges)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Privacy and permissions](#privacy-and-permissions)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [License](#license)

## Why PSI?

Usage alone is a poor "is my machine slow?" signal. A CPU at 100% can be
perfectly healthy, while a disk at 20% can make everything feel frozen.
PSI (`/proc/pressure/*`) reports the share of time tasks spent **stalled
waiting** for a resource, which is much closer to what you actually feel.

This extension shows both: usage as the number, PSI as the color.

## Features

- Four badges: disk, CPU, memory and GPU (NVIDIA).
- Badge color from kernel pressure: green, yellow or red.
- A menu, opened by clicking the badges, with what they cannot fit:
  - PSI `some` / `full` over 10 s, 60 s and 5 min windows;
  - a "now (2s)" value with 3 decimals, computed from the kernel's
    cumulative counter (finer than the 2 decimals in `avg10`);
  - **per-disk** busy %, read/write MB/s and mount points;
  - CPU core count and real usage;
  - RAM and swap in use;
  - GPU usage, VRAM and temperature.
- Few moving parts: a handful of tiny `/proc` reads every 2 s, plus one
  long-running `nvidia-smi` process read asynchronously.
- Everything created in `enable()` is released in `disable()`.

## Reading the badges

The **number** is usage. The **color** is pressure: `some avg10`, the share of
the last 10 s in which at least one task was stalled.

| Badge   | Number                       | Color comes from                |
|---------|------------------------------|---------------------------------|
| Disk    | busy % of the busiest disk   | `/proc/pressure/io` (all disks) |
| CPU     | usage % across all cores     | `/proc/pressure/cpu`            |
| Memory  | RAM in use %                 | `/proc/pressure/memory`         |
| GPU     | GPU usage % (`nvidia-smi`)   | fixed blue (usage only)         |

| Color  | Time stalled (`avg10`) | Meaning                          |
|--------|------------------------|----------------------------------|
| green  | below 5%               | healthy                          |
| yellow | 5% to 20%              | noticeable stalls                |
| red    | 20% or more            | the system is visibly struggling |

Examples:

- `CPU: 90%` in **green**: busy but healthy, nobody is waiting for a core.
- `Disk: 8%` in **red**: little disk traffic, yet tasks are stalling on I/O.

Notes:

- PSI is system-wide. It cannot say *which* disk or core is responsible, so
  the menu breaks usage down per disk.
- The GPU has no PSI, so its badge shows usage only and is always blue.
- At idle, all three colored badges stay green. That is the normal state.

## Requirements

| Needed for            | Requirement |
|-----------------------|-------------|
| Running               | GNOME Shell **46** (Ubuntu 24.04) and a Linux kernel with PSI (`/proc/pressure/` exists) |
| Installing from source| `git` and `make` |
| GPU badge (optional)  | NVIDIA driver providing `nvidia-smi`. Without it the badge shows `GPU: n/a` |
| `make check` / `make test` | Node.js (tested with v23.10) and Python 3 (JSON check) |
| `make pack`           | `zip` |

Tested on Ubuntu 24.04.2, GNOME Shell 46.0 (X11), NVIDIA RTX 3060.
Run `make doctor` to check your machine.

## Installation

### From source (recommended)

```bash
git clone https://github.com/pablomelo-inf/psi-monitor.git
cd psi-monitor
make config       # optional, see Configuration
make install      # copies the extension, links the `psi-monitor` command
```

Restart GNOME Shell:

- **X11:** press `Alt+F2`, type `r`, press `Enter`. Windows stay open.
- **Wayland:** log out and back in.

Then enable it:

```bash
make enable
```

### From a zip

Build one with `make pack` (it creates
`dist/psi-monitor@<HANDLE>.shell-extension.zip`), or use one you were given.
Replace `<HANDLE>` with the suffix in the file name.

```bash
gnome-extensions install --force psi-monitor@<HANDLE>.shell-extension.zip
# restart GNOME Shell as above, then:
gnome-extensions enable psi-monitor@<HANDLE>
```

If `gnome-extensions install` is unavailable or crashes, unzip manually:

```bash
unzip -o psi-monitor@<HANDLE>.shell-extension.zip \
  -d ~/.local/share/gnome-shell/extensions/psi-monitor@<HANDLE>
```

### Check that it works

```bash
make status       # expect "State: ACTIVE"
```

Four badges should appear on the right side of the top bar. For a moment they
may show `…` until the second sample arrives (about 2 s). Click them to open
the details menu.

### Uninstall

```bash
make uninstall                                  # installed from source
gnome-extensions uninstall psi-monitor@<HANDLE> # installed from a zip
```

## Configuration

Personal values live in `config.mk`, which is **gitignored**. The repository
ships only `config.example.mk`. Configuration is optional: without it the
extension works with the default UUID `psi-monitor@local`.

```bash
make config       # copies config.example.mk to config.mk (never overwrites)
$EDITOR config.mk
```

| Variable | Purpose |
|----------|---------|
| `HANDLE` | Suffix of the extension UUID: `psi-monitor@<HANDLE>`. Defaults to `local` without a `config.mk`. Use letters, digits and dashes. |

Things to know:

- `config.example.mk` sets `HANDLE := your-github-username`. Replace it,
  otherwise that placeholder becomes your UUID.
- `HANDLE` is the extension's identity. If you change it after installing, run
  `make uninstall` **first** (with the old value), or the old copy stays behind.
- `metadata.json` is generated from `metadata.json.in` using `HANDLE`, so it is
  gitignored too. `make install`, `make check` and `make pack` regenerate it.

## Usage

After `make install`, the `psi-monitor` command runs this project's make
targets **from any directory**:

```bash
psi-monitor            # list the targets
psi-monitor status     # state reported by GNOME
psi-monitor enable
psi-monitor disable
psi-monitor logs       # follow GNOME Shell logs
```

The command is a symlink in `~/.local/bin`. If your shell does not find it,
that directory is not in `PATH`. Ubuntu adds it at login when it exists, so log
out and back in, or run `export PATH="$HOME/.local/bin:$PATH"`.

## Privacy and permissions

The extension runs inside GNOME Shell with your user's permissions. What it
does:

- **Reads** `/proc/pressure/{io,cpu,memory}`, `/proc/stat`, `/proc/meminfo`,
  `/proc/diskstats`, `/proc/mounts` and, per disk, `/sys/block/<disk>/size`
  and `/sys/block/<disk>/device/model`.
- **Runs** `nvidia-smi` with a read-only query (utilization, memory,
  temperature). Nothing is run if it is not installed.
- **Does not** use the network, write files, or need root.

## Development

### Layout

```
psi-monitor/
├── extension.js         GNOME Shell glue: badges, menu, timer, enable/disable
├── metadata.json.in     metadata template; make generates metadata.json from it
├── stylesheet.css       badge colors
├── lib/
│   ├── psi.js           PSI parser, severity levels, instant % from counters
│   ├── system.js        parsers: meminfo, cpu stat, diskstats, mounts
│   ├── gpu.js           nvidia-smi line parser
│   └── sampler.js       reads /proc and turns samples into rates (GLib only)
├── test/                unit tests (Node)
├── bin/psi-monitor      wrapper: runs this project's make targets from anywhere
├── docs/screenshot.png  image used in this README
├── config.example.mk    template for your personal, gitignored config.mk
├── Makefile             entry point for every task
├── package.json         dev-only: makes Node treat .js as ES modules
├── LICENSE
├── .editorconfig
└── .gitignore
```

Generated or local files, not in git: `config.mk`, `metadata.json`, `dist/`.

`lib/psi.js`, `lib/system.js` and `lib/gpu.js` import nothing from GNOME, so
they are unit-tested with plain Node. `extension.js` and `lib/sampler.js` need
GNOME's runtime (GJS) and are exercised by running them in the shell.

### Make targets

Run `make` with no arguments for the live list.

| Target      | What it does |
|-------------|--------------|
| `help`      | list the targets (default) |
| `config`    | create `config.mk` from `config.example.mk` if missing |
| `install`   | copy the extension to GNOME and link the `psi-monitor` command |
| `uninstall` | disable and remove the extension and the command link |
| `link`      | symlink the `psi-monitor` command into `~/.local/bin` |
| `unlink`    | remove that symlink |
| `enable`    | enable the extension |
| `disable`   | disable the extension (no error if missing) |
| `status`    | show the state GNOME reports for the extension |
| `reload`    | print how to restart GNOME Shell on X11 (it does not do it) |
| `logs`      | follow GNOME Shell logs |
| `doctor`    | check shell version, session, Node, PSI and config |
| `check`     | validate `metadata.json` and the JS syntax |
| `test`      | run the unit tests |
| `pack`      | build `dist/psi-monitor@<HANDLE>.shell-extension.zip` |
| `clean`     | remove `dist/` |

### Workflow

```bash
make test && make install     # after editing extension.js or lib/
# X11: Alt+F2, r, Enter to reload the shell (Wayland: log out and back in)
make logs                     # in another terminal, if something looks wrong
```

`make test` ends with a summary; success is `fail 0`.

### Contributing

Issues and pull requests are welcome. Before opening a pull request, run
`make check && make test`. Keep parsing logic in the GNOME-free modules under
`lib/` and add a test for it.

## Troubleshooting

| Symptom | Likely cause and fix |
|---------|----------------------|
| `make enable` says the extension "does not exist" | GNOME has not discovered it yet. Restart the shell (X11: `Alt+F2`, `r`, `Enter`), then enable again. |
| Badges missing after enabling | `make status` should show `ACTIVE`. If it shows `ERROR`, run `make logs` and look for `psi-monitor` or `JS ERROR`. |
| Badges show `…` | Normal for about 2 s: rates need two samples. |
| `GPU: n/a` | `nvidia-smi` is missing or not in `PATH`, or the GPU is not NVIDIA. |
| Usage looks wrong | Compare with `top` and `nvidia-smi`. If they disagree, open an issue with the `make doctor` output. |
| Colored badges are always green | Normal: PSI is 0 when nothing is stalling. See below to force some load. |
| `psi-monitor: command not found` | `~/.local/bin` is not in `PATH`. See [Usage](#usage). |
| `gnome-extensions pack` crashes | It segfaults on some systems. Use `make pack`, which uses plain `zip`. |

To see PSI move, create load on purpose. For CPU:

```bash
for i in $(seq $(( $(nproc) * 2 ))); do timeout 20 sh -c 'while :; do :; done' & done; wait
```

CPU pressure only rises when there are **more runnable tasks than cores**,
which is why the command starts twice as many busy loops as you have cores.
Each loop ends on its own after 20 s.

## Limitations

- Declares support for GNOME Shell **46** only. Other versions are untested.
- Tested on **X11 only**. Wayland is expected to work but has not been tested.
- GPU support is NVIDIA-only (through `nvidia-smi`).
- The interface text is English only. There is no translation support.
- PSI cannot attribute pressure to a specific disk or core.
- Needs a kernel with PSI enabled (`CONFIG_PSI`, and not turned off with
  `psi=0`).

## License

Copyright (C) the PSI Monitor authors.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. See the [LICENSE](LICENSE) file for the full text.
