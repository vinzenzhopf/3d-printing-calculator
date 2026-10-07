# Import prints

Two ways to fill the print log without typing every print in:

1. **[Live](#live-detect-prints-as-they-finish):** Home Assistant notices when a print finishes and hands it to the
   app. Set it up once, and every print shows up by itself.
2. **[Past prints](#past-prints):** read a printer's own history file once, e.g. when you start with the app.

Both use the same rule: a print that is already in the log is never added twice.

## Live: detect prints as they finish

### How it works

```
printer ──▶ Home Assistant ──▶ print-inbox/<end time>-<printer>.json ──▶ app: Print log → Detected prints
            (automation)        (in your private sync repository)
```

1. Home Assistant watches the printer's state through its integration (OctoPrint, PrusaLink, Bambu Lab, Klipper).
2. When a print starts, an automation remembers the time. When it ends, the automation writes **one small JSON file**
   into the `print-inbox/` folder of your sync repository on GitHub: printer, file name, start, end, print time and
   result (success, failed or cancelled), plus the grams if the printer reports them.
3. The app reads the folder when you open the print log (and on *Refresh*) and lists the prints under
   **Detected prints**.

One file per print means Home Assistant never touches your data file, so nothing is ever edited at the same time from
two places, and repeated prints of the same file stay separate entries.

### What you do in the app

- **Add…** opens a pre-filled print log entry. The model name comes from the file name; if a quote plate has the same
  file or model name, its filaments, grams and quote link are taken over. Pick the spool, check, save.
- **Add all** logs every detected print as it is, e.g. after a busy week. Grams without a chosen filament are kept by
  weight (with the material from the file name) and count in the statistics; you can assign the filament later.
- **Dismiss** drops a print you don't want in the log (a test print, a calibration).

Either way the inbox file is deleted, so the list only shows what is still open.

**Tip:** let your slicer write the grams into the file name, e.g. PrusaSlicer's output template
`{input_filename_base}_{nozzle_diameter[0]}n_{layer_height}mm_{printing_filament_types}_{printer_model}_{print_time}_{total_weight}g`
→ `hit-turm-handy_0.6n_0.3mm_PLA_MK3S_4h31m_110.5g.gcode`. The app reads the model name, grams, material, layer
height and nozzle from it.

### What you need

- **GitHub sync** set up in the app (Settings → Data & sync); the inbox lives in the same private repository.
- **Home Assistant** with the integration for your printer, and a separate GitHub token for it (write access to the
  data repository only).
- A **REST command** (a few lines of YAML), a **date/time helper** and an **automation** (pasted in the UI).

| Printer | Home Assistant integration | Grams reported |
|---|---|---|
| OctoPrint (e.g. Prusa MK3S+) | [OctoPrint](https://www.home-assistant.io/integrations/octoprint/) (built in) | no, use the file name |
| Prusa MK4 / CORE One / XL | [PrusaLink](https://www.home-assistant.io/integrations/prusalink/) (built in) | no, use the file name |
| Bambu Lab | [ha-bambulab](https://github.com/greghesp/ha-bambulab) (HACS) | yes (print weight) |
| Klipper | [Moonraker](https://github.com/marcolivierarsenault/moonraker-home-assistant) (HACS) | no, use the file name |

**→ Step-by-step setup: [Detect prints with Home Assistant](home-assistant.md)** (token, REST command, helper,
automation, and the changes for other printers). The OctoPrint version is the tested one.

## Past prints

**Print log → Import prints…** reads one of the files below and adds what is not in the log yet. Prints already in
the log are skipped, so you can import again later. The filament is logged with its material but without a color: it
counts in the statistics, not in the stock (assign a filament later if you like).

| Source | File | How to get it |
|---|---|---|
| OctoPrint | `.metadata.json` | `scp pi@octopi.local:~/.octoprint/uploads/.metadata.json .` (one entry per print of every file still uploaded; grams from the slicer analysis) |
| Klipper / Moonraker | history JSON | open `http://<printer>:7125/server/history/list?limit=1000` in the browser and save the page |
| Anything else | CSV | a header row with a date column (`date`, `finished`), optionally `name`/`file`, `print time`/`minutes` (`1:30`, `4h12m` or minutes), `weight (g)`/`grams`, `status`/`result`, `material`. `,`, `;` and tabs work, dates as `2026-10-03 12:52` or `03.10.2026 12:52`. |

Notes:

- OctoPrint forgets prints of files you deleted there, and does not record prints from the printer's SD card. It also
  does not tell failed from cancelled: unsuccessful prints are logged as *cancelled*.
- **Bambu Lab** has no export of the print history in Handy or Studio; tools like Bambuddy can export it as CSV.
  **Prusa Connect** has no export either; use the [live detection with Home Assistant](home-assistant.md).
- For a large OctoPrint history there is also a command-line import that writes directly into the data repository:
  `python tools/import_octoprint_history.py .metadata.json <data-repo>/3d-printing-calculator.json --printer <id>`
  (`--dry-run` first). Close the app on other devices (or sync them first) before pushing.
