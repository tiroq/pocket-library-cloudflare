# X3 Calendar — CrossPoint SD plugin

Automatically downloads the latest private Pocket Library calendar to `/sleep.bmp` **before** the reader goes to sleep.

## Required firmware

Requires a CrossPoint build that implements **SD Plugin Events / `sleep.enter`** (currently in the upstream `develop` branch). **CrossPoint 1.6.5 stable does not implement this event; installing the plugin alone will do nothing.** Verify support in [upstream docs](https://github.com/crosspoint-reader/crosspoint-reader/blob/develop/docs/plugin-events.md) before changing firmware.

## SD setup

1. Generate `config.json` **locally** using `bash scripts/make-x3-plugin-config.sh` from the Pocket Library repository. Enter the existing reader password (**READ_PASSWORD**, not UPLOAD_TOKEN). Never commit `config.json`.
2. Copy the folder `plugins/x3-calendar` to the SD card **as** `/.crosspoint/plugins/x3-calendar/`, including `device.json`, `README.md`, and the generated `config.json`.
3. In CrossPoint select **Settings → Display → Sleep Screen → Custom** (not Cover + Custom when sleeping directly out of a book).
4. Connect once to your saved 2.4 GHz Wi-Fi network; restart the reader to register the plugin.
5. Run the iPhone Shortcut at least once **after deploying the updated Worker** so `dashboard/current-1bit.bmp` exists. Then put the reader to sleep to test.

When sleeping, the plugin sends an HTTPS GET with a **read-only Basic** credential; no upload/delete credential is present on the device. It streams the < 1 MiB 1-bit BMP directly into a temporary file, then replaces `/sleep.bmp` on successful download. On offline/HTTP errors, the old file remains. Cloudflare R2 stays private.

### Security

`config.json` contains `Authorization: Basic ...` credentials encoded with Base64, **not encrypted**. Keep the SD card and generated files private. Never commit or screenshot this file, and never use `UPLOAD_TOKEN` in it. All requests use HTTPS.

For full troubleshooting, see [calendar-dashboard.md](../../docs/calendar-dashboard.md).
