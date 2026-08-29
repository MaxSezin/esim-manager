# luci-app-epm (fork) — MBIM SIM slot + TLS workaround for Foxconn T99W175 / Thales MV31-W

This is a fork of [stich86/luci-app-epm](https://github.com/stich86/luci-app-epm), a LuCI web
interface for OpenWrt that manages eSIM profiles via [lpac](https://github.com/estkme-group/lpac).
All credit for the original app goes to [stich86](https://github.com/stich86) — see
[Acknowledgments](#-acknowledgments) below. This fork exists to support a specific modem/router
combo that needs a couple of things the upstream app doesn't handle yet, and is intended to be
upstreamed as a PR once tested.

## 🎯 **What does this app do?**

**luci-app-epm** is a LuCI web interface for OpenWrt that allows easy management of eSIM profiles
on compatible cellular modules. The application uses **lpac** (Local Profile Agent Client) to
communicate with eSIM modules and provides an intuitive user interface for:

- 📊 **Monitor Status** of eSIM module
- 📥 **Download Profiles** via QR codes or manual entry
- 🔄 **Manage Existing Profiles** (enable/disable/delete/rename)
- 🪛 **Configure LPAC backend and Modem Reboot** (via AT, QMI, MBIM or Custom command)
- 🔔 **Notifications** for status and operations
- 🌐 **Connectivity Testing** before managing eSIM profiles

## 🔀 **What's different in this fork**

Working eSIM (embedded eUICC) on a **Foxconn T99W175 / Thales MV31-W** modem (as used in the
WH3000Pro router, OpenWrt 25.12, `mediatek/filogic`) surfaced two gaps in the upstream app:

1. **MBIM SIM Slot selector.** On this modem, MBIM is the *only* APDU backend that can reach the
   eSIM chip at all (AT and QMI backends don't expose eSIM APDU on this hardware), and the eUICC
   sits on **slot 2**, not slot 1. Upstream already has a "QMI SIM Slot" option but nothing
   equivalent for MBIM, so `lpac` had no way to target the right slot. This fork adds an **MBIM
   SIM Slot** dropdown on the Config tab (mirroring the QMI one), wired to `lpac` via the
   `LPAC_APDU_MBIM_UIM_SLOT` environment variable.

2. **TLS workaround (GnuTLS preload).** Some OpenWrt builds ship a system `libcurl` linked against
   mbedTLS, which fails to validate the SM-DP+ server's certificate chain (root CA `GSM
   Association - RSP2 Root CI1`) with `ssl_handshake returned: (-0x2080) X509 - Unavailable
   feature, e.g. RSA hashing/encryption combination`. Installing a GnuTLS-backed `libcurl` (e.g.
   `apk add libcurl-gnutls4` on apk-based OpenWrt) and running `lpac` with
   `LD_PRELOAD=/usr/lib/libcurl-gnutls.so.4` works around it, since `lpac` links directly against
   `libcurl.so.4` rather than loading it via `dlopen`. This fork adds a **TLS Workaround** toggle
   on the Config tab that does this automatically, with the library path configurable (it can
   differ across targets/architectures) and only applied if the file actually exists.

3. **Fixed a `$` corruption bug in the debug log.** `exec_lpac_command()` logged the already
   shell-quoted `lpac` command by wrapping it in a *second* pair of single quotes
   (`logger -t epm 'Executing: ...'`). Nested single quotes aren't valid in POSIX shell — the
   shell exits the outer quoting partway through and re-expands any `$` still inside the
   already-quoted command, e.g. in an activation code like `LPA:1$smdp.example.com$MATCHINGID`.
   In practice this only corrupted what showed up in `logread`, not the actual profile
   download/enable/delete commands (those run the unwrapped, correctly single-quoted string
   directly) — but it made debugging genuinely confusing, so it's fixed by quoting the whole log
   message as a single argument instead.

4. **Support both `lpac` package layouts.** `exec_lpac_command()` used to hardcode
   `/usr/lib/lpac` as the binary path, which only matches the plain official OpenWrt `lpac`
   package (a single executable file at that path). The community
   [lpac-build](https://github.com/fildunsky/lpac-build) packages — recommended by several
   downstream apps, including `luci-app-5gmodem` — install `lpac` as a *directory*
   (`/usr/lib/lpac/lpac` plus driver plugins under `/usr/lib/lpac/driver/`, needed because OpenWrt
   strips `RUNPATH`), which the old hardcoded path couldn't run at all. This fork now detects which
   layout is present and calls the right one, setting `LPAC_DRIVER_HOME` when needed — no more
   editing this path by hand when switching between the official package and `lpac-build`.

See [asset/test_modem_esim.md](asset/test_modem_esim.md) for the updated compatibility notes on
the T99W175/MV31-W row.

**🚀 Happy eSIM managing!** If the app is useful to you, leave a ⭐ on the
[original repo](https://github.com/stich86/luci-app-epm)!

## 🛠️ **Requirements**

- OpenWrt with LuCI interface
- Packages `lpac`, `uqmi`, `mbimcli` and `coreutils-timeout` installed — either the plain official
  OpenWrt `lpac` package, or a [lpac-build](https://github.com/fildunsky/lpac-build) release; both
  layouts are auto-detected (see above)
- Cellular module with eSIM (physical or embedded) support
- Internet connection (for profile download and delete)
- For the TLS workaround: a GnuTLS-backed `libcurl` installed separately (e.g.
  `libcurl-gnutls4` on apk-based OpenWrt 24.x+)
> **Note**: MBIM support needs at least LPAC 2.2.0 version

## Links

- [Tested Modules and eSIMs](asset/test_modem_esim.md)
- [Screenshots](asset/screenshots.md)
- [Installation](asset/installation.md)

## 🤝 **Contributing**

This fork is meant as a stepping stone toward a PR back to
[stich86/luci-app-epm](https://github.com/stich86/luci-app-epm). Bug reports and testing on other
MBIM-based modems are welcome — please open an [Issue](https://github.com/MaxSezin/esim-manager/issues)
here, or check the [upstream repo](https://github.com/stich86/luci-app-epm) for the general
project.

## 🙏 **Acknowledgments**

- **[stich86](https://github.com/stich86)** for the original `luci-app-epm`
- **[estkme-group](https://github.com/estkme-group/lpac)** for the fantastic lpac eSIM client
- **[cozmo](https://github.com/cozmo/jsQR)** for his JavaScript QRCode library
- **[OpenWrt community & LuCI developers](https://openwrt.org/)** for the ecosystem
