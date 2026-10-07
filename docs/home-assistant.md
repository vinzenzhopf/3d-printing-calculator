# Detect prints with Home Assistant

Step-by-step setup for the [live print detection](import-prints.md#live-detect-prints-as-they-finish): Home Assistant
writes one small JSON file per finished print into the `print-inbox/` folder of your **sync repository**, and the app
lists them under **Print log → Detected prints**. How it works and what you do in the app is described
[there](import-prints.md#live-detect-prints-as-they-finish).

The setup below uses OctoPrint; [other printers](#other-printers) work the same way.

Requirements: the app's GitHub sync is set up (the inbox lives in the same private repository), and the
[OctoPrint integration](https://www.home-assistant.io/integrations/octoprint/) is configured in Home Assistant.

One file per print means nothing is ever edited concurrently: Home Assistant only creates new files and never
touches your data file.

## 1. Token

Create a separate [fine-grained token](https://github.com/settings/personal-access-tokens/new) for Home Assistant:
repository access **only your data repository**, permission **Contents: Read and write**. Keeping it separate
from the app's token lets you revoke it on its own.

Add it to `secrets.yaml`:

```yaml
github_print_inbox_auth: "Bearer github_pat_..."
```

## 2. REST command (package file)

Home Assistant has no UI for HTTP requests, so this one part is YAML. With
[packages](https://www.home-assistant.io/docs/configuration/packages/) enabled in `configuration.yaml`:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

create `packages/print_inbox.yaml` (replace `<owner>/<repo>` with your data repository):

```yaml
rest_command:
  print_inbox:
    url: "https://api.github.com/repos/<owner>/<repo>/contents/print-inbox/{{ name }}.json"
    method: PUT
    headers:
      Authorization: !secret github_print_inbox_auth
      Accept: application/vnd.github+json
      X-GitHub-Api-Version: "2022-11-28"
    content_type: application/json
    payload: >-
      {"message": {{ ('Detected print: ' ~ result ~ ' ' ~ file) | to_json }},
       "content": "{{ {'version': 1, 'source': 'home-assistant/octoprint', 'printer': printer, 'file': file,
                       'startedAt': started, 'finishedAt': finished, 'durationMin': duration | int,
                       'result': result} | to_json | base64_encode }}"}
```

Restart Home Assistant (or reload *REST commands*). Test it under **Developer tools → Actions** with
`rest_command.print_inbox` and data such as
`{name: test, printer: mk3s, file: test.gcode, started: "2026-10-03T08:00:00+02:00", finished: "2026-10-03T09:00:00+02:00", duration: 60, result: success}`.
The file should appear in `print-inbox/` and in the app under *Detected prints* (dismiss it there).

## 3. Helper (UI)

**Settings → Devices & services → Helpers → Create helper → Date and/or time**, name `3D print start`,
*Date and time*. It stores when the current print started (a pause does not reset it). Entity:
`input_datetime.3d_print_start`.

## 4. Automation (UI)

**Settings → Automations → Create automation → ⋮ → Edit in YAML**, paste, save. Adjust `printer: mk3s` to the
*Inbox key* of the printer in the app (Settings → Printers → Edit), and the entity IDs if yours differ.

```yaml
alias: 3D printer – print inbox
description: Pre-creates a print log entry in the 3D Printing Calculator for every print that ends.
mode: queued
triggers:
  - trigger: state
    entity_id: sensor.octoprint_current_state
    to: [printing, printing_sd, printing_streaming]
    id: start
  - trigger: state
    entity_id: sensor.octoprint_current_state
    # Final states only: "finishing" / "cancelling" are in-between states (and often skipped by the
    # 30 s polling); they are checked as the from-state below. "offline": printer switched off right after a print.
    to: [operational, error, offline_after_error, offline]
    id: end
actions:
  - choose:
      - conditions:
          - condition: trigger
            id: start
          # Resuming after a pause is not a new print.
          - condition: template
            value_template: "{{ trigger.from_state.state not in ['paused', 'pausing', 'resuming'] }}"
        sequence:
          - action: input_datetime.set_datetime
            target:
              entity_id: input_datetime.3d_print_start
            data:
              datetime: "{{ now().strftime('%Y-%m-%d %H:%M:%S') }}"
      - conditions:
          - condition: trigger
            id: end
          - condition: template
            value_template: >-
              {{ trigger.from_state.state in ['printing', 'printing_sd', 'printing_streaming', 'finishing',
                 'cancelling', 'pausing', 'paused', 'resuming']
                 and states('input_datetime.3d_print_start') not in ['unknown', 'unavailable', ''] }}
        sequence:
          - variables:
              start: "{{ states('input_datetime.3d_print_start') | as_datetime | as_local }}"
          - action: rest_command.print_inbox
            data:
              # One file per print: end time + printer, so repeated prints and several printers never collide.
              name: "{{ now().strftime('%Y%m%d-%H%M%S') }}-mk3s"
              printer: mk3s
              file: "{{ states('sensor.octoprint_current_file') }}"
              started: "{{ (states('input_datetime.3d_print_start') | as_datetime | as_local).isoformat() }}"
              finished: "{{ now().isoformat() }}"
              duration: >-
                {{ ((now() - (states('input_datetime.3d_print_start') | as_datetime | as_local)).total_seconds() / 60)
                   | round(0) | int }}
              result: >-
                {% if trigger.to_state.state in ['error', 'offline_after_error']
                      or is_state('binary_sensor.octoprint_printing_error', 'on')
                      or (trigger.to_state.state == 'offline' and trigger.from_state.state != 'finishing') %}failed
                {%- elif trigger.from_state.state == 'cancelling'
                      or states('sensor.octoprint_job_percentage') | float(0) < 99.5 %}cancelled
                {%- else %}success{% endif %}
```

Notes:

- The OctoPrint integration polls about every 30 seconds, so times are accurate to roughly half a minute, and
  short states like *finishing* or *cancelling* can be skipped. The result therefore also looks at the job
  percentage: below 99.5 % counts as *cancelled*.
- The duration includes pauses (wall-clock time). Correct it in the app if needed.
- Only final states trigger the end (`operational`, `error`, `offline_after_error`, `offline`). `finishing` and
  `cancelling` are recognized as the state the print came from, so a print is never logged twice.
- **Grams from the file name:** if your slicer writes the filament weight into the G-code name, the app pre-fills it.
  PrusaSlicer *Output filename format*, for example:
  `{input_filename_base}_{nozzle_diameter[0]}n_{layer_height}mm_{printing_filament_types}_{printer_model}_{print_time}_{total_weight}g.gcode`
  → `hit-turm-handy_0.6n_0.3mm_PLA_MK3S_4h31m_110.526g.gcode`. Parts are recognized by their shape (`110.5g`,
  `4h31m`, `0.3mm`, `0.6n`), so order and extra parts don't matter; the model name is what comes before them.
- Printing the same file several times creates one inbox file (and one log entry) per print. The inbox file is
  named after the end time and printer, not after the G-code file.
- Inbox file format (version 1): `{"version": 1, "source": "...", "printer": "<inbox key>", "file": "...",
  "startedAt": "<ISO>", "finishedAt": "<ISO>", "durationMin": 260, "result": "success|failed|cancelled"}`, optionally
  `"grams": 87.5` and `"material": "PETG"` when the source knows the filament used. Any other tool can write the
  same format.

## Other printers

The automation only needs a sensor whose state changes when a print starts and ends, plus the job name. Adjust the
entity IDs and state lists to your integration (check them under *Developer tools → States* during a print):

- **Prusa MK4 / CORE One / XL (PrusaLink):** the built-in
  [PrusaLink integration](https://www.home-assistant.io/integrations/prusalink/) has a printer state sensor
  (`printing` while printing; `finished`, `stopped` or `error` at the end) and a job filename sensor. Use those as
  the start/end triggers and the file; map `stopped` to *cancelled* and `error` to *failed*.
- **Bambu Lab:** the community integration [ha-bambulab](https://github.com/greghesp/ha-bambulab) has a print status
  sensor (`running` while printing; `finish` or `failed` at the end), a task name sensor and a **print weight** sensor
  (grams). Send the weight as `grams` (and the material as `material`, if you like) in the REST command, then the
  app pre-fills the filament used.
- **Klipper (Moonraker):** use the [Moonraker integration](https://github.com/marcolivierarsenault/moonraker-home-assistant)
  the same way, or simply [import its history](import-prints.md) now and then.

Give each printer its own *Inbox key* (Settings → Printers → Edit) and use it as `printer` and in the file `name`.
