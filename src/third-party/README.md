# Third-party data

## printables-spool-weights.json

Empty spool weights from the [Empty Spool Weight Catalog](https://www.printables.com/model/464663-empty-spool-weight-catalog)
by **Scuk** and its contributors, licensed under
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). This file is **not** covered by the MIT
license of the rest of the repository, and **commercial use is not allowed**. The app loads it only after the user
confirms non-commercial use in Settings.

Changes: the table was converted to JSON; for weight ranges, `emptyG` is the middle and `minG`/`maxG` the range.
Regenerate with `tools/parse_spool_weight_catalog.py` from a PDF of the page.
