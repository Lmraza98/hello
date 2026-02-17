"""Constants for email discovery."""

VALID_PATTERNS = [
    "first.last",   # john.smith@
    "firstlast",    # johnsmith@
    "flast",        # jsmith@
    "first_last",   # john_smith@
    "first-last",   # john-last@
    "first",        # john@
    "f.last",       # j.smith@
    "last.first",   # smith.john@
    "lastfirst",    # smithjohn@
    "last_first",   # smith_john@
    "last",         # smith@
    "lfirst",       # sjohn@
    "fl",           # js@
]

